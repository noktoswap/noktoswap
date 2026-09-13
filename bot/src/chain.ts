import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { noktoswapAbi } from '../../web/src/lib/abi'
import type { Config } from './config'

/**
 * The EVM half: one public client for reads, one wallet client for writes.
 *
 * Deliberately viem rather than the `@wagmi/core` config the browser client
 * uses. wagmi exists to manage *connectors* — a user choosing a wallet, a chain
 * being switched underneath you, an account that can disappear mid-session. A bot
 * has one key, one chain and no user, so all of that is answered at startup and
 * the connector machinery would only add ways for the answer to change.
 *
 * Everything money-related is read from the contract at the moment it is needed,
 * never from the indexer. The subgraph lags by design; `take` does not. That rule
 * is the browser client's too, and it matters more here, because nothing pauses to
 * let a human notice a stale figure.
 */

export type Parameters = {
  minimumOffer: bigint
  maximumOffer: bigint
  depositRatio: bigint
  maximumBookSize: bigint
  t0Delay: bigint
  t1Delay: bigint
}

export const DEPOSIT_DENOMINATOR = 10_000n

export type OnChainOffer = {
  id: bigint
  kind: 'BUY' | 'SELL' | 'INVALID'
  state: 'INVALID' | 'OPEN' | 'TAKEN' | 'READY' | 'CLAIMED' | 'REFUNDED' | 'CANCELLED'
  owner: Address
  counterparty: Address
  amount: bigint
  deposit: bigint
  xmrAmount: bigint
  t0: bigint
  t1: bigint
  blockTaken: bigint
  evmPublicSpendKey: bigint
  evmPublicViewKey: bigint
  evmPrivateSpendKey: bigint
  evmPrivateViewKey: bigint
  xmrPublicSpendKey: bigint
  xmrPrivateViewKey: bigint
  xmrPrivateSpendKey: bigint
}

const KINDS = ['INVALID', 'BUY', 'SELL'] as const
const STATES = ['INVALID', 'OPEN', 'TAKEN', 'READY', 'CLAIMED', 'REFUNDED', 'CANCELLED'] as const

export class Chain {
  readonly reader: PublicClient
  private readonly writer: WalletClient
  readonly contract: Address

  constructor(private readonly config: Config) {
    const chain = config.chain.chain
    const transport = http(config.rpcUrl)
    this.reader = createPublicClient({ chain, transport })
    this.writer = createWalletClient({ chain, transport, account: config.account })
    this.contract = config.chain.deployment as Address
  }

  async parameters(): Promise<Parameters> {
    const raw = (await this.reader.readContract({
      address: this.contract,
      abi: noktoswapAbi,
      functionName: 'parameters',
    })) as unknown as Record<string, bigint> | readonly bigint[]

    // The getter may come back as a struct or a tuple depending on ABI shape.
    const at = (index: number, name: string): bigint =>
      Array.isArray(raw) ? (raw[index] as bigint) : ((raw as Record<string, bigint>)[name] as bigint)

    return {
      minimumOffer: at(0, 'MINIMUM_OFFER'),
      maximumOffer: at(1, 'MAXIMUM_OFFER'),
      depositRatio: at(2, 'DEPOSIT_RATIO'),
      maximumBookSize: at(3, 'MAXIMUM_OFFER_BOOK_SIZE'),
      t0Delay: at(4, 'T0_DELAY'),
      t1Delay: at(5, 'T1_DELAY'),
    }
  }

  async offer(id: bigint): Promise<OnChainOffer> {
    const raw = (await this.reader.readContract({
      address: this.contract,
      abi: noktoswapAbi,
      functionName: 'offers',
      args: [id],
    })) as unknown as Record<string, unknown>
    return normalise(raw)
  }

  /** `listOffers(offset, count, reverse)` — the contract's own pagination. */
  async listOffers(offset: bigint, count: bigint, reverse = true): Promise<OnChainOffer[]> {
    const raw = (await this.reader.readContract({
      address: this.contract,
      abi: noktoswapAbi,
      functionName: 'listOffers',
      args: [offset, count, reverse],
    })) as unknown as Record<string, unknown>[]
    return raw.map(normalise).filter((offer) => offer.kind !== 'INVALID')
  }

