import type { Address } from 'viem'
import { estimateEth, estimateXmr, rateXmrPerEth } from './format'

export type OfferKind = 'BUY' | 'SELL'
export type OfferState = 'OPEN' | 'TAKEN' | 'CANCELLED' | 'REFUNDED' | 'READY' | 'CLAIMED'

/** Contract ordering is not flow ordering — INVALID is 0. */
export const OFFER_KIND: readonly (OfferKind | 'INVALID')[] = ['INVALID', 'BUY', 'SELL']
export const OFFER_STATE: readonly (OfferState | 'INVALID')[] = [
  'INVALID',
  'OPEN',
  'TAKEN',
  'CANCELLED',
  'REFUNDED',
  'READY',
  'CLAIMED',
]

/** An offer as the subgraph serves it: the book, with no key material. */
export type Offer = {
  /**
   * The chain this offer lives on, and never leaves.
   *
   * Not a display detail. `offerId` restarts at 1 on every deployment, so an id
   * alone does not identify an offer — every read, every contract call and every
   * dedupe key needs the pair. The subgraph cannot supply it (each one indexes a
   * single chain), so it is tagged from whichever endpoint answered.
   */
  chainId: number
  offerId: bigint
  kind: OfferKind
  state: OfferState
  owner: Address
  counterparty: Address | null
  /** ETH side, wei. */
  amount: bigint
  /** Stake from whichever side is not escrowing the full amount, wei. */
  deposit: bigint
  /** XMR side, atomic units. */
  xmrAmount: bigint
  t0: bigint | null
  t1: bigint | null
  evmKeysRevealed: boolean
  xmrSpendKeyRevealed: boolean
  createdAt: bigint
  updatedAt: bigint
}

/**
 * Which side of the trade an address is on.
 *
 * The asymmetry is the whole protocol, and it flips with `kind`:
 *   BUY  — the maker is the EVM side (escrows the full ETH), the taker sends XMR
 *   SELL — the maker is the XMR side (posts a deposit), the taker escrows the ETH
 *
 * Every button in the order dialog is decided by this plus the state, so it is
 * worth keeping in one place rather than re-deriving it per screen.
 */
export type Side = 'evm' | 'xmr' | 'none'

export const sideOf = (offer: Offer, who: Address | undefined): Side => {
  if (!who) return 'none'
  const me = who.toLowerCase()
  const isOwner = offer.owner.toLowerCase() === me

  /*
   * On an OPEN offer, `counterparty` is a *restriction* — the one address allowed
   * to take it — not a party to the trade. `take` is what promotes it to a party,
   * by overwriting the field with the taker.
   *
   * Reading it as a party before that breaks both ways: an offer reserved for you
   * showed the maker's Cancel button (which reverts, you are not the owner), and
   * one reserved for somebody else showed Take (which reverts with ErrorNonMember).
   * Until an offer is taken, the maker is the only party.
   */
  if (offer.state === 'OPEN') {
    if (!isOwner) return 'none'
    return offer.kind === 'BUY' ? 'evm' : 'xmr'
  }

  const isCounterparty = offer.counterparty?.toLowerCase() === me
  if (!isOwner && !isCounterparty) return 'none'
  if (offer.kind === 'BUY') return isOwner ? 'evm' : 'xmr'
  return isOwner ? 'xmr' : 'evm'
}

/**
 * Whether this address may take this offer, mirroring the contract:
 * `require(address(0) == counterparty || counterparty == msg.sender)` plus
 * `require(msg.sender != owner)`.
 *
 * A maker can restrict an offer to one counterparty. Offering Take to anyone else
 * is offering a button that reverts.
 */
export const canTake = (offer: Offer, who: Address | undefined): boolean => {
  if (!who || offer.state !== 'OPEN') return false
  const me = who.toLowerCase()
  if (offer.owner.toLowerCase() === me) return false
  const restricted = offer.counterparty
  return restricted === null || restricted.toLowerCase() === me
}

/** True when an offer is reserved for an address other than this one. */
export const isReservedForOther = (offer: Offer, who: Address | undefined): boolean =>
  offer.state === 'OPEN' &&
  offer.counterparty !== null &&
  offer.counterparty.toLowerCase() !== who?.toLowerCase() &&
  offer.owner.toLowerCase() !== who?.toLowerCase()

/** The EVM side receives XMR and pays ETH; the XMR side does the reverse. */
export const isParty = (offer: Offer, who: Address | undefined): boolean =>
  sideOf(offer, who) !== 'none'

