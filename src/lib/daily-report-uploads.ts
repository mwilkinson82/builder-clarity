// Daily-log attachment upload pipeline (IOR/Project module).
//
// Field reality (2026-07-09): supers save the daily log from the job site on
// cellular data, attaching 8–13 MB camera photos. The old flow uploaded every
// photo sequentially BEFORE the report row was written, with no progress
// feedback — a multi-minute frozen "Saving…" where any network blip, screen
// lock, or navigation killed the whole save and lost the typed log. This
// module owns the pieces that fix that:
//   - attachment type inference (camera files can carry an empty MIME type —
//     infer from the extension instead of rejecting the whole batch)
//   - client-side photo compression (longest edge capped, JPEG re-encode) so
//     a 10 MB photo becomes ~1 MB before it touches the wire
//   - a small concurrency pool with per-file retries, an attempt timeout, and
//     progress callbacks, so uploads survive flaky connections and the UI can
//     say exactly where it is
// The React workspace saves the report text FIRST, then runs this pipeline.

import type { DailyReportAttachment } from "@/lib/daily-reports.functions";

export const DAILY_REPORT_MAX_FILE_BYTES = 25 * 1024 * 1024;

// Only re-encode when it can actually help: canvas can decode these, and
// anything already under the threshold uploads fast enough as-is.
export const COMPRESS_MIN_BYTES = 1.5 * 1024 * 1024;
export const COMPRESS_MAX_EDGE = 2048;
export const COMPRESS_QUALITY = 0.82;

const COMPRESSIBLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
]);

const EXTENSION_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heic",
};

// Real devices declare nonstandard spellings for supported formats — accept
// them instead of rejecting the batch.
const TYPE_ALIASES: Record<string, string> = {
  "image/jpg": "image/jpeg",
  "image/pjpeg": "image/jpeg",
  "image/heif": "image/heic",
  "image/heif-sequence": "image/heic",
  "image/heic-sequence": "image/heic",
};

// Browsers sometimes hand over camera files with an empty, generic, or
// aliased MIME type; normalizing and falling back to the extension keeps a
// legitimate photo from bombing the whole save. Unknown declared types come
// back verbatim so validation can name what it rejected.
export function inferAttachmentType(name: string, declaredType: string): string {
  const declaredRaw = declaredType.trim().toLowerCase();
  const declared = TYPE_ALIASES[declaredRaw] ?? declaredRaw;
  if (ALLOWED_TYPES.has(declared)) return declared;
  const extension = /\.([a-z0-9]+)$/i.exec(name.trim())?.[1]?.toLowerCase() ?? "";
  const fromExtension = EXTENSION_TYPES[extension];
  if (fromExtension) return fromExtension;
  return declared === "application/octet-stream" ? "" : declared;
}

export function isAllowedAttachmentType(type: string): boolean {
  return ALLOWED_TYPES.has(type);
}

export function shouldCompressAttachment(type: string, bytes: number): boolean {
  return COMPRESSIBLE_TYPES.has(type) && bytes >= COMPRESS_MIN_BYTES;
}

export function scaleToFit(
  width: number,
  height: number,
  maxEdge: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

export interface PreparedUpload {
  blob: Blob;
  contentType: string;
  uploadName: string;
  bytes: number;
}

// Shrink a photo for upload; on ANY problem (undecodable file, HEIC in a
// browser that can't rasterize it, canvas quirks) fall back to the original
// bytes — compression is an optimization, never a gate.
export async function prepareAttachmentForUpload(file: File): Promise<PreparedUpload> {
  const contentType = inferAttachmentType(file.name, file.type);
  const passthrough: PreparedUpload = {
    blob: file,
    contentType,
    uploadName: file.name,
    bytes: file.size,
  };
  if (!shouldCompressAttachment(contentType, file.size)) return passthrough;
  if (typeof document === "undefined") return passthrough;

  let objectUrl: string | null = null;
  try {
    let source: CanvasImageSource;
    let width = 0;
    let height = 0;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      source = bitmap;
      width = bitmap.width;
      height = bitmap.height;
    } catch {
      objectUrl = URL.createObjectURL(file);
      const image = new Image();
      image.src = objectUrl;
      await image.decode();
      source = image;
      width = image.naturalWidth;
      height = image.naturalHeight;
    }
    if (!width || !height) return passthrough;

    const target = scaleToFit(width, height, COMPRESS_MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const context = canvas.getContext("2d");
    if (!context) return passthrough;
    // JPEG has no alpha — flatten transparent PNG/WebP onto white, not black.
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, target.width, target.height);
    context.drawImage(source, 0, 0, target.width, target.height);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", COMPRESS_QUALITY),
    );
    if (!blob || blob.size >= file.size) return passthrough;

    return {
      blob,
      contentType: "image/jpeg",
      uploadName: `${file.name.replace(/\.[a-z0-9]+$/i, "")}.jpg`,
      bytes: blob.size,
    };
  } catch {
    return passthrough;
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  }
}

