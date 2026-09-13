import { formatEther } from 'viem'
import type { Parameters as MarketParameters, OnChainOffer } from './chain'
import { DEPOSIT_DENOMINATOR, valueToOpen } from './chain'
import { ONE_XMR, formatXmr } from './monero/backend'

/**
 * What to quote, and how much of it.
 *
 * The strategy is deliberately plain — a symmetric two-sided quote around a mid
 * price, sized by what the inventory can actually honour. Cleverness here buys
 * very little: the book is thin, offers are indivisible, and the thing that
 * decides whether a market maker survives on this protocol is not the price curve
 * but whether it services deadlines and never quotes a size it cannot deliver.
 *
 * The interesting constraint is the *rate*, not the spread. An offer is a pair of
 * absolute amounts, ETH and XMR, so "price" only exists as their ratio, and both
 * sides of the quote have to respect the contract's MINIMUM_OFFER and
 * MAXIMUM_OFFER on the ETH leg after the deposit maths has been applied.
 */

export type Quote = {
  kind: 'BUY' | 'SELL'
  /** The ETH leg, in wei. What the contract measures against its bounds. */
  ethAmount: bigint
  /** The XMR leg, in piconero. */
  xmrAmount: bigint
  /** `msg.value` this offer needs — full amount for BUY, deposit for SELL. */
  value: bigint
  /** XMR per ETH this quote implies, for the log. */
  rate: number
}

export type Inventory = {
  ethWei: bigint
  xmrAtomic: bigint
  /** Wei already committed to live offers. Counts against the exposure cap. */
  committedWei: bigint
}

export type StrategyInput = {
  /** XMR per ETH. The bot does not invent this — see `midFromBook`. */
  mid: number
  spread: number
  depth: number
  /** Largest ETH leg the operator allows on one offer. */
  maxOfferWei: bigint
  maxTotalWei: bigint
  parameters: MarketParameters
  inventory: Inventory
}

export class StrategyError extends Error {}

/**
 * The book's own mid, as the median rate across open offers.
 *
 * Refuses on a thin book rather than extrapolating from one or two. The browser
 * client learned this the hard way: a single 482 XMR/ETH offer became "the book's
 * going rate", which is a confident claim derived from one data point. Three is
 * still few, but it is enough for a median to mean something, and below that the
 * honest answer is that this market has no price yet.
 */
export const MIN_BOOK_SAMPLE = 3

export const midFromBook = (offers: readonly OnChainOffer[]): number | null => {
  const rates = offers
    .filter((o) => o.state === 'OPEN' && o.amount > 0n && o.xmrAmount > 0n)
    .map((o) => Number(o.xmrAmount) / Number(ONE_XMR) / (Number(o.amount) / 1e18))
    .filter((r) => Number.isFinite(r) && r > 0)
    .sort((a, b) => a - b)

  if (rates.length < MIN_BOOK_SAMPLE) return null
  const middle = Math.floor(rates.length / 2)
  return rates.length % 2 === 1
    ? (rates[middle] as number)
    : ((rates[middle - 1] as number) + (rates[middle] as number)) / 2
}

/** ETH wei and a rate to the XMR leg in piconero. */
const xmrLegFor = (ethWei: bigint, rate: number): bigint => {
  const eth = Number(ethWei) / 1e18
  return BigInt(Math.round(eth * rate * Number(ONE_XMR)))
}

/**
 * Build the quotes to have on the book.
 *
 * Sizing runs from the binding constraint inwards, and which constraint binds
 * differs per side — this is the asymmetry that makes a two-sided maker need both
 * balances:
 *
 *   BUY  — the bot is the EVM side and escrows the full ETH amount. ETH is the
 *          constraint, and the XMR leg is whatever the rate implies.
 *   SELL — the bot is the XMR side and escrows only a deposit, but it must be able
 *          to *deliver* the XMR leg. So the XMR balance caps the size, and the ETH
 *          needed is only the deposit.
 */
