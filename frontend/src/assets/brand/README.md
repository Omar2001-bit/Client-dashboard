# Brand assets

Official Optimizers artwork.

## Files

| File | Where it's used |
|---|---|
| `optimizers-logo-full.png` | Full lockup (mark + wordmark), dark navy on transparent. Rendered by `Logo` (`variant="full"`) — light backgrounds only, see note below. |
| `optimizers-icon.png` | Icon-only monogram, brand green on transparent. Rendered by `Logo` (`variant="mark"`), and cropped/padded into `../../../public/favicon.png` (browser tab icon). |

## The in-app logo

`frontend/src/components/ui/Logo.tsx` renders these PNGs directly via `<img>`. Unlike the old
placeholder (an inline SVG tinted with `currentColor`), these are fixed-color rasters — wrapping
`<Logo>` in `text-ink` / `text-white` / `text-brand-500` no longer changes its color.

**Known gap:** `optimizers-logo-full.png` is dark-on-transparent, so it only reads on light
backgrounds. `AdminLayout`'s sidebar is dark and currently uses it anyway as a temporary
placeholder (low contrast) — swap in a white/reversed lockup there once one is supplied.