/**
 * What a taker must send to take this offer, straight off the offer struct.
 *
 * PLAN.md: this figure gates a payment and must come from the contract, never
 * from an indexer that can lag — so callers pass values read on-chain. The
 * function is here only to keep the BUY/SELL choice in one place.
 */
export const requiredToTake = (kind: OfferKind, amount: bigint, deposit: bigint): bigint =>
  kind === 'BUY' ? deposit : amount

/** What `claim` pays out: the sale plus the deposit coming back. */
export const claimPayout = (amount: bigint, deposit: bigint): bigint => amount + deposit

// ── what happens next ───────────────────────────────────────────────────────

/**
 * The six dialog states from the wireframes, plus the two terminal ones that
 * need no dialog of their own.
 */
export type OrderStage =
  | 'open' // on the book; a stranger can take it, the owner can cancel it
  | 'send-xmr' // taken, you are the XMR side: send the coins
  | 'verify' // taken, you are the EVM side: confirm the deposit or back out
  | 'claim' // ready, you are the XMR side: publish the key and take the ETH
  | 'collect' // claimed, you are the EVM side: sweep the XMR out
  | 'refunded' // refunded: the other side published, recover your XMR
  | 'cancelled'
  | 'settled' // claimed, and you are the side that already got paid

export type OrderAction =
  | { kind: 'take'; label: string }
  | { kind: 'cancel'; label: string } // cancel() — an untaken offer, owner only
  | { kind: 'ready'; label: string } // ready() — EVM side confirms the XMR
  | { kind: 'claim'; label: string } // claim() — XMR side publishes, gets paid
  | { kind: 'quit'; label: string } // quit() — publish keys, both sides refunded
  | { kind: 'send-xmr'; label: string } // off-chain: send the coins to escrow
  | { kind: 'show-keys'; label: string } // off-chain: import the escrow wallet

export type OrderStatus = {
  stage: OrderStage
  side: Side
  /** Headline, written as the thing the reader has to do. */
  headline: string
  /** The deadline that applies to this side right now, or null. */
  deadline: bigint | null
  /** True when the clock is running on the reader and nobody else. */
  waitingOnYou: boolean
  primary: OrderAction | null
  secondary: OrderAction | null
}

/**
 * Resolve an offer into what this viewer sees and can press.
 *
 * Timing follows the contract exactly, because a button that reverts is worse
 * than no button:
 *   ready()  TAKEN and t ≤ t0, EVM side
 *   claim()  READY and t ≤ t1, or TAKEN and t0 < t ≤ t1 — XMR side either way
 *   quit()   EVM side: TAKEN and (t ≤ t0 or t > t1), or READY and t > t1
 *            XMR side: TAKEN or READY, and t > t1
 */
