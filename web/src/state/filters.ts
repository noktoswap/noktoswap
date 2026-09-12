import { createSignal } from 'solid-js'

/**
 * Browsing filters, module-level so they survive a picker being covered.
 *
 * The token picker's network filter has to outlive the network view opening on
 * top of it — as a local signal it died on unmount and the selection went
 * nowhere. It is also genuinely shared: the same choice should still be there
 * next time the picker opens.
 *
 * ── why a set rather than one id ────────────────────────────────────────────
 *
 * The wireframe draws *checkboxes* in the network view, not radio buttons, and
 * that is the right affordance: "narrow this down" is rarely "pick exactly one".
 * Someone holding USDC on Base and Arbitrum wants both in front of them, and on
 * an EVM a token *is* a (chain, token) pair — so those are two genuinely
 * different entries, not one entry with a chain attached.
 *
 * **Empty means all**, which keeps the default honest: no filter is not the same
 * fact as "every box happens to be ticked", and clearing the last box should
 * widen the view rather than empty it.
 */

const empty: readonly number[] = []

/** Which networks the token picker lists EVM tokens for. Empty = all. */
const [tokenNetworks, setTokenNetworks] = createSignal<readonly number[]>(empty)

/** Which chains the book is filtered to. Empty = all. */
const [bookChains, setBookChains] = createSignal<readonly number[]>(empty)

export { bookChains, tokenNetworks }

const toggle = (current: readonly number[], chainId: number): readonly number[] =>
  current.includes(chainId)
    ? current.filter((id) => id !== chainId)
    : [...current, chainId]

export const toggleTokenNetwork = (chainId: number): void => {
  setTokenNetworks((current) => toggle(current, chainId))
}

export const toggleBookChain = (chainId: number): void => {
  setBookChains((current) => toggle(current, chainId))
}

export const setTokenNetworks_ = (chainIds: readonly number[]): void => {
  setTokenNetworks(chainIds)
}

export const setBookChains_ = (chainIds: readonly number[]): void => {
  setBookChains(chainIds)
}

export const clearTokenNetworks = (): void => {
  setTokenNetworks(empty)
}

export const clearBookChains = (): void => {
  setBookChains(empty)
}

/**
 * Resolve a filter into the concrete list to query.
 *
 * Empty means all, so this is where "no filter" becomes "every configured
 * chain" — callers should never branch on emptiness themselves.
 */
export const resolveChains = (
  selected: readonly number[],
  all: readonly number[],
): readonly number[] => (selected.length === 0 ? all : selected.filter((id) => all.includes(id)))

export const isSelected = (selected: readonly number[], chainId: number): boolean =>
  selected.length === 0 || selected.includes(chainId)

/** True when the filter is wide open. */
export const isAllChains = (selected: readonly number[]): boolean => selected.length === 0
