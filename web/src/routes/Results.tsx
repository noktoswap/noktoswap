import { A } from '@solidjs/router'
import { For, Show, createMemo, type JSX } from 'solid-js'
import { Footer, Nav } from '../components/Nav'
import { OfferRow } from '../components/OfferCard'
import { WaitingOnYou } from '../components/WaitingOnYou'
import { HOME_CHAIN } from '../lib/chains'
import { formatEth, formatXmr, plural } from '../lib/format'
import { matchOffers, receiveAmountFor, type Leg, type Match } from '../lib/offers'
import { useApp } from '../state/app'
import { openCreate } from '../state/modals'
import { nearBand, nearBandPercent } from '../state/settings'
import { payAmount, payLeg, receiveLeg, seedOfferDraft, want, wantedKind } from '../state/swap'
import { ArrowRight } from '../components/icons'

/**
 * Offers that fit.
 *
 * Leads with the exact band when there is one, then the near band, each row
 * saying how much bigger or smaller it is in the unit the reader typed. Rate
 * order inside each band — best first. The band defaults to ±10% and is a
 * setting, because how much size a reader will trade for rate is a preference.
 *
 * There is no separate empty-results page: every path into this screen has at
 * least one offer by construction, because the landing screen only sends you
 * here when it found something. If the book emptied in between, the invitation
 * to post is what is left.
 */