export const orderStatus = (
  offer: Offer,
  who: Address | undefined,
  nowSeconds: number,
): OrderStatus => {
  const side = sideOf(offer, who)
  const t0 = offer.t0 ?? 0n
  const t1 = offer.t1 ?? 0n
  const now = BigInt(Math.floor(nowSeconds))
  const beforeT0 = t0 > 0n && now <= t0
  const beforeT1 = t1 > 0n && now <= t1
  const afterT1 = t1 > 0n && now > t1

  const base = { side, deadline: null, waitingOnYou: false, primary: null, secondary: null } as const

  switch (offer.state) {
    case 'OPEN': {
      // The maker's own offer. No clock, so it is never "waiting on you".
      if (side !== 'none') {
        return {
          ...base,
          stage: 'open',
          headline: 'Nobody has taken this yet',
          secondary: { kind: 'cancel', label: 'Cancel' },
        }
      }
      // Reserved for a named counterparty, and not this one. The contract would
      // revert with ErrorNonMember, so there is no button to offer.
      if (isReservedForOther(offer, who)) {
        return {
          ...base,
          stage: 'open',
          headline: 'Reserved for another address',
        }
      }
      return {
        ...base,
        stage: 'open',
        headline: 'Open — nobody has taken this yet',
        primary: canTake(offer, who) ? { kind: 'take', label: 'Take this offer' } : null,
      }
    }

    case 'TAKEN': {
      if (side === 'evm') {
        // The EVM side's job is to verify the XMR landed and call ready().
        if (beforeT0) {
          return {
            stage: 'verify',
            side,
            headline: 'Confirm the XMR arrived',
            deadline: t0,
            waitingOnYou: true,
            primary: { kind: 'ready', label: 'Confirm XMR Received' },
            secondary: { kind: 'quit', label: 'Cancel Order' },
          }
        }
        // Past t0 the EVM side has lost its confirm window; past t1 it can exit.
        return {
          stage: 'verify',
          side,
          headline: afterT1 ? 'Deadline passed — recover your ETH' : 'Waiting on the XMR side',
          deadline: t1,
          waitingOnYou: afterT1,
          primary: afterT1 ? { kind: 'quit', label: 'Close and refund' } : null,
          secondary: null,
        }
      }
      if (side === 'xmr') {
        // Send the coins. After t0 the XMR side can claim without a ready().
        const canClaim = now > t0 && beforeT1
        return {
          stage: 'send-xmr',
          side,
          headline: canClaim ? 'Claim your ETH' : 'Send the XMR',
          deadline: t1,
          waitingOnYou: true,
          primary: canClaim
            ? { kind: 'claim', label: 'Claim ETH' }
            : { kind: 'send-xmr', label: 'Copy Address' },
          secondary: afterT1 ? { kind: 'quit', label: 'Back out' } : null,
        }
      }
      return { ...base, stage: 'open', headline: 'Taken — being settled', deadline: t1 }
    }

    case 'READY': {
      if (side === 'xmr') {
        return {
          stage: 'claim',
          side,
          headline: beforeT1 ? 'Claim your ETH' : 'Deadline passed — recover your XMR',
          deadline: t1,
          waitingOnYou: true,
          primary: beforeT1
            ? { kind: 'claim', label: 'Claim ETH' }
            : { kind: 'quit', label: 'Close and recover' },
          secondary: null,
        }
      }
      if (side === 'evm') {
        return {
          stage: 'verify',
          side,
          headline: afterT1 ? 'Deadline passed — recover your ETH' : 'Waiting on them to claim',
          deadline: t1,
          waitingOnYou: afterT1,
          primary: afterT1 ? { kind: 'quit', label: 'Close and refund' } : null,
          secondary: null,
        }
      }
      return { ...base, stage: 'open', headline: 'Ready — waiting on the claim', deadline: t1 }
    }

    case 'CLAIMED': {
      // The XMR private spend key is public now. The EVM side sweeps the coins.
      if (side === 'evm') {
        return {
          ...base,
          stage: 'collect',
          headline: 'Collect your XMR',
          waitingOnYou: true,
          primary: { kind: 'show-keys', label: 'Show Keys' },
        }
      }
      return { ...base, stage: 'settled', headline: 'Trade completed successfully' }
    }

    case 'REFUNDED': {
      // Whoever sent XMR gets it back using the published key half.
      if (side === 'xmr') {
        return {
          ...base,
          stage: 'refunded',
          headline: 'Recover your XMR',
          waitingOnYou: true,
          primary: { kind: 'show-keys', label: 'Show Keys' },
        }
      }
      return { ...base, stage: 'refunded', headline: 'Order refunded' }
    }

    case 'CANCELLED':
      return { ...base, stage: 'cancelled', headline: 'Cancelled' }
  }
}

/**
 * Orders with a clock running on the reader. These sit above the fold on every
 * screen and appear nowhere else — the one thing that outranks the widget.
 */
export const waitingOnYou = (
  offers: readonly Offer[],
  who: Address | undefined,
  nowSeconds: number,
): { offer: Offer; status: OrderStatus }[] =>
  offers
    .map((offer) => ({ offer, status: orderStatus(offer, who, nowSeconds) }))
    .filter((o) => o.status.waitingOnYou)
    .sort((a, b) => Number((a.status.deadline ?? 0n) - (b.status.deadline ?? 0n)))

// ── matching ────────────────────────────────────────────────────────────────

/**
 * An offer is indivisible: `openOffer` fixes the amount and `take` takes the
 * whole thing. There is no pool, no partial fill and no price curve — so the
 * amount a user types is a *filter*, not a quote, and "You receive" is a readout
 * of one specific offer rather than a computed price.
 *
 * The default band the design specifies. Configurable, because how much size a
 * reader will trade for rate is a preference rather than a fact — see
 * `state/settings.ts`.
 */
export const NEAR_BAND = 0.1

export type Band = 'exact' | 'near'

