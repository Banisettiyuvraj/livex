/**
 * YouTube source parsing — the only place a pasted URL is trusted.
 *
 * Pure functions, no DOM, no globals: unit-testable in Node and safe to call
 * before any YouTube code is loaded.
 *
 * SECURITY: the video id is the *only* value that ever reaches the embed URL,
 * and it is validated against YouTube's own id alphabet (exactly 11 chars from
 * `[A-Za-z0-9_-]`). Nothing else from the pasted text is interpolated into a
 * URL, so a hostile paste cannot inject parameters or a different origin.
 */

/** A resolved, safe-to-embed YouTube source. */
export interface YouTubeSource {
  kind: "video";
  /** Validated 11-character video id. */
  videoId: string;
  /** Offset to begin at, in seconds (from `?t=` / `&start=`), else 0. */
  startAt: number;
}

/** A YouTube playlist URL: recognised, but not playable as a single session. */
export interface YouTubePlaylistSource {
  kind: "playlist";
  playlistId: string;
}

export type YouTubeParseResult =
  | { ok: true; source: YouTubeSource }
  | { ok: true; source: YouTubePlaylistSource }
  | { ok: false; reason: string };

/** YouTube ids are exactly 11 characters of this alphabet. */
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
/** Playlist ids are longer and always start with PL/UU/OL/LL/FL/RD. */
const PLAYLIST_ID = /^(PL|UU|OL|LL|FL|RD)[A-Za-z0-9_-]{10,}$/;

/** Hosts we accept, after stripping a leading `www.` / `m.` / `music.`. */
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "youtu.be",
  "youtube-nocookie.com",
  "m.youtube.com",
  "music.youtube.com",
]);

/** Path prefixes that carry a video id as their next segment. */
const ID_IN_PATH = ["embed", "shorts", "live", "v"];

function normaliseHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
}

/**
 * Parse a `t` / `start` value into seconds.
 * Accepts `90`, `90s`, `1m30s`, `1h2m3s`, and `1:30` / `1:02:03`.
 * Returns 0 for anything unparseable rather than throwing.
 */
export function parseTimeParam(raw: string | null | undefined): number {
  if (!raw) return 0;
  const value = raw.trim().toLowerCase();
  if (value === "") return 0;

  // Pure seconds: "90" or "90s"
  const plain = /^(\d+(?:\.\d+)?)s?$/.exec(value);
  if (plain) return Math.max(0, Math.floor(Number(plain[1])));

  // Unit form: "1h2m3s"
  if (/^\d+h|\d+m|\d+s/.test(value) && /^(\d+h)?(\d+m)?(\d+s)?$/.test(value)) {
    const h = Number(/(\d+)h/.exec(value)?.[1] ?? 0);
    const m = Number(/(\d+)m/.exec(value)?.[1] ?? 0);
    const s = Number(/(\d+)s/.exec(value)?.[1] ?? 0);
    return Math.max(0, h * 3600 + m * 60 + s);
  }

  // Clock form: "1:30" or "1:02:03"
  if (/^\d+(?::\d{1,2}){1,2}$/.test(value)) {
    const parts = value.split(":").map((part) => Number(part));
    if (parts.some((part) => !Number.isFinite(part))) return 0;
    return parts.reduce((total, part) => total * 60 + part, 0);
  }

  return 0;
}

/** Wrap a validated id in the success shape, reading a start offset. */
function videoResult(videoId: string, startAt = 0): YouTubeParseResult {
  if (!VIDEO_ID.test(videoId)) {
    return { ok: false, reason: "That does not look like a YouTube video ID." };
  }
  return { ok: true, source: { kind: "video", videoId, startAt: Math.max(0, startAt) } };
}

/**
 * Parse one candidate URL or bare video id.
 *
 * Accepts, with or without a scheme:
 *   https://www.youtube.com/watch?v=VIDEOID&t=90s
 *   https://youtu.be/VIDEOID?t=90
 *   https://www.youtube.com/embed/VIDEOID
 *   https://www.youtube.com/shorts/VIDEOID
 *   https://www.youtube.com/live/VIDEOID
 *   VIDEOID                      (bare 11-character id)
 */
