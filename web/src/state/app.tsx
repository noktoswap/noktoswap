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
import { DEFAULT_CHAIN, chainInfo, isTradable, realmOf, visibleChains, type Realm } from '../lib/chains'
import {
  fetchMarketParameters,
  fetchMyOffers,
  fetchOffers,
  fetchSettledCounts,
  totalOpen,
} from '../lib/subgraph'
import { bookGoingRate, type Offer } from '../lib/offers'
import { fetchXmrPerEth, isStale } from '../lib/oracle'

/**
 * Everything the screens share: the book, the reader's own orders, the clock
 * that drives every countdown, and the reader's identity.
 *
 * The book is polled rather than subscribed. A subgraph is the source of truth
 * for browsing and it lags by design; anything that gates a payment is read off
 * the contract at the moment of the action instead, so a stale book costs a
 * refresh and never a transaction.
 *
 * It also spans chains: one subgraph per indexed chain, merged in
 * `lib/subgraph.ts`, with failures isolated per chain so one unreachable indexer
 * cannot empty the book or make a chain look like it has no offers.
 */

const BOOK_POLL_MS = 15_000

type AppState = {
  /** Wall clock in seconds, ticking once a second. Drives every countdown. */
  now: Accessor<number>
  address: Accessor<Address | undefined>
  /** The chain the wallet is on. */
  walletChainId: Accessor<number | undefined>
  /**
   * Where to act when nothing else decides — a fresh offer, or a wallet sitting
   * on a chain with no contract.
   *
   * Never a stand-in for an offer's own chain: the book spans chains and every
   * offer carries `chainId`. Reading this where an offer is in hand is a bug.
   */
  actionChainId: Accessor<number>
  /** True when the wallet is somewhere the contract is not deployed. */
  wrongNetwork: Accessor<boolean>
  book: Accessor<Offer[]>
  /** Open offers across every chain that answered. */
  openCount: Accessor<number>
  /** Open offers per chain, so a row can report its own rather than the total. */
  openByChain: Accessor<Map<number, number>>
  /** Chains whose subgraph did not answer — their absence is not an empty market. */
  unreachableChains: Accessor<{ chainId: number; reason: string }[]>
  /** Which market the book is showing. Test money and real money never mix. */
  realm: Accessor<Realm>
  bookLoading: Accessor<boolean>
  bookError: Accessor<Error | null>
  refetchBook: () => void
  myOrders: Accessor<Offer[]>
  refetchMyOrders: () => void
  /** Settled-trade counts, keyed by lowercase address. Countable on-chain. */
  settled: Accessor<Map<string, number>>
  /** Median XMR/ETH across every open offer on every chain, or null if none. */
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

  /**
   * Where an action lands: the wallet's chain when the contract is there,
   * otherwise the default. A wallet on Arbitrum cannot open an offer, so acting
   * there would revert — falling back is what the "switch network" prompt is for.
   */
  const actionChainId = (): number => {
    const id = walletChainId()
    return id !== undefined && isTradable(id) ? id : DEFAULT_CHAIN.chain.id
  }

  const [now, setNow] = createSignal(Math.floor(Date.now() / 1000))
  const timer = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000)
  onCleanup(() => clearInterval(timer))

  const address = () => connection().address

  /**
   * Only the realm the reader is in. A testnet offer must never appear in a
   * mainnet book — it is play money priced beside real money, and the chain it
   * lives on decides whether its Monero escrow is stagenet or real.
   *
   * Filtered at the query rather than in the view, so nothing downstream can
   * accidentally reach past it.
   */
  const bookQuery = useQuery(() => {
    const chainIds = visibleChains(actionChainId()).map((c) => c.chain.id)
    return {
      queryKey: ['book', chainIds.join(',')],
      queryFn: () => fetchOffers({ states: ['OPEN'], first: 200, chainIds }),
      refetchInterval: BOOK_POLL_MS,
      staleTime: 5_000,
    }
  })

  /**
   * Own orders are *not* realm-filtered. A trade you are party to still has a
   * clock running on it whichever chain it is on, and hiding it because the
   * wallet moved networks is how someone misses a deadline.
   */
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

  /**
   * Parameters are per deployment, so they are fetched for the chain being acted
   * on rather than once globally. They happen to match across all three today;
   * assuming that would be a latent bug the moment one is retuned.
   */
  const parametersQuery = useQuery(() => {
    const chainId = actionChainId()
    return {
      queryKey: ['market-parameters', chainId],
      queryFn: () => fetchMarketParameters(chainId),
      // Parameters change about never. Refetching them on a timer is waste.
      staleTime: 10 * 60_000,
    }
  })

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

  /**
   * The book's own going rate — or null when the book cannot honestly supply one.
   *
   * Cross-checked against the feed rather than trusted blind: a median of one
   * offer is that offer, and a fresh deployment's first test offer was being
   * quoted as "the book's going rate" at a hundred times the real price.
   */
  const bookRate = () => bookGoingRate(book(), oracleQuery.data?.rate ?? null)

  const state: AppState = {
    now,
    address,
    walletChainId: () => walletChainId(),
    actionChainId,
    wrongNetwork: () => {
      const id = walletChainId()
      if (id === undefined || !connection().isConnected) return false
      // "Wrong" means no contract here, not "not the one chain we know about" —
      // three chains are tradable now.
      return chainInfo(id)?.deployment == null
    },
    book,
    openCount: () => (bookQuery.data ? totalOpen(bookQuery.data) : 0),
    openByChain: () => bookQuery.data?.openByChain ?? new Map(),
    unreachableChains: () => bookQuery.data?.unreachable ?? [],
    bookLoading: () => bookQuery.isPending,
    bookError: () => (bookQuery.error as Error | null) ?? null,
    refetchBook: () => void bookQuery.refetch(),
    myOrders,
    refetchMyOrders: () => void myOrdersQuery.refetch(),
    settled: () => settledQuery.data ?? new Map(),
    realm: () => realmOf(actionChainId()),
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
