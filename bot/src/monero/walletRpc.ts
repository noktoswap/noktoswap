import { createHash, randomBytes } from 'node:crypto'
import {
  MoneroError,
  type MoneroBackend,
  type MoneroBalance,
  type WatchResult,
} from './backend'

/**
 * `monero-wallet-rpc` over JSON-RPC.
 *
 * Two things about this interface shape the code more than anything else.
 *
 * It is stateful and single-wallet. One daemon holds one open wallet, so watching
 * an escrow — which needs a *different* wallet, built from the counterparty's
 * published view key — means closing the funding wallet, opening a view-only one,
 * scanning, and restoring the original. That is why `watch` and `sweep` both save
 * and restore, and why they are careful to do so even when they throw.
 *
 * And it defaults to HTTP digest authentication, so the client below implements
 * digest rather than assuming `--disable-rpc-login`. A wallet daemon holding
 * spendable funds with authentication switched off is the kind of convenience
 * that reads fine until the port is reachable.
 */

type RpcError = { code: number; message: string }

export type WalletRpcOptions = {
  url: string
  username?: string
  password?: string
  /** Wallet to reopen after a watch or sweep borrowed the slot. */
  fundingWallet?: string
  fundingPassword?: string
}

/**
 * RFC 2617 digest, the subset monero-wallet-rpc uses (MD5, qop=auth).
 *
 * MD5 is not a choice here — it is what the server asks for — and it is
 * authenticating a localhost RPC rather than protecting a secret at rest.
 */
