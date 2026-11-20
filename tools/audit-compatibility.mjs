/**
 * Compatibility coverage audit (read-only).
 *
 * Cross-checks three independent sources that are easy to let drift apart:
 *   1. the fixtures that actually exist on disk   (tests/fixtures)
 *   2. the rows the E2E suite asserts against     (tests/e2e/livex.spec.ts)
 *   3. the matrix we document to users            (docs/COMPATIBILITY.md)
 *
 * Source 3 documents rows as *container + codec* (`MP4 (.mp4) | H.264 (avc1)`),
 * not as filenames — so documentation is matched via the container/codec
 * vocabulary below, never by filename substring.
 *
 * Run: node tools/audit-compatibility.mjs
 * Writes nothing. Exit code 1 if a fixture is untested or undocumented.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const FIXTURES_DIR = join(ROOT, "tests", "fixtures");
const SPEC = join(ROOT, "tests", "e2e", "livex.spec.ts");
const DOC = join(ROOT, "docs", "COMPATIBILITY.md");

/** Media fixtures only — caption files are covered by the subtitle suite. */
const MEDIA_EXT = /\.(mp4|mkv|mov|webm|avi|ts|mpg|ogg|flv)$/i;

/**
 * Fixture naming convention is `<video>[-<audio>].<container>`.
 * `containers` and `codecs` are the spellings the docs use for that family.
 */
const containers = [
  { test: /\.mp4$/, label: "MP4", docs: [/\bMP4\b/, /`\.mp4`/] },
  { test: /\.mkv$/, label: "MKV", docs: [/\bMKV\b/] },
  { test: /\.mov$/, label: "MOV", docs: [/\bMOV\b/] },
  { test: /\.webm$/, label: "WebM", docs: [/\bWebM\b/] },
  { test: /\.avi$/, label: "AVI", docs: [/\bAVI\b/] },
  { test: /\.ts$/, label: "MPEG-TS", docs: [/MPEG-TS/] },
  { test: /\.mpg$/, label: "MPEG-PS", docs: [/MPEG-PS/] },
  { test: /\.ogg$/, label: "Ogg", docs: [/\bOgg\b/] },
  { test: /\.flv$/, label: "FLV", docs: [/\bFLV\b/] },
];

const codecs = [
  { test: /h264|avc1/i, label: "H.264", docs: [/H\.264/, /avc1/] },
  { test: /hevc|hvc1|hev1/i, label: "HEVC", docs: [/HEVC/, /hvc1/, /hev1/] },
  { test: /av1/i, label: "AV1", docs: [/\bAV1\b/] },
  { test: /vp8/i, label: "VP8", docs: [/\bVP8\b/] },
  { test: /vp9/i, label: "VP9", docs: [/\bVP9\b/] },
  { test: /mpeg2/i, label: "MPEG-2", docs: [/MPEG-2/] },
  { test: /mpeg4/i, label: "MPEG-4", docs: [/MPEG-4/] },
];

const match = (table, value) => table.find((row) => row.test.test(value)) ?? null;

const fixtureNames = readdirSync(FIXTURES_DIR)
  .filter((name) => MEDIA_EXT.test(name))
  .sort();

const specText = readFileSync(SPEC, "utf8");
const docText = readFileSync(DOC, "utf8");

/** Rows the spec asserts, e.g. h264-aac.mp4 -> "play". */
const specRows = new Map();
for (const m of specText.matchAll(
  /\{\s*file:\s*"([^"]+)"\s*,\s*expect:\s*"(play|fail|either)"\s*\}/g,
)) {
  specRows.set(m[1], m[2]);
}

const rows = fixtureNames.map((file) => {
  const container = match(containers, file);
  const video = match(codecs, file);
  const documentedByContainer = Boolean(container?.docs.some((re) => re.test(docText)));
  const documentedByCodec = Boolean(video?.docs.some((re) => re.test(docText)));
  return {
    file,
    verdict: specRows.get(file) ?? null,
    container: container?.label ?? "unknown",
    video: video?.label ?? "unknown",
    tested: specRows.has(file),
    documented: documentedByContainer && documentedByCodec,
  };
});

const pad = (v, w) => String(v).padEnd(w);
/**
 * The compatibility matrix needs exactly one fixture per (container, codec)
 * pair. Extra fixtures for an already-covered pair exist to exercise *features*
 * (chapter atoms, long-file resume) and are not matrix gaps.
 */
const pairKey = (r) => `${r.container} · ${r.video}`;
const coveredPairs = new Set(rows.filter((r) => r.tested).map(pairKey));
const matrixCovered = (r) => coveredPairs.has(pairKey(r));

const uncoveredPairs = rows.filter((r) => !matrixCovered(r));
const undocumented = rows.filter((r) => !r.documented);
const extras = rows.filter((r) => !r.tested && matrixCovered(r));
const stale = [...specRows.keys()].filter((f) => !fixtureNames.includes(f));

console.log("\nLiveX — compatibility coverage audit\n");
console.log(
  `  ${pad("fixture", 22)} ${pad("container", 10)} ${pad("video", 8)} ${pad("spec", 8)} ${pad("docs", 5)} role`,
);
console.log(
  `  ${"-".repeat(22)} ${"-".repeat(10)} ${"-".repeat(8)} ${"-".repeat(8)} ${"-".repeat(5)} ----`,
);

for (const r of rows) {
  const role = r.tested
    ? "matrix row"
    : matrixCovered(r)
      ? "feature fixture (pair already covered)"
      : "NOT COVERED";
  const gap = !matrixCovered(r) || !r.documented;
  console.log(
    `  ${pad(r.file, 22)} ${pad(r.container, 10)} ${pad(r.video, 8)} ` +
      `${pad(r.tested ? r.verdict : "none", 8)} ${pad(r.documented ? "yes" : "NO", 5)} ${role}` +
      (gap ? "  <-- gap" : ""),
  );
}

const gaps = uncoveredPairs.length + undocumented.length;
console.log(
  `\n  ${rows.length} media fixtures · ${specRows.size} spec rows · ` +
    `${coveredPairs.size} container+codec pairs covered · ${gaps} coverage gaps`,
);
if (extras.length) {
  console.log(
    `  ${extras.length} extra fixture(s) for covered pairs (feature tests, not matrix rows): ` +
      extras.map((r) => r.file).join(", "),
  );
}

if (stale.length) console.log(`\n  WARNING: spec asserts missing files: ${stale.join(", ")}`);
if (uncoveredPairs.length)
  console.log(`  Uncovered pairs: ${uncoveredPairs.map((r) => `${pairKey(r)} (${r.file})`).join(", ")}`);
if (undocumented.length)
  console.log(`  Undocumented:    ${undocumented.map((r) => r.file).join(", ")}`);
if (!gaps && !stale.length)
  console.log("  Result: fixtures, spec and docs agree — every pair is asserted and documented.");
console.log("");

process.exitCode = gaps || stale.length ? 1 : 0;
