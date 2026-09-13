import { Checkbox } from '@kobalte/core/checkbox'
import { useQuery } from '@tanstack/solid-query'
import { For, Show, type JSX } from 'solid-js'
import { CHAINS, realmOf } from '../lib/chains'
import { formatEth, plural } from '../lib/format'
import { fetchNativeAcrossChains } from '../lib/balances'
import { useApp } from '../state/app'
import { closeModal, type ChainFilterTarget } from '../state/modals'
import {
  bookChains,
  clearBookChains,
  clearTokenNetworks,
  isAllChains,
  toggleBookChain,
  toggleTokenNetwork,
  tokenNetworks,
} from '../state/filters'
import { Modal } from './Modal'
import { ChainIcon } from './TokenIcon'
import { Check } from './icons'

/**
 * The fuller network view, opened from the network control in the token picker
 * or from the book's chain chip.
 *
 * ── two fixes worth naming, because the symptom was "nothing happens" ───────
 *
 * It used to be handed `selected` as a *value*, snapshotted when the dialog
 * opened. Toggling a chain updated the signal behind that snapshot but never the
 * snapshot, so no box ever ticked. It now takes a `target` and reads the live
 * signal for it — reactive state cannot be passed by copy.
 *
 * The boxes are Kobalte checkboxes rather than buttons wearing a square. That
 * buys real checkbox semantics: space to toggle, a genuine `input` for
 * assistive tech and forms, and `checked`/`onChange` in place of a click handler
 * inferring intent from where the pointer landed.
 *
 * ── the model ───────────────────────────────────────────────────────────────
 *
 * Multi-select, because the wireframe draws checkboxes and because a token *is*
 * a (chain, token) pair — someone holding USDC on two chains has two genuinely
 * different things to choose between and no reason to see one at a time.
 *
 * **All chains is the absence of a filter**, not every box ticked. Unticking the
 * last chain widens the view rather than emptying it.
 *
 * One book, not four. An order never leaves the chain it was opened on, but
 * switching to take one is a single wallet prompt — so what actually limits a
 * reader is where their money already is. Hence the balances, and the greyed-out
 * figure on a chain they have nothing on. The one honest deviation from the
 * wireframe: chains with no deployment say so rather than showing a fabricated
 * open count.
 */

/**
 * A checkbox row.
 *
 * `Checkbox.Label` holds the name and nothing else. Kobalte points
 * `aria-labelledby` at it, so anything put inside becomes part of the control's
 * accessible name — sweeping the balance and the deployment note in there gave
 * every box a name like "Base 0.42 ETH 23 open". Those are *supplementary*, so
 * they sit outside the label as a sibling: same layout, a name that identifies
 * the control, and no redundant `aria-label` fighting Kobalte's own wiring.
 */
const Box = (props: {
  checked: boolean
  label: string
  onChange: () => void
  /** Icon rendered before the name, inside the label. */
  icon?: JSX.Element
  /** Supplementary figures, outside the accessible name. */
  detail?: JSX.Element
}): JSX.Element => (
  <Checkbox class="chainrow" checked={props.checked} onChange={props.onChange}>
    <Checkbox.Input class="sr-only" />
    <Checkbox.Control class="cbox">
      <Checkbox.Indicator>
        <Check />
      </Checkbox.Indicator>
    </Checkbox.Control>
    <Checkbox.Label class="chainrow-label">
      {props.icon}
      <span style={{ flex: 1, 'min-width': 0, 'font-size': '16px' }}>{props.label}</span>
    </Checkbox.Label>
    {props.detail}
  </Checkbox>
)

