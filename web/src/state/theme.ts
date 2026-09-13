import { createEffect, createSignal } from 'solid-js'

/**
 * Light, dark, or whatever the OS says.
 *
 * The header had a contrast button that did nothing — decorative markup with
 * `aria-hidden`, which is the worst of both worlds: it looks pressable, so it
 * gets pressed, and it is hidden from anyone who would have been told it is not a
 * control. Either it works or it goes; this makes it work.
 *
 * Three states rather than two, because "follow the system" is a real answer and
 * the common default. Unset is that state: no attribute on the root, so the CSS
 * media query decides. Clicking commits to a value, which is why the stylesheet
 * guards its dark media block with `:not([data-theme='light'])` — an explicit
 * light choice has to beat a dark OS.
 */
export type Theme = 'light' | 'dark'

const KEY = 'noktoswap:theme'

/**
 * Storage can throw, not just come back empty — Safari in private browsing raises
 * on access rather than returning null. A preference is not worth a blank page.
 */
const stored = (): Theme | null => {
  try {
    const value = localStorage.getItem(KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

const [theme, setTheme] = createSignal<Theme | null>(stored())

export { theme }

/** What is actually on screen right now, resolving the unset case. */
export const resolvedTheme = (): Theme => {
  const chosen = theme()
  if (chosen) return chosen
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch {
    return 'light'
  }
}

/**
 * Flip to the opposite of what is showing.
 *
 * Resolving first is what makes the first click do the obvious thing: with no
 * stored choice on a dark OS, the button has to go to light, not to dark, or it
 * appears broken exactly once — which is how the old button felt.
 */
export const toggleTheme = (): void => {
  setTheme(resolvedTheme() === 'dark' ? 'light' : 'dark')
}

createEffect(() => {
  const chosen = theme()
  const root = document.documentElement
  if (chosen) root.setAttribute('data-theme', chosen)
  else root.removeAttribute('data-theme')
  try {
    if (chosen) localStorage.setItem(KEY, chosen)
    else localStorage.removeItem(KEY)
  } catch {
    /* preference is not persisted; the session still honours it */
  }
})
