import { arbitrum, base, mainnet, optimism, sepolia } from 'viem/chains'
import type { Address, Chain } from 'viem'

/**
 * The wireframes draw four chains. Exactly one of them has a Noktoswap
 * deployment today, and the chain list is honest about which.
 *
 * `deployment` null does not mean "hide it": the chain picker still lists the
 * chain, still shows the balance the Token API reports for it, and says plainly
 * that there is nothing to trade there. Fabricating open counts for a chain with
 * no contract would be the one thing worse than an empty book.
 */
export type ChainInfo = {
  readonly chain: Chain
  readonly label: string
  /** Noktoswap market contract, or null where the protocol is not deployed. */
  readonly deployment: Address | null
  /** First block the contract existed at — the floor for any log query. */
  readonly deployedAtBlock: bigint | null
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

const SEPOLIA: ChainInfo = {
  chain: sepolia,
  label: 'Sepolia',
  deployment: '0x67DB37c3be37B44c0506e5DF441437C83114bCd2',
  deployedAtBlock: 11670176n,
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
    deployment: null,
    deployedAtBlock: null,
    tokenApiNetwork: 'mainnet',
    uniswapRoutable: true,
    explorer: 'https://etherscan.io',
    moneroMainnet: true,
  },
  {
    chain: base,
    label: 'Base',
    deployment: null,
    deployedAtBlock: null,
    tokenApiNetwork: 'base',
    uniswapRoutable: true,
    explorer: 'https://basescan.org',
    moneroMainnet: true,
  },
  {
    chain: arbitrum,
    label: 'Arbitrum',
    deployment: null,
    deployedAtBlock: null,
    tokenApiNetwork: 'arbitrum-one',
    uniswapRoutable: true,
    explorer: 'https://arbiscan.io',
    moneroMainnet: true,
  },
  {
    chain: optimism,
    label: 'Optimism',
    deployment: null,
    deployedAtBlock: null,
    tokenApiNetwork: 'optimism',
    // Routable, but AMM-only: UniswapX does not fill here.
    uniswapRoutable: true,
    explorer: 'https://optimistic.etherscan.io',
    moneroMainnet: true,
  },
] as const

/** The chain the subgraph indexes, and the only one an offer can live on. */
export const HOME_CHAIN: ChainInfo = SEPOLIA

export const chainInfo = (id: number | undefined): ChainInfo | undefined =>
  CHAINS.find((c) => c.chain.id === id)

export const chainLabel = (id: number | undefined): string =>
  chainInfo(id)?.label ?? (id === undefined ? 'Unknown chain' : `Chain ${id}`)

/** Chains with a market contract — the only ones an offer can be opened on. */
export const tradableChains = (): readonly ChainInfo[] => CHAINS.filter((c) => c.deployment !== null)

/** Uniswap's sentinel for a chain's native currency. */
export const NATIVE = '0x0000000000000000000000000000000000000000' as const

export const isNative = (address: string): boolean =>
  address.toLowerCase() === NATIVE || address.toLowerCase() === 'eth'
