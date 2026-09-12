import { A } from '@solidjs/router'
import { For, Show, type JSX } from 'solid-js'
import { chainLabel } from '../lib/chains'
import { countdown, formatEth, formatXmr, isUrgent, plural, shortAddress } from '../lib/format'
import { waitingOnYou, type Offer, type OrderStatus } from '../lib/offers'
import { useApp, useSettledCount } from '../state/app'
import { openOrder } from '../state/modals'
import { Chevron } from './icons'

/**
 * The one thing that outranks everything else on the page: a clock already
 * running on your side.
 *
 * These rows sit above the fold on every screen and appear nowhere else — a
 * deliberate constraint from the design, and the reason this component is
 * imported by every route rather than owned by one.
 */

const Counterparty = (props: { offer: Offer }): JSX.Element => {
  const app = useApp()
  const other = () => {
    const me = app.address()?.toLowerCase()
    if (props.offer.owner.toLowerCase() !== me) return props.offer.owner
    return props.offer.counterparty
  }
  const settled = useSettledCount(other)

  return (
    <Show when={other()} fallback={<>posted on {chainLabel(props.offer.chainId)}</>}>
      {(address) => (
        <>
          with {shortAddress(address())}
          <Show when={settled() !== null}> · {settled()} done</Show> · {chainLabel(props.offer.chainId)}
        </>
      )}
    </Show>
  )
}

const OrderLine = (props: { offer: Offer; status: OrderStatus; compact?: boolean }): JSX.Element => {
  const app = useApp()
  const pay = () =>
    props.status.side === 'evm'
      ? `${formatEth(props.offer.amount)} ETH → ${formatXmr(props.offer.xmrAmount)} XMR`
      : `${formatXmr(props.offer.xmrAmount)} XMR → ${formatEth(props.offer.amount)} ETH`

  return (
    <div class="ord ord-live">
      <span class="pill">#{props.offer.offerId.toString()}</span>
      <span class="stack2" style={{ flex: 1 }}>
        <span style={{ 'font-size': props.compact ? '16px' : '17px' }}>{props.status.headline}</span>
        <Show when={!props.compact}>
          <span class="cap2">
            {pay()} · <Counterparty offer={props.offer} />
          </span>
        </Show>
      </span>
      <span
        class="pill"
        classList={{ 'pill-urgent': isUrgent(props.status.deadline, app.now() * 1000) }}
      >
        {countdown(props.status.deadline, app.now() * 1000)}
      </span>
      <button
        class="btn-inline btn-fill"
        onClick={() => openOrder(props.offer.chainId, props.offer.offerId)}
      >
        {props.status.primary?.label ?? 'Open'}
      </button>
    </div>
  )
}

export const WaitingOnYou = (props: { compact?: boolean }): JSX.Element => {
  const app = useApp()
  const pending = () => waitingOnYou(app.myOrders(), app.address(), app.now())

  return (
    <Show when={pending().length > 0}>
      {/* Desktop: the full band, with the rule that explains what a miss costs. */}
      <div
        class="card desktop-only"
        style={{
          padding: '11px 13px',
          display: 'flex',
          'flex-direction': 'column',
          gap: '8px',
        }}
      >
        <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
          <span class="th">Waiting on you</span>
          <span class="cap2">
            Miss a deadline and the order closes itself. Both sides get their money back.
          </span>
        </div>
        <For each={pending()}>
          {(item) => (
            <OrderLine offer={item.offer} status={item.status} compact={props.compact} />
          )}
        </For>
      </div>

      {/*
        Phone: the desktop shape would eat ~200 of 852pt, so it collapses to one
        tappable line carrying the count and the soonest deadline. Still
        impossible to miss; the cards themselves live on My orders.
      */}
      <div class="phone-only" style={{ padding: '12px 16px 0' }}>
        <A href="/orders" style={{ 'text-decoration': 'none' }}>
          <div class="ord ord-live" style={{ gap: '9px' }}>
            <span
              class="pill"
              classList={{ 'pill-urgent': isUrgent(pending()[0]?.status.deadline ?? null, app.now() * 1000) }}
            >
              {countdown(pending()[0]?.status.deadline ?? null, app.now() * 1000).replace(' left', '')}
            </span>
            <span style={{ flex: 1 }}>
              Your {plural(pending().length, 'order')} pending
            </span>
            <span class="dim">
              <Chevron size={14} class="" />
            </span>
          </div>
        </A>
      </div>
    </Show>
  )
}

export { OrderLine }