/**
 * Which side of the trade the reader named an amount for.
 *
 * The protocol is symmetric — an offer has an ETH leg and an XMR leg, and either
 * side can be the one you are parting with — so matching cannot assume ETH. It
 * used to, which left the "You pay" field uneditable in the XMR→ETH direction:
 * the typed amount was pinned to the ETH leg no matter which way round the trade
 * was, so the field that should have taken input became a readout.
 */
export type Leg = 'eth' | 'xmr'

export const legAmount = (offer: Offer, leg: Leg): bigint =>
  leg === 'eth' ? offer.amount : offer.xmrAmount

/** The leg a reader receives, given the one they pay. */
export const otherLeg = (leg: Leg): Leg => (leg === 'eth' ? 'xmr' : 'eth')

export type Want = { leg: Leg; amount: bigint }

export type Match = {
  offer: Offer
  band: Band
  /**
   * Signed difference from what the reader asked for, in the typed leg's units.
   *
   * Null when there is no reference amount at all — a row cannot be "0.02 more"
   * than nothing, and rendering a zero delta there claims a precision the reader
   * never asked for.
   */
  delta: bigint | null
  rate: number | null
}

export type Matching = {
  /**
   * ANY   — no amount typed, so nothing narrows the book. Every open offer on the
   *         wanted side is a candidate, and `all` holds them.
   * EXACT — one offer is precisely this size.
   * NEAR  — none is, but some are within the band.
   * NONE  — nothing within the band, so there is nothing takeable at all.
   *
   * ANY used to fall through the NEAR branch with empty bands, which produced a
   * screen that offered "0 near offers" while reporting the book had one, and a
   * summary line reading "0 ETH → —". An unfiltered book is not a failed search;
   * it is the whole book, which is a perfectly good thing to show.
   */
  verdict: 'any' | 'exact' | 'near' | 'none'
  exact: Match[]
  near: Match[]
  /** Every open offer on the wanted side. Populated only for ANY. */
  all: Match[]
  /** The offer the widget names above the primary button, if any. */
  best: Match | null
  /** Rate the readout is computed at, and where it came from. */
  rate: number | null
  /** Whether the readout is a real offer's numbers or an estimate at a rate. */
  estimated: boolean
  /** The leg the amounts above are measured in. */
  leg: Leg
}

const byRateDesc = (a: Match, b: Match) => (b.rate ?? 0) - (a.rate ?? 0)

/**
 * Classify the open book against a requested ETH size.
 *
 * `wantKind` is the kind of offer the user needs to *take*: someone paying ETH
 * for XMR has to take a SELL offer (the maker holds the XMR), and vice versa.
 */
export const matchOffers = (
  book: readonly Offer[],
  want: Want | null,
  wantKind: OfferKind,
  nearBand: number = NEAR_BAND,
): Matching => {
  const leg = want?.leg ?? 'eth'
  const open = book.filter((o) => o.state === 'OPEN' && o.kind === wantKind)
  const priced = open.map((o) => ({ offer: o, rate: rateXmrPerEth(o.amount, o.xmrAmount) }))

  if (want === null || want.amount === 0n) {
    // No amount typed: show the book rather than an empty result. Rate order,
    // best first, and no deltas — there is nothing to be near to.
    const all = priced
      .map(({ offer, rate }): Match => ({ offer, band: 'near', delta: null, rate }))
      .sort(byRateDesc)

    return {
      verdict: all.length > 0 ? 'any' : 'none',
      exact: [],
      near: [],
      all,
      best: null,
      rate: medianRate(priced.map((p) => p.rate)),
      estimated: true,
      leg,
    }
  }

  const tolerance = (want.amount * BigInt(Math.round(nearBand * 1000))) / 1000n
  const exact: Match[] = []
  const near: Match[] = []

  for (const { offer, rate } of priced) {
    const delta = legAmount(offer, leg) - want.amount
    if (delta === 0n) exact.push({ offer, band: 'exact', delta, rate })
    else if ((delta < 0n ? -delta : delta) <= tolerance)
      near.push({ offer, band: 'near', delta, rate })
  }

  exact.sort(byRateDesc)
  near.sort(byRateDesc)

  if (exact.length > 0) {
    // The readout shows this offer's real numbers — the only ones whose figures
    // honestly line up with the amount the user typed.
    const best = exact[0]!
    return { verdict: 'exact', exact, near, all: [], best, rate: best.rate, estimated: false, leg }
  }

  if (near.length > 0) {
    // Nothing is this size. The figure is what the amount is worth at the best
    // near rate, and no offer actually fills it — so it renders muted.
    const best = near[0]!
    return { verdict: 'near', exact, near, all: [], best, rate: best.rate, estimated: true, leg }
  }

  // Nothing takeable. Fall back to the book's going rate across every open
  // offer, in either direction: the primary action here is to post an offer,
  // and you cannot post one without a rate to price against.
  return {
    verdict: 'none',
    exact: [],
    near: [],
    all: [],
    best: null,
    rate: medianRate(
      book.filter((o) => o.state === 'OPEN').map((o) => rateXmrPerEth(o.amount, o.xmrAmount)),
    ),
    estimated: true,
    leg,
  }
}

