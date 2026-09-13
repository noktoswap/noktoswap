import { privateKeyToAccount } from 'viem/accounts'
import type { Address, Hex } from 'viem'
import { CHAINS, chainInfo, type ChainInfo } from '../../web/src/lib/chains'

/**
 * What the bot is allowed to do, and with how much.
 *
 * This file is mostly refusals, and that is the point. A market maker is a
 * program holding spendable ETH and XMR that opens positions while nobody
 * watches, against a protocol where missing a deadline costs a round trip and a
 * mistyped amount costs the amount. The defaults are therefore the safe ones and
 * every dangerous thing is opt-in:
 *
 *   - dry run unless `--live`, and a dry run still simulates against the real chain
 *   - a per-offer cap and a total-exposure cap, both mandatory in live mode
 *
 * The chain default is mainnet, deliberately: a tool that defaults to a testnet
 * trains you to pass a flag you will later forget to drop. `--testnet` is the
 * switch, and the two caps are what actually stand in the way of a loss.
 *
 * Nothing here reads a key from a command-line flag. Argv is visible in `ps` and
 * lands in shell history, so keys come from the environment only.
 */

export type Mode = 'dry-run' | 'live'

export type Config = {
  mode: Mode
  chain: ChainInfo
  account: ReturnType<typeof privateKeyToAccount>
  rpcUrl: string | undefined
  /** Largest ETH value, in wei, the bot may put behind a single offer. */
  maxOfferWei: bigint
  /** Largest total wei the bot may have at risk across all live positions. */
  maxTotalWei: bigint
  /** Fraction above and below mid to quote, e.g. 0.02 for ±2%. */
  spread: number
  /** How many offers to keep open per side. */
  depth: number
  /** Seconds between strategy passes. */
  interval: number
  monero: MoneroConfig
  /** Where keypairs are persisted. The browser client uses localStorage. */
  keystore: string
}

export type MoneroConfig =
  | { kind: 'manual' }
  | { kind: 'wallet-rpc'; url: string; username?: string; password?: string }

export class ConfigError extends Error {}

const env = (name: string): string | undefined => {
  const value = process.env[name]
  return value === undefined || value.trim() === '' ? undefined : value.trim()
}

/**
 * Parse `--flag value` and `--flag=value`, plus bare `--flag` booleans.
 *
 * Hand-rolled rather than a dependency, because the surface is a dozen flags and
 * an argument parser is one more thing that can quietly reinterpret a number.
 */
export const parseFlags = (argv: readonly string[]): Map<string, string> => {
  const flags = new Map<string, string>()
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] as string
    if (!token.startsWith('--')) continue
    const body = token.slice(2)
    const eq = body.indexOf('=')
    if (eq !== -1) {
      flags.set(body.slice(0, eq), body.slice(eq + 1))
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('--')) {
      flags.set(body, next)
      i++
    } else {
      flags.set(body, 'true')
    }
  }
  return flags
}

/** ETH as a decimal string to wei, without floating point anywhere near it. */
export const parseEthToWei = (text: string): bigint => {
  const match = /^(\d+)(?:\.(\d{1,18}))?$/.exec(text.trim())
  if (!match) throw new ConfigError(`not an ETH amount: ${text}`)
  const whole = BigInt(match[1] as string)
  const frac = BigInt((match[2] ?? '').padEnd(18, '0'))
  return whole * 10n ** 18n + frac
}

/** XMR as a decimal string to piconero. Monero has 12 decimals, not 18. */
export const parseXmrToAtomic = (text: string): bigint => {
  const match = /^(\d+)(?:\.(\d{1,12}))?$/.exec(text.trim())
  if (!match) throw new ConfigError(`not an XMR amount: ${text}`)
  const whole = BigInt(match[1] as string)
  const frac = BigInt((match[2] ?? '').padEnd(12, '0'))
  return whole * 10n ** 12n + frac
}

const DEFAULTS = {
  spread: 0.02,
  depth: 2,
  interval: 60,
  /*
   * Mainnet. The book that matters is the one with real money in it, and a tool
   * whose default is a testnet quietly trains you to pass a flag you will then
   * forget to drop. `--testnet` switches to Sepolia; `--chain <id>` names any
   * deployed chain explicitly.
   *
   * What still stands between this default and a loss is the pair of gates below:
   * nothing is sent without `--live`, and `--live` refuses to start without both
   * exposure caps.
   */
  chainId: 1,
  testnetChainId: 11155111,
}

