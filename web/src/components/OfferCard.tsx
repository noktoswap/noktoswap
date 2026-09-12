import { Show, type JSX } from 'solid-js'
import { chainLabel } from '../lib/chains'
import { formatEth, formatRate, formatXmr, relativeTime, shortAddress } from '../lib/format'
import type { Leg, Match, Offer } from '../lib/offers'
import { useApp, useSettledCount } from '../state/app'
import { openOrder } from '../state/modals'
import { ArrowRight } from './icons'

/**
 * An offer in the results list.
 *
 * Each row says how much bigger or smaller it is than what the reader asked for,
 * in the unit they typed — a rate advantage is worthless if you cannot tell that
 * taking it changes your amount.
 */
export const OfferRow = (props: {
  match: Match
  /** Which leg the reader typed, so a delta reads in the right unit. */
  leg: Leg
  /** Marks the recommendation, drawn as the left ink rule. */
  best?: boolean
  /** Marks the best rate in the band, which is not always the best offer. */
  bestRate?: boolean
}): JSX.Element => {
  const app = useApp()
  const offer = () => props.match.offer
  const settled = useSettledCount(() => offer().owner)
  const mine = () => offer().owner.toLowerCase() === app.address()?.toLowerCase()

  /**
   * How much bigger or smaller than what was asked for, in the unit that was
   * typed. Absent when nothing was typed — a row cannot be "more" than nothing.
   */
  const delta = () => {
    const d = props.match.delta
    if (d === null || d === 0n) return null
    const magnitude = d < 0n ? -d : d
    const unit = props.match.band === 'exact' ? 'eth' : props.leg
    const amount = unit === 'xmr' ? formatXmr(magnitude) : formatEth(magnitude)
    return `${amount} ${unit === 'xmr' ? 'XMR' : 'ETH'} ${d > 0n ? 'more' : 'less'}`
  }

  return (
    <div class="offer" classList={{ 'offer-best': props.best }}>
      <div style={{ display: 'flex', 'align-items': 'center', gap: '11px', 'flex-wrap': 'wrap' }}>
        <span style={{ 'font-size': '20px' }}>{formatEth(offer().amount)} ETH</span>
        <ArrowRight />
        <span style={{ 'font-size': '20px' }}>{formatXmr(offer().xmrAmount)} XMR</span>
        <Show when={props.match.band === 'exact'}>
          <span class="pill">Your size</span>
        </Show>
        <Show when={delta()}>{(text) => <span class="pill">{text()}</span>}</Show>
        <Show when={props.bestRate}>
          <span class="pill pill-urgent">Best rate</span>
        </Show>
        <Show when={mine()}>
          <span class="pill">Yours</span>
        </Show>
        <span class="mono dim" style={{ 'margin-left': 'auto' }}>
          {formatRate(props.match.rate)} XMR per ETH
        </span>
      </div>

      <div style={{ display: 'flex', 'align-items': 'center', gap: '12px', 'flex-wrap': 'wrap' }}>
        <span class="cap2">
          {shortAddress(offer().owner)}
          <Show when={settled() !== null}> · {settled()} done</Show> ·{' '}
          {chainLabel(offer().chainId)} · posted {relativeTime(offer().createdAt, app.now() * 1000)}
        </span>
        <span style={{ 'margin-left': 'auto', display: 'flex', gap: '8px' }}>
          <button class="btn-inline" onClick={() => openOrder(offer().chainId, offer().offerId)}>
            Look at it
          </button>
          <Show when={!mine()}>
            <button class="btn-inline btn-fill" onClick={() => openOrder(offer().chainId, offer().offerId)}>
              Take this offer
            </button>
          </Show>
        </span>
      </div>
    </div>
  )
}

/**
 * The phone form of a book row.
 *
 * Eight columns cannot survive 393pt, so this is a redesign rather than a
 * reflow: direction and status on top, the two amounts large, everything else
 * one grey line.
 */
export const OfferPhoneCard = (props: { offer: Offer }): JSX.Element => {
  const app = useApp()
  const settled = useSettledCount(() => props.offer.owner)
  const mine = () => props.offer.owner.toLowerCase() === app.address()?.toLowerCase()
  const rate = () => {
    const eth = Number(formatEth(props.offer.amount, 18))
    return eth === 0 ? null : Number(formatXmr(props.offer.xmrAmount, 12)) / eth
  }

  return (
    <button
      class="offer"
      classList={{ 'offer-best': mine() }}
      style={{ gap: '6px' }}
      onClick={() => openOrder(props.offer.chainId, props.offer.offerId)}
    >
      <div style={{ display: 'flex', 'align-items': 'center', gap: '8px', width: '100%' }}>
        <span style={{ 'font-size': '16px' }}>
          {props.offer.kind === 'BUY' ? 'XMR → ETH' : 'ETH → XMR'}
        </span>
        <span class="pill" style={{ 'margin-left': 'auto' }}>
          {mine() ? 'Yours' : props.offer.state.charAt(0) + props.offer.state.slice(1).toLowerCase()}
        </span>
      </div>
      <div style={{ display: 'flex', 'align-items': 'baseline', gap: '8px', width: '100%' }}>
        <span style={{ 'font-size': '17px' }}>{formatEth(props.offer.amount)} ETH</span>
        <ArrowRight size={14} />
        <span style={{ 'font-size': '17px' }}>{formatXmr(props.offer.xmrAmount)} XMR</span>
        <span class="mono dim" style={{ 'margin-left': 'auto', 'font-size': '12.5px' }}>
          {formatRate(rate())}
        </span>
      </div>
      <span class="cap2" style={{ 'text-align': 'left' }}>
        {shortAddress(props.offer.owner)}
        <Show when={settled() !== null}> · {settled()} done</Show> · {chainLabel(props.offer.chainId)} ·{' '}
        {relativeTime(props.offer.createdAt, app.now() * 1000)}
      </span>
    </button>
  )
}
