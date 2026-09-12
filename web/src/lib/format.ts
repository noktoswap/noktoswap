import { formatUnits, parseUnits } from 'viem'

/** Monero's atomic unit is 1e-12 XMR. */
export const XMR_DECIMALS = 12

/**
 * Trim a fixed-point string to at most `max` significant decimals without ever
 * rounding a figure up. Nothing here gates a payment — the exact wei always
 * comes off the contract — but a display that rounds 0.2499 up to 0.25 invites
 * someone to believe they are taking an offer they are not.
 */
export const trimDecimals = (value: string, max: number): string => {
  if (!value.includes('.')) return value
  const [whole = '0', frac = ''] = value.split('.')
  const cut = frac.slice(0, max).replace(/0+$/, '')
  return cut ? `${whole}.${cut}` : whole
}

export const formatEth = (wei: bigint, decimals = 4): string =>
  trimDecimals(formatUnits(wei, 18), decimals)

export const formatXmr = (atomic: bigint, decimals = 4): string =>
  trimDecimals(formatUnits(atomic, XMR_DECIMALS), decimals)

export const formatToken = (raw: bigint, tokenDecimals: number, decimals = 4): string =>
  trimDecimals(formatUnits(raw, tokenDecimals), decimals)

/** Parse user input, tolerating an empty or half-typed field. */
export const tryParseUnits = (input: string, decimals: number): bigint | null => {
  const text = input.trim().replace(/,/g, '')
  if (!text || !/^\d*\.?\d*$/.test(text) || text === '.') return null
  try {
    const parsed = parseUnits(text, decimals)
    return parsed > 0n ? parsed : null
  } catch {
    return null
  }
}

export const tryParseEth = (input: string): bigint | null => tryParseUnits(input, 18)
export const tryParseXmr = (input: string): bigint | null => tryParseUnits(input, XMR_DECIMALS)

/** XMR per ETH, as a display number. Rate is never used to compute a payment. */
export const rateXmrPerEth = (ethWei: bigint, xmrAtomic: bigint): number | null => {
  if (ethWei === 0n) return null
  return Number(formatUnits(xmrAtomic, XMR_DECIMALS)) / Number(formatUnits(ethWei, 18))
}

export const formatRate = (rate: number | null): string => (rate === null ? '—' : rate.toFixed(2))

/** Null-tolerant rate, for a form where either field may be half-typed. */
export const rateOf = (ethWei: bigint | null, xmrAtomic: bigint | null): number | null =>
  ethWei === null || xmrAtomic === null ? null : rateXmrPerEth(ethWei, xmrAtomic)

/**
 * What `ethWei` is worth in XMR at a given rate.
 *
 * Scaled in bigint rather than multiplied as floats: an ETH amount is up to 1e18
 * and the XMR result up to 1e12, so the product overflows the safe-integer range
 * long before it overflows a bigint, and `Math.round` on a value that large
 * returns something that is not the integer it looks like.
 *
 * This is only ever a readout — nothing here reaches a `msg.value` — but a
 * readout that silently loses its low digits is still a readout nobody can
 * check against the offer it claims to describe.
 */
const RATE_SCALE = 1_000_000n

export const estimateXmr = (ethWei: bigint, rate: number): bigint => {
  if (!Number.isFinite(rate) || rate <= 0) return 0n
  const scaled = BigInt(Math.round(rate * Number(RATE_SCALE)))
  // wei (1e18) → atomic XMR (1e12) is a factor of 1e6 down.
  return (ethWei * scaled) / (RATE_SCALE * 1_000_000n)
}

/** The same conversion the other way, for when XMR is the leg being typed. */
export const estimateEth = (xmrAtomic: bigint, rate: number): bigint => {
  if (!Number.isFinite(rate) || rate <= 0) return 0n
  const scaled = BigInt(Math.round(rate * Number(RATE_SCALE)))
  if (scaled === 0n) return 0n
  return (xmrAtomic * RATE_SCALE * 1_000_000n) / scaled
}

export const formatUsd = (value: number | string | null | undefined): string => {
  const n = typeof value === 'string' ? Number(value) : value
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export const shortAddress = (address: string | null | undefined): string => {
  if (!address) return '—'
  return `${address.slice(0, 5)}…${address.slice(-3)}`
}

/**
 * Deadlines are written as a countdown in plain words. No t0/t1, no block
 * heights — the wireframe is explicit about this and it is the right call: a
 * deadline is the one place in this app where a user loses money by
 * misreading a number.
 */
export const countdown = (deadline: bigint | null, now: number): string => {
  if (deadline === null || deadline === 0n) return 'No deadline'
  const seconds = Number(deadline) - Math.floor(now / 1000)
  if (seconds <= 0) return 'Expired'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h >= 24) {
    const d = Math.floor(h / 24)
    return `${d}d ${h % 24}h left`
  }
  if (h >= 1) return m > 0 && h < 6 ? `${h}h ${m}m left` : `${h}h left`
  return `${Math.max(m, 1)}m left`
}

/** True while a deadline is close enough that the countdown should shout. */
export const isUrgent = (deadline: bigint | null, now: number): boolean => {
  if (deadline === null || deadline === 0n) return false
  const seconds = Number(deadline) - Math.floor(now / 1000)
  return seconds > 0 && seconds <= 6 * 3600
}

export const relativeTime = (timestamp: bigint | number | null, now: number): string => {
  if (timestamp === null) return '—'
  const seconds = Math.floor(now / 1000) - Number(timestamp)
  if (seconds < 60) return 'just now'
  const m = Math.floor(seconds / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
  const d = Math.floor(h / 24)
  return `${d} ${d === 1 ? 'day' : 'days'} ago`
}

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`
