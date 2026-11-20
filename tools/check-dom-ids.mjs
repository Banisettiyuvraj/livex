/**
 * DOM wiring check.
 *
 * `WorkspaceUI` reaches for elements by id at runtime; a typo there fails only
 * when the user happens to trigger that path — which is exactly how a feature
 * ships broken. This compares every id the source asks for against the ids the
 * markup actually defines.
 *
 * Run: node tools/check-dom-ids.mjs
 * Writes nothing. Exit code 1 if the source references an id the HTML lacks.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const HTML = join(ROOT, "index.html");
const SRC = join(ROOT, "src");

/** Ids the source looks up: getElementById("x") and el("x") / el<T>("x"). */
function referencedIds(source) {
  const ids = new Set();
  for (const m of source.matchAll(/getElementById\(\s*["'`]([^"'`]+)["'`]/g)) ids.add(m[1]);
  for (const m of source.matchAll(/\bel(?:<[^>]*>)?\(\s*["'`]([^"'`]+)["'`]/g)) ids.add(m[1]);
  return ids;
}

/** Every id="..." in the markup. */
function definedIds(html) {
  const ids = new Set();
  for (const m of html.matchAll(/\bid=["']([^"']+)["']/g)) ids.add(m[1]);
  return ids;
}

/**
 * Ids the source creates at runtime, so they are legitimately absent in HTML:
 * template-literal ids and `node.id = "..."` assignments anywhere in src/.
 */
function runtimeGeneratedIds(files) {
  const patterns = [];
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(/\.id\s*=\s*[`"']([^`"']+)[`"']/g)) patterns.push(m[1]);
    for (const m of source.matchAll(/\.id\s*=\s*`([^`]+)`/g)) {
      patterns.push(m[1].replace(/\$\{[^}]*\}/g, "*"));
    }
    for (const m of source.matchAll(/setAttribute\(\s*["']id["']\s*,\s*[`"']([^`"']+)[`"']/g)) {
      patterns.push(m[1]);
    }
  }
  return patterns;
}

function matchesPattern(id, pattern) {
  if (!pattern.includes("*")) return pattern === id;
  const escaped = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + escaped + "$").test(id);
}

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith(".ts")) out.push(full);
  }
  return out;
}

const html = readFileSync(HTML, "utf8");
const defined = definedIds(html);

const sourceFiles = walk(SRC);
const dynamic = runtimeGeneratedIds(sourceFiles);

const referenced = new Map();
for (const file of sourceFiles) {
  const source = readFileSync(file, "utf8");
  for (const id of referencedIds(source)) {
    if (!referenced.has(id)) referenced.set(id, []);
    referenced.get(id).push(file.replace(ROOT + "\\", ""));
  }
}

const missing = [...referenced.keys()]
  .filter((id) => !defined.has(id))
  .filter((id) => !dynamic.some((pattern) => matchesPattern(id, pattern)));

console.log(`\nLiveX — DOM id wiring check`);
console.log(`  ${defined.size} ids in index.html · ${referenced.size} ids referenced from src/`);

if (missing.length === 0) {
  console.log("  Result: every referenced id exists in the markup.\n");
  process.exitCode = 0;
} else {
  console.log(`\n  MISSING (${missing.length}) — these would throw or silently no-op at runtime:`);
  for (const id of missing) console.log(`    #${id}  ← ${referenced.get(id).join(", ")}`);
  console.log("");
  process.exitCode = 1;
}
