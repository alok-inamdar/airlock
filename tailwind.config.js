/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          950: "#05070d",
          900: "#080c15",
          850: "#0b101c",
          800: "#0f1523",
          750: "#131a2b",
          700: "#1a2337",
          600: "#243049",
          500: "#33415c",
          400: "#5b6b87",
          300: "#8c9ab2",
          200: "#b9c4d6",
          100: "#dde4ef",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "SF Mono",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 18px 50px -30px rgba(0,0,0,0.9)",
        glow: "0 0 0 1px rgba(52,211,153,0.25), 0 24px 70px -40px rgba(16,185,129,0.55)",
        pane: "0 1px 0 0 rgba(255,255,255,0.05) inset, 0 30px 80px -50px rgba(0,0,0,1)",
      },
      keyframes: {
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "200% 0" },
          "100%": { backgroundPosition: "-200% 0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.55" },
        },
      },
      animation: {
        "fade-in": "fade-in 240ms ease-out both",
        shimmer: "shimmer 2.2s linear infinite",
        "pulse-soft": "pulse-soft 1.8s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
