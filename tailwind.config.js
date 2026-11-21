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
        canvas: "#170c0d",
        surface: "#241113",
        "surface-hover": "#2f171a",
        "surface-active": "#3a1d21",
        border: "#3d2126",
        "border-subtle": "#2b171a",
        "muted-txt": "#a19a9a",
        "accent-purple": "#dc2626",
        "accent-purple-light": "#fca5a5",
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
