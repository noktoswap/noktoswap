import { useQuery } from '@tanstack/solid-query'
import { Show, createMemo, createSignal, type JSX } from 'solid-js'
import { switchChain } from '@wagmi/core'
import { chainInfo, chainLabel } from '../lib/chains'
import {
  awaitReceipt,
  cancelOffer,
  claimOffer,
  quitOffer,
  readOffer,
  readyOffer,
  takeOffer,
  type OnchainOffer,
} from '../lib/contract'
import { countdown, formatEth, formatRate, formatXmr, relativeTime, shortAddress } from '../lib/format'
import {
  exportKeypair,
  generateCanonicalKeypair,
  keysForQuit,
  keysForTake,
  loadKeypair,
  proves,
  saveKeypair,
  type Keypair,
} from '../lib/keys'
import {
  combinePrivateKeys,
  computeEscrowWallet,
  encodeMoneroAddress,
  moneroPaymentUri,
  moneroViewUri,
  moneroWalletUri,
  toMoneroKeyHex,
} from '../lib/monero'
import { claimPayout, orderStatus, requiredToTake, type OfferKind, type Offer, type Side } from '../lib/offers'
import { XMR, nativeOf, type Currency } from '../lib/tokens'
import { config } from '../lib/wagmi'
import { useApp, useSettledCount } from '../state/app'
import { openTokenPicker } from '../state/modals'
import { Modal, Row } from './Modal'
import { TokenIcon } from './TokenIcon'
import { QrCode } from './QrCode'
import { ArrowRight, Chevron, Clock, Copy, EthMark, External, Warning, XmrMark } from './icons'

/**
 * One Order dialog, six states. Each side only ever sees the buttons it can
 * press right now — and "right now" means the contract would not revert, which
 * is why the timing rules live in `orderStatus` rather than being re-guessed
 * here.
 *
 * Every figure in this dialog is read from the **contract**, not the subgraph.
 * Two separate reasons:
 *   — the amounts gate a payment, and an indexer can lag a block
 *   — the key material is not in the subgraph at all, on purpose: reveals are
 *     indexed as booleans so the schema never hands out a joined XMR↔EVM
 *     dataset. A client that needs an actual key reads it here, for the one
 *     offer it is party to.
 */

const ORDER_POLL_MS = 12_000

const AmountBox = (props: { label: string; value: string; xmr?: boolean }): JSX.Element => (
  <div class="sub" style={{ flex: 1, display: 'flex', 'flex-direction': 'column', gap: '5px' }}>
    <span class="lbl">{props.label}</span>
    <span style={{ display: 'flex', 'align-items': 'center', gap: '7px', 'font-size': '19px' }}>
      <Show when={props.xmr} fallback={<EthMark />}>
        <XmrMark />
      </Show>
      {props.value}
    </span>
  </div>
)

/**
 * The escrow wallet: its address, and whichever key halves are public.
 *
 * Two things here are the reason `lib/monero.ts` was ported rather than
 * approximated:
 *
 * **The address is derived, not described.** It is the aggregate of both sides'
 * committed points, so it only exists once an offer is taken — and nothing
 * on-chain validates it, which is exactly why it uses upstream's tested encoder
 * and is covered by a round-trip test rather than eyeballed.
 *
 * **Keys are shown in Monero's byte order.** The contract stores big-endian
 * integers; a wallet reads the same bytes little-endian. Handing over the
 * contract's integer produces a string that pastes cleanly and restores a
 * *different* wallet, which is the worst kind of bug — it looks like it worked.
 */
