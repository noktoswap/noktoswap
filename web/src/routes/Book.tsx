import { A, useNavigate } from '@solidjs/router'
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { Footer, Nav } from '../components/Nav'
import { OfferPhoneCard } from '../components/OfferCard'
import { WaitingOnYou } from '../components/WaitingOnYou'
import { Chevron, Plus } from '../components/icons'
import { ChainIcon, TokenIcon } from '../components/TokenIcon'
import { chainLabel } from '../lib/chains'
import { formatEth, formatRate, formatXmr, plural, relativeTime, shortAddress } from '../lib/format'
import { rateXmrPerEth } from '../lib/format'
import type { Offer } from '../lib/offers'
import { useApp, useSettledCount } from '../state/app'
import { bookChains, isAllChains } from '../state/filters'
import { openChainPicker, openCreate, openOrder, openTokenPicker } from '../state/modals'
import {
  payCurrency,
  payInput,
  payLeg,
  seedOfferDraft,
  setEvmCurrency,
  setPayInput,
} from '../state/swap'

/**
 * The whole book, one click from anywhere, for people who want to read the
 * market rather than ask it a question. A destination, not the front door.
 *
 * The amount bar across the top is the same one from the landing screen, so
 * narrowing from here lands on the same results screen. Create offer stays a
 * button, never a permanent panel.
 */

const PAGE = 25

const Cell = (props: { children: JSX.Element; right?: boolean }): JSX.Element => (
  <span class={props.right ? 'num' : undefined}>{props.children}</span>
)

const BookRow = (props: { offer: Offer }): JSX.Element => {
  const app = useApp()
  const settled = useSettledCount(() => props.offer.owner)
  const mine = () => props.offer.owner.toLowerCase() === app.address()?.toLowerCase()

  return (
    <button
      class="tgrid"
      classList={{ mine: mine() }}
      style={{ padding: '12px 6px', 'border-bottom': '1px solid var(--box2)', width: '100%' }}
      onClick={() => openOrder(props.offer.chainId, props.offer.offerId)}
    >
      <Cell>{props.offer.kind === 'BUY' ? 'XMR → ETH' : 'ETH → XMR'}</Cell>
      <span class="stack2">
        <span class="mono">{shortAddress(props.offer.owner)}</span>
        <span class="cap2">
          {mine() ? 'you · ' : ''}
          {settled() ?? 0} done
        </span>
      </span>
      <Cell>
        {/*
          The chain as its mark rather than its name. The column is 100px and the
          logos are distinct, so the icon reads faster than the word — with the
          name kept on hover and in the accessibility tree, since an unlabelled
          glyph in a data table is a riddle.
        */}
        <ChainIcon chainId={props.offer.chainId} size={24} label={chainLabel(props.offer.chainId)} />
      </Cell>
      <Cell>
        <span class="cap2">{relativeTime(props.offer.createdAt, app.now() * 1000)}</span>
      </Cell>
      <Cell right>
        <span class="mono">{formatRate(rateXmrPerEth(props.offer.amount, props.offer.xmrAmount))}</span>
      </Cell>
      <Cell right>
        <span class="mono">{formatEth(props.offer.amount)}</span>
      </Cell>
      <Cell right>
        <span class="mono">{formatXmr(props.offer.xmrAmount)}</span>
      </Cell>
      <Cell right>
        <span class="pill">
          {mine()
            ? 'Yours'
            : props.offer.state.charAt(0) + props.offer.state.slice(1).toLowerCase()}
        </span>
      </Cell>
    </button>
  )
}

