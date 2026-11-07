import { defineConfig } from "vite";

/**
 * LiveX build config.
 *
 * LiveX is a static, local-first site: video bytes are read from the user's
 * device with the File API and played through an object URL. Nothing is ever
 * posted to a server. Keep `base: "./"` so the built bundle also works when the
 * folder is opened from a plain static host / sub-path.
 */
export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    outDir: "dist",
    assetsInlineLimit: 0,
    sourcemap: true,
  },
  server: {
    port: 5173,
    open: false,
  },
});
