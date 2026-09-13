// Imported for its type augmentation of vitest's `expect`. The matchers
// themselves are already registered: vite-plugin-solid injects this module into
// setupFiles whenever it runs under vitest.
import '@testing-library/jest-dom/vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query'
import { cleanup, render, screen } from '@solidjs/testing-library'
import { MemoryRouter, Route } from '@solidjs/router'
import { afterEach, describe, expect, it } from 'vitest'
import type { JSX } from 'solid-js'
import { WagmiProvider } from '@wagmi/solid'
import { ChainPicker } from './components/ChainPicker'
import { ConnectWallet } from './components/ConnectWallet'
import { Settings } from './components/Settings'
import { TokenPicker } from './components/TokenPicker'
import { Book } from './routes/Book'
import { Find } from './routes/Find'
import { Orders } from './routes/Orders'
import { Results } from './routes/Results'
import { nativeOf } from './lib/tokens'
import { CHAINS } from './lib/chains'
import { clearTokenNetworks, toggleTokenNetwork, tokenNetworks } from './state/filters'

/** Derived, so adding a chain does not silently fail an unrelated assertion. */
const CHAIN_COUNT = CHAINS.length
import { draftEth, setDirectionTo, setDraftEth, setDraftXmr, setPayInput } from './state/swap'
import { config } from './lib/wagmi'
import { AppProvider } from './state/app'

/**
 * A smoke test, deliberately shallow.

 *
 * Every network call is stubbed to reject, so what this proves is narrow and
 * worth having: each screen mounts, survives its data being unavailable, and
 * renders the copy the wireframe specifies rather than an error boundary. A
 * screen that only works when the subgraph answers is a screen that breaks in
 * the demo.
 */

// Solid's testing-library only auto-cleans when it can see a global afterEach;
// register it explicitly so one screen's DOM does not leak into the next assert.
afterEach(cleanup)

const mount = (component: () => JSX.Element) => {
  // A fresh client per test, with retries off — otherwise a rejected fetch
  // retries in the background and leaks between cases.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  })

  return render(() => (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter root={(props) => <AppProvider>{props.children}</AppProvider>}>
          <Route path="/" component={component} />
        </MemoryRouter>
      </QueryClientProvider>
    </WagmiProvider>
  ))
}

