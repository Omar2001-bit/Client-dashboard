// Chart color constants for the Analytics Reports feature. These derive from the
// design-system token source of truth (`src/theme/tokens.js`) so there is ONE place
// that defines brand color — everything else (surfaces, borders, text) uses this
// app's Tailwind `brand`/`ink` tokens directly in JSX.
import { brand, ink, palette, channels } from "@/theme/tokens";

export const SERIES_A = brand[500]; // current period — Pastel Green (#6ae499)
export const SERIES_B = brand[700]; // previous period — a darker shade of the same green

// Categorical palette for multi-series/breakdown charts (pie, donut, multi-line by
// category) — tuned for a white background.
export const CATEGORICAL = [
  brand[700], // brand green
  "#2f6fb0",
  "#c9852f",
  "#b0473f",
  "#6f5fc9",
  "#1f9e9e",
  "#b0468a",
  "#7a8a3f",
];

export const DELTA_UP = brand[700];
export const DELTA_DOWN = "#c1443c";

export const GRID = "#e5e7eb";
export const AXIS = `rgba(${channels.ink},0.5)`; // ink/50
export const BASELINE = `rgba(${channels.ink},0.15)`; // ink/15

export const SURFACE = palette.white;
export const INK = ink.DEFAULT; // primary text (large numbers, headlines) — Big Stone
export const INK_SECONDARY = `rgba(${channels.ink},0.7)`; // ink/70
export const INK_MUTED = `rgba(${channels.ink},0.5)`; // ink/50
export const HOVER_CURSOR_FILL = `rgba(${channels.ink},0.04)`; // Recharts bar/cursor hover highlight
