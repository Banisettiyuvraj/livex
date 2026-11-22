/** Tailwind config mirrored from the previous CDN `tailwind.config` block. */
/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      colors: {
        /* Ink ramp for the control-desk theme. Surfaces stay near-neutral so
           the video and the signal-red tally carry the colour. */
        canvas: "#000000",
        surface: "#141820",
        "surface-hover": "#1c222c",
        "surface-active": "#252d3a",
        border: "#27303c",
        "border-subtle": "#1d242e",
        "muted-txt": "#9aa3b0",
        accent: "#e5484d",
        "accent-light": "#ffa3a3",
        "accent-purple": "#e5484d",
        "accent-purple-light": "#ffa3a3",
        "live-red": "#f04444",
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
