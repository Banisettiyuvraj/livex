/**
 * Taking notes out of LiveX: Markdown, JSON backups and their parser.
 *
 * Everything here is pure so it can be unit-tested without a browser and so no
 * export path can accidentally reach the network. A backup contains the same
 * metadata the local store already keeps — never media bytes, frames or paths.
 */

import {
  mediaFingerprint,
  type Annotation,
  type AnnotationKind,
} from "../files/LocalMetadataStore";

export const ANNOTATION_BACKUP_FORMAT = "livex.annotations";
export const ANNOTATION_BACKUP_VERSION = 1;
/** Matches the note-text cap enforced when a note is written. */
const MAX_NOTE_LENGTH = 500;

/** The file identity a backup was made against, used to rebuild its mediaKey. */
export interface AnnotationBackupMedia {
  fileName: string;
  fileSize: number;
  duration: number;
}

export interface AnnotationBackup {
  format: typeof ANNOTATION_BACKUP_FORMAT;
  version: number;
  /** ISO timestamp. */
  exportedAt: string;
  media: AnnotationBackupMedia | null;
  annotations: Annotation[];
}

export type AnnotationBackupParseResult =
  | { ok: true; annotations: Annotation[]; media: AnnotationBackupMedia | null }
  | { ok: false; error: string };

function stamp(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const rest = Math.floor(safe % 60);
  const mm = String(minutes).padStart(2, "0");
  const ss = String(rest).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

function countLine(annotations: readonly Annotation[]): string {
  const bookmarks = annotations.filter((annotation) => annotation.kind === "bookmark").length;
  const notes = annotations.length - bookmarks;
  return `${bookmarks} bookmark${bookmarks === 1 ? "" : "s"} · ${notes} note${
    notes === 1 ? "" : "s"
  }`;
}

function sorted(annotations: readonly Annotation[]): Annotation[] {
  return annotations
    .slice()
    .sort((a, b) => a.time - b.time || a.createdAt - b.createdAt);
}

/** A readable, portable lecture-notes document. */
export function annotationsToMarkdown(
  fileName: string,
  annotations: readonly Annotation[],
  exportedAt: Date = new Date(),
): string {
  const title = fileName.trim() || "Lecture";
  const lines = [
    `# ${title} — notes`,
    "",
    `_Exported from LiveX on ${exportedAt.toISOString().slice(0, 10)}._`,
  ];

  if (annotations.length === 0) {
    lines.push("", "_No bookmarks or notes for this lecture._");
    return `${lines.join("\n")}\n`;
  }

  lines.push(`_${countLine(annotations)}_`);

  for (const annotation of sorted(annotations)) {
    const kind = annotation.kind === "bookmark" ? "Bookmark" : "Note";
    lines.push("", `## ${stamp(annotation.time)} — ${kind}`);
    if (annotation.kind === "note") {
      lines.push("", annotation.text.trim() || "_No note text._");
    }
  }

  return `${lines.join("\n")}\n`;
}

export function buildAnnotationBackup(
  media: AnnotationBackupMedia | null,
  annotations: readonly Annotation[],
  exportedAt: Date = new Date(),
): AnnotationBackup {
  return {
    format: ANNOTATION_BACKUP_FORMAT,
    version: ANNOTATION_BACKUP_VERSION,
    exportedAt: exportedAt.toISOString(),
    media,
    annotations: sorted(annotations),
  };
}

export function serializeAnnotationBackup(backup: AnnotationBackup): string {
  return `${JSON.stringify(backup, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readMedia(value: unknown): AnnotationBackupMedia | null {
  if (!isRecord(value)) return null;
  const fileName = typeof value.fileName === "string" ? value.fileName.trim() : "";
  if (!fileName) return null;

  const fileSize = Number(value.fileSize);
  const duration = Number(value.duration);
  return {
    fileName,
    fileSize: Number.isFinite(fileSize) && fileSize >= 0 ? fileSize : 0,
    duration: Number.isFinite(duration) && duration >= 0 ? duration : 0,
  };
}

/**
 * Read a backup produced by {@link buildAnnotationBackup}.
 *
 * Validation is deliberately forgiving about missing convenience fields (an id
 * or mediaKey) but strict about what an annotation *is*: unknown kinds, negative
 * or non-numeric timestamps and non-object rows are dropped rather than guessed
 * at. A bare array of annotations is also accepted so hand-written files and
 * older exports still import.
 */
export function parseAnnotationBackup(
  text: string,
  now: number = Date.now(),
): AnnotationBackupParseResult {
  let root: unknown;
  try {
    root = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file is not valid JSON." };
  }

  if (isRecord(root) && typeof root.format === "string" && root.format !== ANNOTATION_BACKUP_FORMAT) {
    return { ok: false, error: "That file is not a LiveX notes backup." };
  }

  const media = isRecord(root) ? readMedia(root.media) : null;
  const rows = Array.isArray(root)
    ? root
    : isRecord(root) && Array.isArray(root.annotations)
      ? root.annotations
      : null;

  if (!rows) {
    return { ok: false, error: "That file does not contain any notes or bookmarks." };
  }

  const annotations: Annotation[] = [];

  rows.forEach((row, index) => {
    if (!isRecord(row)) return;

    const kind: AnnotationKind | null =
      row.kind === "bookmark" || row.kind === "note" ? row.kind : null;
    if (!kind) return;

    const time = Number(row.time);
    if (!Number.isFinite(time) || time < 0) return;

    const storedKey = typeof row.mediaKey === "string" ? row.mediaKey.trim() : "";
    const mediaKey =
      storedKey ||
      (media ? mediaFingerprint(media.fileName, media.fileSize, media.duration) : "");
    if (!mediaKey) return;

    const createdAt = Number(row.createdAt);
    const safeCreatedAt = Number.isFinite(createdAt) && createdAt > 0 ? createdAt : now;
    const text2 = typeof row.text === "string" ? row.text.trim().slice(0, MAX_NOTE_LENGTH) : "";

    annotations.push({
      id:
        typeof row.id === "string" && row.id.trim()
          ? row.id.trim()
          : `${mediaKey}:import-${index}-${safeCreatedAt.toString(36)}`,
      mediaKey,
      kind,
      time: Math.round(time * 10) / 10,
      text: text2,
      createdAt: safeCreatedAt,
    });
  });

  if (annotations.length === 0) {
    return { ok: false, error: "No bookmarks or notes could be read from that file." };
  }

  return { ok: true, annotations: sorted(annotations), media };
}
