import type { Address } from 'viem'
import { indexedChains, type ChainInfo } from './chains'
import type { Offer, OfferKind, OfferState } from './offers'

/**
 * The offer book, read from the live subgraphs on Subgraph Studio.
 *
 * **One subgraph per chain.** A manifest targets exactly one network — every data
 * source in it must share one — so three indexed chains are three deployments with
 * three query URLs, and the merge happens here rather than in the indexer.
 *
 * That is why every offer carries its own `chainId`: the subgraph cannot tell you,
 * because it only knows the one chain it indexes. It is tagged on decode, from the
 * chain whose endpoint answered. Anywhere the UI shows a global chain instead of
 * `offer.chainId` is a bug — an offer never leaves the chain it was opened on.
 *
 * Requests go through `/api/graph/<slug>`, which the dev server rewrites onto
 * Studio with the API key attached — see vite.config.ts. Fixtures disqualify the
 * Graph entry, so there is deliberately no offline fallback: if a subgraph is
 * unreachable the UI says so, per chain.
 */
const endpointFor = (slug: string) => `/api/graph/${slug}`

class SubgraphError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SubgraphError'
  }
}

const query = async <T>(
  slug: string,
  document: string,
  variables: Record<string, unknown> = {},
): Promise<T> => {
  const response = await fetch(endpointFor(slug), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: document, variables }),
  })

  if (!response.ok) {
    throw new SubgraphError(`${slug} responded ${response.status} ${response.statusText}`)
  }

  const body = (await response.json()) as { data?: T; errors?: { message: string }[] }
  if (body.errors?.length) {
    throw new SubgraphError(`${slug}: ${body.errors.map((e) => e.message).join('; ')}`)
  }
  if (!body.data) throw new SubgraphError(`${slug} returned no data`)
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

const decode = (raw: RawOffer, chainId: number): Offer => ({
  chainId,
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
  /** Offers on the book, per chain. Keyed by chain id. */
  openByChain: Map<number, number>
  /** Chains whose subgraph did not answer, so their absence means nothing. */
  unreachable: { chainId: number; reason: string }[]
}

/** Total across the chains that answered. */
export const totalOpen = (page: OfferPage): number =>
  [...page.openByChain.values()].reduce((a, b) => a + b, 0)

const offersOnChain = async (
  info: ChainInfo,
  options?: { first?: number; states?: OfferState[]; kind?: OfferKind },
): Promise<{ offers: Offer[]; open: number }> => {
  const where: Record<string, unknown> = {}
  if (options?.states) where.state_in = options.states
  if (options?.kind) where.kind = options.kind

  const data = await query<{ offers: RawOffer[]; open: { id: string }[] }>(
    info.subgraph as string,
    `query Offers($first: Int!, $where: Offer_filter!) {
      offers(first: $first, where: $where, orderBy: createdAt, orderDirection: desc) {
        ${OFFER_FIELDS}
      }
      open: offers(first: 1000, where: { state: OPEN }) { id }
    }`,
    {
      first: options?.first ?? 100,
      where: Object.keys(where).length ? where : { state: 'OPEN' },
    },
  )

  return {
    offers: data.offers.map((raw) => decode(raw, info.chain.id)),
    open: data.open.length,
  }
}

/**
 * The book, merged across every indexed chain.
 *
 * Failures are per chain and isolated: one unreachable subgraph must not empty the
 * whole book, and it must not silently look like "no offers there" either — hence
 * `unreachable`, so the UI can say which chain it cannot see rather than implying
 * the market is empty.
 */
export const fetchOffers = async (options?: {
  first?: number
  states?: OfferState[]
  kind?: OfferKind
  /** Restrict to these chains. Defaults to every indexed one. */
  chainIds?: readonly number[]
}): Promise<OfferPage> => {
  const targets = indexedChains().filter(
    (info) => !options?.chainIds || options.chainIds.includes(info.chain.id),
  )

  const results = await Promise.allSettled(
    targets.map(async (info) => ({ info, ...(await offersOnChain(info, options)) })),
  )

  const offers: Offer[] = []
  const openByChain = new Map<number, number>()
  const unreachable: { chainId: number; reason: string }[] = []

  results.forEach((result, index) => {
    const info = targets[index]
    if (!info) return
    if (result.status === 'fulfilled') {
      offers.push(...result.value.offers)
      openByChain.set(info.chain.id, result.value.open)
    } else {
      const reason =
        result.reason instanceof Error ? result.reason.message : String(result.reason)
      unreachable.push({ chainId: info.chain.id, reason })
    }
  })

  // Newest first across chains. Block numbers are not comparable between chains;
  // timestamps are, which is why ordering uses createdAt rather than createdBlock.
  offers.sort((a, b) => Number(b.createdAt - a.createdAt))

  return { offers, openByChain, unreachable }
}

/** Every offer this address is party to, on either side. */
export const fetchMyOffers = async (who: Address): Promise<Offer[]> => {
  const address = who.toLowerCase()

  const results = await Promise.allSettled(
    indexedChains().map(async (info) => {
      const data = await query<{ asOwner: RawOffer[]; asCounterparty: RawOffer[] }>(
        info.subgraph as string,
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
      return [...data.asOwner, ...data.asCounterparty].map((raw) => decode(raw, info.chain.id))
    }),
  )

  /*
   * Keyed by `(chainId, offerId)`, never by id alone: ids restart at 1 on each
   * deployment, so offer #1 exists on all three chains and keying by id would
   * silently drop two of them.
   */
  const seen = new Map<string, Offer>()
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const offer of result.value) seen.set(`${offer.chainId}:${offer.offerId}`, offer)
  }
  return [...seen.values()].sort((a, b) => Number(b.updatedAt - a.updatedAt))
}

