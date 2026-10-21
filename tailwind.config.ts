import type { Config } from "tailwindcss";

/**
 * Black & signal-yellow theme. `slate` is replaced by a neutral graphite scale so every existing
 * slate-* class follows the theme; `brand` is the signal yellow (buttons, active states, focus).
 */
const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#fffbe0",
          100: "#fff4b3",
          200: "#ffea75",
          300: "#ffe14d",
          400: "#ffd91f",
          500: "#ffd400",
          600: "#e6be00",
          700: "#b39300",
          800: "#806a00",
          900: "#4d4000",
        },
        slate: {
          50: "#f7f7f4",
          100: "#eeeeea",
          200: "#deded8",
          300: "#c4c4bc",
          400: "#9a9a92",
          500: "#74746d",
          600: "#55554f",
          700: "#3a3a36",
          800: "#242422",
          900: "#141413",
          950: "#000000",
        },
      },
      fontFamily: {
        sans: ["Archivo", "ui-sans-serif", "system-ui", "-apple-system", "Segoe UI", "Roboto", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
