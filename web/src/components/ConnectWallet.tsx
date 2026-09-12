import { For, Show, createSignal, type JSX } from 'solid-js'
import { useConnect, useConnection, useConnectors } from '@wagmi/solid'
import type { Connector } from '@wagmi/core'
import { chainLabel } from '../lib/chains'
import { shortAddress } from '../lib/format'
import { closeModal } from '../state/modals'
import { Modal } from './Modal'
import { Avatar, Check, Warning } from './icons'

/**
 * Connect a wallet.
 *
 * The list is whatever `useConnectors` reports, which is the point of using it
 * rather than a hardcoded set: EIP-6963 means the browser *announces* the wallets
 * it has, so Rabby or Frame appear by name without this file knowing they exist.
 * Anything not announced is a deliberate entry in the config, and every entry
 * there works with no configuration — nothing in this list can be present but
 * unusable.
 *
 * Two things this dialog is careful about:
 *
 * **It reports rejection as rejection.** A user closing their wallet is not an
 * error worth a red banner, and a connector being unavailable is a different fact
 * from a user declining — they read differently here.
 *
 * **It does not pretend to be a wallet.** No seed phrases, no key entry, no
 * "paste your private key". The only thing this collects is a click.
 */

/** An icon from the connector itself, falling back to the lo-fi mark. */
const ConnectorIcon = (props: { connector: Connector }): JSX.Element => {
  const [failed, setFailed] = createSignal(false)
  return (
    <span class="dot" style={{ width: '28px', height: '28px' }}>
      <Show
        when={props.connector.icon && !failed()}
        fallback={
          <span
            style={{
              display: 'flex',
              'align-items': 'center',
              'justify-content': 'center',
              width: '100%',
              height: '100%',
            }}
          >
            <Avatar size={18} />
          </span>
        }
      >
        <img
          src={props.connector.icon}
          alt=""
          width={28}
          height={28}
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      </Show>
    </span>
  )
}

export const ConnectWallet = (): JSX.Element => {
  const connectors = useConnectors()
  const connection = useConnection()
  const connect = useConnect()

  /** Which connector is mid-prompt, so only that row shows a spinner. */
  const [pending, setPending] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [rejected, setRejected] = createSignal(false)

  const attempt = async (connector: Connector) => {
    setError(null)
    setRejected(false)
    setPending(connector.uid)
    try {
      await connect.mutateAsync({ connector })
      closeModal()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      // A closed wallet prompt is the most common outcome and is not a failure.
      if (/reject|denied|cancel|closed/i.test(message)) setRejected(true)
      else setError(message.split('\n')[0] ?? message)
    } finally {
      setPending(null)
    }
  }

  /**
   * Injected wallets that announced themselves, then the rest. Someone who has a
   * wallet installed should find it first, not scroll past options they cannot use.
   */
  const ordered = () => {
    const list = [...connectors()]
    const rank = (c: Connector) => (c.type === 'injected' ? 0 : 1)
    return list.sort((a, b) => rank(a) - rank(b))
  }

  return (
    <Modal title="Connect a wallet" width={440}>
      <Show
        when={!connection().isConnected}
        fallback={
          <div class="sub" style={{ display: 'flex', 'align-items': 'center', gap: '11px' }}>
            <span class="pill pill-urgent" style={{ display: 'flex', 'align-items': 'center', gap: '5px' }}>
              <Check />
            </span>
            <span class="stack" style={{ flex: 1, gap: '2px' }}>
              <span>{shortAddress(connection().address)}</span>
              <span class="cap">
                {connection().connector?.name} · {chainLabel(connection().chainId)}
              </span>
            </span>
          </div>
        }
      >
        <div style={{ display: 'flex', 'flex-direction': 'column', gap: '7px' }}>
          <For each={ordered()}>
            {(connector) => (
              <button
                class="btn"
                style={{
                  height: '56px',
                  'justify-content': 'flex-start',
                  gap: '12px',
                  padding: '0 13px',
                }}
                disabled={pending() !== null}
                onClick={() => void attempt(connector)}
              >
                <ConnectorIcon connector={connector} />
                <span class="stack" style={{ flex: 1, 'text-align': 'left', gap: '1px' }}>
                  <span style={{ 'font-size': '16px' }}>{connector.name}</span>
                  <Show when={connector.type === 'injected'}>
                    <span class="cap2">installed</span>
                  </Show>
                </span>
                <Show when={pending() === connector.uid}>
                  <span class="cap2">check your wallet…</span>
                </Show>
              </button>
            )}
          </For>

          <Show when={ordered().length === 0}>
            <div class="sub" style={{ 'border-style': 'dashed' }}>
              <span class="cap">
                No wallet detected. Install a browser wallet, or open this in a wallet’s own browser.
              </span>
            </div>
          </Show>
        </div>
      </Show>

      <Show when={rejected()}>
        <div class="sub">
          <span class="cap">
            The request was dismissed in your wallet. Nothing happened — pick one above to try again.
          </span>
        </div>
      </Show>

      <Show when={error()}>
        {(message) => (
          <div class="sub" style={{ 'border-style': 'dashed', display: 'flex', gap: '9px' }}>
            <span style={{ flex: 'none', 'margin-top': '3px' }}>
              <Warning />
            </span>
            <span class="cap">{message()}</span>
          </div>
        )}
      </Show>

      <span class="cap" style={{ 'padding-top': '2px' }}>
        Noktoswap never asks for a seed phrase or a private key. Connecting only shares your public
        address.
      </span>
    </Modal>
  )
}