/**
 * The figure for the leg the reader is *receiving*.
 *
 * One definition, because two screens showing different numbers for the same
 * trade is worse than either number being imperfect. The widget had this and the
 * results summary did not, so selling XMR showed an estimated ETH figure on one
 * screen and a dash on the other.
 *
 * On EXACT it is the matched offer's own other-leg amount — a real number from a
 * real offer. Otherwise it is the typed amount converted at whatever rate the rule
 * quotes, in whichever direction is needed, because either leg can be the typed
 * one.
 */
export const receiveAmountFor = (
  matching: Matching,
  want: Want | null,
  rate: number | null,
): bigint | null => {
  if (matching.verdict === 'exact' && matching.best) {
    return legAmount(matching.best.offer, otherLeg(matching.leg))
  }
  if (want === null || rate === null) return null
  return want.leg === 'eth' ? estimateXmr(want.amount, rate) : estimateEth(want.amount, rate)
}

/** Median, not mean: one mispriced offer should not move the going rate. */
export const medianRate = (rates: readonly (number | null)[]): number | null => {
  const xs = rates.filter((r): r is number => r !== null && Number.isFinite(r)).sort((a, b) => a - b)
  if (xs.length === 0) return null
  const mid = Math.floor(xs.length / 2)
  return xs.length % 2 === 1 ? xs[mid]! : (xs[mid - 1]! + xs[mid]!) / 2
}

/**
 * How many priced offers it takes before a median is a *rate* rather than an
 * anecdote.
 *
 * With one offer on the book, `medianRate` returns that offer's price and the UI
 * called it "the book's going rate" — which on a fresh deployment meant a single
 * mispriced test offer was presented as the market, at roughly a hundred times
 * the real figure. A median of one is not a median.
 */
export const MIN_BOOK_SAMPLE = 3

/**
 * The book's own rate, or null when the book is too thin or too strange to have
 * one.
 *
 * Two guards, and both have to be null-returning rather than clamping, because
 * the caller has a genuinely better answer available (a price feed) and should
 * be allowed to reach for it:
 *
 *   sample — fewer than `MIN_BOOK_SAMPLE` offers is not a market
 *   sanity — a book rate wildly adrift of a reference is a mispriced offer, not
 *            a market that happens to disagree
 *
 * The design argued that what a maker competes with is the people already
 * offering, and that is right once there *are* people already offering. It is
 * not an argument for quoting the first junk offer anyone posts.
 */
export const IMPLAUSIBLE_FACTOR = 5

export const bookGoingRate = (
  offers: readonly Offer[],
  reference: number | null,
): number | null => {
  const priced = offers
    .filter((o) => o.state === 'OPEN')
    .map((o) => rateXmrPerEth(o.amount, o.xmrAmount))
    .filter((r): r is number => r !== null && Number.isFinite(r))

  if (priced.length < MIN_BOOK_SAMPLE) return null

  const median = medianRate(priced)
  if (median === null) return null

  if (reference !== null && reference > 0) {
    const ratio = median > reference ? median / reference : reference / median
    if (ratio > IMPLAUSIBLE_FACTOR) return null
  }
  return median
}

/** The closest open offer, measured on the leg the reader typed. */
export const closestBySize = (book: readonly Offer[], want: Want | null): Offer | null => {
  const open = book.filter((o) => o.state === 'OPEN')
  if (open.length === 0) return null
  const leg = want?.leg ?? 'eth'
  if (want === null) {
    return open.reduce((a, b) => (legAmount(b, leg) > legAmount(a, leg) ? b : a))
  }
  const gap = (offer: Offer) => {
    const value = legAmount(offer, leg)
    return value > want.amount ? value - want.amount : want.amount - value
  }
  return open.reduce((a, b) => (gap(b) < gap(a) ? b : a))
}