const digestHeader = (
  challenge: string,
  method: string,
  uri: string,
  username: string,
  password: string,
  nc: number,
): string => {
  const field = (name: string): string => {
    const quoted = new RegExp(`${name}="([^"]*)"`).exec(challenge)
    if (quoted) return quoted[1] as string
    const bare = new RegExp(`${name}=([^,\\s]+)`).exec(challenge)
    return bare ? (bare[1] as string) : ''
  }
  const md5 = (input: string) => createHash('md5').update(input).digest('hex')

  const realm = field('realm')
  const nonce = field('nonce')
  const opaque = field('opaque')
  const qop = field('qop').split(',')[0]?.trim() || 'auth'
  const cnonce = randomBytes(8).toString('hex')
  const ncValue = nc.toString(16).padStart(8, '0')

  const ha1 = md5(`${username}:${realm}:${password}`)
  const ha2 = md5(`${method}:${uri}`)
  const response = md5(`${ha1}:${nonce}:${ncValue}:${cnonce}:${qop}:${ha2}`)

  const parts = [
    `username="${username}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `qop=${qop}`,
    `nc=${ncValue}`,
    `cnonce="${cnonce}"`,
    `response="${response}"`,
  ]
  if (opaque) parts.push(`opaque="${opaque}"`)
  return `Digest ${parts.join(', ')}`
}

export class WalletRpc implements MoneroBackend {
  readonly name = 'monero-wallet-rpc'
  private nc = 0
  private readonly path: string

  constructor(private readonly options: WalletRpcOptions) {
    this.path = new URL(this.endpoint).pathname
  }

  private get endpoint(): string {
    const base = this.options.url.replace(/\/+$/, '')
    return base.endsWith('/json_rpc') ? base : `${base}/json_rpc`
  }

  private async call<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
    const body = JSON.stringify({ jsonrpc: '2.0', id: '0', method, params })
    const headers: Record<string, string> = { 'content-type': 'application/json' }

    let response = await fetch(this.endpoint, { method: 'POST', headers, body })

    // Digest is a two-step handshake: the first request is expected to 401.
    if (response.status === 401 && this.options.username !== undefined) {
      const challenge = response.headers.get('www-authenticate') ?? ''
      this.nc += 1
      headers['authorization'] = digestHeader(
        challenge,
        'POST',
        this.path,
        this.options.username,
        this.options.password ?? '',
        this.nc,
      )
      response = await fetch(this.endpoint, { method: 'POST', headers, body })
    }

    if (!response.ok) {
      throw new MoneroError(
        `${method}: HTTP ${response.status}${
          response.status === 401 ? ' — wallet RPC wants credentials (MONERO_RPC_USER / MONERO_RPC_PASSWORD)' : ''
        }`,
      )
    }

    const payload = (await response.json()) as { result?: T; error?: RpcError }
    if (payload.error) {
      throw new MoneroError(`${method}: ${payload.error.message} (code ${payload.error.code})`)
    }
    if (payload.result === undefined) throw new MoneroError(`${method}: empty result`)
    return payload.result
  }

  async height(): Promise<number | null> {
    try {
      const r = await this.call<{ height: number }>('get_height')
      return r.height
    } catch {
      return null
    }
  }

  async balance(): Promise<MoneroBalance> {
    const r = await this.call<{ balance: number | string; unlocked_balance: number | string }>(
      'get_balance',
      { account_index: 0 },
    )
    return { total: BigInt(r.balance), unlocked: BigInt(r.unlocked_balance) }
  }

  async send(address: string, atomic: bigint): Promise<string> {
    const { unlocked } = await this.balance()
    if (unlocked < atomic) {
      /*
       * Refuse rather than let the daemon send what it can. A short payment to an
       * escrow is the worst outcome available: the EVM side will not call `ready`
       * on an underfunded escrow, and the coins are then behind a spend key whose
       * other half nobody has a reason to reveal.
       */
      throw new MoneroError(
        `wallet has ${unlocked} atomic unlocked, needs ${atomic}. Refusing a partial escrow payment.`,
      )
    }
    const r = await this.call<{ tx_hash: string }>('transfer', {
      destinations: [{ address, amount: Number(atomic) }],
      account_index: 0,
      priority: 1,
      get_tx_key: true,
    })
    return r.tx_hash
  }

  /**
   * Open a view-only wallet for the escrow, scan, and report what arrived.
   *
   * `restore_height` is deliberately not set to 0: a full rescan from genesis on
   * mainnet takes hours, and the escrow cannot predate the offer. Callers pass the
   * address only, so this uses the daemon's current height minus a margin.
   */
  async watch({
    address,
    privateViewKey,
  }: {
    address: string
    privateViewKey: string
  }): Promise<WatchResult> {
    const label = `escrow-view-${address.slice(0, 12)}`
    return this.withBorrowedSlot(async () => {
      await this.openOrCreateFromKeys({ label, address, viewKey: privateViewKey })
      await this.call('refresh', {})
      const transfers = await this.call<{
        in?: { amount: number | string; confirmations?: number }[]
      }>('get_transfers', { in: true, pending: true, pool: true })
      const incoming = transfers.in ?? []
      const received = incoming.reduce((sum, t) => sum + BigInt(t.amount), 0n)
      const confirmations = incoming.length
        ? Math.min(...incoming.map((t) => t.confirmations ?? 0))
        : null
      return { received, confirmations }
    })
  }

  async sweep({
    address,
    privateSpendKey,
    privateViewKey,
    to,
  }: {
    address: string
    privateSpendKey: string
    privateViewKey: string
    to: string
  }): Promise<string> {
    const label = `escrow-spend-${address.slice(0, 12)}`
    return this.withBorrowedSlot(async () => {
      await this.openOrCreateFromKeys({
        label,
        address,
        viewKey: privateViewKey,
        spendKey: privateSpendKey,
      })
      await this.call('refresh', {})
      const r = await this.call<{ tx_hash_list?: string[] }>('sweep_all', {
        address: to,
        account_index: 0,
        priority: 1,
      })
      const hash = r.tx_hash_list?.[0]
      if (!hash) throw new MoneroError('sweep_all returned no transaction — is the escrow funded and unlocked?')
      return hash
    })
  }

  /**
   * The daemon holds one wallet at a time, so anything needing a different one has
   * to put the original back — including on failure, or a crashed watch leaves the
   * bot unable to fund its next offer.
   */
  private async withBorrowedSlot<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work()
    } finally {
      const wallet = this.options.fundingWallet
      if (wallet) {
        try {
          await this.call('close_wallet', {})
        } catch {
          /* nothing was open */
        }
        try {
          await this.call('open_wallet', {
            filename: wallet,
            password: this.options.fundingPassword ?? '',
          })
        } catch (cause) {
          // Loud, because the next `send` will fail confusingly otherwise.
          process.stderr.write(
            `! could not reopen funding wallet ${wallet}: ${
              cause instanceof Error ? cause.message : String(cause)
            }\n`,
          )
        }
      }
    }
  }

  private async openOrCreateFromKeys(args: {
    label: string
    address: string
    viewKey: string
    spendKey?: string
  }): Promise<void> {
    try {
      await this.call('close_wallet', {})
    } catch {
      /* nothing open */
    }
    try {
      await this.call('open_wallet', { filename: args.label, password: '' })
      return
    } catch {
      /* not created yet — fall through */
    }
    const height = (await this.height()) ?? 0
    await this.call('generate_from_keys', {
      filename: args.label,
      address: args.address,
      viewkey: args.viewKey,
      ...(args.spendKey ? { spendkey: args.spendKey } : {}),
      password: '',
      // A margin below current height: the escrow is newer than this, and a scan
      // from genesis is hours of work for an address that cannot hold old outputs.
      restore_height: Math.max(0, height - 5_000),
      autosave_current: true,
    })
  }
}