const EscrowPanel = (props: {
  title: string
  hint: string
  offer: OnchainOffer
  /** What scanning should do: pay into it, watch it, or sweep it. */
  intent: 'pay' | 'view' | 'sweep'
  /** The reader's own half, where they hold one. */
  own?: Keypair | null
  /** The half the other side published, once they have. */
  revealedSpend?: bigint
  xmrAmount: string
  label: string
  mainnet: boolean
}): JSX.Element => {
  const [revealed, setRevealed] = createSignal(false)

  const escrow = createMemo(() => {
    const o = props.offer
    // All four commitments only exist from TAKEN onward.
    if (!o.evmPublicSpendKey || !o.evmPublicViewKey || !o.xmrPublicSpendKey || !o.xmrPrivateViewKey) {
      return null
    }
    try {
      const { publicSpendKey, publicViewKey } = computeEscrowWallet({
        evmPublicSpendKey: o.evmPublicSpendKey,
        evmPublicViewKey: o.evmPublicViewKey,
        xmrPublicSpendKey: o.xmrPublicSpendKey,
        xmrPrivateViewKey: o.xmrPrivateViewKey,
      })
      return encodeMoneroAddress(publicSpendKey, publicViewKey, props.mainnet)
    } catch {
      // A non-canonical commitment cannot produce an address. Say so rather than
      // rendering something that looks like one.
      return null
    }
  })

  /** The escrow's own view key: both halves added, mod L. */
  const escrowViewKey = createMemo(() => {
    const own = props.own
    if (!own) return null
    // The XMR side's private view key is public on-chain, so either party can
    // reach the full view key once they hold their own half.
    return combinePrivateKeys(own.privateView, props.offer.xmrPrivateViewKey)
  })

  /** The escrow's spend key, which exists only after a reveal. */
  const escrowSpendKey = createMemo(() => {
    const own = props.own
    if (!own || !props.revealedSpend) return null
    return combinePrivateKeys(own.privateSpend, props.revealedSpend)
  })

  const uri = createMemo(() => {
    const address = escrow()
    if (!address) return null
    if (props.intent === 'pay') return moneroPaymentUri(address, props.xmrAmount)
    const view = escrowViewKey()
    if (props.intent === 'view') {
      return view === null ? null : moneroViewUri(address, view, props.label)
    }
    const spend = escrowSpendKey()
    return spend !== null && view !== null
      ? moneroWalletUri(address, spend, view, props.label)
      : null
  })

  const hex = (value: bigint) => toMoneroKeyHex(value)

  return (
    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'padding-top': '2px' }}>
      <span class="h4">{props.title}</span>
      <span class="cap">{props.hint}</span>

      <Show
        when={escrow()}
        fallback={
          <div class="sub" style={{ 'border-style': 'dashed' }}>
            <span class="cap">
              The escrow address needs both sides&rsquo; committed keys, which exist once the offer
              is taken.
            </span>
          </div>
        }
      >
        {(address) => (
          <div class="sub" style={{ display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '3px' }}>
              <span class="lbl">
                Escrow address · {props.mainnet ? 'Monero mainnet' : 'Monero stagenet'}
              </span>
              <div style={{ display: 'flex', 'align-items': 'center', gap: '8px' }}>
                <span class="mono" style={{ 'font-size': '11.5px', 'word-break': 'break-all', flex: 1 }}>
                  {address()}
                </span>
                <button
                  class="icon-btn"
                  aria-label="Copy escrow address"
                  onClick={() => void navigator.clipboard?.writeText(address())}
                >
                  <Copy />
                </button>
              </div>
            </div>

            {/*
              The QR is the point of this panel. The alternative to scanning is
              retyping a 95-character address and two 64-character keys into a
              phone, which nobody does correctly.
            */}
            <Show when={uri()}>
              {(link) => (
                <div
                  style={{
                    display: 'flex',
                    gap: '14px',
                    'align-items': 'flex-start',
                    'border-top': '1px solid var(--line)',
                    'padding-top': '11px',
                  }}
                >
                  <QrCode
                    data={link()}
                    size={132}
                    label={
                      props.intent === 'pay'
                        ? 'QR code to pay the escrow address'
                        : props.intent === 'view'
                          ? 'QR code to watch the escrow as a view-only wallet'
                          : 'QR code to import the escrow wallet'
                    }
                  />
                  <span
                    style={{
                      flex: 1,
                      display: 'flex',
                      'flex-direction': 'column',
                      gap: '8px',
                      'align-items': 'flex-start',
                    }}
                  >
                    <span class="cap">
                      {props.intent === 'pay'
                        ? 'Scan with your Monero wallet to send the exact amount to the escrow.'
                        : props.intent === 'view'
                          ? 'Scan to watch the escrow as a view-only wallet. This cannot spend.'
                          : 'Scan to import the escrow wallet and sweep the XMR out.'}
                    </span>
                    <Show when={props.intent === 'sweep'}>
                      <span class="cap" style={{ 'font-style': 'italic' }}>
                        Whoever scans this owns the coins.
                      </span>
                    </Show>
                    <button
                      class="btn-inline"
                      onClick={() => void navigator.clipboard?.writeText(link())}
                    >
                      Copy link
                    </button>
                  </span>
                </div>
              )}
            </Show>

            {/* Key material, only once asked for. It is already public on-chain
                at these stages, but it should not be on screen by default. */}
            <Show
              when={revealed()}
              fallback={
                <button
                  class="btn btn-small"
                  style={{ 'align-self': 'flex-start' }}
                  onClick={() => setRevealed(true)}
                >
                  Show Keys
                </button>
              }
            >
              <div
                style={{
                  display: 'flex',
                  'flex-direction': 'column',
                  gap: '9px',
                  'border-top': '1px solid var(--line)',
                  'padding-top': '10px',
                }}
              >
                <Show when={escrowViewKey()}>
                  {(value) => (
                    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '2px' }}>
                      <span class="lbl">Escrow private view key</span>
                      <span class="mono" style={{ 'font-size': '11.5px', 'word-break': 'break-all' }}>
                        {hex(value())}
                      </span>
                    </div>
                  )}
                </Show>
                <Show when={escrowSpendKey()}>
                  {(value) => (
                    <div style={{ display: 'flex', 'flex-direction': 'column', gap: '2px' }}>
                      <span class="lbl">Escrow private spend key — spends the coins</span>
                      <span class="mono" style={{ 'font-size': '11.5px', 'word-break': 'break-all' }}>
                        {hex(value())}
                      </span>
                    </div>
                  )}
                </Show>
                <span class="cap">
                  Little-endian hex, as Monero wallets read it — not the contract&rsquo;s
                  big-endian integers.
                </span>
              </div>
            </Show>
          </div>
        )}
      </Show>
    </div>
  )
}

