import { useQuery } from '@tanstack/solid-query'
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { CHAINS, NATIVE, chainLabel } from '../lib/chains'
import { formatToken, shortAddress } from '../lib/format'
import { fetchOnchainBalances } from '../lib/balances'
import { coversChain, fetchBalances } from '../lib/tokenApi'
import { fetchSwappableTokens } from '../lib/uniswap'
import { XMR, nativeOf, popularFor, sameCurrency, type Currency } from '../lib/tokens'
import { useApp } from '../state/app'
import {
  clearTokenNetworks,
  isAllChains,
  resolveChains,
  toggleTokenNetwork,
  tokenNetworks,
} from '../state/filters'
import { closeAllModals, openChainPicker } from '../state/modals'
import { Modal } from './Modal'
import { ChainIcon, TokenIcon, TokenIconFor } from './TokenIcon'
import { Chevron, Search } from './icons'

/**
 * One picker, but the two halves of a trade are not alike and the rule says so.
 *
 * Monero has no token standard and no L2s, so XMR sits pinned above the rule —
 * always, whatever has been searched or filtered. Below it is everything Uniswap
 * routes across the selected networks, which is also why the network control
 * lives down there: it filters that side and only that side.
 *
 * Chain is not a separate decision. On an EVM a token *is* a (chain, token)
 * pair — USDC on Base is not USDC on Arbitrum — so picking networks belongs in
 * this dialog, next to the thing they qualify. That is also why the network
 * filter is a *set*: those are two different entries, and someone holding both
 * has no reason to be shown one at a time. Rows carry a chain tag exactly when
 * more than one network is on screen and the symbol alone stops identifying the
 * thing.
 */

type Held = {
  symbol: string
  name: string
  decimals: number
  address: string
  raw: bigint
  chainId: number
}

const TokenRow = (props: {
  symbol: string
  name: string
  amount?: string
  selected?: boolean
  icon?: JSX.Element
  chainTag?: string
  onClick: () => void
}): JSX.Element => (
  <button class="tokrow" onClick={props.onClick} classList={{ 'chip-on': props.selected }}>
    <Show when={props.icon} fallback={<span class="dot" />}>
      {props.icon}
    </Show>
    <span class="stack" style={{ flex: 1, 'min-width': 0, 'text-align': 'left' }}>
      <span style={{ 'font-size': '16px', display: 'flex', 'align-items': 'center', gap: '7px' }}>
        {props.symbol}
        <Show when={props.chainTag}>
          <span class="pill">{props.chainTag}</span>
        </Show>
      </span>
      <span class="cap" style={{ 'font-size': '13px' }}>
        {props.name}
      </span>
    </span>
    <Show when={props.amount}>
      {/* The wireframe pairs each balance with a fiat figure. The Token API
          returns no price, so there is nothing honest to put there. */}
      <span class="mono" style={{ 'font-size': '14px' }}>
        {props.amount}
      </span>
    </Show>
  </button>
)