export const Results = (): JSX.Element => {
  const app = useApp()
  const matching = createMemo(() => matchOffers(app.book(), want(), wantedKind(), nearBand()))

  const payUnit = () => (payLeg() === 'eth' ? 'ETH' : 'XMR')
  const formatLeg = (value: bigint, leg: Leg, decimals?: number) =>
    leg === 'eth' ? formatEth(value, decimals) : formatXmr(value, decimals)

  /** Best rate in a band is not always the recommended offer — label both. */
  const bestRateOf = (band: Match[]): bigint | null => {
    if (band.length === 0) return null
    return band.reduce((a, b) => ((b.rate ?? 0) > (a.rate ?? 0) ? b : a)).offer.offerId
  }

  const nearBestRate = createMemo(() => bestRateOf(matching().near))

  /** The receiving leg's figure, from the one shared definition. */
  const receiving = createMemo(() => receiveAmountFor(matching(), want(), matching().rate))

  /** Same carry-across as the widget, and keyed by leg for the same reason. */
  const postOffer = () => {
    const paying = payAmount()
    const other = receiving()
    const ethLeg = payLeg() === 'eth' ? paying : other
    const xmrLeg = payLeg() === 'eth' ? other : paying
    seedOfferDraft({
      eth: ethLeg === null ? '' : formatEth(ethLeg, 18),
      xmr: xmrLeg === null ? '' : formatXmr(xmrLeg, 12),
    })
    openCreate()
  }

  return (
    <div class="page">
      <Nav />
      <WaitingOnYou compact />

      <div
        style={{
          width: '900px',
          'max-width': '100%',
          margin: '0 auto',
          display: 'flex',
          'flex-direction': 'column',
          gap: '18px',
        }}
      >
        {/*
          What was asked for, and the way back to change it.

          With no amount there is no size to show, so it says what it is actually
          showing instead. "0 ETH → —" alongside "0 of 1 near this size" was a
          filter describing itself as a failure when nothing had been filtered.
        */}
        <div class="card" style={{ padding: '12px 15px', display: 'flex', 'align-items': 'center', gap: '14px', 'flex-wrap': 'wrap' }}>
          <Show
            when={payAmount() !== null}
            fallback={
              <span style={{ 'font-size': '19px' }}>
                Every {payUnit()} ⇄ {receiveLeg() === 'eth' ? 'ETH' : 'XMR'} offer
              </span>
            }
          >
            <span style={{ 'font-size': '19px' }}>
              {formatLeg(payAmount() ?? 0n, payLeg())} {payUnit()}
            </span>
            <ArrowRight size={19} />
            <span style={{ 'font-size': '19px' }}>
              {/* Same readout the widget shows — `receiveAmountFor` is the single
                  definition, so selling XMR cannot estimate an ETH figure on one
                  screen and show a dash on the other. */}
              <Show when={receiving()} fallback="—">
                {(value) => (
                  <>
                    {matching().estimated ? '≈ ' : ''}
                    {formatLeg(value(), receiveLeg())}{' '}
                    {receiveLeg() === 'eth' ? 'ETH' : 'XMR'}
                  </>
                )}
              </Show>
            </span>
          </Show>
          <span style={{ 'margin-left': 'auto', display: 'flex', 'align-items': 'center', gap: '12px' }}>
            <span class="cap2">
              <Show
                when={payAmount() !== null}
                fallback={<>{plural(matching().all.length, 'offer')} open</>}
              >
                {matching().exact.length + matching().near.length} of {app.openCount()} near this
                size
              </Show>
            </span>
            <A href="/" class="btn-inline">
              <Show when={payAmount() !== null} fallback="Narrow by amount">
                Change
              </Show>
            </A>
          </span>
        </div>

        {/*
          No amount typed: the whole book on this side, rate order. Strictly more
          useful than an empty page telling the reader to go back and type
          something — and it is the same list they would have got by doing so with
          no constraint.
        */}
        <Show when={matching().verdict === 'any'}>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '9px' }}>
            <div style={{ display: 'flex', 'align-items': 'baseline', gap: '10px' }}>
              <span class="th">Every offer you can take</span>
              <span class="cap2">any size · best rate first</span>
            </div>
            <For each={matching().all}>
              {(match, index) => (
                <OfferRow match={match} leg={payLeg()} best={index() === 0} />
              )}
            </For>
          </div>
        </Show>

        <Show when={matching().exact.length > 0}>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '9px' }}>
            <div style={{ display: 'flex', 'align-items': 'baseline', gap: '10px' }}>
              <span class="th">Exactly what you asked for</span>
              <span class="cap2">{plural(matching().exact.length, 'offer')}</span>
            </div>
            <For each={matching().exact}>
              {(match, index) => <OfferRow match={match} leg={payLeg()} best={index() === 0} />}
            </For>
          </div>
        </Show>

        <Show when={matching().near.length > 0}>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '9px' }}>
            <div style={{ display: 'flex', 'align-items': 'baseline', gap: '10px' }}>
              <span class="th">Close to it</span>
              <span class="cap2">
                within {nearBandPercent()}% of your size · {plural(matching().near.length, 'offer')}
              </span>
            </div>
            <For each={matching().near}>
              {(match, index) => (
                <OfferRow
                  match={match}
                  leg={payLeg()}
                  best={matching().exact.length === 0 && index() === 0}
                  bestRate={match.offer.offerId === nearBestRate()}
                />
              )}
            </For>
          </div>
        </Show>

        {/*
          Only a real empty state now: an amount was given and nothing fits it.
          With no amount there is nothing to be empty of, and the list above is
          showing the book.
        */}
        <Show when={matching().verdict === 'none'}>
          <div class="sub">
            <span class="cap">
              <Show
                when={payAmount() !== null}
                fallback={<>Nothing on the book yet — post the first offer and set the rate.</>}
              >
                Nothing within {nearBandPercent()}% of {formatLeg(payAmount() ?? 0n, payLeg())}{' '}
                {payUnit()} right now.
              </Show>
            </span>
          </div>
        </Show>

        {/* The third branch, always available: ask for your own size. */}
        <div
          class="card"
          style={{
            padding: '14px 16px',
            display: 'flex',
            'align-items': 'center',
            gap: '18px',
            'border-style': 'dashed',
            'flex-wrap': 'wrap',
          }}
        >
          <span class="stack2" style={{ flex: 1, gap: '3px' }}>
            <span style={{ 'font-size': '18px' }}>None of these the right size? Ask for your own.</span>
            <span class="cap2">Sits in the book until somebody takes it. Cancel any time.</span>
          </span>
          <button class="btn-inline btn-fill" onClick={postOffer}>
            Post my own offer
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            'justify-content': 'space-between',
            'font-size': '14px',
            color: 'var(--muted)',
            gap: '12px',
          }}
        >
          <A href="/book" class="link">
            Browse all {app.openCount()} offers
          </A>
          <span>Sorted by rate, best first</span>
        </div>
      </div>

      <Footer contract={HOME_CHAIN.deployment ?? undefined} explorer={HOME_CHAIN.explorer} />
    </div>
  )
}
