/*
 * Monero key and address handling.
 *
 * ── provenance ──────────────────────────────────────────────────────────────
 *
 * Ported from `lib/src/` of https://github.com/v3xlabs/xmrp2p, which is
 * **pre-existing work** that predates this event and is licensed **LGPL-3.0**.
 * That licence travels with this file: it is LGPL-3.0 while the rest of this
 * repository is MIT, and the two are kept distinct on purpose rather than
 * blended. `../../README.md` records the boundary; `computeEscrowWallet`,
 * `encodeMoneroAddress`, `base58encode`, `combinePrivateKeys`, `toMoneroKeyHex`
 * and the wallet-URI builders are theirs, restated here against the crypto
 * primitives this app already depends on so that no extra package is pulled in.
 *
 * Upstream publishes it as a private workspace package, so there is nothing to
 * depend on — the `xmrp2p` name on npm is an unrelated empty 0.0.1 placeholder
 * with no repository and no exports, and installing it would be a supply-chain
 * risk rather than a shortcut.
 *
 * ── why porting this matters more than it looks ─────────────────────────────
 *
 * Two things here are load-bearing and were wrong or missing before:
 *
 * **Byte order.** The contract stores keys as big-endian integers of a compressed
 * point. Monero wallets expect the *little-endian* 32-byte hex. Showing a user
 * the contract's integer and calling it a key hands them something that looks
 * right, pastes cleanly, and restores the wrong wallet. `toMoneroKeyHex` is the
 * conversion, and it is the difference between a recoverable trade and lost coins.
 *
 * **Address derivation.** The escrow address is the aggregate of both sides'
 * points, and nothing on-chain validates it — a wrong byte sends the XMR
 * somewhere no one can reach. This is upstream's tested implementation rather
 * than a fresh one written from the spec, which is the entire reason to port.
 */

import { ed25519 } from '@noble/curves/ed25519.js'
import { keccak_256 } from '@noble/hashes/sha3.js'
import { mnemonicToAccount } from 'viem/accounts'

const Point = ed25519.Point

/** The ed25519 group order. Scalars live in [1, L). */
export const ED25519_L = 2n ** 252n + 27_742_317_777_372_353_535_851_937_790_883_648_493n

/** Monero's coin type under BIP-44. */
const SPEND_KEY_PATH = "m/44'/128'/0'/0/0"

const MONERO_MAINNET_PREFIX = '12'
const MONERO_STAGENET_PREFIX = '18'

// ── byte-order plumbing ─────────────────────────────────────────────────────

const toBytesLE = (value: bigint, length = 32): Uint8Array => {
  const out = new Uint8Array(length)
  let rest = value
  for (let i = 0; i < length; i += 1) {
    out[i] = Number(rest & 0xffn)
    rest >>= 8n
  }
  return out
}

const fromBytesBE = (bytes: Uint8Array): bigint => {
  let value = 0n
  for (const byte of bytes) value = (value << 8n) | BigInt(byte)
  return value
}

const fromBytesLE = (bytes: Uint8Array): bigint => {
  let value = 0n
  for (let i = bytes.length - 1; i >= 0; i -= 1) value = (value << 8n) | BigInt(bytes[i]!)
  return value
}

/**
 * A key as a Monero wallet wants to read it: little-endian 32-byte hex.
 *
 * The contract's uint256 is the big-endian integer of the same 32 bytes, so this
 * is a byte reversal and nothing more — but getting it backwards produces a
 * plausible-looking 64-hex string that restores a different wallet entirely.
 */
export const toMoneroKeyHex = (key: bigint): string => {
  const hex = key.toString(16).padStart(64, '0')
  const pairs: string[] = []
  for (let i = 0; i < hex.length; i += 2) pairs.push(hex.slice(i, i + 2))
  return pairs.reverse().join('')
}

/** The point encoding the contract checks: BE integer of the compressed bytes. */
const pointToUint256 = (scalar: bigint): bigint => fromBytesBE(Point.BASE.multiply(scalar).toBytes())

const uint256ToPoint = (value: bigint) => Point.fromBytes(toBytesLE(value).reverse())

// ── key generation ──────────────────────────────────────────────────────────

export type MoneroKeys = {
  privateSpendKey: bigint
  privateViewKey: bigint
  publicSpendKey: bigint
  publicViewKey: bigint
}

/**
 * Derive a Monero keypair from a BIP-39 seed phrase.
 *
 * A restorable seed rather than a bare random scalar, which is the practical
 * difference between "your browser holds the only copy" and "write these twelve
 * words down". The view key follows Monero's own derivation —
 * `sc_reduce32(keccak256(spend key))` over the little-endian representation — so
 * a wallet restored from the spend key alone regenerates the same view key.
 */
export const deriveMoneroKeys = (seedphrase: string): MoneroKeys => {
  const hd = mnemonicToAccount(seedphrase.trim(), { path: SPEND_KEY_PATH as never }).getHdKey()
  const raw = hd.privateKey
  if (!raw) throw new Error('seed phrase produced no private key')

  const privateSpendKey = fromBytesBE(raw) % ED25519_L
  // keccak over the *little-endian* spend key, read back little-endian.
  const privateViewKey = fromBytesLE(keccak_256(toBytesLE(privateSpendKey))) % ED25519_L

  return {
    privateSpendKey,
    privateViewKey,
    publicSpendKey: pointToUint256(privateSpendKey),
    publicViewKey: pointToUint256(privateViewKey),
  }
}

/** Scalar addition mod L — how two halves become the escrow's spend key. */
export const combinePrivateKeys = (a: bigint, b: bigint): bigint => (a + b) % ED25519_L

// ── the escrow wallet ───────────────────────────────────────────────────────

