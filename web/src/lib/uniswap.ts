import type { Address, Hex } from 'viem'
import { NATIVE } from './chains'

/**
 * Uniswap Trading API — the APIs and SDKs, not the deprecated widget.
 *
 * Requests go through `/api/uniswap`, which attaches `x-api-key` and
 * `x-universal-router-version` server-side (vite.config.ts). The router version
 * must stay consistent across quote → check_approval → swap, which is another
 * reason to set it in one place rather than per call site.
 *
 * ── why exact-OUTPUT ──────────────────────────────────────────────────────
 *
 * The contract escrows native ETH and nothing else. A taker holding USDC has to
 * arrive with a precise ETH figure: `take` reverts unless `msg.value >= required`
 * where required is `offer.deposit` for a BUY and `offer.amount` for a SELL.
 *
 * So the ETH side is the fixed leg and the token side is the variable one, which
 * is exactly EXACT_OUTPUT. The quote then bounds the token spend rather than the
 * proceeds — `quote.input.maximumAmount` is "costs at most N USDC".
 *
 * Slippage follows the trade type: on EXACT_OUTPUT it lands on the *input*
 * token, which is the property that makes this safe. The ETH that reaches the
 * escrow is not the slippage-bearing side.
 *
 * Anything above `required` is refunded by `take` itself (AUDIT.md H2), so a
 * quote that overshoots costs the user nothing. Do not "simplify" this into an
 * equality check against the offer amount — that reintroduces a revert on every
 * one-wei rounding difference.
 */
const ENDPOINT = '/api/uniswap'

export type TradeType = 'EXACT_INPUT' | 'EXACT_OUTPUT'

export class UniswapApiError extends Error {
  readonly status: number
  readonly detail: string | undefined
  constructor(status: number, statusText: string, detail?: string) {
    super(detail ? `Uniswap API ${status}: ${detail}` : `Uniswap API ${status} ${statusText}`)
    this.name = 'UniswapApiError'
    this.status = status
    this.detail = detail
  }
}

