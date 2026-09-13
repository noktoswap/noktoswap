import { A } from '@solidjs/router'
import { Show, createSignal, type JSX } from 'solid-js'
import { useConnection, useDisconnect, useSwitchChain } from '@wagmi/solid'
import { CHAINS, chainInfo, chainLabel } from '../lib/chains'
import { shortAddress } from '../lib/format'
import { useApp } from '../state/app'
import { openConnect } from '../state/modals'
import { resolvedTheme, toggleTheme } from '../state/theme'
import { ChainIcon } from './TokenIcon'
import { Avatar, Chevron, Contrast } from './icons'

/**
 * The navbar chain chip answers a different question from the one in the token
 * picker: this is which chain the wallet is on right now, not which chain a
 * token belongs to. It is what the "Incorrect network" badge checks against.
 */
const ChainChip = (): JSX.Element => {
  const app = useApp()
  const switchChain = useSwitchChain()
  const [open, setOpen] = createSignal(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        class="chip"
        classList={{ 'chip-on': app.wrongNetwork() }}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open()}
      >
        <Show
          when={app.walletChainId() !== undefined && !app.wrongNetwork()}
          fallback={<span class="dot" style={{ width: '18px', height: '18px' }} />}
        >
          <ChainIcon chainId={app.walletChainId() as number} size={18} />
        </Show>
        <span classList={{ 'desktop-only': !app.wrongNetwork() }}>
          {app.wrongNetwork() ? 'Wrong network' : chainLabel(app.walletChainId())}
        </span>
        <Chevron />
      </button>

      <Show when={open()}>
        <div
          class="card"
          role="listbox"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            'min-width': '200px',
            padding: '6px',
            display: 'flex',
            'flex-direction': 'column',
            'z-index': 30,
          }}
        >
          {CHAINS.map((info) => (
            <button
              class="tokrow"
              style={{ padding: '8px 10px', 'border-radius': '4px' }}
              role="option"
              aria-selected={info.chain.id === app.walletChainId()}
              onClick={() => {
                setOpen(false)
                void switchChain.mutateAsync({ chainId: info.chain.id }).catch(() => {
                  /* the wallet rejected or does not know the chain — nothing to do */
                })
              }}
            >
              <ChainIcon chainId={info.chain.id} size={16} />
              <span style={{ flex: 1 }}>{info.label}</span>
              <Show when={info.deployment === null}>
                <span class="cap2">not deployed</span>
              </Show>
              <Show when={info.deployment !== null && info.subgraph === null}>
                <span class="cap2">not indexed</span>
              </Show>
              <Show when={info.chain.id === app.walletChainId()}>
                <span class="pill">on</span>
              </Show>
            </button>
          ))}
        </div>
      </Show>
    </div>
  )
}

const RealmBadge = (): JSX.Element => {
  const app = useApp()
  return (
    <Show when={app.realm() === 'testnet'}>
      <span
        class="pill"
        title="Offers here are on a test network. Test money, and stagenet Monero."
      >
        testnet
      </span>
    </Show>
  )
}

const WalletChip = (): JSX.Element => {
  const connection = useConnection()
  const disconnect = useDisconnect()

  return (
    <Show
      when={connection().address}
      fallback={
        // Picking *which* wallet is a real decision with several answers, so it
        // gets a dialog rather than silently grabbing whichever connector is
        // first in the config.
        <button class="chip" onClick={openConnect}>
          <Avatar size={22} />
          <span>Connect</span>
        </button>
      }
    >
      {(address) => (
        <button
          class="chip"
          onClick={() => disconnect.mutate({})}
          title={`Disconnect ${connection().connector?.name ?? 'wallet'}`}
        >
          <Avatar size={26} />
          <span class="stack" style={{ 'line-height': 1.15 }}>
            <span style={{ 'font-size': '15px' }}>{shortAddress(address())}</span>
            <span class="mono cap2" style={{ 'font-size': '11px' }}>
              {connection().connector?.name ?? chainLabel(connection().chainId)}
            </span>
          </span>
        </button>
      )}
    </Show>
  )
}

export const Nav = (): JSX.Element => (
  <header
    style={{
      display: 'flex',
      'justify-content': 'space-between',
      'align-items': 'center',
      gap: '24px',
    }}
  >
    <A
      href="/"
      style={{ display: 'flex', 'align-items': 'center', gap: '12px', 'text-decoration': 'none' }}
    >
      <span class="stack desktop-only" style={{ gap: '1px' }}>
        <span style={{ 'font-size': '23px' }}>NoktoSwap</span>
        <span class="cap">Atomic Peer-to-Peer XMR/ETH Swaps</span>
      </span>
      <span class="phone-only" style={{ 'font-size': '17px' }}>
        NoktoSwap
      </span>
    </A>

    <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
      {/*
        Which market you are looking at, stated rather than inferred. The book is
        realm-scoped, so a testnet offer never reaches a mainnet reader — but the
        converse matters too: someone on Sepolia should know the prices they are
        seeing are play money before they read anything into them.
      */}
      <RealmBadge />
      <button
        class="chip"
        style={{ padding: '7px 9px' }}
        onClick={toggleTheme}
        aria-label={`Switch to ${resolvedTheme() === 'dark' ? 'light' : 'dark'} theme`}
        title={`Switch to ${resolvedTheme() === 'dark' ? 'light' : 'dark'} theme`}
      >
        <Contrast />
      </button>
      <ChainChip />
      <WalletChip />
    </div>
  </header>
)

/**
 * Source and contract links. Present on every page, quietly.
 *
 * Takes a chain rather than an address and an explorer: with three deployments the
 * link has to follow whichever chain the reader is acting on, and resolving that
 * here means a caller cannot pair one chain's address with another's explorer.
 */
export const Footer = (props: { chainId: number }): JSX.Element => (
  <footer
    style={{
      display: 'flex',
      gap: '20px',
      padding: '2px 6px',
      'margin-top': 'auto',
      'font-size': '14px',
      color: 'var(--muted)',
    }}
  >
    <a
      href="https://github.com/noktoswap/noktoswap"
      target="_blank"
      rel="noreferrer"
      style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}
    >
      Source
    </a>
    <Show when={chainInfo(props.chainId)?.deployment}>
      <a
        href={`${chainInfo(props.chainId)?.explorer}/address/${chainInfo(props.chainId)?.deployment}`}
        target="_blank"
        rel="noreferrer"
        style={{ display: 'flex', 'align-items': 'center', gap: '6px' }}
      >
        Contract on {chainLabel(props.chainId)}
      </a>
    </Show>
  </footer>
)
