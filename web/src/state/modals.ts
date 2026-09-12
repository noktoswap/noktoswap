import { createSignal } from 'solid-js'
import type { Currency } from '../lib/tokens'

/**
 * A stack, not a single slot — and payloads that name *what to edit* rather than
 * carrying a copy of it.
 *
 * Both of those are bug fixes rather than preferences:
 *
 * The stack: the token picker opens the network view on top of itself, and with
 * one slot that *replaced* the token picker, which then unmounted and took its
 * local filter signal with it. Closing the network view left nothing open and
 * nothing selected.
 *
 * The payload: the chain picker used to be handed `selected: tokenNetworks()` —
 * a value read at open time and frozen into this object. Toggling the filter
 * updated the signal but not the frozen copy, so every checkbox stayed unticked
 * no matter what was clicked. A snapshot of reactive state is not reactive
 * state, and no amount of component polish fixes that. So the payload names a
 * `target` and the component reads the live signal for that target itself.
 */
export type ChainFilterTarget = 'token-networks' | 'book-chains'

export type Modal =
  /**
   * `chainId` is not optional context. Offer ids restart at 1 on every
   * deployment, so #1 exists on all three chains — opening one by id alone would
   * read whichever chain happened to be default and show a different trade.
   */
  | { kind: 'order'; chainId: number; offerId: bigint }
  | { kind: 'create' }
  | {
      kind: 'token'
      onPick: (currency: Currency) => void
      current: Currency
      /**
       * Whether XMR is a legal answer. True on the trade widget and the create
       * form; false for a claim payout, which is native ETH swapped into an EVM
       * token — there is nothing for XMR to mean there.
       */
      allowXmr: boolean
    }
  | { kind: 'chains'; target: ChainFilterTarget }
  | { kind: 'review' }
  | { kind: 'settings' }
  | { kind: 'connect' }

const [stack, setStack] = createSignal<Modal[]>([])

export { stack }

/** The modal actually on screen. */
export const modal = (): Modal | null => stack().at(-1) ?? null

const push = (next: Modal): void => {
  setStack((current) => [...current, next])
}

export const openOrder = (chainId: number, offerId: bigint): void => {
  push({ kind: 'order', chainId, offerId })
}
export const openCreate = (): void => {
  push({ kind: 'create' })
}
export const openReview = (): void => {
  push({ kind: 'review' })
}
export const openSettings = (): void => {
  push({ kind: 'settings' })
}
export const openConnect = (): void => {
  push({ kind: 'connect' })
}

/** Pop one level — back to whatever opened this, or to the page. */
export const closeModal = (): void => {
  setStack((current) => current.slice(0, -1))
}

/** Dismiss everything. For a flow that has finished rather than been backed out of. */
export const closeAllModals = (): void => {
  setStack([])
}

export const openTokenPicker = (
  current: Currency,
  onPick: (currency: Currency) => void,
  options?: { allowXmr?: boolean },
): void => {
  push({ kind: 'token', current, onPick, allowXmr: options?.allowXmr ?? true })
}

export const openChainPicker = (target: ChainFilterTarget): void => {
  push({ kind: 'chains', target })
}
