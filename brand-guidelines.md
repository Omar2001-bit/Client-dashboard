---
name: brand-guidelines
description: >
  Create comprehensive, professional brand design guideline documents as polished HTML artifacts or downloadable files.
  Use this skill whenever a user asks to create brand guidelines, a brand book, brand identity documentation,
  visual identity guide, style guide, or any document that defines how a brand looks and feels.
  Also trigger when the user says things like "document our brand", "create a brand kit", "make brand rules",
  "write up our visual identity", "build a style guide", or uploads brand assets and asks to formalize them.
  This skill covers all four core pillars: Logo, Typography, Color Palette, and Brand Elements.
  Always use this skill when brand documentation of any kind is requested — even partial guides (e.g., "just the colors and fonts").
---

# Brand Design Guidelines Skill

This skill produces **professional, publication-ready brand guideline documents** — the kind agencies charge tens of thousands for. The output is an immersive, interactive HTML artifact styled to reflect the brand itself, covering all pillars of visual identity.

---

## STEP 0 — Read the frontend-design skill first

Before writing any HTML, read `/mnt/skills/public/frontend-design/SKILL.md` for UI quality standards. The brand guidelines artifact must meet those standards — no generic AI aesthetics.

---

## STEP 1 — Gather Brand Information

Before generating anything, collect:

### Required inputs
- **Brand name** (e.g., "Antigravity", "Optimizers")
- **Brand tagline / mission statement** (e.g., "We make optimization Simple, Practical, and Profitable")
- **Industry / target audience** (e.g., e-commerce, fintech, healthcare)
- **Primary color(s)** — hex codes if known; otherwise describe the vibe
- **Fonts** — if specified; otherwise Claude selects from Google Fonts that match the brand personality
- **Logo description or SVG** — if provided; otherwise Claude designs an SVG wordmark
- **Brand personality keywords** (e.g., bold + modern + trustworthy, or playful + minimal + fresh)

### Optional but valuable
- Existing logo files (SVG/PNG)
- Competitor references ("feel like X but more Y")
- What NOT to do aesthetically

### If the user has uploaded a brand guidelines PDF
Extract all specs from it — colors, fonts, logo rationale, rules — and use them to populate the document faithfully.

---

## STEP 2 — Structure of the Output

Every brand guidelines document follows this four-section architecture, matching professional agency deliverables:

```
Cover Page
Contents / TOC
01. Brand Logo
    - Logo Rationale
    - Final Logo
    - Logo Color Variations
    - Logo Usage (correct)
    - Logo Wrong Usage (don'ts)
02. Brand Typography
    - Primary Font (English)
    - Secondary Font (Arabic, if applicable)
    - Type Hierarchy & Rules
03. Brand Color Palette
    - Primary Colors
    - Color Values (HEX, RGB, CMYK)
    - Color Usage Rules
04. Brand Elements
    - Iconography Style
    - Photography / Image Style
    - Patterns & Textures
    - UI Elements (buttons, cards, etc.)
    - Dual-Mode Adaptivity (Light/Dark Switch Rules)
    - Bilingual Adaptivity (EN/AR & RTL Logic)
Closing Page
```

See `/references/sections.md` for detailed content spec for each section.

---

## STEP 3 — HTML Artifact Architecture

The output is a **single-page scrollable HTML artifact** that:

- Uses the brand's own colors, fonts, and visual language throughout
- Has a **sticky sidebar navigation** linking to each section
- Each section is a **full-screen panel** with the section number and title
- Renders **live color swatches**, **font specimens**, **logo usage grids**, **do/don't comparisons**
- Is fully self-contained (no external dependencies except Google Fonts CDN)

### Layout skeleton

```html
<body>
  <nav class="sidebar"><!-- Section links --></nav>
  <main>
    <section id="cover"><!-- Brand hero --></section>
    <section id="contents"><!-- TOC with section previews --></section>
    <section id="logo"><!-- 5 subsections --></section>
    <section id="typography"><!-- Font specimens --></section>
    <section id="colors"><!-- Live swatches + specs --></section>
    <section id="elements"><!-- Icons, patterns, UI --></section>
    <section id="closing"><!-- Thank you / contact --></section>
  </main>
</body>
```

### Critical CSS variables to define at :root

```css
:root {
  --brand-primary: #6ae499;    /* Main accent */
  --brand-dark: #0e1c26;       /* Dark background */
  --brand-darkest: #020601;    /* Deepest black */
  --brand-white: #ffffff;
  --font-main: 'Sora', sans-serif;
  --font-arabic: 'KO Sans', sans-serif; /* if applicable */
  --section-padding: 80px;
  --border-radius: 16px;
}
```

---

## STEP 4 — Visual Design Rules

These rules ensure the document looks like the brand itself:

### Cover Page
- Full viewport height
- Brand's dark color as background
- Logo prominently placed (top-left or centered)
- Brand tagline in large display type using the primary accent color
- Subtle repeating pattern using the brand monogram/icon at low opacity

### Section Dividers
- Each section opens with a **section intro card**: large section number (01, 02...) + section title + brand tagline on the accent-colored background
- This visually separates major sections like a printed book

### Color Swatches
Render as tall rounded rectangles with color values shown below:
```html
<div class="swatch" style="background: #6ae499">
  <div class="swatch-info">
    <span>Pastel Green</span>
    <code>HEX #6ae499</code>
    <code>RGB 106, 228, 153</code>
    <code>CMYK 52, 0, 57, 0</code>
  </div>
</div>
```

