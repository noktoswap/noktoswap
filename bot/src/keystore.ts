import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fromMnemonic, type Keypair } from '../../web/src/lib/keys'

/**
 * Where the private halves live between the two transactions that need them.
 *
 * This is the sharpest edge in the protocol, and the browser client says so about
 * its own storage: the scalar generated when an offer is opened or taken is the
 * only thing that can later `claim` or `quit`, and losing it loses the trade —
 * the ETH sits in escrow until a deadline refunds it, and any XMR already sent to
 * the escrow is gone for good, because spending it needs both halves.
 *
 * A bot cannot use the client's `localStorage` keystore, so this is the file
 * equivalent, with three differences that matter for an unattended process:
 *
 * Only the mnemonic is written. Everything else in a `Keypair` is derived from
 * it, and storing derived values invites a file that disagrees with itself.
 *
 * Writes are atomic — a temporary file renamed into place — because the process
 * may be killed at any moment, and a half-written key is indistinguishable from a
 * lost one.
 *
 * The file is `0600` and the directory `0700`. This is a seed phrase controlling
 * real funds; a group-readable key file is a mistake you only make once.
 */

export type Record = {
  mnemonic: string
  /** `open` or `take` — which role the keys were generated for. */
  role: 'open' | 'take'
  offerKind: 'BUY' | 'SELL'
  chainId: number
  /** Set once the chain has assigned an id. */
  offerId: string | null
  createdAt: number
  /*
   * Local facts the chain does not record, and which the bot would otherwise
   * repeat. Paying an escrow twice is a real risk: the contract knows nothing
   * about Monero, so nothing on-chain stops a restarted bot from funding the same
   * escrow again.
   */
  xmrSentTxid?: string | null
  sweptTxid?: string | null
}

export class Keystore {
  constructor(private readonly dir: string) {}

  private path(ref: string): string {
    return join(this.dir, `${ref}.json`)
  }

  private ensureDir(): void {
    if (!existsSync(this.dir)) mkdirSync(this.dir, { recursive: true, mode: 0o700 })
    try {
      chmodSync(this.dir, 0o700)
    } catch {
      /* a filesystem without POSIX modes; the write below still succeeds */
    }
  }

  /**
   * `ref` is a caller-chosen name. Offers are keyed `<chainId>-<offerId>` once the
   * id is known, and `<chainId>-draft-<timestamp>` before that — ids restart at 1
   * on every deployment, so the chain has to be in the name or two chains collide
   * on offer #1.
   */
  put(ref: string, record: Record): void {
    this.ensureDir()
    const target = this.path(ref)
    const temp = `${target}.tmp`
    writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 })
    try {
      chmodSync(temp, 0o600)
    } catch {
      /* see ensureDir */
    }
    // Atomic on the same filesystem: either the old file or the new one, never half.
    renameSync(temp, target)
  }

  get(ref: string): { record: Record; pair: Keypair } | null {
    const path = this.path(ref)
    if (!existsSync(path)) return null
    const record = JSON.parse(readFileSync(path, 'utf8')) as Record
    return { record, pair: fromMnemonic(record.mnemonic) }
  }

  /** Attach a chain-assigned id to a draft, renaming the file to match. */
  claimId(draftRef: string, offerId: bigint, chainId: number): string {
    const found = this.get(draftRef)
    if (!found) throw new Error(`no stored keys under ${draftRef}`)
    const ref = `${chainId}-${offerId}`
    this.put(ref, { ...found.record, offerId: offerId.toString() })
    // The draft stays. A duplicate costs nothing; a missing key costs the trade.
    return ref
  }

  /**
   * Merge fields into an existing record.
   *
   * Read-modify-write rather than a partial file, and it goes through `put`, so the
   * write stays atomic. There is no locking: one bot process per keystore is the
   * assumption, and two processes trading the same offers would be a worse problem
   * than a torn file.
   */
  patch(ref: string, fields: Partial<Record>): void {
    const found = this.get(ref)
    if (!found) throw new Error(`no stored keys under ${ref}`)
    this.put(ref, { ...found.record, ...fields })
  }

  list(): { ref: string; record: Record }[] {
    if (!existsSync(this.dir)) return []
    return readdirSync(this.dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => {
        const ref = name.slice(0, -'.json'.length)
        return { ref, record: JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as Record }
      })
      .sort((a, b) => a.record.createdAt - b.record.createdAt)
  }

  /** For the operator to write down. The only thing that survives losing this dir. */
  backup(): string {
    const lines = this.list().map(
      ({ ref, record }) =>
        `${ref}\t${record.offerKind}\t${record.role}\tchain ${record.chainId}\t${record.mnemonic}`,
    )
    return lines.join('\n')
  }

  get directory(): string {
    return this.dir
  }

  get parent(): string {
    return dirname(this.dir)
  }
}