describe('the screens mount with no data', () => {
  it('opens on the widget, with no heading', async () => {
    mount(Find)
    // Two amounts and a button say what this is.
    expect(screen.getByText('You pay')).toBeInTheDocument()
    expect(screen.getByText('You receive')).toBeInTheDocument()
    expect(screen.getByLabelText('Flip direction')).toBeInTheDocument()
    // With the book unreachable and nothing typed, the primary demotes to
    // posting an offer — the one action that needs no counterparty.
    expect(await screen.findByRole('button', { name: /post an offer/i })).toBeInTheDocument()
  })

  it('gives every icon a box that can take a size', () => {
    // `.dot` defaulted to `display: inline`, where width and height are simply
    // ignored — so anywhere it was not already a flex child, the image fell back
    // to the SVG's intrinsic size (32px, or 48px for Optimism). The chips hid it
    // because flex items are blockified; the book's grid cell did not.
    mount(Find)
    for (const dot of Array.from(document.querySelectorAll('.dot'))) {
      const el = dot as HTMLElement
      // Every call site asks for an explicit px size; the box has to honour it.
      expect(el.style.width).toMatch(/^\d+px$/)
      expect(el.style.height).toBe(el.style.width)
    }
  })

  it('draws the currency being swapped, not a blank circle', () => {
    mount(Find)
    // Each chip names a currency, so each gets a mark. XMR's is inlined — no
    // asset host is keyed by (chain, address) for a non-EVM currency — and the
    // EVM side comes from the asset API.
    for (const label of [/^Pay currency:/, /^Receive currency:/]) {
      expect(screen.getByLabelText(label).querySelector('svg, img')).not.toBeNull()
    }
    // Specifically: XMR is the inlined mark, not an <img> that would 404.
    const receive = screen.getByLabelText(/^Receive currency: XMR/)
    expect(receive.querySelector('svg')).not.toBeNull()
    expect(receive.querySelector('img')).toBeNull()
  })

  it('reaches for a price feed when the book cannot answer', () => {
    mount(Find)
    // The rule always carries a rate, and the grey line always says where it
    // came from. With an empty book that source is Chainlink — and with the
    // network stubbed out, the line says the feed is unreachable rather than
    // dead-ending on a dash with no explanation.
    expect(screen.getByText(/XMR per ETH/)).toBeInTheDocument()
    expect(screen.getByText(/the feed is unreachable/)).toBeInTheDocument()
  })

  it('takes input on the pay side in either direction', async () => {
    // The bug: with the amount pinned to the ETH leg, selling XMR moved the input
    // down to "You receive" and left "You pay" as a dead readout — so the field
    // the design says is the one you fill could not be filled.
    setDirectionTo('eth-to-xmr')
    setPayInput('')
    mount(Find)

    const payEth = screen.getByLabelText('Amount to pay in ETH') as HTMLInputElement
    expect(payEth.tagName).toBe('INPUT')
    // And the receive side is a readout, not a second field.
    expect(screen.getByLabelText(/^Amount to receive in XMR/).tagName).not.toBe('INPUT')

    screen.getByLabelText('Flip direction').click()
    await Promise.resolve()

    // Now paying XMR — still an input, and now labelled in XMR.
    const payXmr = screen.getByLabelText('Amount to pay in XMR') as HTMLInputElement
    expect(payXmr.tagName).toBe('INPUT')
    expect(screen.getByLabelText(/^Amount to receive in ETH/).tagName).not.toBe('INPUT')

    setDirectionTo('eth-to-xmr')
    setPayInput('')
  })

  it('lets either side of the pair be repicked', () => {
    mount(Find)
    // One picker, XMR always in it — so both chips open it. Refusing to open the
    // XMR side would make inverting the pair impossible.
    expect(screen.getByLabelText(/^Pay currency:/)).toBeEnabled()
    expect(screen.getByLabelText(/^Receive currency:/)).toBeEnabled()
  })

  it('renders the results bands and the invitation to post', () => {
    mount(Results)
    expect(screen.getByText(/None of these the right size/)).toBeInTheDocument()
    expect(screen.getByText('Sorted by rate, best first')).toBeInTheDocument()
  })

  it('describes an unfiltered results page as unfiltered', () => {
    // With no amount this used to read "0 ETH → —" beside "0 of N near this size"
    // and tell the reader to go back and type something. It is not a failed
    // search; nothing was searched for.
    setPayInput('')
    mount(Results)
    expect(screen.getByText(/^Every ETH/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Narrow by amount' })).toBeInTheDocument()
    expect(screen.queryByText(/go back and type one/)).not.toBeInTheDocument()
  })

  it('renders the book with its eight columns', () => {
    mount(Book)
    for (const heading of ['Swap', 'Trader', 'Chain', 'Posted', 'Rate', 'Status']) {
      expect(screen.getByText(heading)).toBeInTheDocument()
    }
    expect(screen.getByRole('button', { name: /create offer/i })).toBeInTheDocument()
  })

  it('tells an unconnected reader why My orders is empty', () => {
    mount(Orders)
    expect(screen.getByText(/Miss a deadline and the order closes itself/)).toBeInTheDocument()
    expect(screen.getByText(/Connect a wallet to see your orders/)).toBeInTheDocument()
  })
})

describe('settings', () => {
  it('offers only settings that change an outcome', () => {
    mount(() => <Settings />)
    for (const label of ['Max slippage', 'Swap deadline', 'Close to my size']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    // Auto is a real choice, not a placeholder: it defers to Uniswap's own figure.
    expect(screen.getByRole('button', { name: 'Auto' })).toBeInTheDocument()
    // And the slippage copy says which leg it lands on, which exact-output inverts.
    expect(screen.getByText(/the token you spend, not the ETH/)).toBeInTheDocument()
  })
})

describe('posting an offer from the widget', () => {
  it('opens the form on the amount that was typed', async () => {
    setDraftEth('')
    setDraftXmr('')
    setPayInput('0.25')
    mount(Find)

    // The empty book puts "Post an offer" as the primary, which is the path the
    // design cares most about — it is the one action that needs no counterparty.
    const post = await screen.findByRole('button', { name: /post an offer/i })
    post.click()
    await Promise.resolve()

    // Carried across, rather than opening on blank fields.
    expect(draftEth()).toBe('0.25')
    setPayInput('')
  })
})

describe('a dialog taller than the viewport', () => {
  it('puts the overflow in a body below a pinned head', () => {
    // Structural guard for a layout bug jsdom cannot measure: the dialog was
    // unscrollable, which reads as cropped content. The shape is the fix — a
    // positioner that scrolls, a capped dialog, and a body that takes the
    // overflow so the title and close button do not scroll away with it.
    mount(() => <TokenPicker current={nativeOf(11155111)} onPick={() => {}} allowXmr />)

    const dialog = document.querySelector('.dialog')
    expect(dialog).not.toBeNull()

    // The head is a sibling of the body, not inside it.
    const head = dialog?.querySelector(':scope > .dialog-head')
    const body = dialog?.querySelector(':scope > .dialog-body')
    expect(head).not.toBeNull()
    expect(body).not.toBeNull()
    expect(head?.contains(body as Node)).toBe(false)

    // The close button stays in the pinned head.
    expect(head?.querySelector('[aria-label="Close"]')).not.toBeNull()

    // A sticky region sits between head and body for controls that must outlive
    // scrolling — the search field is the whole point: scrolling away the box
    // that filters the list below it is the one thing it must not do.
    const sticky = dialog?.querySelector(':scope > .dialog-sticky')
    expect(sticky).not.toBeNull()
    expect(sticky?.querySelector('[aria-label="Search tokens"]')).not.toBeNull()
    expect(body?.querySelector('[aria-label="Search tokens"]')).toBeNull()

    // And the list itself is inside the scrolling body.
    expect(body?.querySelector('.scrolls')).not.toBeNull()

    // The positioner exists and is the dialog's parent, so it can scroll it.
    expect((dialog?.parentElement as HTMLElement)?.classList.contains('scrim-layer')).toBe(true)
  })
})

describe('connecting a wallet', () => {
  it('lists the connectors wagmi reports, and promises nothing it should not', () => {
    mount(() => <ConnectWallet />)
    // Whatever the config declares, by name — not a hardcoded list.
    expect(screen.getByText('MetaMask')).toBeInTheDocument()
    expect(screen.getByText('Coinbase Wallet')).toBeInTheDocument()
    // The one piece of copy that matters on a wallet dialog.
    expect(screen.getByText(/never asks for a seed phrase/)).toBeInTheDocument()
    // And nothing about a connector this build does not have. An option that can
    // only ever disappoint is worse than an absent one.
    expect(screen.queryByText(/WalletConnect/)).not.toBeInTheDocument()
  })
})

describe('the currency picker', () => {
  it('pins XMR above the rule and lists the constrained set below', () => {
    mount(() => <TokenPicker current={nativeOf(11155111)} onPick={() => {}} allowXmr />)
    expect(screen.getByText('Monero')).toBeInTheDocument()
    // The network chips filter the EVM side only, which is why they sit below.
    expect(screen.getByRole('button', { name: /All networks/ })).toBeInTheDocument()
    expect(screen.getByText('Popular')).toBeInTheDocument()
  })

  it('names the current network on the control that opens the fuller list', () => {
    mount(() => <TokenPicker current={nativeOf(11155111)} onPick={() => {}} allowXmr />)
    // The leading chip is the selection *and* the way into the network view, so
    // it carries a chevron. The chips beside it are one-click filter values.
    // Styling both identically is what made this unreadable before.
    expect(screen.getByRole('button', { name: /^All networks/ })).toBeInTheDocument()
    expect(screen.getByText('or')).toBeInTheDocument()
  })

  it('drops XMR where it is not a legal answer', () => {
    // A claim payout is native ETH swapped into an EVM token, so offering XMR
    // there would be offering something the flow cannot do.
    mount(() => (
      <TokenPicker current={nativeOf(11155111)} onPick={() => {}} allowXmr={false} />
    ))
    expect(screen.queryByText('Monero')).not.toBeInTheDocument()
    expect(screen.getByText('Popular')).toBeInTheDocument()
  })

  it('groups mainnets apart from testnets', () => {
    mount(() => <ChainPicker target="token-networks" />)
    // "All chains" is a checkbox, not a button — it is a filter state.
    expect(screen.getByRole('checkbox', { name: 'All chains' })).toBeInTheDocument()

    /*
     * The realms are not interchangeable and the flat list read as though they
     * were: Sepolia sat among mainnets, one row of play money, distinguished only
     * by a name you had to recognise. The books never merge, so the headings are
     * what make that legible before anyone reads a price.
     */
    expect(screen.getByText('Mainnets')).toBeInTheDocument()
    expect(screen.getByText('Testnets')).toBeInTheDocument()

    for (const name of ['Ethereum', 'Base', 'Sepolia']) {
      expect(screen.getByRole('checkbox', { name })).toBeInTheDocument()
    }
  })

  it('never reports a count for coverage it does not have', () => {
    mount(() => <ChainPicker target="token-networks" />)

    /*
     * Every chain now offered has both a contract and a subgraph, so neither
     * caveat row has a live case: Arbitrum and Optimism were placeholders with no
     * deployment and are gone, and Base Sepolia was deployed-but-unindexed until
     * Studio's subgraph limit made it unshippable.
     *
     * Both branches stay in ChainPicker, because the states they describe recur
     * whenever a deployment and its indexer move at different speeds. What must
     * never happen is the third option — printing "0 open" for a chain this app
     * cannot see, which is a claim about the market rather than about coverage.
     * `deployedButUnindexed` and `isTradable` cover that logic directly in
     * domain.test.ts, which does not need such a chain to exist to test it.
     */
    expect(screen.queryByText('not deployed')).not.toBeInTheDocument()
    expect(screen.queryByText(/book not indexed/)).not.toBeInTheDocument()
    expect(screen.getAllByText(/\d+ open/).length).toBeGreaterThan(0)

    // With no wallet there is no balance to read, and an unread balance shows as
    // a dash rather than a zero that would read as a real figure.
    expect(screen.getAllByText('—').length).toBe(CHAIN_COUNT)
  })

  it('is multi-select, the way the wireframe checkboxes imply', async () => {
    clearTokenNetworks()
    mount(() => <ChainPicker target="token-networks" />)

    // Real checkboxes, from Kobalte — six inputs, not buttons wearing a square.
    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(boxes.length).toBe(CHAIN_COUNT + 1) // every chain, plus "All chains"

    // Empty filter means "all", so only that row is ticked to begin with.
    expect(boxes[0]?.checked).toBe(true)

    // Ticking two chains sticks — this is the bug that made the old version look
    // inert: `selected` was snapshotted into the modal payload, so nothing the
    // user clicked could ever change what was rendered.
    toggleTokenNetwork(8453)
    toggleTokenNetwork(1)
    await Promise.resolve()
    expect(tokenNetworks()).toEqual([8453, 1])
    const after = screen.getAllByRole('checkbox') as HTMLInputElement[]
    expect(after.filter((b) => b.checked).length).toBe(2)
    // And "All chains" is unticked precisely because something else is.
    expect(after[0]?.checked).toBe(false)
    clearTokenNetworks()
  })

  it('ticks a box in response to a real click', async () => {
    // The regression guard. The old version rendered from a frozen copy of the
    // filter, so a click changed the signal and the DOM never noticed. Driving
    // this through the actual input is the only way to catch that.
    clearTokenNetworks()
    mount(() => <ChainPicker target="token-networks" />)

    const base = screen.getByRole('checkbox', { name: 'Base' }) as HTMLInputElement
    expect(base.checked).toBe(false)

    base.click()
    await Promise.resolve()

    expect(tokenNetworks()).toEqual([8453])
    expect((screen.getByRole('checkbox', { name: 'Base' }) as HTMLInputElement).checked).toBe(true)
    // And ticking one chain means the filter is no longer wide open.
    expect((screen.getByRole('checkbox', { name: 'All chains' }) as HTMLInputElement).checked).toBe(
      false,
    )
    clearTokenNetworks()
  })
})
