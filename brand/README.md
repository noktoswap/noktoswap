# Noktoswap brand

All three are 512×512, `viewBox="0 0 512 512"`.

| File | Use |
|---|---|
| `noktoswap-logo.svg` | primary — night tile, rounded square. App icon, favicon, social avatar |
| `noktoswap-mark.svg` | transparent, moon tones. **Dark backgrounds only** — it disappears on white |
| `noktoswap-mark-light.svg` | transparent, ink. Light backgrounds, print, documents |

## The idea

*Nokto* is Esperanto for night, and *Monero* is Esperanto for coin, so the
pairing is already in the name.

It is one object, not two logos side by side. **The Monero coin is the moon** —
recoloured into moon tones, its disc becomes the lunar face and its M becomes the
marking on it. A shadow circle then puts the moon into phase, and the terminator
cuts across the M exactly as it would cut across any real marking, so the glyph
runs into the dark side rather than stopping politely at it.

**The Ethereum diamond sits in the shadow the phase opened up.** It is not placed
beside the moon; it occupies the unlit half, which is why the two shapes read as
one composition and why neither needs an outline to stay legible.

The split is the protocol: the lit face is the private side, the diamond is the
public one, and the trade is the boundary between them.

## Palette

| | |
|---|---|
| Night ground | `#0B1230` → `#17265A` → `#090F24` |
| Lunar face | `#F6F9FF` → `#C2D5F3` (upper), `#BDD1F0` → `#7B98CF` (lower) |
| Monero marking | `#37508A` → `#1B2950` |
| Ethereum | `#DCEBFF` → `#8FBCFF` (upper), `#9EC4FF` → `#5E93F7` (lower) |

Both source marks keep their canonical geometry; only the fills are restated.
The Monero logo is CC0.

## Regenerating a preview

No rasteriser needed — macOS QuickLook will do it:

```shell
qlmanage -t -s 512 -o . noktoswap-logo.svg
```
