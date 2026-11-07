import { defineConfig } from "vite";
import { inlineSingleFile } from "./vite-plugins/inline-single-file";

/**
 * LiveX build config.
 *
 * LiveX is a static, local-first site: video bytes are read from the user's
 * device with the File API and played through an object URL. Nothing is ever
 * posted to a server.
 *
 * Two deployment shapes must both work:
 *   1. Served over http(s) — GitHub Pages, Netlify, `npm run preview`.
 *   2. Opened directly from disk (`double-click dist/index.html`, `file://`).
 *
 * For (2) the bundle must be a single self-contained file. `file://` refuses
 * ES module imports and cross-origin stylesheet/style fetches, so:
 *   - `base: "./"` keeps asset URLs relative,
 *   - `modulePreload: false` stops Vite emitting modulepreload `<link>`s,
 *   - CSS is inlined into the HTML (`cssCodeSplit: false` + inlining below),
 *   - and `appType: "spa"`/file names are kept flat.
 */
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    // Inline everything: `file://` cannot fetch sibling assets reliably.
    assetsInlineLimit: 4096,
    cssCodeSplit: false,
    modulePreload: false,
    sourcemap: false,
    rollupOptions: {
      output: {
        // IIFE (not ESM) so the inlined script is valid as a *classic* script,
        // which is the only kind `file://` will execute.
        format: "iife",
        inlineDynamicImports: true,
        entryFileNames: "assets/livex.js",
        assetFileNames: "assets/livex.[ext]",
      },
    },
  },
  plugins: [inlineSingleFile()],
  server: {
    port: 5173,
    open: false,
  },
});
