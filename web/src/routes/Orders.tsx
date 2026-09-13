import { A } from '@solidjs/router'
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { Footer, Nav } from '../components/Nav'
import { chainLabel } from '../lib/chains'
import { countdown, formatEth, formatXmr, isUrgent, shortAddress } from '../lib/format'
import { orderStatus, type Offer, type OrderStatus } from '../lib/offers'
import { useApp, useSettledCount } from '../state/app'
import { openOrder } from '../state/modals'

/**
 * My orders.
 *
 * Live orders get their own tab rather than rows buried in the market list —
 * borrowed from Telegram @wallet, and it works because the order object carries
 * two separate clocks, one per side. So the list splits by *whose turn it is*
 * rather than by state, and each row shows only the side whose turn it is.
 */

type Tab = 'live' | 'past'

const TERMINAL = new Set(['CLAIMED', 'REFUNDED', 'CANCELLED'])

const OrderRow = (props: { offer: Offer; status: OrderStatus; live: boolean }): JSX.Element => {
  const app = useApp()
  const other = () => {
    const me = app.address()?.toLowerCase()
    return props.offer.owner.toLowerCase() === me ? props.offer.counterparty : props.offer.owner
  }
  const settled = useSettledCount(other)

  const pair = () =>
    props.status.side === 'evm'
      ? `${formatEth(props.offer.amount)} ETH → ${formatXmr(props.offer.xmrAmount)} XMR`
      : `${formatXmr(props.offer.xmrAmount)} XMR → ${formatEth(props.offer.amount)} ETH`

  return (
    <div class="ord" classList={{ 'ord-live': props.live }}>
      <span class="pill">#{props.offer.offerId.toString()}</span>
      <span style={{ flex: 1, 'min-width': 0, display: 'flex', 'flex-direction': 'column', gap: '2px' }}>
        <span style={{ 'font-size': '17px' }}>{props.status.headline}</span>
        <span class="cap">
          {pair()} ·{' '}
          <Show when={other()} fallback={<>posted on {chainLabel(props.offer.chainId)}</>}>
            {(address) => (
              <>
                with {shortAddress(address())}
                <Show when={settled() !== null}> · {settled()} done</Show> ·{' '}
                {chainLabel(props.offer.chainId)}
              </>
            )}
          </Show>
        </span>
      </span>
      <span
        class="pill"
        classList={{ 'pill-urgent': isUrgent(props.status.deadline, app.now() * 1000) }}
      >
        {countdown(props.status.deadline, app.now() * 1000)}
      </span>
      <button
        class="btn-inline"
        classList={{
          'btn-fill': props.live,
          'btn-exit': props.status.primary?.kind === 'quit',
        }}
        onClick={() => openOrder(props.offer.chainId, props.offer.offerId)}
      >
        {props.status.primary?.label ?? props.status.secondary?.label ?? 'Open'}
      </button>
    </div>
  )
}

export const Orders = (): JSX.Element => {
  const app = useApp()
  const [tab, setTab] = createSignal<Tab>('live')

  const withStatus = createMemo(() =>
    app.myOrders().map((offer) => ({ offer, status: orderStatus(offer, app.address(), app.now()) })),
  )

  const mine = () => withStatus().filter((row) => !TERMINAL.has(row.offer.state))
  const past = () => withStatus().filter((row) => TERMINAL.has(row.offer.state))

  const onYou = () => mine().filter((row) => row.status.waitingOnYou)
  const onThem = () => mine().filter((row) => !row.status.waitingOnYou)

  return (
    <div class="page">
      <Nav />

      <div
        style={{
          width: '920px',
          'max-width': '100%',
          margin: '0 auto',
          display: 'flex',
          'flex-direction': 'column',
          gap: '14px',
        }}
      >
        <div style={{ display: 'flex', gap: '22px', 'align-items': 'flex-end', padding: '0 4px' }}>
          <A href="/book" class="dim" style={{ 'padding-bottom': '5px', 'text-decoration': 'none' }}>
            Open orders
          </A>
          <button
            style={{
              'padding-bottom': '5px',
              'border-bottom': tab() === 'live' ? '3px solid var(--ink)' : undefined,
              color: tab() === 'live' ? undefined : 'var(--muted)',
            }}
            onClick={() => setTab('live')}
          >
            My orders
          </button>
          <button
            style={{
              'padding-bottom': '5px',
              'border-bottom': tab() === 'past' ? '3px solid var(--ink)' : undefined,
              color: tab() === 'past' ? undefined : 'var(--muted)',
            }}
            onClick={() => setTab('past')}
          >
            Past orders
          </button>
          <span style={{ 'margin-left': 'auto', 'padding-bottom': '6px' }} class="cap">
            {onYou().length} waiting on you
          </span>
        </div>

        <Show when={tab() === 'live'}>
          <div
            style={{
              border: '1px solid var(--line2)',
              'border-radius': '6px',
              padding: '10px 13px',
              'font-size': '15px',
            }}
          >
            Miss a deadline and the order closes itself. Both sides get their money back.
          </div>

          <Show when={!app.address()}>
            <div class="sub">
              <span class="cap">Connect a wallet to see your orders.</span>
            </div>
          </Show>

          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <Show when={onYou().length > 0}>
              <span class="th" style={{ padding: '2px 4px' }}>
                Waiting on you
              </span>
              <For each={onYou()}>
                {(row) => <OrderRow offer={row.offer} status={row.status} live />}
              </For>
            </Show>

            <Show when={onThem().length > 0}>
              <span class="th" style={{ padding: '8px 4px 2px' }}>
                Waiting on someone else
              </span>
              <For each={onThem()}>
                {(row) => <OrderRow offer={row.offer} status={row.status} live={false} />}
              </For>
            </Show>

            <Show when={app.address() && mine().length === 0}>
              <div class="sub">
                <span class="cap">
                  Nothing live. <A href="/" class="link">Find a swap</A> or post an offer.
                </span>
              </div>
            </Show>
          </div>
        </Show>

        <Show when={tab() === 'past'}>
          <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <Show
              when={past().length > 0}
              fallback={
                <div class="sub">
                  <span class="cap">No finished orders yet.</span>
                </div>
              }
            >
              <For each={past()}>
                {(row) => <OrderRow offer={row.offer} status={row.status} live={false} />}
              </For>
            </Show>
          </div>
        </Show>
      </div>

      <Footer chainId={app.actionChainId()} />
    </div>
  )
}
