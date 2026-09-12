import { useNavigate } from '@solidjs/router'
import { Show, createMemo, type JSX } from 'solid-js'
import { chainLabel } from '../lib/chains'
import {
  formatEth,
  formatRate,
  formatXmr,
  plural,
  shortAddress,
} from '../lib/format'
import { closestBySize, legAmount, matchOffers, receiveAmountFor, type Leg } from '../lib/offers'
import { FEED_NETWORK_LABEL } from '../lib/oracle'
import { XMR, isXmr, type Currency } from '../lib/tokens'
import { useApp, useSettledCount } from '../state/app'
import { openCreate, openOrder, openSettings, openTokenPicker } from '../state/modals'
import { nearBand } from '../state/settings'
import {
  evmCurrency,
  flipDirection,
  payAmount,
  payCurrency,
  payInput,
  payLeg,
  receiveCurrency,
  receiveLeg,
  seedOfferDraft,
  selectCurrency,
  setPayInput,
  want,
  wantedKind,
  type Slot,
} from '../state/swap'
import { TokenIcon } from './TokenIcon'
import { Chevron, Flip, Settings } from './icons'

/**
 * The swap widget. The app opens on this, with no heading: two amounts and a
 * button say what this is.
 *
 * Laid out against Uniswap's own swap page — settings above, You pay / You
 * receive, flip control on the seam, one full-width button under it. Familiarity
 * is the point; the differences below are where this market is genuinely not a
 * pool.
 *
 * ── why the amount is a filter, not a quote ─────────────────────────────────
 *
 * An offer is indivisible. `openOffer` fixes its amount and `take` takes the
 * whole thing — no pool, no partial fill, no price curve. So "You receive" is a
 * readout of one specific offer rather than a computed price, and it reads off
 * the offer that is *exactly* the size typed: the only one whose numbers
 * honestly line up with the reader's own.
 *
 * Not the best rate. If a slightly larger offer prices better, it is one click
 * away under the compare button — trading size for rate is the user's call to
 * make, not ours to make silently.
 */

/**
 * Both slots open the same picker, XMR included. Picking a currency the other
 * slot holds inverts the pair rather than being refused — `selectCurrency` owns
 * that, so neither chip needs to know what the other is showing.
 */
const CurrencyChip = (props: { currency: Currency; slot: Slot }): JSX.Element => (
  <button
    class="chip"
    style={{ padding: '8px 11px', 'font-size': '17px' }}
    aria-label={`${props.slot === 'pay' ? 'Pay' : 'Receive'} currency: ${props.currency.symbol}`}
    onClick={() => openTokenPicker(props.currency, (picked) => selectCurrency(props.slot, picked))}
  >
    <TokenIcon currency={props.currency} size={20} />
    {props.currency.symbol}
    <Chevron />
  </button>
)

