import { readContract, simulateContract, waitForTransactionReceipt, writeContract } from '@wagmi/core'
import { toEventSelector, type Address, type Hex } from 'viem'
import { xmrp2pAbi } from './abi'
import { chainInfo } from './chains'
import { OFFER_KIND, OFFER_STATE, type OfferKind, type OfferState } from './offers'
import { config } from './wagmi'

const marketAddress = (chainId: number): Address => {
  const deployment = chainInfo(chainId)?.deployment
  if (!deployment) throw new Error(`Noktoswap is not deployed on ${chainInfo(chainId)?.label ?? chainId}`)
  return deployment
}

/**
 * The full on-chain offer, key material included.
 *
 * `offers(id)` returns a flat 19-tuple. Naming it here is not decoration: the
 * key fields are only reachable this way — the subgraph deliberately publishes
 * reveals as booleans and never the values, so a client that needs an actual
 * key reads it from the contract, for the single offer it is party to.
 */
export type OnchainOffer = {
  id: bigint
  kind: OfferKind | 'INVALID'
  state: OfferState | 'INVALID'
  owner: Address
  counterparty: Address
  amount: bigint
  deposit: bigint
  xmrAmount: bigint
  lastupdate: bigint
  blockTaken: bigint
  evmPublicSpendKey: bigint
  evmPrivateSpendKey: bigint
  evmPublicViewKey: bigint
  evmPrivateViewKey: bigint
  xmrPublicSpendKey: bigint
  xmrPrivateSpendKey: bigint
  xmrPrivateViewKey: bigint
  t0: bigint
  t1: bigint
}

type OffersTuple = readonly [
  bigint, number, number, Address, Address,
  bigint, bigint, bigint, bigint, bigint,
  bigint, bigint, bigint, bigint, bigint, bigint, bigint,
  bigint, bigint,
]

const decodeOffer = (tuple: OffersTuple): OnchainOffer => ({
  id: tuple[0],
  kind: OFFER_KIND[tuple[1]] ?? 'INVALID',
  state: OFFER_STATE[tuple[2]] ?? 'INVALID',
  owner: tuple[3],
  counterparty: tuple[4],
  amount: tuple[5],
  deposit: tuple[6],
  xmrAmount: tuple[7],
  lastupdate: tuple[8],
  blockTaken: tuple[9],
  evmPublicSpendKey: tuple[10],
  evmPrivateSpendKey: tuple[11],
  evmPublicViewKey: tuple[12],
  evmPrivateViewKey: tuple[13],
  xmrPublicSpendKey: tuple[14],
  xmrPrivateSpendKey: tuple[15],
  xmrPrivateViewKey: tuple[16],
  t0: tuple[17],
  t1: tuple[18],
})

/**
 * Read an offer straight off the contract.
 *
 * Every figure that gates a payment comes from here rather than the subgraph.
 * An indexer can lag by a block; `take` cannot.
 */
export const readOffer = async (chainId: number, offerId: bigint): Promise<OnchainOffer> => {
  const tuple = (await readContract(config, {
    abi: xmrp2pAbi,
    address: marketAddress(chainId),
    functionName: 'offers',
    args: [offerId],
    chainId,
  })) as OffersTuple
  return decodeOffer(tuple)
}

export type MarketParams = {
  minimumOffer: bigint
  maximumOffer: bigint
  depositRatio: bigint
  maximumOfferBookSize: bigint
  t0Delay: bigint
  t1Delay: bigint
}

export const readParameters = async (chainId: number): Promise<MarketParams> => {
  const tuple = (await readContract(config, {
    abi: xmrp2pAbi,
    address: marketAddress(chainId),
    functionName: 'parameters',
    chainId,
  })) as readonly [bigint, bigint, bigint, bigint, bigint, bigint]
  return {
    minimumOffer: tuple[0],
    maximumOffer: tuple[1],
    depositRatio: tuple[2],
    maximumOfferBookSize: tuple[3],
    t0Delay: tuple[4],
    t1Delay: tuple[5],
  }
}

/**
 * What `take` will require, read live.
 *
 * BUY offers are escrowed in full by the maker, so the taker posts the deposit.
 * SELL offers are the reverse: the taker escrows the whole amount.
 */
export const readRequiredToTake = async (
  chainId: number,
  offerId: bigint,
): Promise<{ required: bigint; offer: OnchainOffer }> => {
  const offer = await readOffer(chainId, offerId)
  if (offer.state !== 'OPEN') throw new Error(`Offer #${offerId} is ${offer.state.toLowerCase()}, not open`)
  return { required: offer.kind === 'BUY' ? offer.deposit : offer.amount, offer }
}

