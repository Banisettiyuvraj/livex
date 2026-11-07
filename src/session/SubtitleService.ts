/**
 * SubtitleService — local-only caption support (roadmap 2.5).
 *
 * Handles `.vtt` and `.srt` picked from the device. Nothing is fetched: the
 * text is read with the File API, converted to WebVTT in memory and attached
 * via a `blob:` track URL that is revoked on replace.
 *
 * SRT → VTT is a small, well-specified transform:
 *   - add the WEBVTT header
 *   - `00:00:01,000 --> 00:00:04,000` becomes `00:00:01.000 --> 00:00:04.000`
 *   - strip SRT numeric cue indices (VTT allows them but they confuse parsers
 *     when followed by no cue id)
 */

export type SubtitleFormat = "vtt" | "srt" | "unknown";

export interface SubtitleTrackInfo {
  fileName: string;
  format: SubtitleFormat;
  cueCount: number;
  /** Object URL handed to `<track src>`; revoke once detached. */
  url: string;
}

/** Cap the file size we are willing to parse — captions are tiny in practice. */
const MAX_SUBTITLE_BYTES = 8 * 1024 * 1024;

export function detectSubtitleFormat(fileName: string): SubtitleFormat {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".vtt")) return "vtt";
  if (lower.endsWith(".srt")) return "srt";
  return "unknown";
}

/** Convert SRT text to WebVTT. Exported for unit testing. */
export function srtToVtt(input: string): string {
  const normalized = input.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const blocks = normalized.split(/\n{2,}/);
  const out: string[] = ["WEBVTT", ""];

  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => line.trim() !== "");
    if (lines.length === 0) continue;

    // Drop a bare leading cue index ("12").
    const start = /^\d+$/.test(lines[0]!.trim()) ? 1 : 0;
    const body = lines.slice(start);
    if (body.length === 0) continue;

    const timingIndex = body.findIndex((line) => line.includes("-->"));
    if (timingIndex < 0) continue;

    const timing = body[timingIndex]!.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
    const text = body.slice(timingIndex + 1);
    if (text.length === 0) continue;

    out.push(timing.trim(), ...text, "");
  }

  return out.join("\n");
}

/** Strip WebVTT markup for the cue-count estimate and plain-text fallback. */
function countCues(vtt: string): number {
  return vtt.split(/\n{2,}/).filter((block) => block.includes("-->")).length;
}

export class SubtitleService {
  private current: SubtitleTrackInfo | null = null;
  private readonly listeners = new Set<(info: SubtitleTrackInfo | null) => void>();

  getCurrent(): SubtitleTrackInfo | null {
    return this.current;
  }

  onTrackChange(listener: (info: SubtitleTrackInfo | null) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Read a caption file from disk, convert if needed, and register it. */
  async load(file: File): Promise<SubtitleTrackInfo> {
    const format = detectSubtitleFormat(file.name);
    if (format === "unknown") {
      throw new Error(`Unsupported subtitle format: ${file.name}. Use .vtt or .srt.`);
    }
    if (file.size > MAX_SUBTITLE_BYTES) {
      throw new Error("That subtitle file is too large (over 8 MB).");
    }

    const text = await file.text();
    const vtt = format === "srt" ? srtToVtt(text) : text;
    const cueCount = countCues(vtt);

    if (cueCount === 0) {
      throw new Error(`No cues found in ${file.name}. Is it a valid caption file?`);
    }

    this.disposeCurrent();
    const url = URL.createObjectURL(new Blob([vtt], { type: "text/vtt" }));

    const info: SubtitleTrackInfo = { fileName: file.name, format, cueCount, url };
    this.current = info;
    for (const listener of [...this.listeners]) listener(info);

    return info;
  }

  /** Attach to a video element without leaking the previous object URL. */
  attachTo(video: HTMLVideoElement, info: SubtitleTrackInfo): void {
    for (const existing of [...video.querySelectorAll("track")]) existing.remove();

    const track = document.createElement("track");
    track.kind = "subtitles";
    track.label = info.fileName;
    track.srclang = "en";
    track.src = info.url;
    track.default = true;
    video.append(track);
  }

  detachFrom(video: HTMLVideoElement): void {
    for (const existing of [...video.querySelectorAll("track")]) existing.remove();
    this.clear();
  }

  clear(): void {
    this.disposeCurrent();
    for (const listener of [...this.listeners]) listener(null);
  }

  isToggledOn(video: HTMLVideoElement): boolean {
    const list = video.textTracks;
    return list.length > 0 && list[0]?.mode === "showing";
  }

  setEnabled(video: HTMLVideoElement, enabled: boolean): void {
    const list = video.textTracks;
    if (list.length === 0) return;
    list[0]!.mode = enabled ? "showing" : "hidden";
  }

  private disposeCurrent(): void {
    if (this.current) {
      URL.revokeObjectURL(this.current.url);
      this.current = null;
    }
  }

  dispose(): void {
    this.disposeCurrent();
    this.listeners.clear();
  }
}
