# 01 — Brand Logo

## Logo rationale

The mark is the **"OP" monogram**, built from the first two letters of **Optimizers**:

- **"O"** — the first letter, drawn with an arrow shape.
- **"P"** — the second letter, drawn with an arrow shape.
- **"OP"** — when combined, the two letters create a **single, balanced lockup** that stands for
  an **integrated, continuous process** and refers to **infinity** (continuous results).

> _"Our logo is more than a design, it's the heart of our identity. It reflects who we are,
> carrying our mission, values, and personality, while inspiring the vision and objectives we
> strive to achieve."_

## Color variations

| Variant | Color | Use on |
|---|---|---|
| **Primary** | Black (Black Forest) | White or green backgrounds — the main brand materials (brochures, cards, website) |
| **Secondary** | White | Black or green backgrounds, per the design hierarchy |
| **Tertiary** | Green (Pastel Green) | Black background, per the design hierarchy |

## Correct usage

- Apply the logo in the correct colors for the background.
- Place the **black** logo over clean, white images.
- Place the **white** logo over dark images.

## Wrong usage — never

- ❌ Don't **rotate** the logo.
- ❌ Don't **recolor** it outside the brand palette.
- ❌ Don't **outline / stroke** it.
- ❌ Don't **stretch or distort** it.
- ❌ Don't add a **drop shadow**.
- ❌ Don't add extra **decorative elements**.

## In this codebase

- Component: `frontend/src/components/ui/Logo.tsx` — props `variant: "full" | "mark"`. Color follows
  `currentColor`, so the three brand color variations are produced by the parent's text color
  (`text-ink` = primary/dark, `text-white` = secondary, `text-brand-500` = tertiary/green).
- **Status: PLACEHOLDER.** The current artwork approximates the OP monogram; replace with the official
  vector when supplied. Reference/handoff files: `frontend/src/assets/brand/` and
  `frontend/public/favicon.svg`.
