import { ed25519 } from '@noble/curves/ed25519.js'
import { generateMnemonic, english } from 'viem/accounts'
import { deriveMoneroKeys, toMoneroKeyHex, ED25519_L } from './monero'

/**
 * Monero key material, in the encoding the contract actually checks.
 *
 * ── the encoding, because getting it wrong is silent ────────────────────────
 *
 * `Ed25519.compressPointLittleEndian` is `changeEndianness(y) | ((x & 1) << 7)`.
 * Work that through byte by byte and it is the standard 32-byte RFC 8032 /
 * Monero compressed encoding — little-endian y with the sign bit in the top bit
 * of byte 31 — *read as a big-endian integer*. So:
 *
 *   point  as uint256 = BE integer of the 32 compressed bytes
 *   scalar as uint256 = the scalar as a plain integer (< l)
 *
 * Those are two different conventions in the same ABI, and the contract expects
 * each in a specific argument. `openOffer` and `take` each want one of each,
 * and which one flips with the offer kind — hence `keysForOpen` / `keysForTake`
 * below rather than callers assembling arguments themselves.
 *
 * ── where the Monero side lives ─────────────────────────────────────────────
 *
 * `./monero.ts` — ported from upstream, and the reason address derivation is no
 * longer a gap. This file owns the *contract* encoding; that one owns Monero's,
 * including the byte-order difference between them. Keys here are derived from a
 * BIP-39 seed phrase rather than drawn as a bare scalar, so a trade survives a
 * cleared browser.
 */

const L = ED25519_L
const Point = ed25519.Point

const bytesToBigIntBE = (bytes: Uint8Array): bigint => {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

const bigIntToBytesLE = (value: bigint, length = 32): Uint8Array => {
  const out = new Uint8Array(length)
  let rest = value
  for (let i = 0; i < length; i += 1) {
    out[i] = Number(rest & 0xffn)
    rest >>= 8n
  }
  return out
}

/** A compressed point as the contract wants it: BE integer of the 32 bytes. */
export const pointToUint256 = (scalar: bigint): bigint =>
  bytesToBigIntBE(Point.BASE.multiply(scalar).toBytes())

/**
 * A Monero keypair for one side of one escrow, plus the phrase it came from.
 *
 * The phrase is the point. A bare random scalar can only ever live in the browser
 * that drew it, so "clear site data" and "lose the trade" were the same action.
 * Twelve words can be written down, and `deriveMoneroKeys` regenerates both keys
 * from them — matching upstream's BIP-44 path so the same phrase restores the
 * same wallet in either client.
 */
export type Keypair = {
  /** BIP-39 phrase. The only thing that actually needs backing up. */
  mnemonic: string
  privateSpend: bigint
  privateView: bigint
  publicSpend: bigint
  publicView: bigint
}

export const fromMnemonic = (mnemonic: string): Keypair => {
  const keys = deriveMoneroKeys(mnemonic)
  return {
    mnemonic: mnemonic.trim(),
    privateSpend: keys.privateSpendKey,
    privateView: keys.privateViewKey,
    publicSpend: keys.publicSpendKey,
    publicView: keys.publicViewKey,
  }
}

export const generateKeypair = (): Keypair => fromMnemonic(generateMnemonic(english))

/** Does this scalar open that committed point? The check `claim`/`quit` make. */
export const proves = (scalar: bigint, committedPoint: bigint): boolean =>
  scalar > 0n && scalar < L && pointToUint256(scalar) === committedPoint

const Q = 2n ** 255n - 19n

/**
 * Recover y from a compressed point, the way the contract does.
 *
 * `Ed25519.requireCanonicalPoint` computes `changeEndianness(compressed & ~0x80)`,
 * and `changeEndianness` reverses the 32 bytes of a big-endian uint256. Taking
 * the little-endian bytes and reading them as big-endian *is* that reversal — so
 * there is no second `.reverse()` here, and adding one silently returns the input
 * unchanged. That mistake rejects roughly half of all valid points.
 */
const yOf = (compressed: bigint): bigint => bytesToBigIntBE(bigIntToBytesLE(compressed & ~0x80n))

/**
 * The contract rejects compressed points it could never produce — y >= q, or
 * y <= 1 (the identity and a small-order point). Mirror that client-side so a
 * bad draw is caught before a wallet prompt rather than after one.
 */
export const isCanonicalPoint = (compressed: bigint): boolean => {
  const y = yOf(compressed)
  return y < Q && y > 1n
}

export const generateCanonicalKeypair = (): Keypair => {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const pair = generateKeypair()
    if (isCanonicalPoint(pair.publicSpend) && isCanonicalPoint(pair.publicView)) return pair
  }
  throw new Error('could not draw a canonical keypair')
}

// ── the two call shapes the contract expects ────────────────────────────────

/**
 * `openOffer(kind, xmrAmount, counterparty, spendingKey, viewingKey)`.
 *
 * BUY  — the maker is the EVM side and commits two *public* keys.
 * SELL — the maker is the XMR side: a public spend point, and its *private*
 *        view scalar in the clear, so the counterparty can watch the escrow.
 */