export const TokenPicker = (props: {
  current: Currency
  onPick: (currency: Currency) => void
  allowXmr: boolean
}): JSX.Element => {
  const app = useApp()
  const [search, setSearch] = createSignal('')

  /**
   * Selected networks; empty means all. Shared rather than local: the network
   * view opens *on top of* this picker, so a local signal would die when this
   * unmounted and the choice would go nowhere.
   */
  const selectedNetworks = tokenNetworks

  /** The concrete chains to query — every configured one when nothing is picked. */
  const activeChains = createMemo(() =>
    resolveChains(
      selectedNetworks(),
      CHAINS.map((c) => c.chain.id),
    ),
  )

  /** More than one network on screen means rows need a chain to disambiguate. */
  const spansChains = () => activeChains().length > 1

  const pick = (currency: Currency) => {
    props.onPick(currency)
    // The picker's whole question is answered — dismiss the stack rather than
    // popping back to whatever opened it.
    closeAllModals()
  }

  const matches = (symbol: string, name: string, address?: string | null) => {
    const needle = search().trim().toLowerCase()
    if (!needle) return true
    return (
      symbol.toLowerCase().includes(needle) ||
      name.toLowerCase().includes(needle) ||
      (address?.toLowerCase().includes(needle) ?? false)
    )
  }

  /**
   * "Your tokens" has two sources, because they answer different questions.
   *
   * The Graph Token API does *discovery*: which tokens does this address hold, out
   * of all tokens that exist. Only an indexer can answer that, which is the whole
   * leverage claim — there is no balance indexing here. But its networks are
   * mainnets only, so on Sepolia it returns nothing.
   *
   * Multicall does *truth*: exact balances for the tokens we already know about,
   * on every chain including Sepolia, read at head so it cannot be stale.
   *
   * Both run, across every selected network. Where they overlap the on-chain
   * figure wins.
   */
  const discovered = useQuery(() => {
    const who = app.address()
    const chains = activeChains().filter(coversChain)
    return {
      queryKey: ['balances-indexed', who, chains.join(',')],
      queryFn: async (): Promise<Held[]> => {
        if (!who) return []
        const results = await Promise.allSettled(
          chains.map(async (chainId) => {
            const rows = await fetchBalances(who, chainId)
            return rows.map(
              (row): Held => ({
                symbol: row.symbol,
                name: row.name,
                decimals: row.decimals,
                address: row.contract,
                raw: row.raw,
                chainId: row.chainId,
              }),
            )
          }),
        )
        // One unreachable chain should not blank out the others.
        return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      },
      enabled: Boolean(who) && chains.length > 0,
      staleTime: 30_000,
    }
  })

  const onchain = useQuery(() => {
    const who = app.address()
    const chains = activeChains()
    return {
      queryKey: ['balances-onchain', who, chains.join(',')],
      queryFn: async (): Promise<Held[]> => {
        if (!who) return []
        const results = await Promise.allSettled(
          chains.map(async (chainId) => {
            const list = popularFor(chainId)
            if (list.length === 0) return []
            const balances = await fetchOnchainBalances(who, chainId, list)
            return balances.flatMap((balance): Held[] => {
              const address = balance.currency.address
              if (!address) return []
              return [
                {
                  symbol: balance.currency.symbol,
                  name: balance.currency.name,
                  decimals: balance.currency.decimals,
                  address,
                  raw: balance.raw,
                  chainId: balance.currency.chainId ?? chainId,
                },
              ]
            })
          }),
        )
        return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      },
      enabled: Boolean(who) && chains.length > 0,
      staleTime: 15_000,
    }
  })

  /** The wider routable set, behind the constrained default list. */
  const routable = useQuery(() => {
    const chains = activeChains()
    return {
      queryKey: ['swappable', chains.join(',')],
      queryFn: async () => {
        const results = await Promise.allSettled(
          chains.map((chainId) => fetchSwappableTokens({ tokenIn: NATIVE, chainId })),
        )
        return results.flatMap((r) => (r.status === 'fulfilled' ? r.value : []))
      },
      staleTime: 10 * 60_000,
      // Only worth fetching once someone searches past the short list.
      enabled: search().trim().length >= 2 && chains.length > 0,
    }
  })

  /** The constrained default set, unioned across the selected networks. */
  const popular = createMemo(() =>
    activeChains()
      .flatMap((chainId) => popularFor(chainId))
      .filter((c) => matches(c.symbol, c.name, c.address)),
  )

  /**
   * A token is keyed by (chain, address), never by address alone — that is the
   * same fact that makes the network filter a set.
   */
  const key = (chainId: number, address: string) => `${chainId}:${address.toLowerCase()}`

  const held = createMemo<Held[]>(() => {
    const byToken = new Map<string, Held>()
    // Indexed first, so a direct read overwrites it rather than the reverse.
    for (const balance of discovered.data ?? []) byToken.set(key(balance.chainId, balance.address), balance)
    for (const balance of onchain.data ?? []) byToken.set(key(balance.chainId, balance.address), balance)

    return [...byToken.values()]
      .filter((b) => matches(b.symbol, b.name, b.address))
      .sort((a, b) => (b.raw === a.raw ? 0 : b.raw > a.raw ? 1 : -1))
  })

  /** Routable tokens the wallet does not hold and the short list omits. */
  const searchable = createMemo(() => {
    const known = new Set([
      ...popular().flatMap((c) =>
        c.address && c.chainId !== null ? [key(c.chainId, c.address)] : [],
      ),
      ...held().map((b) => key(b.chainId, b.address)),
    ])
    return (routable.data ?? [])
      .filter((t) => !known.has(key(t.chainId, t.address)))
      .filter((t) => matches(t.symbol, t.name, t.address))
      .slice(0, 25)
  })

  const networkLabel = () => {
    const selected = selectedNetworks()
    if (isAllChains(selected)) return 'All networks'
    if (selected.length === 1) return chainLabel(selected[0])
    return `${selected.length} networks`
  }

  const tagFor = (chainId: number) => (spansChains() ? chainLabel(chainId) : undefined)

  const openNetworks = () => openChainPicker('token-networks')

  /**
   * The EVM side's network control, below the rule that separates it from XMR.
   *
   * The leading chip is the current selection *and* the way into the fuller list,
   * so it carries a chevron; the chips beside it are one-click toggles. Styling
   * those two behaviours identically is what made this unreadable before.
   */
  const NetworkControl = (): JSX.Element => (
    <div
      style={{
        'border-top': '1px solid var(--line2)',
        'padding-top': '11px',
        display: 'flex',
        'flex-wrap': 'wrap',
        'align-items': 'center',
        gap: '7px',
      }}
    >
      <button
        class="chip chip-on"
        style={{ padding: '5px 10px', 'font-size': '14px' }}
        onClick={openNetworks}
      >
        <Show when={selectedNetworks().length === 1}>
          <ChainIcon chainId={selectedNetworks()[0] ?? app.homeChainId} size={16} />
        </Show>
        {networkLabel()}
        <Chevron size={12} />
      </button>

      <span class="cap2" style={{ padding: '0 2px' }}>
        or
      </span>

      {/* Toggles, so more than one can be on at once. */}
      <For each={CHAINS}>
        {(info) => (
          <button
            class="chip"
            classList={{ 'chip-on': selectedNetworks().includes(info.chain.id) }}
            style={{ padding: '5px 10px', 'font-size': '14px' }}
            aria-pressed={selectedNetworks().includes(info.chain.id)}
            onClick={() => toggleTokenNetwork(info.chain.id)}
          >
            {info.label}
          </button>
        )}
      </For>

      <Show when={!isAllChains(selectedNetworks())}>
        <button
          class="chip"
          style={{ padding: '5px 10px', 'font-size': '14px', 'border-style': 'dashed' }}
          onClick={clearTokenNetworks}
        >
          Clear
        </button>
      </Show>
    </div>
  )

  return (
    <Modal
      title="Select a token"
      width={472}
      sticky={
        <div class="dialog-sticky">
          <div class="input" style={{ height: '46px', gap: '9px', 'justify-content': 'flex-start' }}>
            <Search />
            <input
              placeholder="Search tokens"
              value={search()}
              onInput={(event) => setSearch(event.currentTarget.value)}
              aria-label="Search tokens"
            />
          </div>

          {/*
            XMR above the rule. Pinned in both senses — it is not a (chain, token)
            pair so no network filter or search applies to it, and it stays on
            screen while the EVM list below scrolls. Absent only where XMR is not
            a legal answer at all.
          */}
          <Show when={props.allowXmr}>
            <TokenRow
              symbol={XMR.symbol}
              name={XMR.name}
              icon={<TokenIcon currency={XMR} />}
              selected={sameCurrency(props.current, XMR)}
              onClick={() => pick(XMR)}
            />
          </Show>

          <NetworkControl />
        </div>
      }
    >
      <div class="scrolls">
        <Show when={popular().length > 0}>
          <span class="lbl" style={{ display: 'block', padding: '10px 2px 4px' }}>
            Popular
          </span>
          <div style={{ display: 'flex', 'flex-wrap': 'wrap', gap: '7px' }}>
            <For each={popular()}>
              {(currency) => (
                <button
                  class="chip"
                  classList={{ 'chip-on': sameCurrency(props.current, currency) }}
                  style={{ padding: '5px 10px', 'font-size': '14px' }}
                  onClick={() => pick(currency)}
                >
                  <TokenIcon currency={currency} size={16} />
                  {currency.symbol}
                  <Show when={spansChains() && currency.chainId !== null}>
                    <span class="cap2">{chainLabel(currency.chainId ?? undefined)}</span>
                  </Show>
                </button>
              )}
            </For>
          </div>
        </Show>

        <Show when={app.address()}>
          <span class="lbl" style={{ display: 'block', padding: '12px 2px 4px' }}>
            Your tokens
            <Show when={onchain.isPending || discovered.isPending}> · reading</Show>
          </span>
          <Show
            when={held().length > 0}
            fallback={
              <span class="cap" style={{ display: 'block', padding: '4px 2px' }}>
                <Show when={!onchain.isPending} fallback="Reading balances…">
                  Nothing on {networkLabel().toLowerCase()}.
                  <Show when={activeChains().some((id) => !coversChain(id))}>
                    {' '}
                    Only the tokens listed above are checked on{' '}
                    {activeChains()
                      .filter((id) => !coversChain(id))
                      .map((id) => chainLabel(id))
                      .join(', ')}
                    — the Token API, which finds everything else an address holds, does not index
                    them.
                  </Show>
                </Show>
              </span>
            }
          >
            <div style={{ display: 'flex', 'flex-direction': 'column' }}>
              <For each={held()}>
                {(balance) => (
                  <TokenRow
                    symbol={balance.symbol}
                    name={balance.name}
                    amount={formatToken(balance.raw, balance.decimals)}
                    chainTag={tagFor(balance.chainId)}
                    icon={
                      <TokenIconFor
                        chainId={balance.chainId}
                        address={balance.address}
                        symbol={balance.symbol}
                      />
                    }
                    selected={
                      props.current.chainId === balance.chainId &&
                      props.current.address?.toLowerCase() === balance.address.toLowerCase()
                    }
                    onClick={() =>
                      pick({
                        symbol: balance.symbol,
                        name: balance.name,
                        decimals: balance.decimals,
                        address: balance.address as `0x${string}`,
                        chainId: balance.chainId,
                      })
                    }
                  />
                )}
              </For>
            </div>
          </Show>
        </Show>

        <Show when={searchable().length > 0}>
          <span class="lbl" style={{ display: 'block', padding: '12px 2px 4px' }}>
            Routable on {networkLabel().toLowerCase()}
          </span>
          <div style={{ display: 'flex', 'flex-direction': 'column' }}>
            <For each={searchable()}>
              {(token) => (
                <TokenRow
                  symbol={token.symbol}
                  name={shortAddress(token.address)}
                  chainTag={tagFor(token.chainId)}
                  icon={
                    <TokenIconFor
                      chainId={token.chainId}
                      address={token.address}
                      symbol={token.symbol}
                    />
                  }
                  onClick={() =>
                    pick({
                      symbol: token.symbol,
                      name: token.name,
                      decimals: token.decimals,
                      address: token.address,
                      chainId: token.chainId,
                    })
                  }
                />
              )}
            </For>
          </div>
        </Show>

        <Show
          when={
            search().trim().length >= 2 &&
            searchable().length === 0 &&
            held().length === 0 &&
            popular().length === 0
          }
        >
          <span class="cap" style={{ display: 'block', padding: '12px 2px' }}>
            Nothing matching “{search()}” on {networkLabel().toLowerCase()}.
          </span>
        </Show>
      </div>
    </Modal>
  )
}

export { nativeOf }
