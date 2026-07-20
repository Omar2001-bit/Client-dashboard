# 04 — Brand Elements

## Iconography

- Style: **minimal**, with **rounded edges and rounded corners**, in line with the brand identity's
  **curvy** style.
- Color: brand **green icons on a black background** (dark surfaces); on light surfaces use the dark
  (Big Stone / Black Forest) color.
- **In this codebase:** standardize on **`lucide-react`** (rounded, minimal 2px strokes — matches the
  brand). Icons on the dark admin sidebar render in green/white; on light surfaces in `ink`.

## Photography style

Three permitted treatments:

1. **Authentic & real** — natural colors and light, no heavy modes; prefer a **dark background**.
   People should read as Arab, with appropriate clothing; imagery reflects e-commerce, revenue
   growth, and technology.
2. **Black & white, lighter preset** — used on **white or green** backgrounds.
3. **Green multiply** — a green multiply-mode layer over the image; used on **black or white**
   backgrounds.

## Patterns

- The pattern uses the **"OP" logo icon** in an **outline** style, in **green** with **opacity** to
  match the background.
- Blend modes: **overlay** on dark backgrounds; **multiply** on green backgrounds.

## UI elements — buttons

### Primary button
- Used for the **main actions**.
- **Green fill**, **rounded corners**, **black (Black Forest) text**.
- Has a **hover** state.

### Secondary button
- Used for **lower-priority actions**.
- **Outlined**: white outline on a dark background; black outline on a white background.
- Has a **hover** state.

> **In this codebase:** these map directly to `<Button variant="primary">` (green fill + Black Forest
> text) and `<Button variant="secondary">` (outline). A dark-surface `variant="onDark"` covers the
> "white outline on dark background" case (admin sidebar, coach-marks). See
> [`design-system.md`](./design-system.md).