export interface UploadFailure {
  file: File;
  error: string;
}

export interface UploadRunResult<T> {
  ok: T[];
  failed: UploadFailure[];
}

export interface UploadRunOptions {
  concurrency?: number;
  attempts?: number;
  // A number, or a per-file function (big non-compressible files need longer).
  attemptTimeoutMs?: number | ((file: File) => number);
  retryDelayMs?: number;
  onProgress?: (done: number, total: number) => void;
}

// The timeout is a hang-guard, not a speed limit: allow ~25 KB/s (slow but
// moving cellular) before calling an attempt dead, with a two-minute floor.
// A 12 MB HEIC gets ~8 minutes per attempt instead of dying at 120s on the
// slow links this pipeline exists for; a truly hung transfer still times out.
export function attachmentAttemptTimeoutMs(bytes: number): number {
  return Math.max(120_000, Math.ceil(bytes / (25 * 1024)) * 1000);
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> => {
  if (!Number.isFinite(ms) || ms <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("The upload timed out — the connection may have dropped.")),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
};

// Run every upload through a small worker pool. One file failing (after its
// retries) never stops the others; `ok` keeps the input order so the saved
// manifest reads the way the user picked the photos.
export async function uploadFilesWithRetry<T>(
  files: readonly File[],
  upload: (file: File) => Promise<T>,
  options: UploadRunOptions = {},
): Promise<UploadRunResult<T>> {
  const concurrency = Math.max(1, options.concurrency ?? 2);
  const attempts = Math.max(1, options.attempts ?? 3);
  const attemptTimeout =
    options.attemptTimeoutMs ?? ((file: File) => attachmentAttemptTimeoutMs(file.size));
  const timeoutFor = typeof attemptTimeout === "function" ? attemptTimeout : () => attemptTimeout;
  const retryDelayMs = options.retryDelayMs ?? 750;

  const results = new Array<{ value: T } | undefined>(files.length);
  const failures = new Array<UploadFailure | undefined>(files.length);
  let nextIndex = 0;
  let doneCount = 0;
  options.onProgress?.(0, files.length);

  const worker = async () => {
    while (nextIndex < files.length) {
      const index = nextIndex;
      nextIndex += 1;
      const file = files[index];
      let lastError = "";
      for (let attempt = 1; attempt <= attempts; attempt += 1) {
        if (attempt > 1 && retryDelayMs > 0) await sleep(retryDelayMs * (attempt - 1));
        try {
          results[index] = { value: await withTimeout(upload(file), timeoutFor(file)) };
          lastError = "";
          break;
        } catch (error) {
          lastError = error instanceof Error ? error.message : "The upload failed.";
        }
      }
      if (lastError) failures[index] = { file, error: lastError };
      doneCount += 1;
      options.onProgress?.(doneCount, files.length);
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, worker));

  return {
    ok: results.flatMap((entry) => (entry ? [entry.value] : [])),
    failed: failures.filter((failure): failure is UploadFailure => Boolean(failure)),
  };
}

// Fold freshly-uploaded attachments into a report's manifest without ever
// duplicating a storage path (re-saves and retries make duplicates easy).
export function mergeAttachmentManifest(
  existing: DailyReportAttachment[],
  uploaded: DailyReportAttachment[],
): DailyReportAttachment[] {
  const seenPaths = new Set(existing.map((attachment) => attachment.path));
  return [...existing, ...uploaded.filter((attachment) => !seenPaths.has(attachment.path))];
}
