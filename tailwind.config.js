/** Tailwind config mirrored from the previous CDN `tailwind.config` block. */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,js}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        canvas: "#121212",
        surface: "#202020",
        "surface-hover": "#2c2c2c",
        "surface-active": "#363636",
        border: "#2e2e2e",
        "border-subtle": "#242424",
        "muted-txt": "#8e8e93",
        "accent-purple": "#6965db",
        "accent-purple-light": "#a5a1f8",
        "live-red": "#ef4444",
        /**
         * The stock Tailwind 500/600 greys used for small labels are 3.95:1 and
         * 2.40:1 on the #121212 canvas — both below WCAG AA (4.5:1). These
         * values keep the same muted look at 5.7:1 and 5.1:1.
         */
        neutral: { 500: "#8e8e93", 600: "#85858b" },
      },
    },
  },
  // The CDN build loaded the `forms` and `container-queries` plugins.
  plugins: [require("@tailwindcss/forms"), require("@tailwindcss/container-queries")],
};
