/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/web/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        "sb-blue": "#0867f5",
        "sb-blue-hover": "#0657d4",
        "sb-ink": "#0b1220",
        "sb-ink-2": "#3a4352",
        "sb-muted": "#6b7380",
        "sb-line": "rgba(11, 18, 32, 0.08)",
        "sb-surface": "#ffffff",
        "sb-mist": "#d0cdc7",
      },
      fontFamily: {
        "sb-serif": ["Instrument Serif", "ui-serif", "Georgia", "serif"],
        "sb-sans": ["Geist Variable", "ui-sans-serif", "system-ui", "sans-serif"],
        "sb-google": ["Roboto", "Helvetica Neue", "Arial", "sans-serif"],
        "sb-system": ["-apple-system", "BlinkMacSystemFont", "Helvetica Neue", "system-ui", "sans-serif"],
      },
      boxShadow: {
        "sb-float": "0 24px 60px rgba(11, 18, 32, 0.14)",
      },
      keyframes: {
        // Starts at 0.01, not 0: Chrome never counts a first paint at opacity 0 as the Largest Contentful Paint.
        "sb-rise": {
          from: { opacity: "0.01", transform: "translate3d(0, var(--sb-rise, 16px), 0)" },
          to: { opacity: "1", transform: "none" },
        },
      },
      animation: {
        "sb-rise": "sb-rise 600ms cubic-bezier(0.16, 1, 0.3, 1) both",
        "sb-rise-slow": "sb-rise 800ms cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