export const plan = (input: StrategyInput): Quote[] => {
  const { mid, spread, depth, parameters, inventory } = input
  if (!Number.isFinite(mid) || mid <= 0) throw new StrategyError(`mid must be positive, got ${mid}`)

  const headroom = input.maxTotalWei > inventory.committedWei
    ? input.maxTotalWei - inventory.committedWei
    : 0n
  if (headroom === 0n) return []

  const quotes: Quote[] = []

  for (let level = 0; level < depth; level++) {
    // Each level steps further out, so depth 2 at 2% quotes ±2% and ±4%.
    const offset = spread * (level + 1)

    // ── BUY: pay ETH, receive XMR. Quote below mid to earn the spread. ──
    {
      const rate = mid * (1 - offset)
      const size = clampEthLeg(input, headroom, quotes, 'BUY')
      if (size !== null && rate > 0) {
        const xmrAmount = xmrLegFor(size, rate)
        if (xmrAmount > 0n) {
          quotes.push({ kind: 'BUY', ethAmount: size, xmrAmount, value: size, rate })
        }
      }
    }

    // ── SELL: deliver XMR, receive ETH. Quote above mid. ──
    {
      const rate = mid * (1 + offset)
      const size = clampEthLeg(input, headroom, quotes, 'SELL')
      if (size !== null && rate > 0) {
        const xmrAmount = xmrLegFor(size, rate)
        const xmrCommitted = quotes
          .filter((q) => q.kind === 'SELL')
          .reduce((sum, q) => sum + q.xmrAmount, 0n)
        // Only quote XMR the wallet can actually deliver, now, unlocked.
        if (xmrAmount > 0n && xmrCommitted + xmrAmount <= inventory.xmrAtomic) {
          quotes.push({
            kind: 'SELL',
            ethAmount: size,
            xmrAmount,
            value: valueToOpen('SELL', size, parameters.depositRatio),
            rate,
          })
        }
      }
    }
  }

  return quotes
}

/**
 * The largest ETH leg allowed for one more quote of this kind, or null if none
 * fits. Every bound is checked; the smallest wins.
 */
const clampEthLeg = (
  input: StrategyInput,
  headroom: bigint,
  planned: readonly Quote[],
  kind: 'BUY' | 'SELL',
): bigint | null => {
  const { parameters, inventory, maxOfferWei } = input

  const plannedValue = planned.reduce((sum, q) => sum + q.value, 0n)
  const remainingExposure = headroom > plannedValue ? headroom - plannedValue : 0n
  // Leave gas behind. An offer the bot cannot service is worse than no offer.
  const gasReserve = 2_000_000_000_000_000n // 0.002 ETH
  const spendable = inventory.ethWei > gasReserve ? inventory.ethWei - gasReserve : 0n
  const budget = min(remainingExposure, spendable)
  if (budget === 0n) return null

  // A BUY escrows the whole leg; a SELL escrows only the deposit, so the same
  // budget supports a proportionally larger leg.
  const legFromBudget =
    kind === 'BUY' ? budget : (budget * DEPOSIT_DENOMINATOR) / parameters.depositRatio

  const size = min(min(legFromBudget, maxOfferWei), parameters.maximumOffer)
  if (size < parameters.minimumOffer) return null
  return size
}

const min = (a: bigint, b: bigint): bigint => (a < b ? a : b)

/** One line per quote, for the log. */
export const describeQuote = (quote: Quote): string =>
  `${quote.kind} ${formatEther(quote.ethAmount)} ETH / ${formatXmr(quote.xmrAmount)} XMR ` +
  `@ ${quote.rate.toFixed(4)} XMR/ETH (stakes ${formatEther(quote.value)} ETH)`

/**
 * Does an existing offer already cover this quote closely enough to leave alone?
 *
 * Cancelling and reposting costs two transactions and a fresh keypair, so a quote
 * within tolerance of something already on the book is not worth replacing.
 */
export const alreadyQuoted = (
  quote: Quote,
  mine: readonly OnChainOffer[],
  tolerance = 0.005,
): boolean =>
  mine.some((offer) => {
    if (offer.state !== 'OPEN' || offer.kind !== quote.kind) return false
    if (offer.amount === 0n) return false
    const existing = Number(offer.xmrAmount) / Number(ONE_XMR) / (Number(offer.amount) / 1e18)
    return Math.abs(existing - quote.rate) / quote.rate <= tolerance
  })
