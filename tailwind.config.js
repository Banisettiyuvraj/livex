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
      },
    },
  },
  // The CDN build loaded the `forms` and `container-queries` plugins.
  plugins: [require("@tailwindcss/forms"), require("@tailwindcss/container-queries")],
};
