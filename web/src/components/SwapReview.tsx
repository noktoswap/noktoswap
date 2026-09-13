import { useNavigate } from '@solidjs/router'
import { useQuery } from '@tanstack/solid-query'
import { For, Show, createMemo, createSignal, type JSX } from 'solid-js'
import { sendTransaction, signTypedData, switchChain, waitForTransactionReceipt } from '@wagmi/core'
import type { Hex } from 'viem'
import { NATIVE, chainLabel } from '../lib/chains'
import { openOffer, valueToOpen } from '../lib/contract'
import { formatEth, formatToken, formatUsd, formatXmr, tryParseEth, tryParseXmr } from '../lib/format'
import {
  exportKeypair,
  generateCanonicalKeypair,
  keysForOpen,
  rekeyKeypair,
  saveKeypair,
} from '../lib/keys'
import { offerIdFromReceipt } from '../lib/contract'
import { XMR, nativeOf, type Currency } from '../lib/tokens'
import {
  checkApproval,
  createSwap,
  describeRoute,
  isTransientQuoteError,
  permitTypedData,
  quoteFunding,
  type FundingQuote,
  type TxRequest,
} from '../lib/uniswap'
import { config } from '../lib/wagmi'
import { useApp } from '../state/app'
import { closeAllModals, openOrder, openSettings } from '../state/modals'
import { deadlineAt, maxSlippage } from '../state/settings'
import { clearDraft, draftEth, draftXmr, evmCurrency, postedKind } from '../state/swap'
import { Modal, Row } from './Modal'
import { TokenIcon } from './TokenIcon'
import { ArrowDown, Check, Settings as Sliders } from './icons'

/**
 * Review, then execute. Two or three transactions, named honestly.
 *
 * The escrow is funded by an exact-output swap, and the swap output lands in the
 * wallet before `openOffer` can spend it — the Trading API sends proceeds to the
 * swapper, and there is no hook that would let one transaction do both. So this
 * is a *sequence*, and the step list says so rather than implying atomicity.
 *
 * That is the real integration friction here, and it is written up in
 * FEEDBACK.md rather than papered over in the UI.
 */

type StepState = 'done' | 'active' | 'pending'

const Step = (props: { index: number; label: string; state: StepState }): JSX.Element => (
  <div
    style={{
      display: 'flex',
      'align-items': 'center',
      gap: '10px',
      color: props.state === 'pending' ? 'var(--muted)' : undefined,
    }}
  >
    <span
      style={{
        width: '24px',
        height: '24px',
        'border-radius': '50%',
        border: `1px solid ${props.state === 'pending' ? 'var(--line2)' : 'var(--ink)'}`,
        display: 'flex',
        'align-items': 'center',
        'justify-content': 'center',
        flex: 'none',
        background: props.state === 'done' ? 'var(--ink)' : 'transparent',
        color: props.state === 'done' ? 'var(--paper)' : 'inherit',
      }}
    >
      <Show
        when={props.state === 'done'}
        fallback={
          <span class="mono" style={{ 'font-size': '12px' }}>
            {props.index}
          </span>
        }
      >
        <Check />
      </Show>
    </span>
    <span style={{ 'font-size': '15px' }}>{props.label}</span>
  </div>
)

const Leg = (props: {
  label: string
  amount: string
  fiat?: string
  currency?: Currency
}): JSX.Element => (
  <div class="sub" style={{ display: 'flex', 'flex-direction': 'column', gap: '5px' }}>
    <span class="lbl">{props.label}</span>
    <div class="row" style={{ 'font-size': '20px' }}>
      <span style={{ display: 'flex', 'align-items': 'center', gap: '9px' }}>
        <Show when={props.currency}>{(c) => <TokenIcon currency={c()} size={20} />}</Show>
        {props.amount}
      </span>
      <Show when={props.fiat}>
        <span class="mono cap" style={{ 'font-size': '13px' }}>
          {props.fiat}
        </span>
      </Show>
    </div>
  </div>
)

