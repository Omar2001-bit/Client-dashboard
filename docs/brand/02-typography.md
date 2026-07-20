# 02 — Brand Typography

## English — Sora

**Sora** is the brand's main English font. It's used across all communications to keep things
consistent on every platform and material.

> _"Sora is the voice of our brand. Strong, modern, and confident, it ensures clarity, impact, and
> timeless presence across every visual."_

**Weights available:** Light (300) · Regular (400) · Medium (500) · SemiBold (600) · Bold (700) ·
ExtraBold (800).

Specimen (each weight shows the full set):

```
ABCDEFGHIJKLMNOPQRSTUVWXYZ
abcdefghijklmnopqrstuvwxyz
1234567890
```

## Arabic — KO Sans

**KO Sans** is the brand's main Arabic font, used across all Arabic communications for consistency.
Weights: Light · Regular · Medium.

> **In this codebase:** the app is currently English-only; KO Sans is **documented but not loaded**,
> and RTL support is a non-goal for now. When Arabic is needed, add the KO Sans font files (a
> placeholder the brand owner must supply) and an `[lang="ar"]` / `dir="rtl"` strategy.

## Type hierarchy & rules

| Level | Font & weight | Size |
|---|---|---|
| **Headline** | Sora **Bold** | Large, relative to the artboard/layout |
| **Sub-Headline 1** | Sora **SemiBold** | ~½ the main headline size |
| **Sub-Headline 2** | Sora **SemiBold** | Smaller than Sub-Headline 1 |
| **Paragraph / body** | Sora **Light** | Small — **24px or below**, per the material |

## In this codebase

- Loaded via `<link rel="preconnect">` + Google Fonts `<link>` in `frontend/index.html`
  (weights 300–800), and set as the default family in `frontend/src/index.css` + the Tailwind
  `fontFamily.sans` / `fontFamily.display` tokens.
- Utility mapping suggestion: Headline → `font-bold` (or `font-extrabold`), Sub-headlines →
  `font-semibold`, body → `font-light` / `font-normal`.
