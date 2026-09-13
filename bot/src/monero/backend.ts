/**
 * What the bot needs a Monero wallet for, reduced to four operations.
 *
 * Worth being precise about why each exists, because the protocol's asymmetry is
 * easy to get wrong and only two of the four involve spending:
 *
 * `balance` — inventory. The XMR side cannot post an offer it has no coins to
 *   honour, and quoting a size the wallet cannot cover is how a maker ends up
 *   watching its own deposit get refunded.
 *
 * `send` — the XMR side paying into the escrow address, which is the aggregate of
 *   both parties' public spend points. Neither side can spend it alone.
 *
 * `watch` — the EVM side verifying that payment arrived, view-only. This is not
 *   optional courtesy: `ready()` is the EVM side's assertion that the XMR landed,
 *   it must be called before `t0`, and calling it on an escrow that was never
 *   funded hands the counterparty a claim on the ETH. The contract publishes the
 *   XMR side's *private view key* in the clear precisely so this check is
 *   possible without trusting anybody.
 *
 * `sweep` — the EVM side collecting the XMR after the XMR side reveals its
 *   private spend scalar in `claim`. Until that reveal the escrow is unspendable
 *   by design; after it, the two halves sum to the escrow's spend key.
 *
 * So an EVM-side-only bot needs a wallet but no XMR balance, and an XMR-side bot
 * needs both a balance and ETH for the deposit. A two-sided maker needs
 * everything.
 */

export type MoneroBalance = {
  /** Everything the wallet knows about, including funds not yet spendable. */
  total: bigint
  /** What can actually be sent right now. Monero locks change for ~10 blocks. */
  unlocked: bigint
}

export type WatchResult = {
  /** Atomic units credited to the watched address so far. */
  received: bigint
  /** Confirmations on the least-confirmed incoming transfer, or null if none. */
  confirmations: number | null
}

export type MoneroBackend = {
  readonly name: string

  /** Height the backend has scanned to, for a staleness check. Null if unknown. */
  height(): Promise<number | null>

  balance(): Promise<MoneroBalance>

  /**
   * Pay `atomic` piconero to `address`. Returns a txid.
   *
   * Implementations must refuse rather than guess if the wallet cannot cover it —
   * a partial send to an escrow is worse than no send, because the EVM side will
   * not call `ready` and the XMR is then locked behind a key nobody will reveal.
   */
  send(address: string, atomic: bigint): Promise<string>

  /**
   * How much has arrived at an address the wallet does not own, using the view key
   * the contract published.
   *
   * `privateViewKey` and `publicSpendKey` are Monero-style little-endian hex, the
   * form wallets expect — not the big-endian integers the contract stores.
   */
  watch(args: { address: string; privateViewKey: string }): Promise<WatchResult>

  /**
   * Spend an escrow whose private spend scalar is now known, sending everything to
   * `to`. Returns a txid.
   */
  sweep(args: {
    address: string
    privateSpendKey: string
    privateViewKey: string
    to: string
  }): Promise<string>
}

/** 1 XMR = 10^12 piconero. Not 10^18 — a decimals mixup here is a 10^6 error. */
export const XMR_DECIMALS = 12n
export const ONE_XMR = 10n ** XMR_DECIMALS

export const formatXmr = (atomic: bigint, places = 6): string => {
  const negative = atomic < 0n
  const value = negative ? -atomic : atomic
  const whole = value / ONE_XMR
  const frac = (value % ONE_XMR).toString().padStart(Number(XMR_DECIMALS), '0').slice(0, places)
  const trimmed = frac.replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${trimmed ? `.${trimmed}` : ''}`
}

export class MoneroError extends Error {}
