/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: { 50: "#eef5ff", 100: "#d9e8ff", 200: "#b6d3ff", 500: "#408dfb", 600: "#2f7ae8", 700: "#2563c9" },
        navy: { 800: "#262a3f", 900: "#1e2235" },
        ink: { 50: "#f6f7f9", 100: "#eceef2", 200: "#d5d9e0", 300: "#b4bac6", 400: "#9aa1b1", 500: "#6b7280", 600: "#4b5263", 700: "#2f3441", 800: "#1f2330", 900: "#141824" },
      },
      fontFamily: { sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "Roboto", "sans-serif"] },
      boxShadow: { card: "0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.06)" },
    },
  },
  plugins: [],
};