/**
 * The shared address both sides committed to.
 *
 * Spend side: the two public spend points added. Neither party can spend alone —
 * that is the whole escrow.
 *
 * View side: the EVM party's public view point plus the point derived from the
 * XMR party's *private* view key, which the contract publishes in the clear
 * precisely so the EVM side can watch the address before confirming.
 */
export const computeEscrowWallet = (keys: {
  evmPublicSpendKey: bigint
  evmPublicViewKey: bigint
  xmrPublicSpendKey: bigint
  xmrPrivateViewKey: bigint
}): { publicSpendKey: bigint; publicViewKey: bigint } => {
  const xmrViewPoint = Point.BASE.multiply(keys.xmrPrivateViewKey)
  const viewPoint = uint256ToPoint(keys.evmPublicViewKey).add(xmrViewPoint)
  const spendPoint = uint256ToPoint(keys.evmPublicSpendKey).add(
    uint256ToPoint(keys.xmrPublicSpendKey),
  )

  return {
    publicSpendKey: fromBytesBE(spendPoint.toBytes()),
    publicViewKey: fromBytesBE(viewPoint.toBytes()),
  }
}

/** Monero's base58 — a distinct alphabet and, below, a distinct block scheme. */
export const base58encode = (bytes: Uint8Array): string => {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const base = BigInt(alphabet.length)

  let leadingZeros = 0
  for (let i = 0; i < bytes.length && bytes[i] === 0; i += 1) leadingZeros += 1

  let value = 0n
  for (const byte of bytes) value = (value << 8n) + BigInt(byte)

  let result = ''
  while (value > 0n) {
    result = alphabet[Number(value % base)] + result
    value /= base
  }

  return '1'.repeat(leadingZeros) + result
}

const hexToBytes = (hex: string): Uint8Array => {
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

/**
 * Encode a Monero address: network byte, spend key, view key, checksum.
 *
 * Monero does not base58 the whole payload — it does so in 8-byte blocks padded
 * to 11 characters (and a 5-byte tail padded to 7), which is why this cannot
 * reuse a generic base58 implementation.
 */
export const encodeMoneroAddress = (
  publicSpendKey: bigint,
  publicViewKey: bigint,
  mainnet: boolean,
): string => {
  let hex = mainnet ? MONERO_MAINNET_PREFIX : MONERO_STAGENET_PREFIX
  hex += publicSpendKey.toString(16).padStart(64, '0')
  hex += publicViewKey.toString(16).padStart(64, '0')

  // First four bytes of the keccak over everything so far.
  const checksum = keccak_256(hexToBytes(hex))
  hex += Array.from(checksum.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  const bytes = hexToBytes(hex)
  let address = ''
  for (let offset = 0; offset < bytes.length; offset += 8) {
    const block = bytes.slice(offset, offset + 8)
    let encoded = base58encode(block)
    const width = block.length === 8 ? 11 : block.length === 5 ? 7 : encoded.length
    while (encoded.length < width) encoded = `1${encoded}`
    address += encoded
  }

  return address
}

/**
 * The inverse, for verifying an encode rather than for parsing user input.
 *
 * An address is the one artefact here that nothing on-chain validates, so the
 * encoder is checked by decoding its own output and re-deriving the checksum.
 * That is a materially stronger test than eyeballing a 95-character string, and
 * it is why this exists at all.
 */
export const decodeMoneroAddress = (address: string): string => {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
  const base = BigInt(alphabet.length)

  let hex = ''
  for (let offset = 0; offset < address.length; offset += 11) {
    const block = address.slice(offset, offset + 11)
    // Monero's block scheme: 11 characters carry 8 bytes, 7 carry 5.
    const width = block.length === 11 ? 8 : block.length === 7 ? 5 : null
    if (width === null) throw new Error(`bad base58 block length ${block.length}`)

    let value = 0n
    for (const char of block) {
      const index = alphabet.indexOf(char)
      if (index < 0) throw new Error(`bad base58 character ${char}`)
      value = value * base + BigInt(index)
    }
    hex += value.toString(16).padStart(width * 2, '0')
  }

  const body = hex.slice(0, hex.length - 8)
  const checksum = keccak_256(hexToBytes(body))
  const expected = Array.from(checksum.slice(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
  if (hex.slice(-8) !== expected) throw new Error('address checksum does not validate')

  return hex
}

// ── wallet URIs, for the QR codes the design calls for ──────────────────────

/** Pay this address. What the XMR side scans to send the coins. */
export const moneroPaymentUri = (address: string, xmrAmount: string): string =>
  `monero:${address}?tx_amount=${xmrAmount}`

/** Watch this address. What the EVM side scans to verify the deposit. */
export const moneroViewUri = (
  address: string,
  privateViewKey: bigint,
  label: string,
  restoreHeight?: number,
): string => {
  const params = new URLSearchParams({
    address,
    view_key: toMoneroKeyHex(privateViewKey),
    label,
  })
  if (restoreHeight !== undefined && restoreHeight > 0) params.set('height', String(restoreHeight))
  return `monero_wallet:${address}?${params.toString()}`
}

/** Sweep this address. What the winning side scans once a key half is published. */
export const moneroWalletUri = (
  address: string,
  privateSpendKey: bigint,
  privateViewKey: bigint,
  label: string,
  restoreHeight?: number,
): string => {
  const params = new URLSearchParams({
    address,
    spend_key: toMoneroKeyHex(privateSpendKey),
    view_key: toMoneroKeyHex(privateViewKey),
    label,
  })
  if (restoreHeight !== undefined && restoreHeight > 0) params.set('height', String(restoreHeight))
  return `monero_wallet:${address}?${params.toString()}`
}
