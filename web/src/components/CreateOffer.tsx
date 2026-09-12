import { useQuery } from '@tanstack/solid-query'
import { Show, createMemo, createSignal, type JSX } from 'solid-js'
import { NATIVE, chainLabel } from '../lib/chains'
import { readParameters, valueToOpen } from '../lib/contract'
import {
  formatEth,
  formatRate,
  estimateXmr,
  formatToken,
  formatUsd,
  formatXmr,
  rateOf,
  tryParseEth,
  tryParseXmr,
} from '../lib/format'
import { describeRoute, quoteFunding, type FundingQuote } from '../lib/uniswap'
import { XMR, type Currency } from '../lib/tokens'
import { useApp } from '../state/app'
import { closeModal, openReview, openSettings, openTokenPicker } from '../state/modals'
import { maxSlippage } from '../state/settings'
import {
  direction,
  draftEth,
  draftXmr,
  evmCurrency,
  postedKind,
  selectCurrency,
  setDraftEth,
  setDraftXmr,
  type Slot,
} from '../state/swap'
import { Modal, Row } from './Modal'
import { TokenIcon } from './TokenIcon'
import { Chevron, Refresh, Settings } from './icons'

/**
 * Post an offer, optionally paying in something other than ETH.
 *
 * No protocol change for the token case: the contract still escrows native ETH,
 * so the app swaps the token to ETH on the way in and back out again on the way
 * out. The detail rows and their labels follow the Uniswap app, because the
 * numbers are Uniswap's and inventing new names for them would be worse.
 */

const QUOTE_REFRESH_MS = 20_000