/**
 * `chainId` is the offer's, passed in rather than read from app state.
 *
 * Offer ids restart at 1 on every deployment, so #1 exists on all three chains.
 * Every read, write and stored key below is keyed to this chain — resolving it
 * globally would open one chain's order and then sign the other's transaction.
 */
export const OrderDialog = (props: { chainId: number; offerId: bigint }): JSX.Element => {
  const app = useApp()
  const [busy, setBusy] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  /** A freshly generated escrow key, offered as a file before it can be lost. */
  const [backup, setBackup] = createSignal<string | null>(null)
  /** Which currency a claim should pay out in. ETH means no swap. */
  const [payoutCurrency, setPayoutCurrency] = createSignal<Currency>(nativeOf(props.chainId))

  const home = chainInfo(props.chainId)

  /**
   * Which Monero network the escrow belongs to, taken from the EVM chain rather
   * than configured apart from it — a Sepolia escrow must never hand out a
   * mainnet address.
   */
  const moneroMainnet = () => home?.moneroMainnet ?? false

  /** A label a wallet will show against the imported account. */
  const escrowLabel = () =>
    `NoktoSwap ${chainLabel(props.chainId)} #${props.offerId.toString()}`

  const onchain = useQuery(() => ({
    queryKey: ['onchain-offer', props.chainId, props.offerId.toString()],
    queryFn: () => readOffer(props.chainId, props.offerId),
    refetchInterval: ORDER_POLL_MS,
  }))

  /** The subgraph row, for the fields the contract does not carry (createdAt). */
  const indexed = createMemo<Offer | undefined>(() =>
    [...app.book(), ...app.myOrders()].find((o) => o.offerId === props.offerId),
  )

  /** `orderStatus` wants the subgraph shape; build it from the on-chain read. */
  const asOffer = createMemo<Offer | null>(() => {
    const chain = onchain.data
    if (!chain || chain.kind === 'INVALID' || chain.state === 'INVALID') return null
    return {
      chainId: props.chainId,
      offerId: chain.id,
      kind: chain.kind,
      state: chain.state,
      owner: chain.owner,
      counterparty:
        chain.counterparty === '0x0000000000000000000000000000000000000000'
          ? null
          : chain.counterparty,
      amount: chain.amount,
      deposit: chain.deposit,
      xmrAmount: chain.xmrAmount,
      t0: chain.t0 === 0n ? null : chain.t0,
      t1: chain.t1 === 0n ? null : chain.t1,
      evmKeysRevealed: chain.evmPrivateSpendKey !== 0n,
      xmrSpendKeyRevealed: chain.xmrPrivateSpendKey !== 0n,
      createdAt: indexed()?.createdAt ?? chain.lastupdate,
      updatedAt: chain.lastupdate,
    }
  })

  const status = createMemo(() => {
    const offer = asOffer()
    return offer ? orderStatus(offer, app.address(), app.now()) : null
  })

  const wrongNetwork = () => app.walletChainId() !== props.chainId
  const counterpartySettled = useSettledCount(() => {
    const offer = asOffer()
    if (!offer) return null
    const me = app.address()?.toLowerCase()
    return offer.owner.toLowerCase() === me ? offer.counterparty : offer.owner
  })

  /**
   * Amount ordering follows the reader: the box on the left is what they give up.
   * The EVM side gives ETH, the XMR side gives XMR.
   */
  const boxes = createMemo(() => {
    const offer = asOffer()
    if (!offer) return []
    const eth = { label: 'ETH Amount', value: formatEth(offer.amount), xmr: false }
    const xmr = { label: 'XMR Amount', value: formatXmr(offer.xmrAmount), xmr: true }
    return status()?.side === 'evm' ? [eth, xmr] : [xmr, eth]
  })

  const run = async (label: string, action: () => Promise<`0x${string}`>) => {
    setError(null)
    setBusy(label)
    try {
      if (wrongNetwork()) await switchChain(config, { chainId: props.chainId })
      const hash = await action()
      await awaitReceipt(props.chainId, hash)
      await onchain.refetch()
      app.refetchBook()
      app.refetchMyOrders()
    } catch (cause) {
      // simulateContract decodes the contract's custom errors, so the message
      // here is usually the actual revert reason rather than "execution reverted".
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message.split('\n')[0] ?? message)
    } finally {
      setBusy(null)
    }
  }

  /** Where this offer's escrow key lives between the transactions that need it. */
  const keyRef = () => `offer-${props.offerId.toString()}`

  /**
   * The private half that `claim` and `quit` have to prove.
   *
   * It was generated at take time and written to this browser. If it is gone —
   * different device, cleared site data — the trade cannot be claimed from here,
   * and saying so plainly is the only honest thing to do.
   */
  const storedKeys = () => loadKeypair(props.chainId, keyRef())

  const perform = (kind: string) => {
    const offer = asOffer()
    const chain = onchain.data
    if (!offer || !chain) return

    switch (kind) {
      case 'cancel':
        void run('cancel', () => cancelOffer(props.chainId, offer.offerId))
        return

      case 'ready':
        void run('ready', () => readyOffer(props.chainId, offer.offerId))
        return

      case 'take': {
        // Generate the escrow half *and persist it before the transaction*. The
        // other order loses the key on a crash between send and confirm, and
        // that key is the only thing that can claim the trade.
        const pair = generateCanonicalKeypair()
        try {
          saveKeypair(props.chainId, keyRef(), pair)
        } catch {
          setError(
            'This browser will not store the escrow key, so the trade could not be claimed later. Turn off private browsing or allow site data first.',
          )
          return
        }
        setBackup(exportKeypair(pair, `order #${offer.offerId.toString()}`))

        const { spendingKey, viewingKey } = keysForTake(offer.kind, pair)
        void run('take', () =>
          takeOffer({
            chainId: props.chainId,
            offerId: offer.offerId,
            spendingKey,
            viewingKey,
            // Read live off the contract, never off the indexer. Excess is
            // refunded by `take` itself, so overshooting is safe.
            value: requiredToTake(offer.kind, chain.amount, chain.deposit),
          }),
        )
        return
      }

      case 'claim': {
        const pair = storedKeys()
        if (!pair) {
          setError(
            'The escrow key for this order is not in this browser. Claiming needs the private spend key generated when the offer was taken.',
          )
          return
        }
        if (!proves(pair.privateSpend, chain.xmrPublicSpendKey)) {
          setError(
            'The stored key does not open the point committed on-chain. Do not submit it — the contract would reject it.',
          )
          return
        }
        void run('claim', () => claimOffer(props.chainId, offer.offerId, pair.privateSpend))
        return
      }

      case 'quit': {
        const side = status()?.side
        if (side !== 'evm' && side !== 'xmr') return
        const pair = storedKeys()
        if (!pair) {
          setError('The escrow key for this order is not in this browser, so it cannot be published.')
          return
        }
        const committed = side === 'xmr' ? chain.xmrPublicSpendKey : chain.evmPublicSpendKey
        if (!proves(pair.privateSpend, committed)) {
          setError('The stored key does not open the point committed on-chain.')
          return
        }
        const { spendingKey, viewingKey } = keysForQuit(side, pair)
        void run('quit', () =>
          quitOffer({ chainId: props.chainId, offerId: offer.offerId, spendingKey, viewingKey }),
        )
        return
      }

      default:
        return
    }
  }

  const explorerLink = () =>
    home ? `${home.explorer}/address/${home.deployment}` : undefined

  return (
    <Modal title={`Order #${props.offerId.toString()}`}>
      <Show
        when={asOffer()}
        fallback={
          <div class="sub">
            <span class="cap">
              <Show when={onchain.isError} fallback="Reading the order from the contract…">
                Could not read order #{props.offerId.toString()} — {String(onchain.error)}
              </Show>
            </span>
          </div>
        }
      >
        {(offer) => (
          <>
            <div style={{ display: 'flex', 'align-items': 'center', gap: '10px' }}>
              {boxes().map((box, index) => (
                <>
                  <Show when={index > 0}>
                    <ArrowRight size={18} />
                  </Show>
                  <AmountBox label={box.label} value={box.value} xmr={box.xmr} />
                </>
              ))}
            </div>

            <div class="sub" style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
              <Row k="Status">
                <span class="pill">
                  {offer().state.charAt(0) + offer().state.slice(1).toLowerCase()}
                </span>
              </Row>
              <Row k="Counterparty">
                <span class="mono">
                  <Show when={offer().counterparty} fallback="—">
                    {(address) => (
                      <>
                        {shortAddress(address())}
                        <Show when={counterpartySettled() !== null}>
                          {' '}
                          · {counterpartySettled()} done
                        </Show>
                      </>
                    )}
                  </Show>
                </span>
              </Row>
              <Row k="Rate">
                {formatRate(
                  Number(formatXmr(offer().xmrAmount, 12)) / Number(formatEth(offer().amount, 18)),
                )}{' '}
                XMR/ETH
              </Row>
              <Row k="Deposit">{formatEth(offer().deposit)} ETH</Row>
              <Row k={offer().state === 'OPEN' ? 'Posted' : 'Updated'}>
                {relativeTime(offer().updatedAt, app.now() * 1000)}
              </Row>
              <Show when={offer().state === 'OPEN' && status()?.side === 'none'}>
                <Row k="You would send">
                  <span class="mono">
                    {formatEth(requiredToTake(offer().kind, offer().amount, offer().deposit))} ETH
                  </span>
                </Row>
              </Show>
            </div>

            {/* The deadline, in plain words. No t0/t1, no block heights. */}
            <Show when={status()?.deadline}>
              {(deadline) => (
                <div class="sub" style={{ display: 'flex', gap: '11px', 'align-items': 'flex-start' }}>
                  <span style={{ flex: 'none', 'margin-top': '2px' }}>
                    <Clock />
                  </span>
                  <span style={{ display: 'flex', 'flex-direction': 'column', gap: '3px' }}>
                    <span style={{ 'font-size': '16px' }}>
                      {countdown(deadline(), app.now() * 1000)} to {verb(status()?.side, offer().state)}
                    </span>
                    <span class="cap">
                      Miss a deadline and the order closes itself. Both sides get their money back.
                    </span>
                  </span>
                </div>
              )}
            </Show>

            {/* ── stage-specific panel ───────────────────────────────────── */}

            <Show when={status()?.stage === 'send-xmr' && onchain.data}>
              <EscrowPanel
                title="Send XMR"
                hint={`Send exactly ${formatXmr(offer().xmrAmount)} XMR to the address both sides committed to. Neither of you can spend it alone.`}
                offer={onchain.data as OnchainOffer}
                intent="pay"
                own={storedKeys()}
                xmrAmount={formatXmr(offer().xmrAmount, 12)}
                label={escrowLabel()}
                mainnet={moneroMainnet()}
              />
            </Show>

            <Show when={status()?.stage === 'verify' && onchain.data}>
              <EscrowPanel
                title="Verify XMR Deposit"
                hint="Watch the escrow as a view-only wallet before you confirm. The XMR side published its view key on-chain precisely so you can."
                offer={onchain.data as OnchainOffer}
                intent="view"
                own={storedKeys()}
                xmrAmount={formatXmr(offer().xmrAmount, 12)}
                label={escrowLabel()}
                mainnet={moneroMainnet()}
              />
            </Show>

            <Show when={status()?.stage === 'claim'}>
              <div style={{ display: 'flex', 'flex-direction': 'column', gap: '10px', 'padding-top': '4px' }}>
                <div class="note">XMR deposit verified by buyer</div>
                <div class="sub" style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
                  <Row k="Sale">
                    <span class="mono">{formatEth(offer().amount)} ETH</span>
                  </Row>
                  <Row k="Deposit returned">
                    <span class="mono">{formatEth(offer().deposit)} ETH</span>
                  </Row>
                  <div class="row" style={{ 'font-size': '17px' }}>
                    <span>You receive</span>
                    <span class="mono" style={{ 'font-size': '15px' }}>
                      {formatEth(claimPayout(offer().amount, offer().deposit))} ETH
                    </span>
                  </div>
                  <Row k="Paid out as">
                    <button
                      class="chip"
                      style={{ padding: '4px 8px', 'font-size': '14px' }}
                      onClick={() =>
                        openTokenPicker(payoutCurrency(), setPayoutCurrency, { allowXmr: false })
                      }
                    >
                      <TokenIcon currency={payoutCurrency()} size={16} />
                      {payoutCurrency().symbol}
                      <Chevron size={11} />
                    </button>
                  </Row>
                </div>
              </div>
            </Show>

            <Show when={status()?.stage === 'collect' && onchain.data}>
              <EscrowPanel
                title="Collect XMR"
                hint="They published their key half, so the escrow's spend key now exists. Import it and sweep the coins out — whoever holds it owns them."
                offer={onchain.data as OnchainOffer}
                intent="sweep"
                own={storedKeys()}
                revealedSpend={onchain.data?.xmrPrivateSpendKey}
                xmrAmount={formatXmr(offer().xmrAmount, 12)}
                label={escrowLabel()}
                mainnet={moneroMainnet()}
              />
              <div style={{ 'padding-top': '6px' }}>
                <div class="note">Trade completed successfully</div>
              </div>
            </Show>

            <Show when={status()?.stage === 'refunded'}>
              <div style={{ 'padding-top': '4px' }}>
                <div class="note">Order refunded</div>
              </div>
              <Show when={status()?.side === 'xmr' && onchain.data}>
                <EscrowPanel
                  title="Recover XMR"
                  hint="They published their key half, so you can reach the escrow and sweep your own coins back out."
                  offer={onchain.data as OnchainOffer}
                  intent="sweep"
                  own={storedKeys()}
                  revealedSpend={onchain.data?.evmPrivateSpendKey}
                  xmrAmount={formatXmr(offer().xmrAmount, 12)}
                  label={escrowLabel()}
                  mainnet={moneroMainnet()}
                />
              </Show>
            </Show>

            <Show when={status()?.stage === 'settled'}>
              <div style={{ 'padding-top': '4px' }}>
                <div class="note">Trade completed successfully</div>
              </div>
            </Show>

            <Show when={status()?.stage === 'cancelled'}>
              <div style={{ 'padding-top': '4px' }}>
                <div class="note">Cancelled — the escrow was returned</div>
              </div>
            </Show>

            {/* ── actions ────────────────────────────────────────────────── */}

            <div style={{ display: 'flex', 'flex-direction': 'column', gap: '8px', 'padding-top': '4px' }}>
              <Show when={wrongNetwork() && status()?.primary}>
                <span
                  class="pill"
                  style={{ display: 'flex', 'align-items': 'center', gap: '5px', 'align-self': 'flex-start' }}
                >
                  <Warning />
                  Incorrect network
                </span>
              </Show>

              <Show when={status()?.primary}>
                {(action) => (
                  <button
                    class="btn btn-primary"
                    disabled={busy() !== null}
                    onClick={() => perform(action().kind)}
                  >
                    {busy() === action().kind
                      ? 'Confirm in your wallet…'
                      : wrongNetwork()
                        ? `Switch to ${chainLabel(props.chainId)} and ${action().label.toLowerCase()}`
                        : action().label}
                  </button>
                )}
              </Show>

              <Show when={status()?.secondary}>
                {(action) => (
                  <button
                    class="btn btn-exit"
                    disabled={busy() !== null}
                    onClick={() => perform(action().kind)}
                  >
                    {busy() === action().kind ? 'Confirm in your wallet…' : action().label}
                  </button>
                )}
              </Show>

              <Show when={status()?.stage === 'verify' && status()?.secondary?.kind === 'quit'}>
                <span class="cap" style={{ 'text-align': 'center' }}>
                  Cancelling publishes your half of the escrow key.
                </span>
              </Show>

              <Show when={status()?.stage === 'claim'}>
                <span class="cap" style={{ 'text-align': 'center' }}>
                  Claiming publishes your half of the escrow key.
                  <Show when={payoutCurrency().symbol !== 'ETH'}>
                    {' '}
                    The ETH is swapped to {payoutCurrency().symbol} through Uniswap the moment it
                    lands — a second transaction, not an atomic one.
                  </Show>
                </span>
              </Show>

              <Show when={status()?.stage === 'open' && status()?.side === 'none'}>
                <span class="cap" style={{ 'text-align': 'center' }}>
                  Takers post a {formatEth(offer().deposit)} ETH deposit and send the XMR next.
                </span>
              </Show>

              {/*
                The escrow key is the single irreplaceable thing this app holds.
                It is in localStorage, which survives a reload and nothing else,
                so offer a copy the moment it exists rather than after a reset.
              */}
              <Show when={backup()}>
                {(text) => (
                  <div class="sub" style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
                    <span class="lbl">Back up this escrow key</span>
                    <span class="cap">
                      It lives in this browser only. Clear site data or switch device without a copy
                      and this trade cannot be claimed.
                    </span>
                    <span style={{ display: 'flex', gap: '8px' }}>
                      <button
                        class="btn-inline"
                        onClick={() => void navigator.clipboard?.writeText(text())}
                      >
                        Copy
                      </button>
                      <button
                        class="btn-inline"
                        onClick={() => {
                          const blob = new Blob([text()], { type: 'text/plain' })
                          const url = URL.createObjectURL(blob)
                          const anchor = document.createElement('a')
                          anchor.href = url
                          anchor.download = `noktoswap-order-${props.offerId.toString()}.key.txt`
                          anchor.click()
                          URL.revokeObjectURL(url)
                        }}
                      >
                        Download
                      </button>
                      <button class="btn-inline btn-exit" onClick={() => setBackup(null)}>
                        I have it
                      </button>
                    </span>
                  </div>
                )}
              </Show>

              <Show when={error()}>
                {(message) => (
                  <div class="sub" style={{ 'border-style': 'dashed' }}>
                    <span class="cap">{message()}</span>
                  </div>
                )}
              </Show>
            </div>

            <div
              style={{
                display: 'flex',
                'justify-content': 'space-between',
                'align-items': 'center',
                'padding-top': '2px',
              }}
            >
              <span class="cap">
                Order #{offer().offerId.toString()} on {chainLabel(props.chainId)}
              </span>
              <Show when={explorerLink()}>
                {(href) => (
                  <a
                    class="cap link"
                    href={href()}
                    target="_blank"
                    rel="noreferrer"
                    style={{ display: 'flex', 'align-items': 'center', gap: '5px' }}
                  >
                    See it on a block explorer
                    <External />
                  </a>
                )}
              </Show>
            </div>
          </>
        )}
      </Show>
    </Modal>
  )
}

/** What the countdown is counting down *to*, in the reader's own terms. */
const verb = (side: Side | undefined, state: string): string => {
  if (side === 'evm') return state === 'TAKEN' ? 'confirm' : 'close this out'
  if (side === 'xmr') return state === 'READY' ? 'claim' : 'finish this trade'
  return 'settle'
}

export { XMR }
export type { OnchainOffer, OfferKind }