export const ChainPicker = (props: { target: ChainFilterTarget }): JSX.Element => {
  const app = useApp()

  /** Live, not a snapshot — that distinction was the whole bug. */
  const selected = () => (props.target === 'token-networks' ? tokenNetworks() : bookChains())
  const toggle = (chainId: number) =>
    props.target === 'token-networks' ? toggleTokenNetwork(chainId) : toggleBookChain(chainId)
  const clear = () =>
    props.target === 'token-networks' ? clearTokenNetworks() : clearBookChains()

  /**
   * Native balances read on-chain rather than from the Token API, which covers
   * mainnets only and so reported nothing for Sepolia — the one chain that
   * actually has a contract. `getBalance` works everywhere and cannot be stale.
   */
  const balances = useQuery(() => {
    const who = app.address()
    return {
      queryKey: ['native-balances', who],
      queryFn: () =>
        who
          ? fetchNativeAcrossChains(who, CHAINS.map((c) => c.chain.id))
          : Promise.resolve(new Map<number, bigint>()),
      enabled: Boolean(who),
      staleTime: 60_000,
    }
  })

  /**
   * Three distinct facts, and the row has to tell them apart:
   *   a count      — deployed and indexed, so the book is knowable
   *   'unindexed'  — deployed, but this app cannot list its offers
   *   'absent'     — no contract at all
   *
   * Reporting "0 open" for an unindexed chain would be a claim about the market
   * rather than about our coverage.
   */
  const bookOn = (info: (typeof CHAINS)[number]): number | 'unindexed' | 'absent' => {
    if (info.deployment === null) return 'absent'
    if (info.subgraph === null) return 'unindexed'
    return app.openCount()
  }

  /*
   * Split by realm, because the realms are not interchangeable and the list read
   * as though they were: Sepolia sat between mainnets, one row of play money
   * among real ones, distinguished only by a name you had to recognise.
   *
   * The books never merge — `visibleChains` filters by realm — so a selection
   * spanning both groups cannot show a single combined book, and the heading is
   * what makes that legible before someone reads a price. Derived from `realmOf`
   * rather than `chain.testnet` so there is one definition of which is which.
   */
  const GROUPS = [
    { label: 'Mainnets', first: true, chains: () => CHAINS.filter((c) => realmOf(c.chain.id) === 'mainnet') },
    { label: 'Testnets', first: false, chains: () => CHAINS.filter((c) => realmOf(c.chain.id) === 'testnet') },
  ]

  return (
    <Modal title="Chains" width={422}>
      {/*
        Not a chain in the list — the state of having no filter at all. Ticked
        exactly when nothing else is, and ticking it clears the rest.
      */}
      <div style={{ 'border-bottom': '1px solid var(--line)', 'padding-bottom': '7px' }}>
        <Box
          checked={isAllChains(selected())}
          label="All chains"
          onChange={clear}
          detail={<span class="cap">{plural(app.openCount(), 'open', 'open')}</span>}
        />
      </div>

      <div style={{ display: 'flex', 'flex-direction': 'column' }}>
        <For each={GROUPS}>
          {(group) => (
            <Show when={group.chains().length > 0}>
              <span
                class="th"
                style={{ padding: '9px 2px 3px', 'border-top': group.first ? undefined : '1px solid var(--line)' }}
              >
                {group.label}
              </span>
              <For each={group.chains()}>
          {(info) => {
            const balance = () => balances.data?.get(info.chain.id) ?? null
            const book = () => bookOn(info)
            return (
              <Box
                checked={selected().includes(info.chain.id)}
                label={info.label}
                onChange={() => toggle(info.chain.id)}
                icon={<ChainIcon chainId={info.chain.id} />}
                detail={
                  <span class="stack" style={{ 'text-align': 'right', gap: '2px' }}>
                    <span
                      class="mono"
                      style={{
                        'font-size': '14px',
                        // Greyed out on a chain you have nothing on.
                        color: (balance() ?? 0n) > 0n ? undefined : 'var(--muted)',
                      }}
                    >
                      {/* An absent entry means the RPC did not answer, which is
                          not the same fact as a zero balance. */}
                      <Show when={balance() !== null} fallback={<>—</>}>
                        {formatEth(balance() ?? 0n, 4)} {info.chain.nativeCurrency.symbol}
                      </Show>
                    </span>
                    <span class="cap2" style={{ 'font-size': '12.5px' }}>
                      {book() === 'absent'
                        ? 'not deployed'
                        : book() === 'unindexed'
                          ? 'live · book not indexed'
                          : `${book()} open`}
                    </span>
                  </span>
                }
              />
            )
          }}
              </For>
            </Show>
          )}
        </For>
      </div>

      <span class="cap" style={{ 'padding-top': '4px' }}>
        Offers live on the chain they were opened on, and the two groups never share a book — a
        testnet offer is play money and is priced as such. The contract sits at one address across
        chains; every chain here is routable by the Uniswap Trading API.
      </span>

      <button class="btn btn-primary" onClick={closeModal}>
        <Show when={isAllChains(selected())} fallback={`Show ${selected().length} selected`}>
          Show all chains
        </Show>
      </button>
    </Modal>
  )
}