// ── writes ──────────────────────────────────────────────────────────────────

const DEPOSIT_DENOMINATOR = 10_000n

/**
 * `openOffer` derives the ETH amount from msg.value, and the derivation differs
 * by kind. Inverting it here keeps the "how much do I send" question in one
 * place, and the ceiling division mirrors the contract's exactly.
 */
export const valueToOpen = (kind: OfferKind, ethAmount: bigint, depositRatio: bigint): bigint =>
  kind === 'BUY'
    ? ethAmount
    : // SELL: msg.value is the deposit, and amount = value * DENOM / ratio.
      // Round the deposit up so the derived amount never lands under the target.
      (ethAmount * depositRatio + DEPOSIT_DENOMINATOR - 1n) / DEPOSIT_DENOMINATOR

const send = async (
  chainId: number,
  functionName: 'openOffer' | 'take' | 'cancel' | 'quit' | 'ready' | 'claim' | 'withdraw',
  args: readonly unknown[],
  value?: bigint,
): Promise<Hex> => {
  const request = {
    abi: xmrp2pAbi,
    address: marketAddress(chainId),
    functionName,
    args,
    chainId,
    ...(value === undefined ? {} : { value }),
  } as Parameters<typeof simulateContract>[1]

  // Simulate first so a revert surfaces as a decoded custom error rather than an
  // opaque wallet rejection. The ABI carries every error for exactly this.
  await simulateContract(config, request)
  return writeContract(config, request as Parameters<typeof writeContract>[1])
}

export const openOffer = (params: {
  chainId: number
  kind: OfferKind
  xmrAmount: bigint
  counterparty: Address
  spendingKey: bigint
  viewingKey: bigint
  value: bigint
}): Promise<Hex> =>
  send(
    params.chainId,
    'openOffer',
    [
      params.kind === 'BUY' ? 1 : 2,
      params.xmrAmount,
      params.counterparty,
      params.spendingKey,
      params.viewingKey,
    ],
    params.value,
  )

/**
 * Take an offer.
 *
 * `value` may exceed `required` — the contract refunds the excess (AUDIT.md H2),
 * which is what makes funding the take with an exact-output swap safe.
 */
export const takeOffer = (params: {
  chainId: number
  offerId: bigint
  spendingKey: bigint
  viewingKey: bigint
  value: bigint
}): Promise<Hex> =>
  send(
    params.chainId,
    'take',
    [params.offerId, params.spendingKey, params.viewingKey],
    params.value,
  )

export const cancelOffer = (chainId: number, offerId: bigint): Promise<Hex> =>
  send(chainId, 'cancel', [offerId])

/** EVM side confirms the XMR landed. TAKEN → READY, and only before t0. */
export const readyOffer = (chainId: number, offerId: bigint): Promise<Hex> =>
  send(chainId, 'ready', [offerId])

/** XMR side publishes its private spend key and takes amount + deposit. */
export const claimOffer = (chainId: number, offerId: bigint, privateSpendKey: bigint): Promise<Hex> =>
  send(chainId, 'claim', [offerId, privateSpendKey])

/** Publish a key half and refund both sides. The exit on either side. */
export const quitOffer = (params: {
  chainId: number
  offerId: bigint
  spendingKey: bigint
  /** Zero for the XMR side — it has no view key to publish. */
  viewingKey: bigint
}): Promise<Hex> =>
  send(params.chainId, 'quit', [params.offerId, params.spendingKey, params.viewingKey])

/** Collect a payout the contract could not deliver. */
export const withdrawCredit = (chainId: number): Promise<Hex> => send(chainId, 'withdraw', [])

export const awaitReceipt = (chainId: number, hash: Hex) =>
  waitForTransactionReceipt(config, { hash, chainId })

/**
 * The offer id a transaction just created, taken from its own logs.
 *
 * `openOffer` returns the struct to a caller but a transaction returns nothing to
 * the client, so the id has to come from the emitted `OfferEvent` — whose first
 * indexed topic it is. The alternative is waiting for the subgraph, which lags by
 * design and makes a successful post look like a failed one.
 *
 * Returns null rather than throwing: a missing id costs a nicer landing, not the
 * trade, and the offer exists on-chain either way.
 */
export const offerIdFromReceipt = (logs: readonly { topics: readonly Hex[] }[]): bigint | null => {
  for (const log of logs) {
    if (log.topics[0] !== OFFER_EVENT_TOPIC) continue
    const id = log.topics[1]
    if (id) return BigInt(id)
  }
  return null
}

/** keccak256("OfferEvent(uint256,uint8,uint8)") */
const OFFER_EVENT_TOPIC = toEventSelector('OfferEvent(uint256,uint8,uint8)')
