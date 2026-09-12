import { useQuery } from '@tanstack/solid-query'
import {
  createContext,
  createSignal,
  onCleanup,
  useContext,
  type Accessor,
  type JSX,
} from 'solid-js'
import { useChainId, useConnection } from '@wagmi/solid'
import type { Address } from 'viem'
import { HOME_CHAIN, chainInfo } from '../lib/chains'
import { fetchMarketParameters, fetchMyOffers, fetchOffers, fetchSettledCounts } from '../lib/subgraph'
import { medianRate, type Offer } from '../lib/offers'
import { rateXmrPerEth } from '../lib/format'
import { fetchXmrPerEth, isStale } from '../lib/oracle'

/**
 * Everything the screens share: the book, the reader's own orders, the clock
 * that drives every countdown, and the reader's identity.
 *
 * The book is polled rather than subscribed. A subgraph is the source of truth
 * for browsing and it lags by design; anything that gates a payment is read off
 * the contract at the moment of the action instead, so a stale book costs a
 * refresh and never a transaction.
 */

const BOOK_POLL_MS = 15_000

type AppState = {
  /** Wall clock in seconds, ticking once a second. Drives every countdown. */
  now: Accessor<number>
  address: Accessor<Address | undefined>
  /** The chain the wallet is on. */
  walletChainId: Accessor<number | undefined>
  /** The chain offers live on — the one the subgraph indexes. */
  homeChainId: number
  /** True when the wallet is somewhere the contract is not deployed. */
  wrongNetwork: Accessor<boolean>
  book: Accessor<Offer[]>
  openCount: Accessor<number>
  bookLoading: Accessor<boolean>
  bookError: Accessor<Error | null>
  refetchBook: () => void
  myOrders: Accessor<Offer[]>
  refetchMyOrders: () => void
  /** Settled-trade counts, keyed by lowercase address. Countable on-chain. */
  settled: Accessor<Map<string, number>>
  /** Median XMR/ETH across every open offer, or null on an empty book. */
  bookRate: Accessor<number | null>
  /** Chainlink XMR/USD ÷ ETH/USD, or null while unavailable. */
  oracleRate: Accessor<number | null>
  /**
   * The going rate: the book's own figure where it has one, Chainlink otherwise.
   * Every screen that quotes a market rate reads this, so they cannot disagree.
   */
  marketRate: Accessor<number | null>
  rateSource: Accessor<'book' | 'oracle' | null>
  rateStale: Accessor<boolean>
  t0Delay: Accessor<bigint | null>
  t1Delay: Accessor<bigint | null>
  depositRatio: Accessor<bigint | null>
}

const AppContext = createContext<AppState>()

export const AppProvider = (props: { children: JSX.Element }): JSX.Element => {
  // @wagmi/solid: `useConnection` is core v3's replacement for useAccount, and
  // `useChainId` resolves to an id rather than a whole Chain object.
  const connection = useConnection()
  const walletChainId = useChainId()

  const [now, setNow] = createSignal(Math.floor(Date.now() / 1000))
  const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
  onCleanup(() => clearInterval(timer))

  const address = () => connection().address

  const bookQuery = useQuery(() => ({
    queryKey: ['book'],
    queryFn: () => fetchOffers({ states: ['OPEN'], first: 200 }),
    refetchInterval: BOOK_POLL_MS,
    staleTime: 5_000,
  }))

  const myOrdersQuery = useQuery(() => ({
    queryKey: ['my-orders', address()],
    queryFn: () => {
      const who = address()
      if (!who) return Promise.resolve<Offer[]>([])
      return fetchMyOffers(who)
    },
    enabled: Boolean(address()),
    refetchInterval: BOOK_POLL_MS,
  }))

  const parametersQuery = useQuery(() => ({
    queryKey: ['market-parameters'],
    queryFn: fetchMarketParameters,
    // Parameters change about never. Refetching them on a timer is waste.
    staleTime: 10 * 60_000,
  }))

  const book = () => bookQuery.data?.offers ?? []
  const myOrders = () => myOrdersQuery.data ?? []

  /** Everyone whose reputation is on screen, in one query rather than per row. */
  const settledQuery = useQuery(() => {
    const parties = new Set<string>()
    for (const offer of [...book(), ...myOrders()]) {
      parties.add(offer.owner.toLowerCase())
      if (offer.counterparty) parties.add(offer.counterparty.toLowerCase())
    }
    const addresses = [...parties] as Address[]
    return {
      queryKey: ['settled', addresses.join(',')],
      queryFn: () => fetchSettledCounts(addresses),
      enabled: addresses.length > 0,
      staleTime: 60_000,
    }
  })

  /** The book's own going rate. Median, so one mispriced offer cannot move it. */
  const bookRate = () =>
    medianRate(book().filter((o) => o.state === 'OPEN').map((o) => rateXmrPerEth(o.amount, o.xmrAmount)))

  /**
   * The oracle sits behind the book, and is fetched unconditionally rather than
   * only when the book is empty. Two reasons: the create form wants a spot figure
   * to price against even when the book *can* answer, and a query that appears
   * and disappears with the book would refetch every time the book emptied.
   * One cheap read pair on a 20-minute stale window.
   */
  const oracleQuery = useQuery(() => ({
    queryKey: ['xmr-per-eth'],
    queryFn: fetchXmrPerEth,
    refetchInterval: 1200_000,
    staleTime: 600_000,
    retry: 1,
  }))

  const state: AppState = {
    now,
    address,
    walletChainId: () => walletChainId(),
    homeChainId: HOME_CHAIN.chain.id,
    wrongNetwork: () => {
      const id = walletChainId()
      if (id === undefined || !connection().isConnected) return false
      return chainInfo(id)?.deployment == null
    },
    book,
    openCount: () => bookQuery.data?.openCount ?? 0,
    bookLoading: () => bookQuery.isPending,
    bookError: () => (bookQuery.error as Error | null) ?? null,
    refetchBook: () => void bookQuery.refetch(),
    myOrders,
    refetchMyOrders: () => void myOrdersQuery.refetch(),
    settled: () => settledQuery.data ?? new Map(),
    bookRate,
    oracleRate: () => oracleQuery.data?.rate ?? null,
    marketRate: () => bookRate() ?? oracleQuery.data?.rate ?? null,
    rateSource: () => (bookRate() !== null ? 'book' : oracleQuery.data ? 'oracle' : null),
    // Derived at read time from the clock, never frozen into the fetch.
    rateStale: () => {
      const quote = oracleQuery.data
      return bookRate() === null && quote !== undefined && isStale(quote, now())
    },
    t0Delay: () => parametersQuery.data?.t0Delay ?? null,
    t1Delay: () => parametersQuery.data?.t1Delay ?? null,
    depositRatio: () => parametersQuery.data?.depositRatio ?? null,
  }

  return <AppContext.Provider value={state}>{props.children}</AppContext.Provider>
}

export const useApp = (): AppState => {
  const context = useContext(AppContext)
  if (!context) throw new Error('useApp must be used inside <AppProvider>')
  return context
}

/** "31 done" — how many of this address's orders actually settled. */
export const useSettledCount = (address: Accessor<string | null | undefined>): Accessor<number | null> => {
  const app = useApp()
  return () => {
    const who = address()
    if (!who) return null
    return app.settled().get(who.toLowerCase()) ?? 0
  }
}