export const Book = (): JSX.Element => {
  const app = useApp()
  const navigate = useNavigate()
  const [shown, setShown] = createSignal(PAGE)
  const rows = createMemo(() => {
    // Every offer is on the home chain today; the filter still applies so the
    // control is not a lie when a second deployment lands.
    // Filter on each offer's own chain. It used to compare the filter against a
    // single global chain, which meant selecting one chain either showed the whole
    // book or nothing at all.
    const selected = bookChains()
    const visible = isAllChains(selected)
      ? app.book()
      : app.book().filter((offer) => selected.includes(offer.chainId))
    return visible.slice(0, shown())
  })

  const chainLabelForChip = () => {
    const selected = bookChains()
    if (isAllChains(selected)) return 'All chains'
    if (selected.length === 1) return chainLabel(selected[0])
    return `${selected.length} chains`
  }

  return (
    <div class="page">
      <Nav />
      <WaitingOnYou compact />

      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px', padding: '0 16px' }}>
        {/* Same amount bar as the landing screen. */}
        <div
          class="card"
          style={{
            padding: '11px 14px',
            display: 'flex',
            'align-items': 'center',
            gap: '11px',
            'flex-wrap': 'wrap',
          }}
        >
          <span
            style={{
              display: 'flex',
              'align-items': 'center',
              gap: '10px',
              border: '1px solid var(--line)',
              'border-radius': '6px',
              background: 'var(--box)',
              padding: '8px 12px',
              width: '212px',
            }}
          >
            <input
              placeholder="Amount"
              inputmode="decimal"
              value={payInput()}
              onInput={(event) => setPayInput(event.currentTarget.value)}
              aria-label={`Amount in ${payCurrency().symbol}`}
            />
            <button
              style={{ display: 'flex', 'align-items': 'center', gap: '6px', flex: 'none' }}
              onClick={() => openTokenPicker(payCurrency(), setEvmCurrency)}
            >
              <TokenIcon currency={payCurrency()} size={16} />
              {payCurrency().symbol}
              <Chevron size={12} />
            </button>
          </span>

          <button class="btn-inline btn-fill" onClick={() => navigate('/offers')}>
            Find offers
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '22px',
            'align-items': 'flex-end',
            padding: '0 6px',
            'flex-wrap': 'wrap',
          }}
        >
          <span style={{ 'border-bottom': '3px solid var(--ink)', 'padding-bottom': '5px' }}>
            Open orders
          </span>
          <A href="/orders" class="dim" style={{ 'padding-bottom': '5px', 'text-decoration': 'none' }}>
            My orders
            <Show when={app.myOrders().length > 0}> ({app.myOrders().length})</Show>
          </A>
          <span
            style={{
              'margin-left': 'auto',
              'padding-bottom': '4px',
              display: 'flex',
              'align-items': 'center',
              gap: '10px',
            }}
          >
            <span class="cap">
              {app.openCount()} open across {plural(app.openByChain().size, 'chain')}
              <Show when={app.realm() === 'testnet'}> · test networks</Show>
            </span>
            <button
              class="chip"
              classList={{ 'chip-on': !isAllChains(bookChains()) }}
              style={{ padding: '5px 9px', 'font-size': '14px' }}
              onClick={() => openChainPicker('book-chains')}
            >
              <Show
                when={bookChains().length === 1}
                fallback={<ChainIcon chainId={app.actionChainId()} size={15} />}
              >
                <ChainIcon chainId={bookChains()[0] ?? app.actionChainId()} size={15} />
              </Show>
              {chainLabelForChip()}
              <Chevron size={12} />
            </button>
            <button
              class="btn-inline btn-fill"
              style={{ display: 'flex', 'align-items': 'center', gap: '7px' }}
              onClick={() => {
                // Whatever is in the amount bar comes along; an empty bar seeds
                // nothing rather than clearing a draft in progress.
                seedOfferDraft({
                  eth: payLeg() === 'eth' ? payInput() : '',
                  xmr: payLeg() === 'xmr' ? payInput() : '',
                })
                openCreate()
              }}
            >
              <Plus />
              Create offer
            </button>
          </span>
        </div>

        {/* Desktop: the eight-column table. */}
        <div
          class="card desktop-only"
          style={{ padding: '12px 14px', display: 'flex', 'flex-direction': 'column', gap: '2px' }}
        >
          <div class="tgrid th" style={{ padding: '4px 6px 10px', 'border-bottom': '1px solid var(--line)' }}>
            <span>Swap</span>
            <span>Trader</span>
            <span>Chain</span>
            <span>Posted</span>
            <span class="num">Rate</span>
            <span class="num">ETH</span>
            <span class="num">XMR</span>
            <span class="num">Status</span>
          </div>

          <Show
            when={rows().length > 0}
            fallback={
              <div style={{ padding: '22px 6px' }}>
                <span class="cap">
                  <Show when={app.bookError()} fallback="Nothing on the book yet.">
                    {(error) => <>The subgraph is unreachable — {error().message}</>}
                  </Show>
                </span>
              </div>
            }
          >
            <For each={rows()}>{(offer) => <BookRow offer={offer} />}</For>
          </Show>

          <Show when={app.book().length > shown()}>
            <button
              style={{
                border: '1px solid var(--line)',
                'border-radius': '6px',
                padding: '8px 14px',
                'align-self': 'flex-start',
                'margin-top': '12px',
                'font-size': '15px',
              }}
              onClick={() => setShown((n) => n + PAGE)}
            >
              Load more
            </button>
          </Show>
        </div>

        {/* Phone: each offer becomes a card. */}
        <div
          class="phone-only"
          style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'padding-bottom': '16px' }}
        >
          <For each={rows()}>{(offer) => <OfferPhoneCard offer={offer} />}</For>
        </div>
      </div>

      <Footer chainId={app.actionChainId()} />
    </div>
  )
}
