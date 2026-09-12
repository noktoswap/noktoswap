import { Dialog } from '@kobalte/core/dialog'
import type { JSX } from 'solid-js'
import { closeModal } from '../state/modals'
import { Close } from './icons'

/**
 * The dialog shell every modal shares, on Kobalte's Dialog.
 *
 * ── why not the hand-rolled version ─────────────────────────────────────────
 *
 * It was closing on a scrim click via `event.target === event.currentTarget`
 * inside a `<Portal>`, and Solid's event rules make that a trap: handlers are
 * delegated from `document`, `stopPropagation` does not behave as it looks, and
 * portals propagate events through the *component* tree rather than the DOM tree.
 * A target-identity comparison across a portal boundary is the exact pattern
 * those rules warn about.
 *
 * Kobalte handles overlay clicks, Escape, the focus trap, focus restore on
 * close, scroll lock and the aria wiring — all of which the hand-rolled version
 * either approximated or skipped.
 *
 * ── what Kobalte does not do ─────────────────────────────────────────────────
 *
 * Layout. The primitives are unstyled, so overflow is entirely this file's
 * problem and was entirely this file's bug: a tall dialog was unscrollable, which
 * reads as cropped content. Two causes, both in the CSS — a positioner with
 * `pointer-events: none` (an element that ignores pointer events ignores the
 * wheel too) and no height ceiling on the dialog itself.
 *
 * The fix is the three-part structure below: a positioner that scrolls, a dialog
 * capped to the viewport, and a body that takes the overflow so the title and the
 * primary action stay put rather than scrolling away. `.dialog-body` is why the
 * children are wrapped rather than rendered straight in.
 *
 * On a phone the same markup becomes a full-screen sheet, which is CSS under the
 * 720px breakpoint rather than a second component — the contents do not change.
 */
export const Modal = (props: {
  title: string
  width?: number
  children: JSX.Element
  /** Rendered to the left of the close button. */
  actions?: JSX.Element
  /**
   * Controls that must stay reachable while the body scrolls — a search field, a
   * filter row. Without this the token picker's search scrolled away with the
   * list it filters, which is the one thing it needs to outlive.
   */
  sticky?: JSX.Element
  onClose?: () => void
}): JSX.Element => {
  const close = () => (props.onClose ?? closeModal)()

  return (
    <Dialog open modal onOpenChange={(open) => !open && close()}>
      <Dialog.Portal>
        <Dialog.Overlay class="scrim" />
        {/*
          Kobalte puts the overlay and the content as siblings, so the content
          gets its own positioner rather than relying on the overlay's. This is
          the scroll container: a dialog taller than the viewport scrolls here.
        */}
        <div class="scrim scrim-layer">
          <Dialog.Content
            class="dialog"
            style={props.width ? { width: `${props.width}px` } : undefined}
          >
            <div class="dialog-head">
              <Dialog.Title class="dialog-title">{props.title}</Dialog.Title>
              <span style={{ display: 'flex', gap: '8px' }}>
                {props.actions}
                <Dialog.CloseButton class="icon-btn" aria-label="Close">
                  <Close />
                </Dialog.CloseButton>
              </span>
            </div>
            {props.sticky}
            {/* The overflow lives here, so the head and sticky row stay pinned. */}
            <div class="dialog-body">{props.children}</div>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog>
  )
}

/** A label/value row inside an inset panel. */
export const Row = (props: { k: string; children: JSX.Element }): JSX.Element => (
  <div class="row">
    <span class="k">{props.k}</span>
    <span>{props.children}</span>
  </div>
)
