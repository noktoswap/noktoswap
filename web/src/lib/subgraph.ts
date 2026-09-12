import type { Address } from 'viem'
import type { Offer, OfferKind, OfferState } from './offers'

/**
 * The offer book, read from the live subgraph on Subgraph Studio.
 *
 * Requests go through `/api/graph`, which the dev server rewrites onto the
 * Studio query URL with the API key attached — see vite.config.ts. Fixtures
 * disqualify the Graph entry, so there is deliberately no offline fallback
 * here: if the subgraph is unreachable the UI says so.
 */
const ENDPOINT = '/api/graph'

class SubgraphError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubgraphError'
  }
}

const query = async <T>(document: string, variables: Record<string, unknown> = {}): Promise<T> => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: document, variables }),
  })

  if (!response.ok) {
    throw new SubgraphError(`subgraph responded ${response.status} ${response.statusText}`)
  }

  const body = (await response.json()) as { data?: T; errors?: { message: string }[] }
  if (body.errors?.length) {
    throw new SubgraphError(body.errors.map((e) => e.message).join('; '))
  }
  if (!body.data) throw new SubgraphError('subgraph returned no data')
  return body.data
}

// The schema keeps Monero key material out on purpose — reveals are booleans.
// Key values are read straight off the contract, for the one offer the reader is
// party to. See subgraph/README.md.
const OFFER_FIELDS = `
  offerId
  kind
  state
  owner
  counterparty
  amount
  deposit
  xmrAmount
  t0
  t1
  evmKeysRevealed
  xmrSpendKeyRevealed
  createdAt
  updatedAt
`

type RawOffer = {
  offerId: string
  kind: OfferKind
  state: OfferState
  owner: string
  counterparty: string | null
  amount: string
  deposit: string
  xmrAmount: string
  t0: string | null
  t1: string | null
  evmKeysRevealed: boolean
  xmrSpendKeyRevealed: boolean
  createdAt: string
  updatedAt: string
}

const decode = (raw: RawOffer): Offer => ({
  offerId: BigInt(raw.offerId),
  kind: raw.kind,
  state: raw.state,
  owner: raw.owner as Address,
  counterparty: (raw.counterparty as Address | null) ?? null,
  amount: BigInt(raw.amount),
  deposit: BigInt(raw.deposit),
  xmrAmount: BigInt(raw.xmrAmount),
  t0: raw.t0 === null ? null : BigInt(raw.t0),
  t1: raw.t1 === null ? null : BigInt(raw.t1),
  evmKeysRevealed: raw.evmKeysRevealed,
  xmrSpendKeyRevealed: raw.xmrSpendKeyRevealed,
  createdAt: BigInt(raw.createdAt),
  updatedAt: BigInt(raw.updatedAt),
})

export type OfferPage = {
  offers: Offer[]
  /** Offers currently on the book, across every state-less filter. */
  openCount: number
}

/**
 * The book. `states` defaults to OPEN because that is what "the book" means
 * everywhere in the UI except the order lists.
 */
export const fetchOffers = async (options?: {
  first?: number
  skip?: number
  states?: OfferState[]
  kind?: OfferKind
}): Promise<OfferPage> => {
  const where: Record<string, unknown> = {}
  if (options?.states) where.state_in = options.states
  if (options?.kind) where.kind = options.kind

  const data = await query<{ offers: RawOffer[]; open: { id: string }[] }>(
    `query Offers($first: Int!, $skip: Int!, $where: Offer_filter!) {
      offers(first: $first, skip: $skip, where: $where, orderBy: createdAt, orderDirection: desc) {
        ${OFFER_FIELDS}
      }
      open: offers(first: 1000, where: { state: OPEN }) { id }
    }`,
    {
      first: options?.first ?? 100,
      skip: options?.skip ?? 0,
      where: Object.keys(where).length ? where : { state: 'OPEN' },
    },
  )

  return { offers: data.offers.map(decode), openCount: data.open.length }
}

