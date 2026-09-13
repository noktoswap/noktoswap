import { base, mainnet, optimism, sepolia } from 'viem/chains'
import type { Address, Chain } from 'viem'

/**
 * Where the protocol is, and where its book is — which are two different facts.
 *
 * `deployment` is whether a contract exists. `subgraph` is whether this app can
 * *list* its offers. Every chain offered right now has both, but they stay
 * separate fields because they come apart the moment one moves ahead of the
 * other — Base Sepolia sat here deployed and unindexed until Studio's subgraph
 * limit made it unshippable, and mainnet and Base each spent a while in that
 * state before their indexers went up.
 *
 * Collapsing them into one flag would make the picker report "0 open" for a chain
 * it simply cannot see, which is a claim about the market rather than about our
 * coverage — the kind of confident wrong number this app avoids elsewhere. So a
 * chain with no contract says "not deployed", a deployed chain with no indexer
 * says so too, and neither invents a count.
 */
export type ChainInfo = {
  readonly chain: Chain
  readonly label: string
  /** Noktoswap market contract, or null where the protocol is not deployed. */
  readonly deployment: Address | null
  /** First block the contract existed at — the floor for any log query. */
  readonly deployedAtBlock: bigint | null
  /**
   * The Studio slug indexing this chain, or null if nothing does.
   *
   * A subgraph targets exactly one network — every data source in a manifest must
   * share it — so three indexed chains means three subgraphs and three query
   * URLs, not one multi-chain subgraph. The client merges them.
   *
   * A deployed chain with no slug can still be read from the contract and traded
   * on by id; it just has no browsable book.
   */
  readonly subgraph: string | null
  /**
   * `network` value the Graph Token API keys balances by, or null where the API
   * does not cover the chain. Its enum is mainnets only — Sepolia is not in it,
   * so balances are genuinely unavailable on the home chain.
   */
  readonly tokenApiNetwork: string | null
  /** Routable by the Uniswap Trading API. Its ChainId enum is the authority. */
  readonly uniswapRoutable: boolean
  readonly explorer: string
  /**
   * Which Monero network the escrow addresses on this chain belong to.
   *
   * Tied to the EVM chain rather than configured separately, because the pairing
   * is the safety property: a Sepolia escrow must not hand out a *mainnet* XMR
   * address, or someone sends real coins against a testnet trade.
   */
  readonly moneroMainnet: boolean
}

/**
 * The CREATE3 address, identical on every chain deployed after it.
 *
 * Sepolia predates it and keeps its own address — which is the whole reason
 * `deployment` is per-chain rather than one constant.
 */
export const CREATE3_ADDRESS = '0x4862839b11a6013FCC2A5f5AD2bA438Cac742d8C' as const

const SEPOLIA: ChainInfo = {
  chain: sepolia,
  label: 'Sepolia',
  // Predates the CREATE3 deployment, and the only chain the subgraph indexes.
  deployment: '0x67DB37c3be37B44c0506e5DF441437C83114bCd2',
  deployedAtBlock: 11670176n,
  subgraph: 'xmrp-2-p',
  tokenApiNetwork: null,
  uniswapRoutable: true,
  explorer: 'https://sepolia.etherscan.io',
  // Testnet EVM ⇒ stagenet XMR. Never real coins against a Sepolia escrow.
  moneroMainnet: false,
}

export const CHAINS: readonly ChainInfo[] = [
  SEPOLIA,
  {
    chain: mainnet,
    label: 'Ethereum',
    deployment: CREATE3_ADDRESS,
    deployedAtBlock: 25962326n,
    subgraph: 'noktoswap-mainnet',
    tokenApiNetwork: 'mainnet',
    uniswapRoutable: true,
    explorer: 'https://etherscan.io',
    moneroMainnet: true,
  },
  {
    chain: base,
    label: 'Base',
    deployment: CREATE3_ADDRESS,
    deployedAtBlock: 51219297n,
    subgraph: 'noktoswap-base',
    tokenApiNetwork: 'base',
    uniswapRoutable: true,
    explorer: 'https://basescan.org',
    moneroMainnet: true,
  },
] as const

