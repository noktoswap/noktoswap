import type { JSX } from 'solid-js'
import ArrowDownIcon from 'lucide-solid/icons/arrow-down'
import ArrowRightIcon from 'lucide-solid/icons/arrow-right'
import ArrowUpDownIcon from 'lucide-solid/icons/arrow-up-down'
import CheckIcon from 'lucide-solid/icons/check'
import ChevronDownIcon from 'lucide-solid/icons/chevron-down'
import CircleUserIcon from 'lucide-solid/icons/circle-user'
import ClockIcon from 'lucide-solid/icons/clock'
import ContrastIcon from 'lucide-solid/icons/contrast'
import CopyIcon from 'lucide-solid/icons/copy'
import DiamondIcon from 'lucide-solid/icons/diamond'
import ExternalLinkIcon from 'lucide-solid/icons/external-link'
import FileTextIcon from 'lucide-solid/icons/file-text'
import PlusIcon from 'lucide-solid/icons/plus'
import RefreshIcon from 'lucide-solid/icons/refresh-cw'
import SearchIcon from 'lucide-solid/icons/search'
import SlidersIcon from 'lucide-solid/icons/sliders-horizontal'
import TerminalIcon from 'lucide-solid/icons/square-terminal'
import TriangleAlertIcon from 'lucide-solid/icons/triangle-alert'
import XIcon from 'lucide-solid/icons/x'

/**
 * Lucide, at the wireframe's weights.
 *
 * The artboards draw their own line art, but the sizes and the 1.5 stroke are
 * the thing that actually reads as lo-fi — Lucide's default 2 at 24px is
 * heavier than the rest of the page. So every icon is re-exported through one
 * wrapper that fixes the weight and the default size, and call sites name the
 * concept (`Flip`, `XmrMark`) rather than the glyph. Swapping an icon later is
 * a one-line change here.
 */

type IconProps = { size?: number | string; class?: string }

const lofi = (
  Icon: (props: Record<string, unknown>) => JSX.Element,
  fallbackSize: number,
) => (props: IconProps): JSX.Element => (
  <Icon size={props.size ?? fallbackSize} stroke-width={1.5} class={props.class} />
)

export const Chevron = lofi(ChevronDownIcon, 14)
export const Contrast = lofi(ContrastIcon, 17)
export const Avatar = lofi(CircleUserIcon, 26)
export const Settings = lofi(SlidersIcon, 16)
export const ArrowRight = lofi(ArrowRightIcon, 17)
export const ArrowDown = lofi(ArrowDownIcon, 17)
export const Close = lofi(XIcon, 14)
export const Clock = lofi(ClockIcon, 17)
export const Warning = lofi(TriangleAlertIcon, 11)
export const Plus = lofi(PlusIcon, 14)
export const Search = lofi(SearchIcon, 15)
export const Check = lofi(CheckIcon, 11)
export const Refresh = lofi(RefreshIcon, 13)
export const Copy = lofi(CopyIcon, 14)
export const External = lofi(ExternalLinkIcon, 13)
export const SourceMark = lofi(TerminalIcon, 14)
export const ContractMark = lofi(FileTextIcon, 14)

/** The flip control on the seam between the two amount fields. */
export const Flip = lofi(ArrowUpDownIcon, 17)

/**
 * The Monero mark, inlined.
 *
 * XMR is not an EVM token, so no (chain, address) asset host has it — and it is
 * the one currency on every screen in this app, which makes a request that can
 * 404 the wrong trade. This is the official mark from `spothq/cryptocurrency-icons`
 * (CC0-1.0), so inlining costs nothing and needs no attribution.
 */
export const XmrMark = (props: IconProps): JSX.Element => (
  <svg
    width={props.size ?? 15}
    height={props.size ?? 15}
    viewBox="0 0 32 32"
    class={props.class}
    aria-hidden="true"
  >
    <g fill="none" fill-rule="evenodd">
      <circle cx="16" cy="16" r="16" fill="#F60" />
      <path
        fill="#FFF"
        fill-rule="nonzero"
        d="M15.97 5.235c5.985 0 10.825 4.84 10.825 10.824a11.07 11.07 0 01-.558 3.432h-3.226v-9.094l-7.04 7.04-7.04-7.04v9.094H5.704a11.07 11.07 0 01-.557-3.432c0-5.984 4.84-10.824 10.824-10.824zM14.358 19.02L16 20.635l1.613-1.614 3.051-3.08v5.72h4.547a10.806 10.806 0 01-9.24 5.192c-3.902 0-7.334-2.082-9.24-5.192h4.546v-5.72l3.08 3.08z"
      />
    </g>
  </svg>
)

/** Ether, for the amount boxes in the order dialog. */
export const EthMark = lofi(DiamondIcon, 15)

/** The wordmark. Drawn rather than borrowed — it is the one brand element. */
export const Logo = (props: IconProps): JSX.Element => (
  <svg
    width={props.size ?? 40}
    height={props.size ?? 40}
    viewBox="0 0 40 40"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    class={props.class}
  >
    <rect x="1" y="1" width="38" height="38" rx="8" />
    <path d="M12 13 28 27M28 13 12 27" />
  </svg>
)