/** One offer, on the chain it lives on — an id alone does not identify it. */
export const fetchOffer = async (chainId: number, offerId: bigint): Promise<Offer | null> => {
  const info = indexedChains().find((c) => c.chain.id === chainId)
  if (!info) return null
  const data = await query<{ offer: RawOffer | null }>(
    info.subgraph as string,
    `query Offer($id: ID!) { offer(id: $id) { ${OFFER_FIELDS} } }`,
    { id: offerId.toString() },
  )
  return data.offer ? decode(data.offer, chainId) : null
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
export const fetchMarketParameters = async (
  chainId: number,
): Promise<MarketParameters | null> => {
  const info = indexedChains().find((c) => c.chain.id === chainId)
  if (!info) return null
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
    info.subgraph as string,
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
export const fetchSettledCounts = async (
  addresses: readonly Address[],
): Promise<Map<string, number>> => {
  const unique = [...new Set(addresses.map((a) => a.toLowerCase()))]
  if (unique.length === 0) return new Map()

  const counts = new Map<string, number>(unique.map((a) => [a, 0]))

  const results = await Promise.allSettled(
    indexedChains().map((info) =>
      query<{ asOwner: { owner: string }[]; asCounterparty: { counterparty: string }[] }>(
        info.subgraph as string,
        `query Settled($who: [Bytes!]!) {
          asOwner: offers(first: 1000, where: { owner_in: $who, state: CLAIMED }) { owner }
          asCounterparty: offers(first: 1000, where: { counterparty_in: $who, state: CLAIMED }) { counterparty }
        }`,
        { who: unique },
      ),
    ),
  )

  // Summed across chains: a trader's record is theirs wherever they traded. The
  // signal is about the person, not the deployment.
  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    for (const row of result.value.asOwner) {
      const key = row.owner.toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    for (const row of result.value.asCounterparty) {
      const key = row.counterparty.toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * Anything the contract owes this address from a payout it could not deliver.
 * Maintained purely from logs: sum(PayoutCredit) − sum(AccountWithdrawal).
 */
export const fetchWithdrawable = async (who: Address, chainId: number): Promise<bigint> => {
  const info = indexedChains().find((c) => c.chain.id === chainId)
  if (!info) return 0n
  const data = await query<{ account: { withdrawable: string } | null }>(
    info.subgraph as string,
    `query Account($id: ID!) { account(id: $id) { withdrawable } }`,
    { id: who.toLowerCase() },
  )
  return data.account ? BigInt(data.account.withdrawable) : 0n
}