export const SwapReview = (): JSX.Element => {
  const app = useApp()
  const navigate = useNavigate()
  const [step, setStep] = createSignal(0)
  const [error, setError] = createSignal<string | null>(null)
  const [busy, setBusy] = createSignal(false)
  const [backup, setBackup] = createSignal<string | null>(null)
  const [done, setDone] = createSignal(false)
  /** The id the chain assigned, pulled from the receipt rather than the indexer. */
  const [offerId, setOfferId] = createSignal<bigint | null>(null)

  const kind = () => postedKind()
  const token = () => evmCurrency()
  const needsSwap = () => token().address !== null && token().address !== NATIVE

  const ethAmount = () => tryParseEth(draftEth())
  const xmrAmount = () => tryParseXmr(draftXmr())

  const escrowValue = createMemo(() => {
    const eth = ethAmount()
    const ratio = app.depositRatio()
    if (eth === null || ratio === null) return null
    return valueToOpen(kind(), eth, ratio)
  })

  const funding = useQuery(() => {
    const who = app.address()
    const address = token().address
    const required = escrowValue()
    return {
      queryKey: ['review-quote', address, required?.toString(), who, maxSlippage()],
      queryFn: (): Promise<FundingQuote> =>
        quoteFunding({
          chainId: app.actionChainId(),
          token: address as `0x${string}`,
          ethRequired: required as bigint,
          swapper: who as `0x${string}`,
          slippageTolerance: maxSlippage() ?? undefined,
        }),
      enabled: Boolean(needsSwap() && who && required && required > 0n),
      // Retry only what the service says is worth retrying; a real
      // no-route answer is a fact about the market, not a hiccup.
      retry: (count: number, error: unknown) => count < 2 && isTransientQuoteError(error),
      retryDelay: 600,
    }
  })

  /** Is a Permit2 / router allowance outstanding for the spend ceiling? */
  const approval = useQuery(() => {
    const who = app.address()
    const address = token().address
    const ceiling = funding.data?.tokenInMax
    return {
      queryKey: ['review-approval', address, ceiling?.toString(), who],
      queryFn: () =>
        checkApproval({
          chainId: app.actionChainId(),
          walletAddress: who as `0x${string}`,
          token: address as `0x${string}`,
          // Approve against the ceiling, not the expected spend — otherwise the
          // swap can fail on slippage it was explicitly allowed to take.
          amount: ceiling as bigint,
        }),
      enabled: Boolean(needsSwap() && who && ceiling),
      // Retry only what the service says is worth retrying; a real
      // no-route answer is a fact about the market, not a hiccup.
      retry: (count: number, error: unknown) => count < 2 && isTransientQuoteError(error),
      retryDelay: 600,
    }
  })

  const needsApproval = () => approval.data?.approval != null

  const needsPermit = () => funding.data?.raw.permitData != null

  /**
   * The steps, in the order they actually happen. Approval and the signature each
   * appear only when the API asks for one — a step that is always skipped teaches
   * nothing, and this list has to match what `execute` advances through or the
   * progress marker drifts ahead of the wallet.
   */
  const steps = createMemo(() => {
    const list: string[] = []
    if (needsSwap() && needsApproval()) list.push(`Approve ${token().symbol}`)
    // A signature, not a transaction — so it says sign, and says it is free.
    if (needsSwap() && needsPermit()) list.push(`Sign the ${token().symbol} spending permission (no gas)`)
    if (needsSwap()) list.push(`Swap ${token().symbol} for exactly ${formatEth(escrowValue() ?? 0n)} ETH`)
    list.push('Open the order and escrow the ETH')
    return list
  })

  const sendRequest = async (request: TxRequest) => {
    const hash = await sendTransaction(config, {
      to: request.to,
      data: request.data,
      value: BigInt(request.value || '0'),
      chainId: app.actionChainId(),
    })
    return waitForTransactionReceipt(config, { hash, chainId: app.actionChainId() })
  }

  const execute = async () => {
    const who = app.address()
    const xmr = xmrAmount()
    const value = escrowValue()

    // These were a bare `return`, which made the button a silent no-op — the
    // worst possible response to a click, and indistinguishable from a bug.
    if (!who) return setError('Connect a wallet first.')
    if (xmr === null) return setError('Set the XMR amount before posting.')
    if (value === null) {
      return setError('Still reading the market parameters from the contract — try again in a moment.')
    }

    setError(null)
    setBusy(true)
    try {
      if (app.walletChainId() !== app.actionChainId()) {
        await switchChain(config, { chainId: app.actionChainId() })
      }

      let index = 0

      if (needsSwap()) {
        const quote = funding.data
        if (!quote) throw new Error('no quote to execute')

        const pending = approval.data?.approval
        if (pending) {
          await sendRequest(pending)
          setStep(++index)
        }

        /*
         * Permit2 signature, when the API asks for one.
         *
         * This costs no gas and sends no transaction — it is an off-chain
         * signature granting the router a bounded, expiring allowance, which is
         * why it is the common path: `approve` only shows up when Permit2 itself
         * has no allowance yet. Submitting the swap without the signature would
         * fail at simulation.
         */
        const permit = quote.raw.permitData
        let signature: Hex | undefined
        if (permit) {
          signature = await signTypedData(config, permitTypedData(permit))
          setStep(++index)
        }

        const swap = await createSwap({
          quote: quote.raw.quote,
          signature,
          permitData: permit,
          deadline: deadlineAt(app.now()),
        })
        await sendRequest(swap)
        setStep(++index)
      }

      // Only now does the wallet hold escrowable ETH.
      const pair = generateCanonicalKeypair()
      const ref = `draft-${Date.now()}`
      saveKeypair(app.actionChainId(), ref, pair)
      setBackup(exportKeypair(pair, 'a new offer'))

      const { spendingKey, viewingKey } = keysForOpen(kind(), pair)
      const hash = await openOffer({
        chainId: app.actionChainId(),
        kind: kind(),
        xmrAmount: xmr,
        counterparty: '0x0000000000000000000000000000000000000000',
        spendingKey,
        viewingKey,
        value,
      })
      const receipt = await waitForTransactionReceipt(config, { hash, chainId: app.actionChainId() })

      /*
       * Read the new id out of the receipt rather than waiting for the subgraph.
       * The book is indexed and lags by design, so landing on it immediately after
       * posting can show nothing — which looks exactly like a failed post. The
       * offer id is in the log this transaction just emitted, and the order dialog
       * reads the contract, so it is correct the instant it opens.
       */
      const newId = offerIdFromReceipt(receipt.logs)
      if (newId !== null) {
        setOfferId(newId)
        // Re-key the escrow keys from the draft reference onto the real id, or
        // nothing could find them again.
        rekeyKeypair(app.actionChainId(), ref, `offer-${newId.toString()}`)
      }

      setStep(++index)
      setDone(true)
      app.refetchBook()
      app.refetchMyOrders()
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(message.split('\n')[0] ?? message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title="You're swapping"
      actions={
        <button class="icon-btn" aria-label="Settings" onClick={openSettings}>
          <Sliders />
        </button>
      }
    >
      <Show when={needsSwap()}>
        <Leg
          label={`You pay · ${chainLabel(app.actionChainId())}`}
          amount={`${formatToken(funding.data?.tokenIn ?? 0n, token().decimals)} ${token().symbol}`}
          currency={token()}
        />
        <div style={{ display: 'flex', 'justify-content': 'center', margin: '-4px 0' }}>
          <ArrowDown />
        </div>
      </Show>

      <Leg
        label={`Locked in your order · ${chainLabel(app.actionChainId())}`}
        amount={`${formatEth(escrowValue() ?? 0n)} ETH`}
        currency={nativeOf(app.actionChainId())}
      />

      <div style={{ display: 'flex', 'justify-content': 'center', margin: '-4px 0' }}>
        <ArrowDown />
      </div>

      <Leg
        label="You get when it settles"
        amount={`${formatXmr(xmrAmount() ?? 0n)} ${XMR.symbol}`}
        currency={XMR}
      />

      <Show when={needsSwap() && funding.data}>
        {(quote) => (
          <div class="sub" style={{ display: 'flex', 'flex-direction': 'column', gap: '7px' }}>
            <Row k="Network cost">
              <span class="mono">{formatUsd(quote().gasFeeUsd)}</span>
            </Row>
            <Row k="Max slippage">
              <span class="mono">
                {quote().slippage === null ? 'Auto' : `Auto · ${quote().slippage}%`}
              </span>
            </Row>
            <Row k="Maximum sold">
              <span class="mono">
                {formatToken(quote().tokenInMax, token().decimals)} {token().symbol}
              </span>
            </Row>
            <Row k="Price difference">
              <span class="mono">
                {quote().priceDifference === null ? '—' : `${quote().priceDifference}%`}
              </span>
            </Row>
            <Row k="Order routing">
              <span class="mono">{describeRoute(quote().routeString)}</span>
            </Row>
          </div>
        )}
      </Show>

      <div style={{ display: 'flex', 'flex-direction': 'column', gap: '9px', 'padding-top': '2px' }}>
        <span class="lbl">
          Step {Math.min(step() + 1, steps().length)} of {steps().length}
        </span>
        <For each={steps()}>
          {(label, index) => (
            <Step
              index={index() + 1}
              label={label}
              state={index() < step() ? 'done' : index() === step() ? 'active' : 'pending'}
            />
          )}
        </For>
        <Show when={needsSwap()}>
          <span class="cap">
            These are separate transactions. The swap has to land in your wallet before the order can
            escrow it — nothing on-chain ties the two together.
          </span>
        </Show>
      </div>

      <Show when={backup()}>
        {(text) => (
          <div class="sub" style={{ display: 'flex', 'flex-direction': 'column', gap: '8px' }}>
            <span class="lbl">Back up this escrow key</span>
            <span class="cap">
              It lives in this browser only, and it is the only thing that can settle this offer.
            </span>
            <span style={{ display: 'flex', gap: '8px' }}>
              <button class="btn-inline" onClick={() => void navigator.clipboard?.writeText(text())}>
                Copy
              </button>
              <button
                class="btn-inline"
                onClick={() => {
                  const blob = new Blob([text()], { type: 'text/plain' })
                  const url = URL.createObjectURL(blob)
                  const anchor = document.createElement('a')
                  anchor.href = url
                  anchor.download = 'noktoswap-offer.key.txt'
                  anchor.click()
                  URL.revokeObjectURL(url)
                }}
              >
                Download
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

      <Show
        when={!done()}
        fallback={
          /*
           * `closeModal` pops one level, and this dialog was opened *on top of*
           * the create form — so finishing used to land back on a filled-in
           * create form, which reads as the flow restarting rather than
           * completing. A finished flow dismisses the whole stack and goes
           * somewhere that shows the result.
           */
          <button
            class="btn btn-primary"
            style={{ 'margin-top': '4px' }}
            onClick={() => {
              const id = offerId()
              clearDraft()
              closeAllModals()
              navigate('/book')
              // Open the order itself on top of the list. It reads the contract,
              // so it is right immediately, while the book behind it fills in on
              // its next poll.
              if (id !== null) openOrder(app.actionChainId(), id)
            }}
          >
            <Show when={offerId()} fallback="Done — see it on the book">
              {(id) => <>Done — open order #{id().toString()}</>}
            </Show>
          </button>
        }
      >
        <button
          class="btn btn-primary"
          style={{ 'margin-top': '4px' }}
          disabled={busy() || (needsSwap() && !funding.data)}
          onClick={() => void execute()}
        >
          {busy()
            ? 'Confirm in your wallet…'
            : needsSwap() && needsApproval()
              ? 'Approve and swap'
              : needsSwap()
                ? 'Swap and open the order'
                : 'Open the order'}
        </button>
      </Show>
    </Modal>
  )
}
