import { getBalance, multicall } from '@wagmi/core'
import { erc20Abi, type Address } from 'viem'
import { CHAINS, NATIVE } from './chains'
import type { Currency } from './tokens'
import { config } from './wagmi'

/**
 * Balances read straight off the chain, via Multicall3.
 *
 * ── why this exists alongside the Token API ─────────────────────────────────
 *
 * The Graph Token API answers a question only an indexer can: *which* tokens does
 * this address hold, out of all tokens that exist. That is discovery, and it is
 * worth an API. But its networks are mainnets only, and the contract is deployed
 * on Sepolia — so on the home chain it returns nothing at all.
 *
 * Uniswap does not fill that hole: the Trading API has no balances endpoint.
 * Every mention of "balance" in its spec is either an input you supply
 * (`nativeTokenBalance`, for wrap maths) or an error code. `/tokens` returns
 * metadata and TVL rankings and does not even take an address.
 *
 * So the hole is filled by the chain itself. Multicall3 is at the same address on
 * all five configured chains — Sepolia included — and the token list is
 * deliberately constrained, so "what do you hold, of these" is one RPC round trip
 * with no key, no CORS, and no third party to be down.
 *
 * The two are complements, not alternatives, and both are used:
 *
 *   discovery  — Token API, mainnets only, finds tokens not on any list
 *   truth      — this module, every chain, exact and current
 *
 * Where they overlap, this module wins: it is a direct read at head rather than
 * an indexed one, so it cannot be stale.
 */

export type OnchainBalance = {
  currency: Currency
  raw: bigint
}

/**
 * Balances for a known set of currencies. `allowFailure` keeps one bad contract
 * from taking the batch down — a token that does not implement `balanceOf` should
 * be absent from the list, not fatal to it.
 */
export const fetchOnchainBalances = async (
  who: Address,
  chainId: number,
  currencies: readonly Currency[],
): Promise<OnchainBalance[]> => {
  const tokens = currencies.filter(
    (currency): currency is Currency & { address: Address } =>
      currency.address !== null && currency.address !== NATIVE,
  )
  const wantsNative = currencies.some((currency) => currency.address === NATIVE)

  const [native, results] = await Promise.all([
    wantsNative
      ? getBalance(config, { address: who, chainId }).catch(() => null)
      : Promise.resolve(null),
    tokens.length > 0
      ? multicall(config, {
          chainId,
          allowFailure: true,
          contracts: tokens.map((token) => ({
            abi: erc20Abi,
            address: token.address,
            functionName: 'balanceOf' as const,
            args: [who] as const,
          })),
        })
      : Promise.resolve([]),
  ])

  const out: OnchainBalance[] = []

  if (native && native.value > 0n) {
    const currency = currencies.find((c) => c.address === NATIVE)
    if (currency) out.push({ currency, raw: native.value })
  }

  results.forEach((result, index) => {
    const currency = tokens[index]
    if (!currency || result.status !== 'success') return
    const raw = result.result as bigint
    if (raw > 0n) out.push({ currency, raw })
  })

  return out
}

/**
 * Native balance per chain, for the chain picker's "where is my money" column.
 *
 * One `getBalance` per chain rather than a multicall — Multicall3 cannot span
 * chains, and these are cheap. Failures are isolated so one unreachable RPC does
 * not blank out the chains that answered; an absent entry means "unknown", which
 * the picker renders differently from a real zero.
 */
export const fetchNativeAcrossChains = async (
  who: Address,
  chainIds: readonly number[] = CHAINS.map((c) => c.chain.id),
): Promise<Map<number, bigint>> => {
  const results = await Promise.allSettled(
    chainIds.map(async (chainId) => {
      const balance = await getBalance(config, { address: who, chainId })
      return [chainId, balance.value] as const
    }),
  )

  const out = new Map<number, bigint>()
  for (const result of results) {
    if (result.status === 'fulfilled') out.set(result.value[0], result.value[1])
  }
  return out
}