const post = async <T>(path: string, body: unknown): Promise<T> => {
  const response = await fetch(`${ENDPOINT}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    let detail: string | undefined
    try {
      detail = (JSON.parse(text) as { detail?: string; errorCode?: string }).detail
    } catch {
      detail = text.slice(0, 200) || undefined
    }
    throw new UniswapApiError(response.status, response.statusText, detail)
  }
  return (await response.json()) as T
}

/** The subset of TransactionRequest a wallet actually needs. */
export type TxRequest = {
  to: Address
  from: Address
  data: Hex
  value: string
  chainId: number
  gasLimit?: string
  maxFeePerGas?: string
  maxPriorityFeePerGas?: string
}

type QuoteLeg = {
  amount?: string
  token?: string
  /** Present on the input leg of an EXACT_OUTPUT quote — the spend ceiling. */
  maximumAmount?: string
  /** Present on the output leg of an EXACT_INPUT quote. */
  minimumAmount?: string
}

export type ClassicQuote = {
  input?: QuoteLeg
  output?: QuoteLeg
  chainId?: number
  tradeType?: TradeType
  slippage?: number
  gasFee?: string
  gasFeeUSD?: string
  quoteId?: string
  routeString?: string
  priceImpact?: number
  priceDifference?: number
}

export type QuoteResponse = {
  requestId: string
  routing: 'CLASSIC' | 'DUTCH_LIMIT' | 'DUTCH_V2' | 'DUTCH_V3' | 'BRIDGE' | 'LIMIT_ORDER' | 'PRIORITY' | 'WRAP'
  quote: ClassicQuote
  isTokenApprovalApplicable?: boolean
  permitData?: unknown | null
  permitTransaction?: TxRequest
}

export type QuoteParams = {
  chainId: number
  tokenIn: Address
  tokenOut: Address
  /** Interpreted per `type`: the exact output for EXACT_OUTPUT. */
  amount: bigint
  type: TradeType
  swapper: Address
  /** Percent, e.g. 0.5. Omit to let the API pick (`autoSlippage: DEFAULT`). */
  slippageTolerance?: number
}

export const fetchQuote = (params: QuoteParams): Promise<QuoteResponse> =>
  post<QuoteResponse>('/quote', {
    type: params.type,
    amount: params.amount.toString(),
    tokenInChainId: params.chainId,
    tokenOutChainId: params.chainId,
    tokenIn: params.tokenIn,
    tokenOut: params.tokenOut,
    swapper: params.swapper,
    ...(params.slippageTolerance === undefined
      ? { autoSlippage: 'DEFAULT' }
      : { slippageTolerance: params.slippageTolerance }),
    // A fixed list means known routes. UniswapX is deliberately excluded: it
    // fills off-chain and asynchronously, and the escrow needs the ETH in the
    // wallet before the next transaction, not eventually.
    protocols: ['V4', 'V3', 'V2'],
    routingPreference: 'BEST_PRICE',
    urgency: 'normal',
  })

/**
 * Is a Permit2 or router approval outstanding for this spend?
 * Native ETH never needs one — short-circuit rather than ask.
 */
export const checkApproval = async (params: {
  chainId: number
  walletAddress: Address
  token: Address
  amount: bigint
}): Promise<{ approval: TxRequest | null; cancel: TxRequest | null }> => {
  if (params.token.toLowerCase() === NATIVE) return { approval: null, cancel: null }

  const body = await post<{ approval: TxRequest | null; cancel: TxRequest | null }>(
    '/check_approval',
    {
      walletAddress: params.walletAddress,
      token: params.token,
      amount: params.amount.toString(),
      chainId: params.chainId,
    },
  )
  return { approval: body.approval ?? null, cancel: body.cancel ?? null }
}

/** Turn a quote into calldata. `signature` carries the Permit2 signature. */
export const createSwap = async (params: {
  quote: ClassicQuote
  signature?: Hex
  permitData?: unknown
  /** Unix seconds. Past this the signed swap is no longer valid. */
  deadline?: number
}): Promise<TxRequest> => {
  const body = await post<{ swap: TxRequest }>('/swap', {
    quote: params.quote,
    ...(params.signature ? { signature: params.signature } : {}),
    ...(params.permitData ? { permitData: params.permitData } : {}),
    ...(params.deadline === undefined ? {} : { deadline: params.deadline }),
    simulateTransaction: true,
    refreshGasPrice: true,
  })
  return body.swap
}

export type SwappableToken = {
  address: Address
  chainId: number
  name: string
  symbol: string
  decimals: number
}

/**
 * Tokens Uniswap will route on this chain. PLAN.md constrains the list rather
 * than doing open-ended route discovery, so the picker shows a curated set by
 * default and this is the "search everything" path behind it.
 */
export const fetchSwappableTokens = async (params: {
  tokenIn: Address
  chainId: number
}): Promise<SwappableToken[]> => {
  const url = new URL(`${ENDPOINT}/swappable_tokens`, window.location.origin)
  url.searchParams.set('tokenIn', params.tokenIn)
  url.searchParams.set('tokenInChainId', String(params.chainId))

  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) return []
  const body = (await response.json()) as { tokens?: SwappableToken[] }
  return body.tokens ?? []
}

// ── the figures the review screen shows ─────────────────────────────────────

export type FundingQuote = {
  /** Exactly what reaches the escrow. The number the contract checks. */
  ethOut: bigint
  /** Expected token spend. */
  tokenIn: bigint
  /** Ceiling on the token spend: expected × (1 + slippage). Never exceeded. */
  tokenInMax: bigint
  slippage: number | null
  gasFeeUsd: number | null
  routeString: string | null
  priceDifference: number | null
  raw: QuoteResponse
}

/**
 * Quote the token spend needed to land `ethRequired` wei in the wallet.
 *
 * `ethRequired` should be the figure read off the contract, not the subgraph.
 */
export const quoteFunding = async (params: {
  chainId: number
  token: Address
  ethRequired: bigint
  swapper: Address
  slippageTolerance?: number
}): Promise<FundingQuote> => {
  const response = await fetchQuote({
    chainId: params.chainId,
    tokenIn: params.token,
    tokenOut: NATIVE,
    amount: params.ethRequired,
    type: 'EXACT_OUTPUT',
    swapper: params.swapper,
    slippageTolerance: params.slippageTolerance,
  })

  const { quote } = response
  const expected = quote.input?.amount
  if (expected === undefined) {
    throw new UniswapApiError(502, 'Bad Gateway', 'quote carried no input amount')
  }

  const tokenIn = BigInt(expected)
  return {
    // The API echoes the exact output back; trust the request over the echo only
    // if they disagree, since the request is what the contract will be given.
    ethOut: quote.output?.amount ? BigInt(quote.output.amount) : params.ethRequired,
    tokenIn,
    // maximumAmount is the whole point of EXACT_OUTPUT. Fall back to the
    // expected amount rather than inventing a ceiling if it is ever absent.
    tokenInMax: quote.input?.maximumAmount ? BigInt(quote.input.maximumAmount) : tokenIn,
    slippage: quote.slippage ?? null,
    gasFeeUsd: quote.gasFeeUSD === undefined ? null : Number(quote.gasFeeUSD),
    routeString: quote.routeString ?? null,
    priceDifference: quote.priceDifference ?? null,
    raw: response,
  }
}

/**
 * The reverse leg: a payout in something other than ETH.
 *
 * `claim` pays native ETH into the caller's wallet and the app swaps it after
 * the fact — hence EXACT_INPUT here. There is no way to make this atomic with
 * the claim, and pretending otherwise in the UI would be a lie, so the dialog
 * says "swapped the moment the ETH lands".
 */
export const quotePayout = (params: {
  chainId: number
  token: Address
  ethIn: bigint
  swapper: Address
}): Promise<QuoteResponse> =>
  fetchQuote({
    chainId: params.chainId,
    tokenIn: NATIVE,
    tokenOut: params.token,
    amount: params.ethIn,
    type: 'EXACT_INPUT',
    swapper: params.swapper,
  })

/** Route summary in the shape the detail rows want: "2 pools · v3, v4". */
export const describeRoute = (routeString: string | null): string => {
  if (!routeString) return '—'
  const versions = [...new Set(routeString.match(/\[V[234]\]/g) ?? [])]
    .map((v) => v.replace(/[[\]]/g, '').toLowerCase())
    .sort()
  const hops = (routeString.match(/-->/g) ?? []).length
  if (versions.length === 0) return routeString.slice(0, 40)
  const pools = Math.max(hops, 1)
  return `${pools} ${pools === 1 ? 'pool' : 'pools'} · ${versions.join(', ')}`
}
