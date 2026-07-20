# Optimizers Brand — Reference & Design System

Faithful extraction of `frontend/Optimizers Brand Guidelines.pdf` (September 2025), plus the
machine-readable token layer that drives the app. This folder is the human-readable half; the
code half lives in `frontend/src/theme/tokens.js` (the single source of truth) and
`frontend/tailwind.config.js`.

> **Positioning / tagline:** _"We make optimization **Simple, Practical, and Profitable** for
> e-commerce businesses."_

## Contents

| Doc | Covers |
|---|---|
| [`01-logo.md`](./01-logo.md) | Logo rationale (the "OP" monogram), color variations, correct & wrong usage |
| [`02-typography.md`](./02-typography.md) | Sora (EN) + KO Sans (AR), weights, type hierarchy & rules |
| [`03-colors.md`](./03-colors.md) | The 3 brand colors (HEX/RGB/CMYK) + usage rules and the app token mapping |
| [`04-elements.md`](./04-elements.md) | Iconography, photography, patterns, and UI element rules (buttons) |
| [`design-system.md`](./design-system.md) | The reusable component library, tokens, and how to build UI with them |

## Quick reference

**Colors (the brand defines only three + white):**

| Name | HEX | RGB | CMYK | Role |
|---|---|---|---|---|
| Pastel Green | `#6ae499` | 106, 228, 153 | 52, 0, 57, 0 | Accents, fills, numbers, icons, headlines |
| Big Stone ("light black") | `#162a3d` | 22, 42, 61 | 92, 76, 50, 53 | Body text, paragraphs, dark surfaces |
| Black Forest ("dark black") | `#020601` | 2, 6, 1 | 74, 65, 68, 87 | Main headlines, **text on green**, deepest bg |

**Type:** Sora (English) · KO Sans (Arabic). Headline = Bold, Sub-headline = SemiBold, Body = Light.

**Radius:** 16px on cards (`rounded-brand`). **Icons:** minimal, rounded, curvy.

## Assets

Placeholder brand artwork lives in [`../../frontend/src/assets/brand/`](../../frontend/src/assets/brand/)
and `frontend/public/favicon.svg`. These are **clearly-marked placeholders** — replace them with the
official OP-monogram artwork when supplied (see that folder's `README.md`). The in-app logo component is
`frontend/src/components/ui/Logo.tsx`.
