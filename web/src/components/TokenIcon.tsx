import { Show, createMemo, createSignal, type JSX } from 'solid-js'
import { chainLogo, logoCandidates, logoFor } from '../lib/icons'
import { isXmr, type Currency } from '../lib/tokens'
import { XmrMark } from './icons'

/**
 * A currency's artwork, inside the wireframe's `.dot`.
 *
 * The dot is the fallback rather than a placeholder to be replaced: it already
 * has the right size, border and clip, so artwork drops into it and a miss simply
 * leaves the lo-fi circle showing. Candidates are tried in order and exhausted
 * silently — a 404 here is a cosmetic non-event, not something to report.
 */

const DEFAULT_SIZE = 22

const Img = (props: { sources: string[]; alt: string; size: number }): JSX.Element => {
  const [index, setIndex] = createSignal(0)
  const src = createMemo(() => props.sources[index()])

  return (
    <Show when={src()}>
      {(url) => (
        <img
          src={url()}
          alt={props.alt}
          width={props.size}
          height={props.size}
          loading="lazy"
          decoding="async"
          // The page URL is not this third party's business.
          referrerpolicy="no-referrer"
          onError={() => setIndex((i) => i + 1)}
          style={{ width: '100%', height: '100%', display: 'block' }}
        />
      )}
    </Show>
  )
}

export const TokenIcon = (props: { currency: Currency; size?: number }): JSX.Element => {
  const size = () => props.size ?? DEFAULT_SIZE
  return (
    <span class="dot" style={{ width: `${size()}px`, height: `${size()}px` }}>
      {/* XMR is not an EVM token, so no asset host keyed by (chain, address) has
          it — the same fact that pins it above the rule in the picker. Its mark
          is inlined instead. */}
      <Show
        when={!isXmr(props.currency)}
        fallback={<XmrMark size={size()} />}
      >
        <Img
          sources={logoCandidates(props.currency)}
          alt={props.currency.symbol}
          size={size()}
        />
      </Show>
    </span>
  )
}

/** Artwork for a (chain, token) pair when no Currency object is to hand. */
export const TokenIconFor = (props: {
  chainId: number
  address: string
  symbol?: string
  size?: number
}): JSX.Element => {
  const size = () => props.size ?? DEFAULT_SIZE
  return (
    <span class="dot" style={{ width: `${size()}px`, height: `${size()}px` }}>
      <Img
        sources={logoFor(props.chainId, props.address, props.symbol)}
        alt={props.symbol ?? ''}
        size={size()}
      />
    </span>
  )
}

/**
 * A chain's artwork. Covers Sepolia, unlike the token endpoint.
 *
 * `label` matters wherever the icon stands in for the chain's *name* rather than
 * decorating it — the book's Chain column, for one. Five chains with distinct
 * logos are recognisable, but only if the name is still reachable by hover and by
 * a screen reader.
 */
export const ChainIcon = (props: { chainId: number; size?: number; label?: string }): JSX.Element => {
  const size = () => props.size ?? DEFAULT_SIZE
  return (
    <span
      class="dot"
      style={{ width: `${size()}px`, height: `${size()}px` }}
      title={props.label}
      role={props.label ? 'img' : undefined}
      aria-label={props.label}
    >
      <Img sources={[chainLogo(props.chainId)]} alt="" size={size()} />
    </span>
  )
}