### Typography Specimens
Show each font weight with a full alphabet + numerals:
```
ABCDEFGHIJKLMNOPQRSTUVWXYZ
abcdefghijklmnopqrstuvwxyz
1234567890
```
Label each weight (Light, Regular, Medium, SemiBold, Bold, ExtraBold).

### Logo Do/Don't Grid
Two-column grid: ✅ correct usages left, ❌ wrong usages right.
Wrong usage examples to always include:
- Don't rotate
- Don't recolor outside brand palette
- Don't outline / stroke
- Don't stretch or distort
- Don't add drop shadow
- Don't add extra decorative elements

### UI Elements
Show button states: Normal + Hover for both Primary and Secondary buttons.
Primary = accent color fill, dark text.
Secondary = outlined, no fill, matching border color.

---

## STEP 5 — Logo SVG Construction

If no logo is provided, construct one from brand initials using SVG:

```svg
<!-- Example: Arrow/infinity motif integrated into letterforms -->
<svg viewBox="0 0 300 80" xmlns="http://www.w3.org/2000/svg">
  <!-- Custom letterform for brand initial with arrow/motion element -->
  <!-- Full wordmark in brand font weight -->
</svg>
```

Guidelines for logo SVG:
- Use brand accent color for the icon/monogram
- Use white or dark for the wordmark text depending on background
- Ensure it works on both light and dark backgrounds
- Keep it geometric and clean — avoid decorative serifs
- The icon should embody a concept related to the brand (loops, arrows, motion for "Optimizers"; gravity, orbit, lift for "Antigravity")

---

## STEP 6 — Iconography Style Rules

Icons should always match the brand's aesthetic language:
- **Line style**: minimal, 2px stroke weight, rounded line caps and joins
- **Size grid**: designed on 24×24 or 32×32 px grid
- **Color**: brand accent on dark backgrounds; dark color on light backgrounds
- Render 8–12 sample icons as inline SVGs in the artifact covering the brand's domain

---

## STEP 7 — Pattern System

The brand pattern uses the logo icon/monogram:
- Rotated at various angles
- Low opacity (8–15%) to create texture without distraction
- On dark backgrounds: overlay blend mode
- On accent-colored backgrounds: multiply blend mode

Implement as a CSS background or an SVG `<pattern>` element tiled across section headers.

---

## STEP 8 — Dual-Mode Adaptivity Rules

Modern brands must function seamlessly across system-wide light and dark modes. Every brand guide must define a **Theme Switching Strategy**:

### 1. Theme Variables
Define a shared set of CSS variables that map to different values in each mode:
- **Surface**: Primary background color.
- **Surface-Contrast**: Secondary/elevated background (cards, modals).
- **Text-Main**: Primary readability color.
- **Text-Muted**: Less prominent text.
- **Accent-Adaptive**: Ensuring the accent color remains accessible (contrast ratio >= 4.5:1) in both modes.

### 2. The Toggle Interface
The switch should be a prominent, animated UI element. 
- Use a **Sun/Moon icon system** or a **labeled toggle**.
- Micro-interaction: The background colors should transition smoothly (e.g., `transition: background 0.5s ease`).

### 3. Logo Switching
- If the logo does not work on both backgrounds, define a **Positive** (for light) and **Negative** (for dark) version.

---

## STEP 9 — Bilingual & RTL Adaptivity Rules

For brands targeting regions like the Middle East, **Bilingual Support (English/Arabic)** is a mandatory capability:

### 1. The Language Switcher
- Include a switcher in the header (e.g., "EN | AR" or a globe icon).
- The switcher should toggle the `lang` attribute on the `<html>` tag and the `dir` attribute (`ltr` for EN / `rtl` for AR).

### 2. RTL Transition Rules
- When the language is set to Arabic, the layout must **flip horizontally**:
    - Sidebars move to the right.
    - Logos usually move to the right.
    - Text alignment becomes `right`.
    - Directional icons (arrows) must be mirrored.
- Use **CSS Logical Properties** (e.g., `margin-inline-start` instead of `margin-left`) to handle this automatically where possible.

### 3. Typography Switching
- Map a separate Arabic font variable (e.g., `IBM Plex Sans Arabic` or `Cairo`) that activates when `[lang="ar"]` is present.
- Adjust font sizes: Arabic text often requires 10-15% larger font size than English to be equally legible at small scales.

### 4. Logic & Storage
- Persist the language choice in `localStorage`.
- Use a dictionary object in JS or a data-driven approach for UI translations.

---

## STEP 8 — Quality Checklist

Before presenting the artifact, verify:

- [ ] Cover page uses brand colors + large display typography
- [ ] All 4 sections present with intro divider cards
- [ ] Color swatches show HEX + RGB + CMYK values
- [ ] At least 3 font weights showcased with full alphabet specimens
- [ ] Logo usage grid has at least 4 correct + 4 incorrect examples
- [ ] Type hierarchy section shows H1 → H2 → H3 → Body progression
- [ ] At least one interactive element (hover on swatches, active nav link highlighting)
- [ ] Sidebar navigation links to every section
- [ ] Document is self-contained (no broken external links)
- [ ] The visual design of the document itself matches the brand

---

## Reference Files

- `/references/sections.md` — Detailed content spec for each of the 4 sections
- `/references/font-pairings.md` — Recommended Google Font pairings by industry/personality
- `/references/color-systems.md` — How to build a full color system from 1–2 seed colors