import type { Address } from 'viem'
import { NATIVE } from './chains'

/**
 * The token a leg of a trade is denominated in.
 *
 * XMR is modelled as a currency here but it is not an EVM token and never will
 * be: no standard, no address, no chain. That is why the picker pins it above a
 * rule and why `chainId` is null for it — a (chain, token) pair is meaningless
 * on the Monero side.
 */
export type Currency = {
  symbol: string
  name: string
  decimals: number
  /** Null for XMR. `NATIVE` for a chain's own currency. */
  address: Address | null
  /** Null for XMR. */
  chainId: number | null
}

export const XMR: Currency = {
  symbol: 'XMR',
  name: 'Monero',
  decimals: 12,
  address: null,
  chainId: null,
}

export const isXmr = (currency: Currency): boolean => currency.address === null

export const nativeOf = (chainId: number, symbol = 'ETH'): Currency => ({
  symbol,
  name: symbol === 'ETH' ? 'Ethereum' : symbol,
  decimals: 18,
  address: NATIVE,
  chainId,
})

/**
 * A constrained token list, per PLAN.md: at this hour count there is no time for
 * open-ended route discovery, and a fixed list means known routes.
 *
 * This is the *default* set the picker shows under "Popular". Anything a wallet
 * actually holds comes from the Graph Token API, and the wider routable set from
 * Uniswap's `/swappable_tokens` — so the list constrains the happy path without
 * being the only way in.
 */
const erc20 = (
  chainId: number,
  symbol: string,
  name: string,
  decimals: number,
  address: Address,
): Currency => ({ symbol, name, decimals, address, chainId })

export const POPULAR: Record<number, readonly Currency[]> = {
  // Sepolia — the chain the contract is actually deployed on. Short list on
  // purpose: a testnet token with no liquidity is worse than an absent one.
  11155111: [
    nativeOf(11155111),
    erc20(11155111, 'WETH', 'Wrapped Ether', 18, '0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14'),
    erc20(11155111, 'USDC', 'USD Coin', 6, '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238'),
  ],
  1: [
    nativeOf(1),
    erc20(1, 'USDC', 'USD Coin', 6, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'),
    erc20(1, 'USDT', 'Tether USD', 6, '0xdAC17F958D2ee523a2206206994597C13D831ec7'),
    erc20(1, 'DAI', 'Dai Stablecoin', 18, '0x6B175474E89094C44Da98b954EedeAC495271d0F'),
    erc20(1, 'WETH', 'Wrapped Ether', 18, '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'),
  ],
  8453: [
    nativeOf(8453),
    erc20(8453, 'USDC', 'USD Coin', 6, '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'),
    erc20(8453, 'USDT', 'Tether USD', 6, '0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2'),
    erc20(8453, 'DAI', 'Dai Stablecoin', 18, '0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb'),
    erc20(8453, 'WETH', 'Wrapped Ether', 18, '0x4200000000000000000000000000000000000006'),
  ],
  42161: [
    nativeOf(42161),
    erc20(42161, 'USDC', 'USD Coin', 6, '0xaf88d065e77c8cC2239327C5EDb3A432268e5831'),
    erc20(42161, 'USDT', 'Tether USD', 6, '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9'),
    erc20(42161, 'DAI', 'Dai Stablecoin', 18, '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'),
    erc20(42161, 'WETH', 'Wrapped Ether', 18, '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1'),
  ],
  10: [
    nativeOf(10),
    erc20(10, 'USDC', 'USD Coin', 6, '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85'),
    erc20(10, 'USDT', 'Tether USD', 6, '0x94b008aA00579c1307B0EF2c499aD98a8ce58e58'),
    erc20(10, 'DAI', 'Dai Stablecoin', 18, '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1'),
    erc20(10, 'WETH', 'Wrapped Ether', 18, '0x4200000000000000000000000000000000000006'),
  ],
}

export const popularFor = (chainId: number | undefined): readonly Currency[] =>
  (chainId === undefined ? undefined : POPULAR[chainId]) ?? []

export const sameCurrency = (a: Currency, b: Currency): boolean =>
  a.chainId === b.chainId && (a.address ?? 'xmr').toLowerCase() === (b.address ?? 'xmr').toLowerCase()
