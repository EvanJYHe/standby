/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/web/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#f2f0e9",
        panel: "#faf9f5",
        ink: "#101722",
        muted: "#667080",
        line: "#deddd6",
        "standby": "#f36f56",
        "standby-dark": "#d95d47",
        amber: "#eaa63a",
        "amber-soft": "#fff5df",
        "landing-paper": "#f2f0e9",
        "landing-panel": "#faf9f5",
        "landing-ink": "#101722",
        "landing-muted": "#667080",
        "landing-coral": "#f36f56",
        "landing-coral-soft": "#fbe1d9",
        "landing-sage": "#dbe5d9",
        "landing-sage-ink": "#3b5941",
        "landing-blue": "#dae5f4",
      },
      fontFamily: {
        sans: ["Instrument Sans", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
        "landing-sans": ["Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
        "landing-serif": ["Iowan Old Style", "Baskerville", "Times New Roman", "serif"],
      },
      borderRadius: {
        "standby": "10px",
      },
      boxShadow: {
        panel: "0 14px 36px rgba(16, 23, 34, 0.07)",
      },
    },
  },
  plugins: [],
};