export const resolveConfig = (flags: Map<string, string>): Config => {
  const mode: Mode = flags.get('live') === 'true' ? 'live' : 'dry-run'

  const explicit = flags.get('chain')
  const wantsTestnet = flags.get('testnet') === 'true'
  if (explicit && wantsTestnet) {
    throw new ConfigError('--chain and --testnet both name a chain; pass one')
  }
  const chainId = Number(explicit ?? (wantsTestnet ? DEFAULTS.testnetChainId : DEFAULTS.chainId))
  const chain = chainInfo(chainId)
  if (!chain) {
    const known = CHAINS.map((c) => `${c.chain.id} (${c.label})`).join(', ')
    throw new ConfigError(`unknown chain ${chainId}. Known: ${known}`)
  }
  if (!chain.deployment) {
    throw new ConfigError(`${chain.label} has no contract deployed — nothing to trade against`)
  }

  const rawKey = env('BOT_PRIVATE_KEY')
  if (!rawKey) {
    throw new ConfigError(
      'BOT_PRIVATE_KEY is not set. Export it rather than passing a flag — argv is visible in `ps`.',
    )
  }
  const hex = (rawKey.startsWith('0x') ? rawKey : `0x${rawKey}`) as Hex
  if (!/^0x[0-9a-fA-F]{64}$/.test(hex)) {
    throw new ConfigError('BOT_PRIVATE_KEY must be 32 bytes of hex')
  }
  const account = privateKeyToAccount(hex)

  /*
   * Caps are mandatory in live mode and there is no default. A default cap is a
   * number nobody chose, which is exactly the wrong property for the one value
   * standing between a strategy bug and the whole balance.
   */
  const offerFlag = flags.get('max-offer-eth')
  const totalFlag = flags.get('max-total-eth')
  if (mode === 'live' && (!offerFlag || !totalFlag)) {
    throw new ConfigError(
      'live mode needs --max-offer-eth and --max-total-eth. No defaults: the cap is the one number that should not be inherited.',
    )
  }
  const maxOfferWei = parseEthToWei(offerFlag ?? '0.01')
  const maxTotalWei = parseEthToWei(totalFlag ?? '0.05')
  if (maxOfferWei > maxTotalWei) {
    throw new ConfigError('--max-offer-eth exceeds --max-total-eth')
  }

  const spread = Number(flags.get('spread') ?? DEFAULTS.spread)
  if (!Number.isFinite(spread) || spread <= 0 || spread >= 1) {
    throw new ConfigError('--spread must be between 0 and 1, e.g. 0.02 for ±2%')
  }
  const depth = Number(flags.get('depth') ?? DEFAULTS.depth)
  if (!Number.isInteger(depth) || depth < 1 || depth > 10) {
    throw new ConfigError('--depth must be a whole number from 1 to 10')
  }
  const interval = Number(flags.get('interval') ?? DEFAULTS.interval)
  if (!Number.isFinite(interval) || interval < 5) {
    throw new ConfigError('--interval must be at least 5 seconds')
  }

  const walletRpc = flags.get('monero-rpc') ?? env('MONERO_WALLET_RPC')
  const monero: MoneroConfig = walletRpc
    ? {
        kind: 'wallet-rpc',
        url: walletRpc,
        ...(env('MONERO_RPC_USER') ? { username: env('MONERO_RPC_USER') as string } : {}),
        ...(env('MONERO_RPC_PASSWORD') ? { password: env('MONERO_RPC_PASSWORD') as string } : {}),
      }
    : { kind: 'manual' }

  return {
    mode,
    chain,
    account,
    rpcUrl: flags.get('rpc') ?? env(`BOT_RPC_${chain.chain.id}`),
    maxOfferWei,
    maxTotalWei,
    spread,
    depth,
    interval,
    monero,
    keystore: flags.get('keystore') ?? env('BOT_KEYSTORE') ?? '.noktoswap-bot/keys',
  }
}

/** The bot's own address, for "is this mine" checks. */
export const selfAddress = (config: Config): Address => config.account.address
