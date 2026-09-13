# Noktoswap brand

All three are 512×512, `viewBox="0 0 512 512"`, and scale cleanly to a 16px
favicon — the two shapes stay distinguishable because neither carries fine
detail.

| File | Use |
|---|---|
| `noktoswap-logo.svg` | primary — night tile, rounded square. App icon, favicon, social avatar |
| `noktoswap-mark.svg` | transparent, pale. **Dark backgrounds only** — it disappears on white |
| `noktoswap-mark-light.svg` | transparent, ink. Light backgrounds, print, documents |

## The idea

*Nokto* is Esperanto for night, and *Monero* is Esperanto for coin, so the name
already points at the pairing. The mark takes it literally: a crescent moon and
the Ethereum diamond, sharing one frame.

The moon is the Monero side, and there is no third mark for it on purpose.
Monero's own logo recoloured into blue would read as a borrowed asset; night
already means the private, unlit half of the trade, and it belongs to the project
name rather than to another protocol's brand. So the composition is two elements
and not three — the lit, faceted, public side, and the dark one beside it.

The two are deliberately equal in weight. This is a swap, and a logo where one
currency is an accent on the other would say the wrong thing.

## Palette

| | |
|---|---|
| Night ground | `#0B1230` → `#17265A` → `#090F24` |
| Moon | `#F2F7FF` → `#C6D8F5` → `#7F9AD4` |
| Ethereum | `#DCEBFF` → `#8FBCFF` (upper), `#9EC4FF` → `#5E93F7` (lower) |

The Ethereum mark keeps its canonical six-facet geometry; only the fill is
restated in night tones.

## Regenerating a preview

No rasteriser is needed — macOS QuickLook will do it:

```shell
qlmanage -t -s 512 -o . noktoswap-logo.svg
```
