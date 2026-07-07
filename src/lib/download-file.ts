// The ONE safe browser-download path for every generated file (PDF, CSV, text).
//
// The bug this module exists to kill: revoking a blob URL synchronously after
// anchor.click() races the browser's asynchronous fetch of that blob. Chrome
// snapshots the blob at click time so it tolerates the race; Safari and iOS do
// not — the download is silently cancelled, with no error surfaced to the user
// or to code. That was the "AIA package won't download" field report: the PDF
// generated fine, click() fired, Safari killed the fetch when the URL was
// revoked one line later. (ior-pdf.ts had already learned this lesson with a
// delayed revoke; three sibling copies of the helper never got the fix —
// classic duplicated-helper drift. Every download now delegates here.)
//
// The revoke MUST stay on a generous delay — do not "optimize" it back to
// synchronous or 0ms. The blob is freed on revoke or page unload either way.
const REVOKE_DELAY_MS = 60_000;

export function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), REVOKE_DELAY_MS);
}

// Copies into a fresh ArrayBuffer: pdf-lib can hand back a view over a larger
// buffer, and Blob would otherwise capture the whole thing. Returns a Blob a
// caller can hold and hand to triggerBlobDownload more than once (e.g. an auto
// download plus a user-tap fallback) without re-copying the bytes.
export function bytesToBlob(bytes: Uint8Array, mimeType = "application/pdf"): Blob {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  return new Blob([arrayBuffer], { type: mimeType });
}

// Bytes-first signature, matching the existing downloadPdfBytes helpers that
// now delegate here.
export function downloadFileBytes(
  bytes: Uint8Array,
  filename: string,
  mimeType = "application/pdf",
) {
  triggerBlobDownload(bytesToBlob(bytes, mimeType), filename);
}

// Filename-first signature, matching every existing downloadText helper.
export function downloadTextFile(filename: string, content: string, mimeType: string) {
  triggerBlobDownload(new Blob([content], { type: mimeType }), filename);
}
