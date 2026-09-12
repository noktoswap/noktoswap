import { createSignal } from 'solid-js'

/**
 * The settings that actually exist.
 *
 * Every one of these was a hardcoded constant somewhere until it came in here, and
 * each is exposed because it changes an outcome rather than because the wireframe
 * draws a gear:
 *
 *   maxSlippage   how much of your token an exact-output swap may spend
 *   deadline      how long a swap stays valid after you sign it
 *   nearBand      how far from your size still counts as "close to it"
 *
 * Anything that does not change an outcome is not here. There is no theme toggle
 * and no currency-display preference, because there is nothing behind them.
 */

/** `null` means let the Trading API choose (`autoSlippage: DEFAULT`). */
export type Slippage = number | null

const STORAGE_KEY = 'noktoswap.settings.v1'

type Stored = {
  maxSlippage?: number | null
  deadlineMinutes?: number
  nearBandPercent?: number
}

/**
 * Defaults worth stating:
 *
 * `null` slippage defers to Uniswap's own auto figure, which accounts for the
 * pair's volatility and gas — better than a number we would invent. 30 minutes
 * matches the Uniswap app. 10% is the band the design specifies.
 */
const DEFAULTS = {
  maxSlippage: null as Slippage,
  deadlineMinutes: 30,
  nearBandPercent: 10,
}

const load = (): Stored => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Stored) : {}
  } catch {
    // Private window, or site data blocked. Defaults are a fine answer.
    return {}
  }
}

const stored = load()

const [maxSlippage, setMaxSlippageSignal] = createSignal<Slippage>(
  stored.maxSlippage === undefined ? DEFAULTS.maxSlippage : stored.maxSlippage,
)
const [deadlineMinutes, setDeadlineSignal] = createSignal(
  stored.deadlineMinutes ?? DEFAULTS.deadlineMinutes,
)
const [nearBandPercent, setNearBandSignal] = createSignal(
  stored.nearBandPercent ?? DEFAULTS.nearBandPercent,
)

const persist = () => {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        maxSlippage: maxSlippage(),
        deadlineMinutes: deadlineMinutes(),
        nearBandPercent: nearBandPercent(),
      } satisfies Stored),
    )
  } catch {
    // Losing a preference is not worth surfacing. Losing an escrow key is, and
    // that is stored elsewhere with its own error path.
  }
}

export { deadlineMinutes, maxSlippage, nearBandPercent }

/**
 * Clamped on the way in, not on the way out.
 *
 * A slippage of 50% is not a preference, it is a mistake that hands a sandwich
 * bot the difference — and because this is exact-*output*, the loss lands on the
 * token being spent rather than on the ETH reaching the escrow, which makes it
 * easier to miss. 5% is a generous ceiling for the stablecoin routes this app
 * constrains itself to.
 */
export const MAX_ALLOWED_SLIPPAGE = 5

export const setMaxSlippage = (value: Slippage): void => {
  setMaxSlippageSignal(
    value === null ? null : Math.min(Math.max(value, 0.01), MAX_ALLOWED_SLIPPAGE),
  )
  persist()
}

export const setDeadlineMinutes = (value: number): void => {
  setDeadlineSignal(Math.min(Math.max(Math.round(value), 1), 4320))
  persist()
}

export const setNearBandPercent = (value: number): void => {
  setNearBandSignal(Math.min(Math.max(value, 1), 50))
  persist()
}

export const resetSettings = (): void => {
  setMaxSlippageSignal(DEFAULTS.maxSlippage)
  setDeadlineSignal(DEFAULTS.deadlineMinutes)
  setNearBandSignal(DEFAULTS.nearBandPercent)
  persist()
}

export const isDefault = (): boolean =>
  maxSlippage() === DEFAULTS.maxSlippage &&
  deadlineMinutes() === DEFAULTS.deadlineMinutes &&
  nearBandPercent() === DEFAULTS.nearBandPercent

/** The band as a fraction, which is what the matching code wants. */
export const nearBand = (): number => nearBandPercent() / 100

/** Unix seconds, as `/swap` wants its `deadline`. */
export const deadlineAt = (nowSeconds: number): number =>
  nowSeconds + deadlineMinutes() * 60
