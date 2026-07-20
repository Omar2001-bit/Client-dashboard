/** @type {import('tailwindcss').Config} */
import { brand, ink, palette, shadows, radii } from "./src/theme/tokens.js";

export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand, // Pastel Green ramp (500 = #6ae499)
        ink, // Big Stone (DEFAULT) → Black Forest (deep), the brand darks
        canvas: palette.canvas, // #f7fafb page background
      },
      fontFamily: {
        // Sora — the brand's English typeface (loaded via index.css @import + index.html preconnect)
        sans: ["Sora", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Sora", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        brand: radii.brand, // 16px brand radius for cards
      },
      boxShadow: {
        card: shadows.card,
        "card-hover": shadows["card-hover"],
        pop: shadows.pop,
        overlay: shadows.overlay,
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
        "pop-in": {
          from: { opacity: "0", transform: "scale(0.96)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "rise-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "check-pop": {
          "0%": { transform: "scale(0)" },
          "60%": { transform: "scale(1.15)" },
          "100%": { transform: "scale(1)" },
        },
      },
      animation: {
        "fade-in": "fade-in 150ms ease-out",
        "pop-in": "pop-in 120ms ease-out",
        "rise-in": "rise-in 200ms ease-out",
        "check-pop": "check-pop 200ms ease-out",
      },
    },
  },
  plugins: [],
};