/**
 * Chains wagmi needs a transport for, but which the UI never offers.
 *
 * Arbitrum and Optimism used to sit in `CHAINS` with `deployment: null`, as
 * placeholders for where the protocol could go. That earns its place only if a
 * reader gains something from seeing them, and they did not: the picker listed
 * two networks that could show no book, hold no offer, and be traded on by
 * nobody. So they are gone from the list a user sees.
 *
 * Optimism cannot leave the wagmi config, though, and this is the trap. Nothing
 * is deployed there, but Chainlink's mainnet XMR/USD proxy is decommissioned and
 * reverts, so `lib/oracle.ts` reads the *Optimism* pair — whatever chain the
 * wallet is on. Drop it from `createConfig`'s chain list and `readContract` has
 * no transport for chain 10, the read throws, and the rate ladder silently loses
 * its last rung: `Market ~—` on an empty book, which is the exact bug the ladder
 * was built to fix.
 *
 * Hence two lists. This one is reachable; `CHAINS` is offerable. A chain here has
 * no `ChainInfo`, so `chainInfo(10)` is `undefined` and `chainLabel(10)` reads
 * "Chain 10" — correct, because it is not somewhere this app trades.
 */
export const READ_ONLY_CHAINS: readonly Chain[] = [optimism] as const

/**
 * The chain to act on when nothing else decides it — a fresh offer, a wallet on a
 * chain with no contract.
 *
 * Deliberately not "the chain the book lives on" any more: the book spans every
 * indexed chain, and an offer's own chain travels with it. Anywhere this is used
 * as a stand-in for an offer's chain is a bug.
 */
export const DEFAULT_CHAIN: ChainInfo = SEPOLIA

/** Chains whose books can be listed. One subgraph each. */
export const indexedChains = (): readonly ChainInfo[] =>
  CHAINS.filter((c) => c.subgraph !== null)

/** Chains with a contract whose offers cannot be listed from here. */
export const deployedButUnindexed = (): readonly ChainInfo[] =>
  CHAINS.filter((c) => c.deployment !== null && c.subgraph === null)

/** True where an offer can actually be opened. */
export const isTradable = (chainId: number | undefined): boolean =>
  chainInfo(chainId)?.deployment != null

export const chainInfo = (id: number | undefined): ChainInfo | undefined =>
  CHAINS.find((c) => c.chain.id === id)

/**
 * Test money and real money are different markets, and the book must never mix
 * them.
 *
 * The design's "one book, not four" is about mainnets a trader moves between with
 * a single wallet prompt — here Ethereum and Base. Sepolia is in this app only
 * because it is where the contract landed first, and a testnet offer surfacing in
 * a mainnet book is not one market; it is play money priced beside real money.
 *
 * It compounds with the Monero pairing: a testnet chain yields a *stagenet*
 * escrow address. Letting the realms share a book is how someone ends up looking
 * at a stagenet address in a mainnet context.
 */
export type Realm = 'mainnet' | 'testnet'

export const realmOf = (chainId: number | undefined): Realm =>
  chainInfo(chainId)?.chain.testnet ? 'testnet' : 'mainnet'

export const sameRealm = (a: number | undefined, b: number | undefined): boolean =>
  realmOf(a) === realmOf(b)

/** The indexed chains a given chain is allowed to see offers from. */
export const visibleChains = (from: number | undefined): readonly ChainInfo[] =>
  indexedChains().filter((c) => sameRealm(c.chain.id, from))

export const chainLabel = (id: number | undefined): string =>
  chainInfo(id)?.label ?? (id === undefined ? 'Unknown chain' : `Chain ${id}`)

/** Chains with a market contract — the only ones an offer can be opened on. */
export const tradableChains = (): readonly ChainInfo[] => CHAINS.filter((c) => c.deployment !== null)

/** Uniswap's sentinel for a chain's native currency. */
export const NATIVE = '0x0000000000000000000000000000000000000000' as const

export const isNative = (address: string): boolean =>
  address.toLowerCase() === NATIVE || address.toLowerCase() === 'eth'
