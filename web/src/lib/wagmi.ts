import { createConfig, http } from '@wagmi/solid'
import { injected } from '@wagmi/solid/connectors/injected'
import { coinbaseWallet } from '@wagmi/solid/connectors/coinbaseWallet'
import { metaMask } from '@wagmi/solid/connectors/metaMask'
import { safe } from '@wagmi/solid/connectors/safe'
import type { CreateConnectorFn, Transport } from '@wagmi/core'
import type { Chain } from 'viem'
import { CHAINS, READ_ONLY_CHAINS } from './chains'

/**
 * `@wagmi/solid` — the official Solid package, not the community `solid-wagmi`.
 *
 * Worth the swap: it tracks the same `@wagmi/core` version already in use here,
 * it ships the connector set a real connect dialog needs, and it fixes two
 * papercuts the community port had — `useChainId` returned a whole Chain object
 * rather than an id, and the connector list hung off `useDisconnect` instead of
 * having a `useConnectors` of its own.
 */
/*
 * Offerable chains plus read-only ones. The second group exists entirely so
 * `readContract` has a transport for them — Chainlink's live XMR/USD pair is on
 * Optimism, where nothing is deployed. Omitting them builds and typechecks fine
 * and fails at runtime, on the fallback rung of the rate ladder.
 */
const chains = [...CHAINS.map((c) => c.chain), ...READ_ONLY_CHAINS] as [Chain, ...Chain[]]

/**
 * One RPC override per chain, via `VITE_RPC_<chainId>`. Unset falls back to the
 * chain's public endpoint, which is fine for reads and rate-limited for
 * everything else — set them before demoing.
 */
const transports = Object.fromEntries(
  chains.map((c) => [c.id, http(import.meta.env[`VITE_RPC_${c.id}`] as string | undefined)]),
) as Record<number, Transport>

const APP_NAME = 'NoktoSwap'

const connectors: CreateConnectorFn[] = [
  // `injected` is kept alongside `metaMask` deliberately: it picks up whatever
  // EIP-6963 wallet the browser actually announces — Rabby, Frame, Brave — which
  // a MetaMask-specific connector will not.
  injected(),
  metaMask({ dappMetadata: { name: APP_NAME } }),
  coinbaseWallet({ appName: APP_NAME, preference: { options: 'all' } }),
  // Only resolves inside a Safe app frame; harmless everywhere else.
  safe(),
]

export const config = createConfig({ chains, transports, connectors })

declare module '@wagmi/core' {
  interface Register {
    config: typeof config
  }
}
