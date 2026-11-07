/**
 * Produce a single self-contained `dist/index.html`.
 *
 * `file://` can load a classic <script> and an inline <style>, but it refuses
 * cross-origin stylesheet fetches and ES module graph imports (and any
 * `<link crossorigin>` always fails there). LiveX must keep working when the
 * folder is simply double-clicked, so the built CSS and JS are inlined.
 *
 * Fonts stay as separate files referenced by relative URL from the inlined CSS;
 * those load fine over `file://` because they are same-origin subresources and
 * are not subject to the stylesheet CORS check.
 */
import type { Plugin } from "vite";

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function inlineSingleFile(): Plugin {
  return {
    name: "livex:inline-single-file",
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      const htmlKey = Object.keys(bundle).find((key) => key.endsWith(".html"));
      if (!htmlKey) return;

      const htmlAsset = bundle[htmlKey];
      if (!htmlAsset || htmlAsset.type !== "asset") return;

      let html = String(htmlAsset.source);

      // 1. Inline stylesheets.
      for (const [key, asset] of Object.entries(bundle)) {
        if (asset.type !== "asset" || !key.endsWith(".css")) continue;

        const fileName = key.split("/").pop() ?? key;
        const linkRe = new RegExp(
          `<link[^>]*href="[^"]*${escapeForRegExp(fileName)}"[^>]*>`,
          "g",
        );
        if (!linkRe.test(html)) continue;

        const css = String(asset.source).replace(
          // The stylesheet is being moved from `assets/` into a <style> tag in
          // the HTML at the site root, so relative font URLs must be rebased.
          /url\((\.\/)([^)'"]*)\)/g,
          (_match, _prefix, file: string) => `url(assets/${file})`,
        );
        html = html.replace(linkRe, () => `<style>${css}</style>`);
        delete bundle[key];
      }

      // 2. Inline the entry script (classic, so file:// can execute it).
      for (const [key, chunk] of Object.entries(bundle)) {
        if (chunk.type !== "chunk") continue;

        const fileName = key.split("/").pop() ?? key;
        const scriptRe = new RegExp(
          `<script[^>]*src="[^"]*${escapeForRegExp(fileName)}"[^>]*>\\s*</script>`,
          "g",
        );
        if (!scriptRe.test(html)) continue;

        const code = chunk.code
          // An IIFE-style bundle has no static imports left, but strip any
          // stray top-level import as a safety net.
          .replace(/^\s*import\s.*?;\s*$/gm, "")
          .replace(/<\/script/gi, "<\\/script");

        html = html.replace(scriptRe, () => `<script>${code}</script>`);
        delete bundle[key];
      }

      htmlAsset.source = html;
    },
  };
}
