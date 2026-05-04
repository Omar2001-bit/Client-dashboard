/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Optimizers — pastel green primary
        brand: {
          50: "#f0fcf3",
          100: "#dcf9e3",
          200: "#bbf2c7",
          300: "#9eecae",
          400: "#83e8a4",
          500: "#6ae499", // brand primary
          600: "#4dd083",
          700: "#3ab36c",
          800: "#308d56",
          900: "#235b3c",
        },
        // Optimizers — deep navy dark backgrounds
        ink: {
          DEFAULT: "#0e1c26",
          deep: "#020601",
          800: "#162a37",
          700: "#1f3a4a",
        },
      },
      fontFamily: {
        sans: ["Sora", "ui-sans-serif", "system-ui", "sans-serif"],
        display: ["Sora", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      borderRadius: {
        // 16px brand radius for cards
        brand: "1rem",
      },
    },
  },
  plugins: [],
};