export const SwapWidget = (): JSX.Element => {
  const app = useApp()
  const navigate = useNavigate()

  const matching = createMemo(() => matchOffers(app.book(), want(), wantedKind(), nearBand()))

  /**
   * The rate the readout is computed at, in order of how much it is worth
   * trusting: a real offer at your size, the best near offer, the book's own
   * median, and only then an external feed.
   *
   * The feed lives in app state rather than here, so this screen and the create
   * form quote the same number.
   */
  const rate = createMemo(() => matching().rate ?? app.oracleRate())

  /**
   * The readout. On EXACT it is the matched offer's real XMR figure. Otherwise
   * it is what the typed amount is worth at whatever rate the rule quotes — and
   * it renders muted, because no offer actually fills it.
   */
  /**
   * The readout, in the units of whichever leg the reader is *receiving*.
   *
   * On EXACT it is the matched offer's own other-leg figure. Otherwise it is the
   * typed amount converted at whatever rate the rule quotes — and either
   * direction of that conversion is needed, because either leg can be the one
   * being typed.
   */
  const receiveAmountRaw = createMemo<bigint | null>(() =>
    receiveAmountFor(matching(), want(), rate()),
  )

  const formatLeg = (value: bigint, leg: Leg, decimals?: number) =>
    leg === 'eth' ? formatEth(value, decimals) : formatXmr(value, decimals)

  const receiveAmount = createMemo(() => {
    const value = receiveAmountRaw()
    return value === null ? '—' : formatLeg(value, receiveLeg())
  })

  /**
   * Posting carries both legs across, so the form opens on the trade the reader
   * was already looking at rather than on an empty pair of fields. The draft is
   * keyed by leg, not by field position, so it is right in both directions.
   */
  const postOffer = () => {
    const paying = payAmount()
    const receiving = receiveAmountRaw()
    const ethLeg = payLeg() === 'eth' ? paying : receiving
    const xmrLeg = payLeg() === 'eth' ? receiving : paying
    seedOfferDraft({
      eth: ethLeg === null ? '' : formatEth(ethLeg, 18),
      xmr: xmrLeg === null ? '' : formatXmr(xmrLeg, 12),
    })
    openCreate()
  }

  /** The grey line under the rule: where that rate came from. */
  const provenance = createMemo(() => {
    const match = matching()
    const closest = closestBySize(app.book(), want())
    const unit = payLeg() === 'eth' ? 'ETH' : 'XMR'

    if (match.verdict === 'exact' && match.best) {
      return (
        <>
          {shortAddress(match.best.offer.owner)} · {chainLabel(match.best.offer.chainId)} · your
          exact size
        </>
      )
    }
    if (match.verdict === 'near' && match.best) {
      return (
        <>
          nothing at your exact size · closest is{' '}
          {formatLeg(legAmount(match.best.offer, payLeg()), payLeg())} {unit} on{' '}
          {chainLabel(match.best.offer.chainId)}
        </>
      )
    }
    /*
     * NOTHING takeable. Prefer the book's own going rate — the number you would
     * price against if you posted one — but only when the book actually has one:
     * `bookRate` returns null on a thin or implausible book, so a single test
     * offer can no longer be quoted as the market.
     *
     * Whichever source answers, the line names it *and* the chain. The book spans
     * chains now, and "biggest open is 0.0001 ETH" with no chain reads as a claim
     * about the reader's own network when the offer is on another one entirely.
     */
    return (
      <Show
        when={app.rateSource() === 'book' && closest}
        fallback={
          <Show
            when={app.oracleRate() !== null}
            fallback={<>no rate available — the book is thin and the feed is unreachable</>}
          >
            market price · Chainlink on {FEED_NETWORK_LABEL}
            <Show when={app.rateStale()}> · last round is stale</Show>
            <Show when={app.openCount() > 0}>
              {' '}
              · {plural(app.openCount(), 'offer')} on the book, too few to price from
            </Show>
          </Show>
        }
      >
        {(offer) => (
          <>
            the book&rsquo;s going rate · biggest open is{' '}
            {formatLeg(legAmount(offer(), payLeg()), payLeg())} {unit} on{' '}
            {chainLabel(offer().chainId)}
          </>
        )}
      </Show>
    )
  })

  /**
   * Three things you can do with an amount, three buttons, in the order most
   * people want them. Which one is primary is the whole state machine:
   *
   *   EXACT       take the offer that matches
   *   NEAR ONLY   compare — taking would quietly change your amount
   *   NOTHING     post your own, because there is no takeable rate
   */
  const goToResults = () => navigate('/offers')

  const primary = createMemo(() => {
    const match = matching()
    if (match.verdict === 'exact' && match.best) {
      const { chainId, offerId } = match.best.offer
      return { label: 'Take this offer', action: () => openOrder(chainId, offerId) }
    }
    // Nothing typed yet: the book is unfiltered, so offer to browse it rather
    // than reporting "0 near offers" — there is nothing to be near to.
    if (match.verdict === 'any') {
      return { label: `See ${plural(match.all.length, 'offer')}`, action: goToResults }
    }
    if (match.verdict === 'near') {
      return { label: `See ${plural(match.near.length, 'near offer')}`, action: goToResults }
    }
    return { label: 'Post an offer', action: postOffer }
  })

  const secondary = createMemo(() => {
    const match = matching()
    if (match.verdict === 'exact') {
      const nearby = match.near.length
      return [
        { label: `See ${nearby} similar`, action: goToResults, show: nearby > 0 },
        { label: 'Post an offer', action: postOffer, show: true },
      ].filter((b) => b.show)
    }
    if (match.verdict === 'near' || match.verdict === 'any') {
      return [{ label: 'Post an offer', action: postOffer, show: true }]
    }
    return [{ label: 'See closest sizes', action: goToResults, show: app.openCount() > 0 }].filter(
      (b) => b.show,
    )
  })

  const makerSettled = useSettledCount(() => matching().best?.offer.owner)

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        'flex-direction': 'column',
        'align-items': 'center',
        'justify-content': 'center',
        gap: '15px',
        'padding-bottom': '10px',
      }}
    >
      <div
        style={{
          width: '480px',
          'max-width': '100%',
          display: 'flex',
          'flex-direction': 'column',
          gap: '7px',
        }}
      >
        <div style={{ display: 'flex', 'align-items': 'center', padding: '0 2px 3px' }}>
          <button
            style={{
              'margin-left': 'auto',
              border: '1px solid var(--line)',
              'border-radius': '6px',
              padding: '7px',
              display: 'flex',
            }}
            aria-label="Settings"
            onClick={openSettings}
          >
            <Settings />
          </button>
        </div>

        <div class="field">
          <span class="th">You pay</span>
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'space-between',
              gap: '14px',
            }}
          >
            {/*
              Always the editable field, whichever way the trade runs. The design
              is explicit that the *receive* side is the readout, so the pay side
              is by definition the one that takes input.
            */}
            <input
              class="amt"
              inputmode="decimal"
              placeholder="0"
              value={payInput()}
              onInput={(event) => setPayInput(event.currentTarget.value)}
              aria-label={`Amount to pay in ${payCurrency().symbol}`}
            />
            <CurrencyChip currency={payCurrency()} slot="pay" />
          </div>
        </div>

        <div style={{ display: 'flex', 'justify-content': 'center', margin: '-16px 0' }}>
          <button
            onClick={() => {
              // Carry the readout up into the input: the same trade, seen from
              // the other side. Keeping the digits would silently change it.
              const receiving = receiveAmountRaw()
              flipDirection(
                receiving === null ? '' : formatLeg(receiving, receiveLeg(), 18),
              )
            }}
            aria-label="Flip direction"
            style={{
              width: '32px',
              height: '32px',
              'border-radius': '9px',
              border: '1px solid var(--line2)',
              background: 'var(--panel)',
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
            }}
          >
            <Flip />
          </button>
        </div>

        <div class="field">
          <span class="th">You receive</span>
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'space-between',
              gap: '14px',
            }}
          >
            {/*
              Always the readout. An offer is indivisible — `openOffer` fixes its
              amount and `take` takes the whole thing — so there is no second
              amount to fill in, only the other side of one specific offer.
              Muted whenever the figure is an estimate rather than an offer's own
              numbers.
            */}
            <span
              class="amt"
              classList={{ dim: matching().estimated }}
              aria-label={`Amount to receive in ${receiveCurrency().symbol}`}
            >
              {matching().estimated && receiveAmount() !== '—' ? '≈ ' : ''}
              {receiveAmount()}
            </span>
            <CurrencyChip currency={receiveCurrency()} slot="receive" />
          </div>

          {/* The rule always carries a rate, and the grey line always says where
              that rate came from. */}
          <div
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '9px',
              'flex-wrap': 'wrap',
              'padding-top': '9px',
              'margin-top': '1px',
              'border-top': '1px solid var(--line)',
            }}
          >
            <span class="mono" style={{ 'font-size': '13px' }}>
              {formatRate(rate())} XMR per ETH
            </span>
            <span class="cap2">{provenance()}</span>
            <Show when={matching().verdict === 'exact' && makerSettled() !== null}>
              <span class="pill">{makerSettled()} done</span>
            </Show>
          </div>
        </div>

        <button
          class="btn btn-primary"
          style={{ height: '52px', 'font-size': '19px', 'margin-top': '6px' }}
          onClick={() => primary().action()}
          disabled={app.bookLoading()}
        >
          {app.bookLoading() ? 'Reading the book…' : primary().label}
        </button>

        <div style={{ display: 'flex', gap: '7px' }}>
          {secondary().map((button) => (
            <button
              class="btn"
              style={{ flex: 1, height: '44px', 'font-size': '17px' }}
              onClick={() => button.action()}
            >
              {button.label}
            </button>
          ))}
        </div>

        <div
          style={{
            'text-align': 'center',
            'font-size': '14px',
            color: 'var(--muted)',
            'padding-top': '4px',
          }}
        >
          <Show
            when={app.bookError()}
            fallback={
              <a class="link" href="/book" onClick={(e) => (e.preventDefault(), navigate('/book'))}>
                browse all {plural(app.openCount(), 'offer')}
              </a>
            }
          >
            {(error) => <span>the book is unreachable — {error().message}</span>}
          </Show>
        </div>

        <Show when={evmCurrency().symbol !== 'ETH'}>
          {/* Paying in something other than ETH. No protocol change: the
              contract still escrows native ETH, so the app swaps on the way in
              and back out again on the way out. */}
          <div class="sub" style={{ 'margin-top': '6px' }}>
            <span class="cap">
              {evmCurrency().symbol} is swapped to ETH on the way in through Uniswap, with an
              exact-output quote so the escrow gets a precise figure.{' '}
              <Show when={!isXmr(receiveCurrency())}>
                Payouts swap back the moment the ETH lands.
              </Show>
            </span>
          </div>
        </Show>
      </div>
    </div>
  )
}

export { XMR }
