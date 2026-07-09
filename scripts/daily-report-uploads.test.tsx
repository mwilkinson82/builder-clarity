// DAILY LOG SAVE regression (Darian, 2026-07-09): a super saving the daily
// log from the job site on cellular lost the whole report — typed text
// included — when one 10 MB photo upload died mid-batch, and a frozen
// "Saving…" gave no clue for minutes. The fix routes photos through
// src/lib/daily-report-uploads.ts: extension-based type inference (camera
// files can carry an empty MIME type), a retrying concurrency pool with
// progress callbacks, and path-deduped manifest merging. These tests pin the
// pure orchestration pieces; the canvas compression path is browser-bound and
// falls back to the original bytes on any failure.

import { describe, expect, test } from "vitest";
import {
  attachmentAttemptTimeoutMs,
  inferAttachmentType,
  isAllowedAttachmentType,
  mergeAttachmentManifest,
  prepareAttachmentForUpload,
  scaleToFit,
  shouldCompressAttachment,
  uploadFilesWithRetry,
} from "@/lib/daily-report-uploads";
import type { DailyReportAttachment } from "@/lib/daily-reports.functions";

const makeFile = (name: string, type = "image/jpeg", bytes = 16) =>
  new File([new Uint8Array(bytes)], name, { type });

const attachment = (path: string): DailyReportAttachment => ({
  name: path,
  path,
  type: "image/jpeg",
  size: 100,
  uploaded_at: "2026-07-09T00:00:00.000Z",
  client_visible: false,
});

describe("inferAttachmentType", () => {
  test("keeps a declared MIME type", () => {
    expect(inferAttachmentType("site.jpg", "image/jpeg")).toBe("image/jpeg");
  });

  test("falls back to the extension when the browser hands over an empty type", () => {
    // Android camera files routinely arrive with type "" — this used to
    // reject the entire batch with "must be PDF, PNG, JPG…".
    expect(inferAttachmentType("20260706_075228.jpg", "")).toBe("image/jpeg");
    expect(inferAttachmentType("scan.PDF", "")).toBe("application/pdf");
    expect(inferAttachmentType("IMG_0012.HEIC", "")).toBe("image/heic");
    expect(inferAttachmentType("clip.heif", "")).toBe("image/heic");
  });

  test("treats application/octet-stream as undeclared", () => {
    expect(inferAttachmentType("pour.png", "application/octet-stream")).toBe("image/png");
  });

  test("normalizes real-world MIME aliases devices actually send", () => {
    // Some Androids declare image/jpg; iOS declares image/heif for HEIF.
    expect(inferAttachmentType("site.jpg", "image/jpg")).toBe("image/jpeg");
    expect(inferAttachmentType("IMG_0012.heif", "image/heif")).toBe("image/heic");
    expect(inferAttachmentType("old-scan.jpg", "image/pjpeg")).toBe("image/jpeg");
  });

  test("rescues a supported extension when the declared type isn't supported", () => {
    expect(inferAttachmentType("photo.jpg", "video/mp4")).toBe("image/jpeg");
  });

  test("leaves unknown extensions alone so validation can reject them", () => {
    expect(isAllowedAttachmentType(inferAttachmentType("notes.txt", ""))).toBe(false);
    expect(isAllowedAttachmentType(inferAttachmentType("video.mp4", "video/mp4"))).toBe(false);
  });
});

describe("attachmentAttemptTimeoutMs", () => {
  test("floors at two minutes for small files", () => {
    expect(attachmentAttemptTimeoutMs(500 * 1024)).toBe(120_000);
  });

  test("scales up for big non-compressible files so slow links can finish", () => {
    // A 12 MB HEIC at ~25 KB/s needs ~8 minutes — must exceed the old 120s.
    const ms = attachmentAttemptTimeoutMs(12 * 1024 * 1024);
    expect(ms).toBeGreaterThan(400_000);
    expect(ms).toBeLessThan(600_000);
  });
});

describe("scaleToFit", () => {
  test("leaves small images untouched", () => {
    expect(scaleToFit(1200, 800, 2048)).toEqual({ width: 1200, height: 800 });
  });

  test("caps the longest edge and keeps the aspect ratio", () => {
    expect(scaleToFit(4000, 3000, 2048)).toEqual({ width: 2048, height: 1536 });
    expect(scaleToFit(3000, 4000, 2048)).toEqual({ width: 1536, height: 2048 });
  });

  test("never collapses a dimension to zero", () => {
    expect(scaleToFit(10000, 2, 2048).height).toBeGreaterThanOrEqual(1);
  });
});

describe("shouldCompressAttachment", () => {
  test("compresses big camera formats only", () => {
    expect(shouldCompressAttachment("image/jpeg", 10 * 1024 * 1024)).toBe(true);
    expect(shouldCompressAttachment("image/png", 5 * 1024 * 1024)).toBe(true);
    // Small files upload fast enough as-is.
    expect(shouldCompressAttachment("image/jpeg", 200 * 1024)).toBe(false);
    // PDFs and HEIC pass through untouched (canvas can't re-encode them).
    expect(shouldCompressAttachment("application/pdf", 10 * 1024 * 1024)).toBe(false);
    expect(shouldCompressAttachment("image/heic", 10 * 1024 * 1024)).toBe(false);
  });
});