/** Every offer this address is party to, on either side. */
export const fetchMyOffers = async (who: Address): Promise<Offer[]> => {
  const address = who.toLowerCase()
  const data = await query<{ asOwner: RawOffer[]; asCounterparty: RawOffer[] }>(
    `query MyOffers($who: Bytes!) {
      asOwner: offers(first: 200, where: { owner: $who }, orderBy: updatedAt, orderDirection: desc) {
        ${OFFER_FIELDS}
      }
      asCounterparty: offers(first: 200, where: { counterparty: $who }, orderBy: updatedAt, orderDirection: desc) {
        ${OFFER_FIELDS}
      }
    }`,
    { who: address },
  )

  // An address can be both maker and taker across different offers, and the two
  // lists can overlap on nothing — dedupe by id regardless.
  const seen = new Map<string, Offer>()
  for (const raw of [...data.asOwner, ...data.asCounterparty]) {
    seen.set(raw.offerId, decode(raw))
  }
  return [...seen.values()].sort((a, b) => Number(b.updatedAt - a.updatedAt))
}

export const fetchOffer = async (offerId: bigint): Promise<Offer | null> => {
  const data = await query<{ offer: RawOffer | null }>(
    `query Offer($id: ID!) { offer(id: $id) { ${OFFER_FIELDS} } }`,
    { id: offerId.toString() },
  )
  return data.offer ? decode(data.offer) : null
}

export type MarketParameters = {
  minimumOffer: bigint
  maximumOffer: bigint
  depositRatio: bigint
  maximumOfferBookSize: bigint
  t0Delay: bigint
  t1Delay: bigint
}

/**
 * Latest market parameters. Reconstructible from logs alone — ParametersUpdated
 * fires from the constructor too, so this is populated from the first block.
 *
 * Note the plural: `MarketParameters` already ends in s, so graph-node exposes
 * the list as `marketParameters_collection`.
 */
export const fetchMarketParameters = async (): Promise<MarketParameters | null> => {
  const data = await query<{
    marketParameters_collection: {
      minimumOffer: string
      maximumOffer: string
      depositRatio: string
      maximumOfferBookSize: string
      t0Delay: string
      t1Delay: string
    }[]
  }>(
    `query Parameters {
      marketParameters_collection(first: 1, orderBy: block, orderDirection: desc) {
        minimumOffer
        maximumOffer
        depositRatio
        maximumOfferBookSize
        t0Delay
        t1Delay
      }
    }`,
  )
  const latest = data.marketParameters_collection[0]
  if (!latest) return null
  return {
    minimumOffer: BigInt(latest.minimumOffer),
    maximumOffer: BigInt(latest.maximumOffer),
    depositRatio: BigInt(latest.depositRatio),
    maximumOfferBookSize: BigInt(latest.maximumOfferBookSize),
    t0Delay: BigInt(latest.t0Delay),
    t1Delay: BigInt(latest.t1Delay),
  }
}

/**
 * How many of an address's orders actually settled.
 *
 * The wireframes borrow the "31 done" trust signal from Telegram @wallet, with
 * one difference worth the query: here it is countable on-chain rather than
 * asserted by the venue.
 */
export const fetchSettledCounts = async (addresses: readonly Address[]): Promise<Map<string, number>> => {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))]
  if (unique.length === 0) return new Map()

  const data = await query<{ asOwner: { owner: string }[]; asCounterparty: { counterparty: string }[] }>(
    `query Settled($who: [Bytes!]!) {
      asOwner: offers(first: 1000, where: { owner_in: $who, state: CLAIMED }) { owner }
      asCounterparty: offers(first: 1000, where: { counterparty_in: $who, state: CLAIMED }) { counterparty }
    }`,
    { who: unique },
  )

  const counts = new Map<string, number>(unique.map((a) => [a, 0]))
  for (const row of data.asOwner) {
    const key = row.owner.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  for (const row of data.asCounterparty) {
    const key = row.counterparty.toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * Anything the contract owes this address from a payout it could not deliver.
 * Maintained purely from logs: sum(PayoutCredit) − sum(AccountWithdrawal).
 */
export const fetchWithdrawable = async (who: Address): Promise<bigint> => {
  const data = await query<{ account: { withdrawable: string } | null }>(
    `query Account($id: ID!) { account(id: $id) { withdrawable } }`,
    { id: who.toLowerCase() },
  )
  return data.account ? BigInt(data.account.withdrawable) : 0n
}
