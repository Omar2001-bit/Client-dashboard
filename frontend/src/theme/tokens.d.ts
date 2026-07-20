// Type declarations for tokens.js (the plain-JS single source of truth so that
// tailwind.config.js can import it). Keep in sync with tokens.js.

export const palette: {
  pastelGreen: string;
  bigStone: string;
  blackForest: string;
  white: string;
  canvas: string;
};

export const brand: Record<number, string>;

export const ink: { DEFAULT: string; deep: string } & Record<number, string>;

export const channels: { ink: string; inkDeep: string; brand: string };

export const shadows: Record<string, string>;

export const radii: Record<string, string>;

export const motion: { fast: string; base: string; slow: string };
