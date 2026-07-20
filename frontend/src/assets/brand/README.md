# Brand assets — PLACEHOLDERS

These are **placeholder** brand assets so the app renders without blocking. Replace them with the
**official OP-monogram artwork** when it's available.

## Files

| File | Where it's used | Replace with |
|---|---|---|
| `../../../public/favicon.svg` | Browser tab icon (`index.html`) | Official mark, square, self-colored (works small) |
| `optimizers-logo-full.svg` | Reference / handoff (marketing, exports) | Official full lockup (mark + wordmark) |

## The in-app logo is a React component, not a file

The logo the app actually renders is `frontend/src/components/ui/Logo.tsx` — an **inline SVG** so it
can be tinted via `currentColor` (the brand's primary/secondary/tertiary color variations map to the
parent's text color: `text-ink`, `text-white`, `text-brand-500`).

### To install the official logo
1. Drop the official vector into this folder.
2. Update `Logo.tsx` — either paste the official `<path>` data into the inline SVG (keeping
   `fill="currentColor"` so tinting still works), or, if you prefer fixed-color files, import the SVGs
   as URLs and render `<img>` (note: `<img>`-rendered SVGs can't inherit `currentColor`, so you'd
   need one file per color variant).
3. Regenerate `public/favicon.svg` from the official mark.

See `docs/brand/01-logo.md` for the logo rationale, color variations, and usage rules.
