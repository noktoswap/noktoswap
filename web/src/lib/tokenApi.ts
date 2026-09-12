import type { Address } from 'viem'
import { chainInfo } from './chains'

/**
 * Wallet balances from the Graph Token API — the second Graph product, and the
 * reason this app indexes no token balances of its own.
 *
 * That is the leverage claim in one line: the swap token selector needs every
 * ERC-20 an address holds, per chain, with metadata. Indexing that would be a
 * subgraph per chain tracking every Transfer touching the user, and it would
 * still be wrong for tokens acquired before the start block. A standardized
 * product already serves it, so there is nothing here but a fetch.
 *
 * ── two facts worth knowing before reading the code ─────────────────────────
 *
 * The service now lives at `api.pinax.network`; `token-api.thegraph.com` no
 * longer resolves. Requests go through `/api/token`, which attaches the bearer
 * token server-side (vite.config.ts).
 *
 * Its `network` enum covers mainnets only — mainnet, base, arbitrum-one,
 * optimism, polygon, bsc, avalanche, unichain, hyperevm. **Sepolia is not in
 * it**, and Sepolia is where the contract is deployed. `coversChain` exists so
 * callers can tell "no coverage" from "nothing held".
 *
 * So this module does *discovery* and nothing else: which tokens does an address
 * hold, out of all tokens that exist. Exact figures — and any figure at all on
 * Sepolia — come from `lib/balances.ts`, which reads Multicall3 directly. Uniswap
 * is not an alternative here: the Trading API has no balances endpoint.
 */
const ENDPOINT = '/api/token/v1/evm'

export type TokenBalance = {
  contract: Address
  symbol: string
  name: string
  decimals: number
  /** Raw balance in base units. */
  raw: bigint
  /** Decimal-scaled balance, as the API computed it. Not a fiat figure. */
  amount: number
  chainId: number
  lastUpdatedBlock: number | null
}

/** `amount` is base units as a string; `value` is amount / 10^decimals. */
type RawBalance = {
  contract?: string
  address?: string
  amount?: string
  value?: number
  name?: string | null
  symbol?: string | null
  decimals?: number | null
  last_update_block_num?: number
}

/** Does the Token API cover this chain at all? */
export const coversChain = (chainId: number): boolean =>
  chainInfo(chainId)?.tokenApiNetwork != null

const decode = (raw: RawBalance, chainId: number): TokenBalance | null => {
  const contract = (raw.contract ?? raw.address) as Address | undefined
  if (raw.amount === undefined || !contract) return null

  const decimals = raw.decimals ?? 18
  let units: bigint
  try {
    units = BigInt(raw.amount)
  } catch {
    return null
  }

  return {
    contract,
    symbol: raw.symbol ?? '???',
    name: raw.name ?? raw.symbol ?? 'Unknown token',
    decimals,
    raw: units,
    amount: raw.value ?? 0,
    chainId,
    lastUpdatedBlock: raw.last_update_block_num ?? null,
  }
}

const get = async (path: string, params: Record<string, string>): Promise<RawBalance[]> => {
  const url = new URL(`${ENDPOINT}${path}`, window.location.origin)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)

  const response = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!response.ok) {
    throw new Error(`Token API responded ${response.status} ${response.statusText}`)
  }
  // Every endpoint wraps its payload in a top-level `data` array.
  const body = (await response.json()) as { data?: RawBalance[] }
  return body.data ?? []
}

export const fetchBalances = async (
  who: Address,
  chainId: number,
  options?: { limit?: number },
): Promise<TokenBalance[]> => {
  const network = chainInfo(chainId)?.tokenApiNetwork
  if (!network) return []

  const rows = await get('/balances', {
    network,
    address: who,
    limit: String(options?.limit ?? 50),
  })

  return rows
    .map((row) => decode(row, chainId))
    .filter((balance): balance is TokenBalance => balance !== null && balance.raw > 0n)
    .sort((a, b) => b.amount - a.amount)
}