describe("prepareAttachmentForUpload", () => {
  test("passes small files through byte-for-byte", async () => {
    const file = makeFile("small.jpg", "image/jpeg", 64);
    const prepared = await prepareAttachmentForUpload(file);
    expect(prepared.blob).toBe(file);
    expect(prepared.contentType).toBe("image/jpeg");
    expect(prepared.uploadName).toBe("small.jpg");
    expect(prepared.bytes).toBe(64);
  });

  test("falls back to the original bytes when decode fails (junk data)", async () => {
    // 2 MB of zeros with a jpeg type qualifies for compression but cannot be
    // decoded — the pipeline must degrade to a passthrough, never an error.
    const file = makeFile("broken.jpg", "image/jpeg", 2 * 1024 * 1024);
    const prepared = await prepareAttachmentForUpload(file);
    expect(prepared.blob).toBe(file);
    expect(prepared.bytes).toBe(file.size);
  });
});

describe("uploadFilesWithRetry", () => {
  const fastRetry = { retryDelayMs: 0 };

  test("uploads everything and reports progress in order", async () => {
    const files = [makeFile("a.jpg"), makeFile("b.jpg"), makeFile("c.jpg")];
    const progress: Array<[number, number]> = [];
    const result = await uploadFilesWithRetry(files, async (file) => file.name, {
      ...fastRetry,
      onProgress: (done, total) => progress.push([done, total]),
    });
    expect(result.ok).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(result.failed).toEqual([]);
    expect(progress[0]).toEqual([0, 3]);
    expect(progress.at(-1)).toEqual([3, 3]);
    expect(progress).toHaveLength(4);
  });

  test("keeps input order in ok even when later files finish first", async () => {
    const files = [makeFile("slow.jpg"), makeFile("fast.jpg")];
    const result = await uploadFilesWithRetry(
      files,
      (file) =>
        new Promise<string>((resolve) =>
          setTimeout(() => resolve(file.name), file.name.startsWith("slow") ? 30 : 1),
        ),
      { ...fastRetry, concurrency: 2 },
    );
    expect(result.ok).toEqual(["slow.jpg", "fast.jpg"]);
  });

  test("one file failing all its attempts never sinks the others", async () => {
    const files = [makeFile("good1.jpg"), makeFile("bad.jpg"), makeFile("good2.jpg")];
    const attemptsByFile = new Map<string, number>();
    const result = await uploadFilesWithRetry(
      files,
      async (file) => {
        attemptsByFile.set(file.name, (attemptsByFile.get(file.name) ?? 0) + 1);
        if (file.name === "bad.jpg") throw new Error("connection reset");
        return file.name;
      },
      { ...fastRetry, attempts: 3 },
    );
    expect(result.ok).toEqual(["good1.jpg", "good2.jpg"]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.file.name).toBe("bad.jpg");
    expect(result.failed[0]?.error).toBe("connection reset");
    expect(attemptsByFile.get("bad.jpg")).toBe(3);
    expect(attemptsByFile.get("good1.jpg")).toBe(1);
  });

  test("a transient failure succeeds on retry", async () => {
    let attempts = 0;
    const result = await uploadFilesWithRetry(
      [makeFile("flaky.jpg")],
      async (file) => {
        attempts += 1;
        if (attempts === 1) throw new Error("blip");
        return file.name;
      },
      fastRetry,
    );
    expect(result.ok).toEqual(["flaky.jpg"]);
    expect(result.failed).toEqual([]);
    expect(attempts).toBe(2);
  });

  test("never runs more than the concurrency cap at once", async () => {
    let inFlight = 0;
    let peak = 0;
    const files = Array.from({ length: 6 }, (_, index) => makeFile(`p${index}.jpg`));
    await uploadFilesWithRetry(
      files,
      async (file) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight -= 1;
        return file.name;
      },
      { ...fastRetry, concurrency: 2 },
    );
    expect(peak).toBe(2);
  });

  test("a hung upload times out instead of freezing the save forever", async () => {
    const result = await uploadFilesWithRetry(
      [makeFile("hung.jpg")],
      () => new Promise<string>(() => {}),
      { ...fastRetry, attempts: 1, attemptTimeoutMs: 20 },
    );
    expect(result.ok).toEqual([]);
    expect(result.failed).toHaveLength(1);
    expect(result.failed[0]?.error).toContain("timed out");
  });

  test("accepts a per-file timeout function", async () => {
    const seen: number[] = [];
    const result = await uploadFilesWithRetry(
      [makeFile("big.heic", "image/heic", 64), makeFile("hung.jpg")],
      (file) =>
        file.name === "hung.jpg" ? new Promise<string>(() => {}) : Promise.resolve(file.name),
      {
        ...fastRetry,
        attempts: 1,
        concurrency: 1,
        attemptTimeoutMs: (file) => {
          seen.push(file.size);
          return file.name === "hung.jpg" ? 20 : 60_000;
        },
      },
    );
    expect(result.ok).toEqual(["big.heic"]);
    expect(result.failed[0]?.file.name).toBe("hung.jpg");
    expect(seen).toHaveLength(2);
  });

  test("handles an empty file list without touching the uploader", async () => {
    let called = 0;
    const result = await uploadFilesWithRetry([], async () => {
      called += 1;
      return "never";
    });
    expect(result.ok).toEqual([]);
    expect(result.failed).toEqual([]);
    expect(called).toBe(0);
  });
});

describe("mergeAttachmentManifest", () => {
  test("appends new uploads after the kept attachments", () => {
    const merged = mergeAttachmentManifest(
      [attachment("kept-1"), attachment("kept-2")],
      [attachment("new-1")],
    );
    expect(merged.map((entry) => entry.path)).toEqual(["kept-1", "kept-2", "new-1"]);
  });

  test("never duplicates a storage path on a retry re-save", () => {
    const merged = mergeAttachmentManifest(
      [attachment("kept-1"), attachment("dup")],
      [attachment("dup"), attachment("new-1")],
    );
    expect(merged.map((entry) => entry.path)).toEqual(["kept-1", "dup", "new-1"]);
  });
});
