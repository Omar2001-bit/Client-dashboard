# 03 — Brand Color Palette

The brand palette is deliberately minimal — **three colors + white** — used for backgrounds, text,
and icons across all marketing collateral and product UI.

## The three colors

### Pastel Green
- **HEX** `#6ae499` · **RGB** 106, 228, 153 · **CMYK** 52%, 0%, 57%, 0%
- Used with some text headlines, numbers, icons, and some backgrounds per the design hierarchy.

### Big Stone — "light black"
- **HEX** `#162a3d` · **RGB** 22, 42, 61 · **CMYK** 92%, 76%, 50%, 53%
- Used with paragraphs and backgrounds (the primary dark/navy surface & body text).

### Black Forest — "dark black"
- **HEX** `#020601` · **RGB** 2, 6, 1 · **CMYK** 74%, 65%, 68%, 87%
- Used with main headlines and **the text on the green color**, and for the deepest backgrounds.

## Usage rules (summary)

- **Green** = accent / attention: headlines, key numbers, icons, primary-button fills, chart series.
- **Big Stone** = the workhorse dark: body copy, borders (via opacity), dark surfaces (sidebars).
- **Black Forest** = maximum contrast: main headlines and any **text placed on a green fill**.
- **White** = the primary light surface (cards) over the app canvas `#f7fafb`.

## App token mapping

Defined once in `frontend/src/theme/tokens.js` and exposed as Tailwind utilities:

| Brand color | Token | Utilities |
|---|---|---|
| Pastel Green | `brand.500` (ramp `brand.50`–`brand.900`) | `bg-brand-500`, `text-brand-700`, `ring-brand-300`, … |
| Big Stone | `ink.DEFAULT` | `bg-ink`, `text-ink`, `border-ink/10`, `text-ink/70`, … |
| Black Forest | `ink.deep` (alias `ink.900`) | `bg-ink-deep`, `text-ink-deep` (use for text-on-green) |
| White / canvas | `white`, `canvas` | `bg-white`, `bg-canvas` (`#f7fafb`) |

**Neutrals/muted tones** are produced from `ink` with Tailwind opacity slashes (`text-ink/50`,
`border-ink/10`) rather than a separate gray ramp — do **not** use stock `gray-*` / `slate-*`.
