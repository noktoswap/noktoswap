import encodeQR from 'qr'
import { Show, createMemo, type JSX } from 'solid-js'

/**
 * A scannable code for a Monero URI.
 *
 * `qr` is the same generator upstream uses — zero-dependency, MIT/Apache-2.0, and
 * by the same author as the `@noble` libraries this app already leans on.
 *
 * The wireframe draws a QR beside "Send XMR" and "Verify deposit", and it is not
 * decoration: the alternative to scanning is retyping a 95-character address and
 * two 64-character keys into a phone, which nobody does correctly.
 *
 * ── two details ─────────────────────────────────────────────────────────────
 *
 * The generated SVG goes in through `innerHTML`, which is only defensible because
 * of what it contains: `encodeQR` emits nothing but `<svg>` and `<path>` from a
 * URI this app built itself out of on-chain values. No user text reaches it, and
 * the module has no dependencies that could change that.
 *
 * A long `monero_wallet:` URI carries an address plus two keys — around 390
 * characters, which needs a denser symbol than a plain payment URI. The code is
 * sized by `viewBox` and scaled by CSS rather than by a pixel `scale`, so a denser
 * symbol stays the same physical size and simply has finer modules.
 */
export const QrCode = (props: {
  /** The URI to encode. A falsy value renders nothing. */
  data: string | null | undefined
  /** Rendered size in px. The wireframe uses 132 beside a panel, 120 inline. */
  size?: number
  label?: string
}): JSX.Element => {
  const svg = createMemo(() => {
    const data = props.data
    if (!data) return null
    try {
      // border: 2 is the quiet zone. Below ~2 modules, scanners struggle.
      return encodeQR(data, 'svg', { scale: 1, border: 2 }).replace(
        '<svg ',
        '<svg width="100%" height="100%" ',
      )
    } catch {
      // Over capacity, or a character the encoder cannot represent. A missing
      // code is recoverable — the address and keys are on screen as text too.
      return null
    }
  })

  const size = () => props.size ?? 132

  return (
    <Show when={svg()}>
      {(markup) => (
        <div
          role="img"
          aria-label={props.label ?? 'QR code'}
          style={{
            width: `${size()}px`,
            height: `${size()}px`,
            flex: 'none',
            border: '1px solid var(--line)',
            'border-radius': '6px',
            padding: '8px',
            // White rather than the paper tone: scanners want maximum contrast,
            // and this is the one element whose job is to be machine-readable.
            background: '#fff',
          }}
          innerHTML={markup()}
        />
      )}
    </Show>
  )
}