export const CreateOffer = (): JSX.Element => {
  const app = useApp()
  // Seeded by whoever opened this — see `seedOfferDraft`. The draft is separate
  // from the widget's own input on purpose: there the amount is a filter, here it
  // is a commitment, and editing one should not silently change the other.
  const ethText = draftEth
  const xmrText = draftXmr
  const setEthText = setDraftEth
  const setXmrText = setDraftXmr
  const [quotedAt, setQuotedAt] = createSignal(Date.now())

  const kind = () => postedKind()
  const ethAmount = () => tryParseEth(ethText())
  const xmrAmount = () => tryParseXmr(xmrText())

  /**
   * The rate to price against, from the shared ladder: the book's own median
   * where it has one, Chainlink otherwise. Reading `app.marketRate()` rather than
   * recomputing the median here is what stops this line showing a dash on an
   * empty book while the widget two clicks away shows a figure.
   */
  const marketRate = () => app.marketRate()

  const rate = createMemo(() => rateOf(ethAmount(), xmrAmount()))

  /** Contract parameters gate what can be posted at all. Read them live. */
  const parameters = useQuery(() => ({
    queryKey: ['contract-parameters', app.homeChainId],
    queryFn: () => readParameters(app.homeChainId),
    staleTime: 10 * 60_000,
  }))

  /** What msg.value has to be, given the kind. */
  const escrowValue = createMemo(() => {
    const eth = ethAmount()
    const ratio = parameters.data?.depositRatio
    if (eth === null || ratio === undefined) return null
    return valueToOpen(kind(), eth, ratio)
  })

  const payingToken = () => evmCurrency()
  const needsSwap = () => payingToken().symbol !== 'ETH' && payingToken().address !== null

  /**
   * The exact-output quote. The escrow needs a precise ETH figure, so the ETH is
   * the fixed leg and the token spend is bounded:
   *   maximum sold = expected × (1 + slippage)
   */
  const funding = useQuery(() => {
    const who = app.address()
    const token = payingToken().address
    const required = escrowValue()
    return {
      queryKey: [
        'funding-quote',
        app.homeChainId,
        token,
        required?.toString(),
        who,
        maxSlippage(),
        quotedAt(),
      ],
      queryFn: (): Promise<FundingQuote> =>
        quoteFunding({
          chainId: app.homeChainId,
          token: token as `0x${string}`,
          ethRequired: required as bigint,
          swapper: who as `0x${string}`,
          // undefined defers to the API's own auto figure.
          slippageTolerance: maxSlippage() ?? undefined,
        }),
      enabled: Boolean(who && token && token !== NATIVE && required && required > 0n),
      refetchInterval: QUOTE_REFRESH_MS,
      retry: 0,
    }
  })

  const belowMinimum = createMemo(() => {
    const eth = ethAmount()
    const min = parameters.data?.minimumOffer
    return eth !== null && min !== undefined && eth < min
  })

  const aboveMaximum = createMemo(() => {
    const eth = ethAmount()
    const max = parameters.data?.maximumOffer
    return eth !== null && max !== undefined && max > 0n && eth > max
  })

  const ready = () =>
    ethAmount() !== null &&
    xmrAmount() !== null &&
    !belowMinimum() &&
    !aboveMaximum() &&
    (!needsSwap() || funding.data !== undefined)

  /**
   * Sell and buy are the same two slots the widget calls pay and receive, so they
   * share `selectCurrency` — including its inversion rule. Picking XMR on the buy
   * side of an XMR sale flips the offer from a SELL to a BUY, which is the honest
   * reading of the request.
   */
  const TokenChip = (props: { currency: Currency; slot: Slot }): JSX.Element => (
    <button
      class="chip"
      style={{ padding: '5px 9px' }}
      aria-label={`${props.slot === 'pay' ? 'Sell' : 'Buy'} currency: ${props.currency.symbol}`}
      onClick={() => openTokenPicker(props.currency, (picked) => selectCurrency(props.slot, picked))}
    >
      <TokenIcon currency={props.currency} size={18} />
      <span style={{ 'font-size': '15px' }}>{props.currency.symbol}</span>
      <Chevron size={13} />
    </button>
  )

  const sellSide = () => (direction() === 'eth-to-xmr' ? payingToken() : XMR)
  const buySide = () => (direction() === 'eth-to-xmr' ? XMR : payingToken())

  return (
    <Modal
      title="Create offer"
      actions={
        <button class="icon-btn" aria-label="Settings" onClick={openSettings}>
          <Settings />
        </button>
      }
    >
      <div class="card" style={{ padding: '16px', display: 'flex', 'flex-direction': 'column', gap: '10px' }}>
        <div style={{ display: 'flex', 'justify-content': 'space-between', 'align-items': 'center' }}>
          <span>Sell</span>
          <TokenChip currency={sellSide()} slot="pay" />
        </div>
        <div class="input">
          <input
            style={{ 'font-size': '24px' }}
            inputmode="decimal"
            placeholder="0"
            value={direction() === 'eth-to-xmr' ? ethText() : xmrText()}
            onInput={(event) =>
              direction() === 'eth-to-xmr'
                ? setEthText(event.currentTarget.value)
                : setXmrText(event.currentTarget.value)
            }
            aria-label="Amount to sell"
          />
          {/* The wireframe shows a fiat figure here. There is no honest source
              for it on this leg — the quote prices gas in USD but not the token
              amount — so it is left out rather than estimated. */}
        </div>

        <Show when={needsSwap()}>
          {/* Paying in a token. The escrow figure is fixed; the spend is capped. */}
          <div class="sub" style={{ display: 'flex', gap: '11px', 'align-items': 'flex-start', 'margin-top': '2px' }}>
            <span class="stack" style={{ gap: '3px' }}>
              <span style={{ 'font-size': '16px' }}>Swapped to ETH first</span>
              <Show
                when={funding.data}
                fallback={
                  <span class="cap">
                    <Show when={funding.isError} fallback="Quoting through Uniswap…">
                      No route right now — {String(funding.error).slice(0, 120)}
                    </Show>
                  </span>
                }
              >
                {(quote) => (
                  <span class="cap">
                    The order escrows exactly <b>{formatEth(quote().ethOut)} ETH</b>. That costs at
                    most{' '}
                    <b>
                      {formatToken(quote().tokenInMax, payingToken().decimals)}{' '}
                      {payingToken().symbol}
                    </b>
                    . Anything left over stays in your wallet.
                  </span>
                )}
              </Show>
            </span>
          </div>
        </Show>

        <div
          style={{
            display: 'flex',
            'justify-content': 'space-between',
            'align-items': 'center',
            'margin-top': '2px',
          }}
        >
          <span>Buy</span>
          <TokenChip currency={buySide()} slot="receive" />
        </div>
        <div class="input">
          <input
            style={{ 'font-size': '24px' }}
            inputmode="decimal"
            placeholder="0"
            value={direction() === 'eth-to-xmr' ? xmrText() : ethText()}
            onInput={(event) =>
              direction() === 'eth-to-xmr'
                ? setXmrText(event.currentTarget.value)
                : setEthText(event.currentTarget.value)
            }
            aria-label="Amount to buy"
          />
        </div>

        <div style={{ 'margin-top': '4px' }}>Rate</div>
        <div class="input" style={{ height: '48px' }}>
          <span style={{ 'font-size': '20px' }}>{formatRate(rate())}</span>
          <span class="mono cap">XMR/ETH</span>
        </div>
        {/*
          Clicking it adopts the market rate, which is the useful thing to do with
          a number you are being shown to price against — and on an empty book it
          is the only reference there is.
        */}
        <button
          style={{
            'text-align': 'right',
            'font-size': '14px',
            color: 'var(--muted)',
            'text-decoration': 'underline',
            'align-self': 'flex-end',
          }}
          disabled={marketRate() === null || ethAmount() === null}
          title="Use this rate"
          onClick={() => {
            const eth = ethAmount()
            const current = marketRate()
            if (eth === null || current === null) return
            setXmrText(formatXmr(estimateXmr(eth, current), 12))
          }}
        >
          Market ~{formatRate(marketRate())} XMR/ETH
          <Show when={app.rateSource() === 'oracle'}>
            {' '}
            <span class="cap2">(Chainlink)</span>
          </Show>
          <Show when={app.rateStale()}>
            {' '}
            <span class="cap2">· stale</span>
          </Show>
        </button>

        {/* Detail rows, labelled the way the Uniswap app labels them. */}
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
              <Row k="Price difference">
                <span class="mono">
                  {quote().priceDifference === null ? '—' : `${quote().priceDifference}%`}
                </span>
              </Row>
              <Row k="Order routing">
                <span class="mono">{describeRoute(quote().routeString)}</span>
              </Row>
              <Row k="Maximum sold">
                <span class="mono">
                  {formatToken(quote().tokenInMax, payingToken().decimals)} {payingToken().symbol}
                </span>
              </Row>
            </div>
          )}
        </Show>

        <Show when={needsSwap()}>
          <div
            style={{
              display: 'flex',
              'justify-content': 'space-between',
              'align-items': 'center',
              padding: '0 2px',
            }}
          >
            <span class="cap">
              <Show when={funding.data} fallback="No quote yet">
                Quote updated {Math.max(0, Math.round((app.now() * 1000 - quotedAt()) / 1000))}s ago
              </Show>
            </span>
            <button class="icon-btn" aria-label="Refresh quote" onClick={() => setQuotedAt(Date.now())}>
              <Refresh />
            </button>
          </div>
        </Show>

        {/* What the contract will actually accept. */}
        <Show when={escrowValue()}>
          {(value) => (
            <div class="sub" style={{ display: 'flex', 'flex-direction': 'column', gap: '7px' }}>
              <Row k={kind() === 'BUY' ? 'You escrow' : 'You stake'}>
                <span class="mono">{formatEth(value())} ETH</span>
              </Row>
              <Row k="Offer kind">
                <span class="pill">{kind()}</span>
              </Row>
              <Row k="Chain">
                <span class="pill">{chainLabel(app.homeChainId)}</span>
              </Row>
              <Show when={xmrAmount()}>
                {(xmr) => (
                  <Row k="XMR side">
                    <span class="mono">{formatXmr(xmr())} XMR</span>
                  </Row>
                )}
              </Show>
            </div>
          )}
        </Show>

        <Show when={belowMinimum() || aboveMaximum()}>
          <div class="sub" style={{ 'border-style': 'dashed' }}>
            <span class="cap">
              <Show when={belowMinimum()} fallback={<>Above the market maximum of {formatEth(parameters.data?.maximumOffer ?? 0n)} ETH.</>}>
                Below the market minimum of {formatEth(parameters.data?.minimumOffer ?? 0n)} ETH.
              </Show>
            </span>
          </div>
        </Show>

        <button
          class="btn btn-primary"
          style={{ 'margin-top': '2px', 'font-size': '18px' }}
          disabled={!ready()}
          onClick={() => openReview()}
        >
          Review
        </button>

        <Show when={!app.address()}>
          <span class="cap" style={{ 'text-align': 'center' }}>
            Connect a wallet to quote and post.
          </span>
        </Show>
      </div>

      <button class="btn btn-exit" onClick={closeModal}>
        Cancel
      </button>
    </Modal>
  )
}
