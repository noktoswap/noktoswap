import { NATIVE } from './chains'
import { POPULAR, type Currency } from './tokens'

/**
 * Token and chain artwork from smold.app.
 *
 * `https://assets.smold.app/token/{chainId}/{address}/logo.svg`, plus
 * `/chain/{chainId}/logo.svg`. Three things about it that the code has to handle
 * rather than assume:
 *
 *   — native currency is keyed by the `0xEeee…EEeE` sentinel, not the zero
 *     address the rest of this app (and Uniswap) uses; the zero address 404s
 *   — chain logos cover Sepolia; token logos do not cover *any* testnet, native
 *     currency included — the host redirects to a jsDelivr mirror of
 *     SmolDapp/tokenAssets, which simply has no testnet directories
 *   — a miss is a 404 serving text/plain, so every <img> needs an error path
 *
 * ── a privacy note, since this is a privacy protocol ────────────────────────
 *
 * Each request tells a third party which token a viewer is looking at. That is
 * far less than the app already reveals by querying a subgraph over HTTPS, and it
 * is never tied to an address — no wallet address appears in any of these URLs.
 * Requests go out with `referrerpolicy="no-referrer"` so the page is not leaked
 * alongside them. Self-hosting the set would remove even this, and is the right
 * move if the app ever stops being a hackathon entry.
 */

const BASE = 'https://assets.smold.app'

/** smold.app's key for a chain's own currency. */
const NATIVE_SENTINEL = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

export const chainLogo = (chainId: number): string => `${BASE}/chain/${chainId}/logo.svg`

const tokenLogo = (chainId: number, address: string): string =>
  `${BASE}/token/${chainId}/${address}/logo.svg`

/**
 * Ordered candidates for a currency's artwork, tried until one loads.
 *
 * The second candidate is what makes testnets look right: there is no artwork for
 * a Sepolia USDC contract, but Sepolia USDC *is* USDC — same issuer, same symbol,
 * same thing a user is trying to recognise. So a testnet token falls back to the
 * mainnet logo for its symbol. That is a labelling convenience and nothing more;
 * no address, amount or route is ever taken from the mainnet entry.
 */
export const logoCandidates = (currency: Currency): string[] => {
  const { address, chainId, symbol } = currency
  if (address === null || chainId === null) return [] // XMR — drawn, not fetched

  const key = (id: number, at: string) =>
    at.toLowerCase() === NATIVE ? tokenLogo(id, NATIVE_SENTINEL) : tokenLogo(id, at)

  // A chain with no artwork at all gets no request. Letting the <img> discover
  // that with a 404 works, but it means every testnet token costs a guaranteed
  // failed round trip and fills the network log with noise that looks like a bug.
  if (COVERED_CHAINS.has(chainId)) return [key(chainId, address)]

  // Testnet: go straight to the mainnet counterpart's artwork, matched by symbol.
  const counterpart = (POPULAR[1] ?? []).find(
    (c) => c.symbol.toUpperCase() === symbol.toUpperCase(),
  )
  return counterpart?.address ? [key(1, counterpart.address)] : []
}

/**
 * Chains the asset host actually has directories for. Testnets are absent, so
 * everything else falls back to a mainnet counterpart rather than asking.
 */
const COVERED_CHAINS = new Set([1, 10, 56, 100, 137, 8453, 42161, 43114, 250, 324, 1101, 59144])

/** Artwork for a bare (chainId, address) pair, where no Currency is to hand. */
export const logoFor = (chainId: number, address: string, symbol = ''): string[] =>
  logoCandidates({ symbol, name: symbol, decimals: 18, address: address as `0x${string}`, chainId })