  async nextOfferId(): Promise<bigint> {
    return (await this.reader.readContract({
      address: this.contract,
      abi: noktoswapAbi,
      functionName: 'nextOfferId',
    })) as bigint
  }

  async ethBalance(): Promise<bigint> {
    return this.reader.getBalance({ address: this.config.account.address })
  }

  /**
   * Simulate, then send. The simulation is not optional politeness — it turns a
   * revert into a named error before it costs gas, and the contract's reverts are
   * specific enough to act on (`ErrorOfferNotOpen` means someone else took it,
   * which is a normal race rather than a bug).
   */
  async write(
    functionName: string,
    args: readonly unknown[],
    value?: bigint,
  ): Promise<{ hash: Hex; simulated: true } | { hash: null; simulated: false; reason: string }> {
    try {
      const { request } = await this.reader.simulateContract({
        address: this.contract,
        abi: noktoswapAbi,
        functionName: functionName as never,
        args: args as never,
        account: this.config.account,
        ...(value === undefined ? {} : { value }),
      })
      if (this.config.mode === 'dry-run') {
        return { hash: null, simulated: false, reason: 'dry run — simulated only, nothing sent' }
      }
      const hash = await this.writer.writeContract(request as never)
      return { hash, simulated: true }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      // viem's messages are long; the first line carries the revert name.
      return { hash: null, simulated: false, reason: message.split('\n')[0] ?? message }
    }
  }

  async waitFor(hash: Hex) {
    return this.reader.waitForTransactionReceipt({ hash })
  }
}

const normalise = (raw: Record<string, unknown>): OnChainOffer => {
  const big = (key: string): bigint => (raw[key] as bigint | undefined) ?? 0n
  return {
    id: big('id'),
    kind: KINDS[Number(raw['kind'] ?? 0)] ?? 'INVALID',
    state: STATES[Number(raw['state'] ?? 0)] ?? 'INVALID',
    owner: raw['owner'] as Address,
    counterparty: raw['counterparty'] as Address,
    amount: big('amount'),
    deposit: big('deposit'),
    xmrAmount: big('xmrAmount'),
    t0: big('t0'),
    t1: big('t1'),
    blockTaken: big('blockTaken'),
    evmPublicSpendKey: big('evmPublicSpendKey'),
    evmPublicViewKey: big('evmPublicViewKey'),
    evmPrivateSpendKey: big('evmPrivateSpendKey'),
    evmPrivateViewKey: big('evmPrivateViewKey'),
    xmrPublicSpendKey: big('xmrPublicSpendKey'),
    xmrPrivateViewKey: big('xmrPrivateViewKey'),
    xmrPrivateSpendKey: big('xmrPrivateSpendKey'),
  }
}

/**
 * What `msg.value` has to be to open an offer of a given ETH size.
 *
 * Mirrors the contract exactly, and the asymmetry is the whole reason a market
 * maker needs two balances:
 *
 *   BUY  — the maker is the EVM side and escrows the *full* amount. It is buying
 *          XMR with ETH, so the ETH is the consideration.
 *   SELL — the maker is the XMR side and escrows only a *deposit*, a fraction set
 *          by DEPOSIT_RATIO. It is selling XMR, so the XMR is the consideration
 *          and the ETH is collateral against walking away.
 *
 * The contract derives the other figure from `msg.value`, so an off-by-one in the
 * rounding here posts an offer of a different size than intended. `SELL` rounds
 * the way the contract's integer division does, deliberately.
 */
export const valueToOpen = (kind: 'BUY' | 'SELL', ethAmount: bigint, depositRatio: bigint): bigint =>
  kind === 'BUY' ? ethAmount : (ethAmount * depositRatio) / DEPOSIT_DENOMINATOR

/** What `msg.value` has to be to take an existing offer. */
export const valueToTake = (offer: OnChainOffer): bigint =>
  offer.kind === 'BUY' ? offer.deposit : offer.amount

/** Which side of the trade an address is on, for an offer that has been taken. */
export const sideOf = (offer: OnChainOffer, who: Address): 'evm' | 'xmr' | null => {
  const me = who.toLowerCase()
  const owner = offer.owner.toLowerCase()
  const other = offer.counterparty.toLowerCase()
  if (me === owner) return offer.kind === 'BUY' ? 'evm' : 'xmr'
  if (me === other) return offer.kind === 'BUY' ? 'xmr' : 'evm'
  return null
}
