// =============================================================================
// Optimizers design tokens — SINGLE SOURCE OF TRUTH
// -----------------------------------------------------------------------------
// Extracted from `frontend/Optimizers Brand Guidelines.pdf` (see docs/brand/).
// Consumed by BOTH `tailwind.config.js` (utility classes) and app runtime code
// (`src/lib/ga4Reports/theme.ts` Recharts palette, inline styles). Plain ESM JS
// so the Node-run Tailwind config can import it; typed by the sibling tokens.d.ts.
//
// The brand defines only THREE colors + white:
//   • Pastel Green  #6ae499  — accents, fills, numbers, icons
//   • Big Stone     #162a3d  — "light black": body text, dark surfaces
//   • Black Forest  #020601  — "dark black": headlines, text-on-green, deepest bg
// =============================================================================

/** The three official brand colors + white/canvas. */
export const palette = {
  pastelGreen: "#6ae499",
  bigStone: "#162a3d",
  blackForest: "#020601",
  white: "#ffffff",
  canvas: "#f7fafb", // app page background
};

/**
 * Pastel-green ramp. `500` is the OFFICIAL brand green (#6ae499); the tints/shades
 * around it are derived for UI states (hover/active/subtle fills).
 */
export const brand = {
  50: "#f0fcf3",
  100: "#dcf9e3",
  200: "#bbf2c7",
  300: "#9eecae",
  400: "#83e8a4",
  500: "#6ae499", // Pastel Green — brand primary
  600: "#4dd083",
  700: "#3ab36c",
  800: "#308d56",
  900: "#235b3c",
};

/**
 * Ink (navy → near-black) ramp, re-anchored to the brand's two official darks:
 *   DEFAULT = Big Stone (#162a3d), deep/900 = Black Forest (#020601).
 * Almost all neutral/muted tones in the app are produced from these via Tailwind
 * opacity slashes (e.g. `text-ink/70`, `border-ink/10`).
 */
export const ink = {
  DEFAULT: "#162a3d", // Big Stone — primary text & dark surfaces
  deep: "#020601", // Black Forest — headlines, text-on-green, deepest bg
  700: "#1f3a4a", // lighter navy (elevated dark panels)
  800: "#162a37", // ~Big Stone (kept for existing bg-ink-800 usage)
  900: "#020601", // Black Forest alias
};

/** RGB channel triplets (comma form) for building rgba() strings at runtime. */
export const channels = {
  ink: "22,42,61", // Big Stone
  inkDeep: "2,6,1", // Black Forest
  brand: "106,228,153", // Pastel Green
};

/** Elevation scale — promoted from the app's previously-hardcoded arbitrary shadows. */
export const shadows = {
  card: "0 1px 3px rgba(22,42,61,0.04)",
  "card-hover": "0 4px 12px rgba(22,42,61,0.06)",
  pop: "0 10px 30px rgba(22,42,61,0.12)", // dropdowns / popovers
  overlay: "0 20px 60px rgba(22,42,61,0.25)", // dialogs / coach-marks
};

/** Border radius — 16px "brand" radius for cards (stock Tailwind radii cover the rest). */
export const radii = {
  brand: "1rem",
};

/** Motion durations (ms) for consistent transitions/animations. */
export const motion = {
  fast: "120ms",
  base: "200ms",
  slow: "300ms",
};