export const keysForOpen = (
  kind: 'BUY' | 'SELL',
  pair: Keypair,
): { spendingKey: bigint; viewingKey: bigint } =>
  kind === 'BUY'
    ? { spendingKey: pair.publicSpend, viewingKey: pair.publicView }
    : { spendingKey: pair.publicSpend, viewingKey: pair.privateView }

/**
 * `take(offerId, spendingKey, viewingKey)`, where the taker's role is the
 * opposite of the maker's.
 *
 * Taking a BUY makes you the XMR side — private view key in the clear.
 * Taking a SELL makes you the EVM side — public view point.
 */
export const keysForTake = (
  offerKind: 'BUY' | 'SELL',
  pair: Keypair,
): { spendingKey: bigint; viewingKey: bigint } =>
  offerKind === 'BUY'
    ? { spendingKey: pair.publicSpend, viewingKey: pair.privateView }
    : { spendingKey: pair.publicSpend, viewingKey: pair.publicView }

/**
 * `quit(offerId, spendingKey, viewingKey)` — publishing to exit.
 *
 * The XMR side has no view key to publish (it already did, in the clear), so it
 * passes zero. The EVM side publishes both private scalars.
 */
export const keysForQuit = (
  side: 'evm' | 'xmr',
  pair: Keypair,
): { spendingKey: bigint; viewingKey: bigint } =>
  side === 'xmr'
    ? { spendingKey: pair.privateSpend, viewingKey: 0n }
    : { spendingKey: pair.privateSpend, viewingKey: pair.privateView }

// ── persistence ─────────────────────────────────────────────────────────────

/**
 * Where the private halves live between the two transactions that need them.
 *
 * This is the sharpest edge in the whole app: the scalar generated at `take`
 * time is the only thing that can later call `claim`, and losing it loses the
 * trade. localStorage is per-browser and per-origin — it survives a reload and
 * nothing else. So every write is paired with a backup the user can export, and
 * the UI says what clearing site data would cost.
 */
const STORAGE_PREFIX = 'noktoswap.keys.v1'

type StoredKeypair = {
  /** Everything else is derivable from this; the rest is cached for speed. */
  mnemonic: string
  privateSpend: string
  privateView: string
  publicSpend: string
  publicView: string
  createdAt: number
}

const key = (chainId: number, ref: string) => `${STORAGE_PREFIX}.${chainId}.${ref}`

export const saveKeypair = (chainId: number, ref: string, pair: Keypair): void => {
  const record: StoredKeypair = {
    mnemonic: pair.mnemonic,
    privateSpend: pair.privateSpend.toString(16),
    privateView: pair.privateView.toString(16),
    publicSpend: pair.publicSpend.toString(16),
    publicView: pair.publicView.toString(16),
    createdAt: Date.now(),
  }
  try {
    localStorage.setItem(key(chainId, ref), JSON.stringify(record))
  } catch {
    // Private window, or site data blocked. The caller must surface this —
    // proceeding without a stored key is how a trade becomes unclaimable.
    throw new Error('could not store the escrow key in this browser')
  }
}

export const loadKeypair = (chainId: number, ref: string): Keypair | null => {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(key(chainId, ref))
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const record = JSON.parse(raw) as StoredKeypair
    // Re-derive from the phrase where there is one, so a record written by an
    // older build (or a hand-edited one) cannot disagree with itself.
    if (record.mnemonic) return fromMnemonic(record.mnemonic)
    return {
      mnemonic: '',
      privateSpend: BigInt(`0x${record.privateSpend}`),
      privateView: BigInt(`0x${record.privateView}`),
      publicSpend: BigInt(`0x${record.publicSpend}`),
      publicView: BigInt(`0x${record.publicView}`),
    }
  } catch {
    return null
  }
}

/**
 * Re-key a pair stored under a provisional reference once the offer id exists.
 *
 * `openOffer` and `take` both need the keys *before* the chain assigns or
 * confirms anything, so they are written under a draft reference and moved here.
 */
export const rekeyKeypair = (chainId: number, from: string, to: string): void => {
  const pair = loadKeypair(chainId, from)
  if (!pair) return
  saveKeypair(chainId, to, pair)
  try {
    localStorage.removeItem(key(chainId, from))
  } catch {
    /* nothing to do — the copy under `to` is what matters */
  }
}

/**
 * A backup a human can act on.
 *
 * Keys are written in Monero's own byte order, not the contract's — the two
 * differ, and a 64-character string in the wrong one pastes cleanly into a wallet
 * and restores something else entirely. The seed phrase comes first because it is
 * the only line that has to survive.
 */
export const exportKeypair = (pair: Keypair, label: string): string =>
  [
    `# Noktoswap escrow key — ${label}`,
    '#',
    '# The seed phrase below regenerates every key here. It is the only thing',
    '# that can settle this trade, and anyone holding it can spend the escrowed',
    '# XMR once the trade completes. Keep it like cash.',
    '#',
    '# Key hex is little-endian, as Monero wallets expect.',
    '',
    `seed_phrase       = ${pair.mnemonic}`,
    '',
    `private_spend_key = ${toMoneroKeyHex(pair.privateSpend)}`,
    `private_view_key  = ${toMoneroKeyHex(pair.privateView)}`,
    '',
  ].join('\n')