export function parseYouTubeUrl(input: string): YouTubeParseResult {
  const text = (input ?? "").trim();
  if (text === "") return { ok: false, reason: "Nothing was pasted." };

  // Bare id.
  if (VIDEO_ID.test(text)) return videoResult(text);

  // Tolerate a missing scheme ("youtu.be/x", "www.youtube.com/watch?v=x").
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(text) ? text : `https://${text}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "That is not a valid link." };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http(s) YouTube links are supported." };
  }

  const host = normaliseHost(url.hostname);
  if (!YOUTUBE_HOSTS.has(host)) {
    return {
      ok: false,
      reason: "That link is not from YouTube. Paste a youtube.com or youtu.be link.",
    };
  }

  const startAt = Math.max(
    parseTimeParam(url.searchParams.get("t")),
    parseTimeParam(url.searchParams.get("start")),
    parseTimeParam(url.hash.replace(/^#/, "").replace(/^t=/, "")),
  );

  // youtu.be/<id> and /<prefix>/<id>
  const segments = url.pathname.split("/").filter(Boolean);

  if (host === "youtu.be") {
    if (segments.length === 0) return { ok: false, reason: "That youtu.be link has no video ID." };
    return videoResult(segments[0] ?? "", startAt);
  }

  if (segments.length > 0 && ID_IN_PATH.includes(segments[0] ?? "")) {
    const id = segments[1];
    if (!id) {
      const list = url.searchParams.get("list");
      if (list && PLAYLIST_ID.test(list)) {
        return { ok: true, source: { kind: "playlist", playlistId: list } };
      }
      return { ok: false, reason: `That YouTube ${segments[0]} link has no video ID.` };
    }
    return videoResult(id, startAt);
  }

  if (url.pathname === "/watch" || url.searchParams.has("v")) {
    const id = url.searchParams.get("v") ?? "";
    if (id === "") {
      const list = url.searchParams.get("list");
      if (list && PLAYLIST_ID.test(list)) {
        return { ok: true, source: { kind: "playlist", playlistId: list } };
      }
      return { ok: false, reason: "That YouTube link has no video ID." };
    }
    return videoResult(id, startAt);
  }

  const list = url.searchParams.get("list");
  if (list && PLAYLIST_ID.test(list)) {
    return { ok: true, source: { kind: "playlist", playlistId: list } };
  }

  return {
    ok: false,
    reason: "That YouTube link does not point at a single video.",
  };
}

/**
 * Find the first YouTube link inside arbitrary pasted text.
 *
 * Users paste share sheets, chat messages and whole lines, so we scan for a
 * plausible URL rather than requiring the paste to *be* one.
 */
export function firstYouTubeSource(input: string): YouTubeParseResult {
  const text = (input ?? "").trim();
  if (text === "") return { ok: false, reason: "Nothing was pasted." };

  // The whole paste is the common case.
  const direct = parseYouTubeUrl(text);
  if (direct.ok) return direct;

  // Otherwise pull out URL-shaped runs and try each.
  const candidates = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  for (const candidate of candidates) {
    const result = parseYouTubeUrl(candidate);
    if (result.ok) return result;
  }

  // A bare id on its own line, e.g. copied from a share sheet.
  for (const token of text.split(/\s+/)) {
    if (VIDEO_ID.test(token)) return videoResult(token);
  }

  // Report the most specific failure we produced for the whole paste.
  return direct;
}

/**
 * Build the embed URL. The id is pre-validated; nothing else is interpolated.
 *
 * `YouTubeAdapter` hands these same parameters to `YT.Player` and lets the API
 * construct the iframe (the API replaces its target element, so it cannot be
 * given a ready-made iframe). This function is the unit-tested contract for the
 * exact URL shape and origin/parameter set that results, which is why the
 * security-critical part is asserted here rather than only in the browser.
 */
export function buildEmbedUrl(
  source: YouTubeSource,
  options: { origin?: string; controls?: boolean } = {},
): string {
  const params = new URLSearchParams({
    enablejsapi: "1",
    playsinline: "1",
    rel: "0",
    controls: options.controls === false ? "0" : "1",
  });
  if (source.startAt > 0) params.set("start", String(source.startAt));
  if (options.origin) params.set("origin", options.origin);
  return `https://www.youtube-nocookie.com/embed/${source.videoId}?${params.toString()}`;
}
