import { createSignal } from 'solid-js'
import { HOME_CHAIN } from '../lib/chains'
import { XMR, isXmr, nativeOf, type Currency } from '../lib/tokens'
import { otherLeg, type Leg, type OfferKind, type Want } from '../lib/offers'
import { tryParseEth, tryParseXmr } from '../lib/format'

/**
 * The swap intent — what the reader typed, and in which direction.
 *
 * Module-level rather than per-route on purpose: the amount typed on the landing
 * screen has to survive navigating to results, to the book and into the create
 * form, because the whole point of the three buttons under the widget is that
 * each one carries the amount you just typed into a different branch of the flow.
 */

export type Direction = 'eth-to-xmr' | 'xmr-to-eth'

const [direction, setDirection] = createSignal<Direction>('eth-to-xmr')

/**
 * The amount the reader typed — always the leg they are *paying*.
 *
 * It used to be pinned to the ETH leg regardless of direction, which is what made
 * the "You pay" field uneditable when selling XMR: the input followed the ETH
 * side down to "You receive" and left the field above it a dead readout. The
 * protocol is symmetric, so this is too — `payLeg()` says which side the number
 * currently means.
 */
const [payInput, setPayInput] = createSignal('')
/** The EVM-side currency being paid or received. ETH means no swap is needed. */
const [evmCurrency, setEvmCurrency] = createSignal<Currency>(nativeOf(HOME_CHAIN.chain.id))

/**
 * The offer being drafted. Lives here, not in the form, because Review is a
 * separate modal and it has to read the same figures the form validated — a
 * second source of truth for an amount that is about to be escrowed is exactly
 * the kind of thing that silently posts the wrong offer.
 */
const [draftEth, setDraftEth] = createSignal('')
const [draftXmr, setDraftXmr] = createSignal('')

export {
  direction,
  draftEth,
  draftXmr,
  evmCurrency,
  payInput,
  setDraftEth,
  setDraftXmr,
  setEvmCurrency,
  setPayInput,
}

/** Which leg the typed amount refers to. */
export const payLeg = (d: Direction = direction()): Leg => (d === 'eth-to-xmr' ? 'eth' : 'xmr')

/** And the one the readout shows. */
export const receiveLeg = (d: Direction = direction()): Leg => otherLeg(payLeg(d))

/** The typed amount parsed in its own leg's units, or null while half-typed. */
export const payAmount = (): bigint | null =>
  payLeg() === 'eth' ? tryParseEth(payInput()) : tryParseXmr(payInput())

/** What `matchOffers` wants: an amount plus the leg it is measured on. */
export const want = (): Want | null => {
  const amount = payAmount()
  return amount === null ? null : { leg: payLeg(), amount }
}

/**
 * Carry what the widget is showing into the offer being posted.
 *
 * This is the whole reason "Post an offer" is a *button* under the widget rather
 * than a mode tab: unlike a tab, it takes the amount just typed with it. Both
 * legs are seeded, not only the ETH one — the readout's rate is the figure a
 * maker would price against, and on an empty book it is the only rate they have.
 *
 * A separate draft rather than a shared signal, because the two fields mean
 * different things. On the widget the amount is a *filter*; in the form it is a
 * commitment. Editing the form should not silently re-filter the book behind it.
 *
 * Seeds nothing when there is no amount, so opening the form from the book does
 * not wipe a draft somebody was part way through.
 */
export const seedOfferDraft = (legs: { eth: string; xmr: string }): void => {
  if (!legs.eth.trim()) return
  setDraftEth(legs.eth.trim())
  if (legs.xmr.trim()) setDraftXmr(legs.xmr.trim())
}

/**
 * Flip the pair, carrying the readout into the input.
 *
 * Keeping the digits and letting them change meaning — 0.25 ETH becoming
 * 0.25 XMR — would silently ask for a different trade. Moving the *readout* up
 * means flipping "pay 0.25 ETH, get 1.205 XMR" gives "pay 1.205 XMR, get ~0.25
 * ETH", which is the same trade seen from the other side.
 *
 * `nextPay` is the readout the caller is currently showing; without one the field
 * clears rather than carrying a number that no longer means anything.
 */
/**
 * Empty the draft once an offer has actually been posted.
 *
 * Without this, reopening the create form shows the offer that was just
 * submitted — which looks like it failed and is about to be posted twice.
 */
export const clearDraft = (): void => {
  setDraftEth('')
  setDraftXmr('')
}

export const flipDirection = (nextPay?: string): void => {
  setDirection((d) => (d === 'eth-to-xmr' ? 'xmr-to-eth' : 'eth-to-xmr'))
  setPayInput(nextPay ?? '')
}

export const setDirectionTo = setDirection

/**
 * The two slots a currency can be picked into. `pay` and `receive` on the widget;
 * the create form calls them sell and buy, which are the same two slots.
 */
export type Slot = 'pay' | 'receive'

/**
 * Put `currency` on `slot`.
 *
 * There is only one picker and XMR is always in it, so the picker can be asked
 * for a currency the *other* slot is currently holding. Every trade here is
 * XMR against something on an EVM — there is no XMR/XMR pair and no
 * token/token pair — so there is exactly one arrangement that satisfies any
 * request, and the answer is to invert rather than to refuse:
 *
 *   selling XMR for USDC, then picking XMR on the buy side
 *     → you are now selling USDC for XMR
 *
 * Stating it as "this currency belongs on this slot" rather than as a flip is
 * what keeps it correct: there is nothing to toggle and no state where both
 * slots end up the same.
 */
export const selectCurrency = (slot: Slot, currency: Currency): void => {
  if (isXmr(currency)) {
    // XMR on `pay` means XMR is the side being given up: xmr-to-eth.
    setDirection(slot === 'pay' ? 'xmr-to-eth' : 'eth-to-xmr')
    return
  }
  // An EVM token on `pay` means the EVM side is being given up: eth-to-xmr.
  setEvmCurrency(currency)
  setDirection(slot === 'pay' ? 'eth-to-xmr' : 'xmr-to-eth')
}

/**
 * Which kind of offer this intent has to *take*.
 *
 * Paying ETH for XMR means taking a SELL offer — the maker is the XMR side and
 * holds the coins. Selling XMR for ETH means taking a BUY offer. Getting this
 * backwards would silently show the wrong half of the book, so it lives here and
 * nowhere else.
 */
export const wantedKind = (d: Direction = direction()): OfferKind =>
  d === 'eth-to-xmr' ? 'SELL' : 'BUY'

/** The kind of offer this intent would *post*, which is the opposite. */
export const postedKind = (d: Direction = direction()): OfferKind =>
  d === 'eth-to-xmr' ? 'BUY' : 'SELL'

export const payCurrency = (): Currency => (direction() === 'eth-to-xmr' ? evmCurrency() : XMR)
export const receiveCurrency = (): Currency => (direction() === 'eth-to-xmr' ? XMR : evmCurrency())

/** True when the EVM leg needs a Uniswap swap to become escrowable ETH. */
export const needsSwap = (): boolean => evmCurrency().symbol !== 'ETH'
