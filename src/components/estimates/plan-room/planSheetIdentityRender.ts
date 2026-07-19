import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PlanSheetRow } from "@/lib/plan-room.functions";

export type PlanSheetIdentityImage = {
  sheet_id: string;
  page_number: number;
  media_type: "image/jpeg";
  base64: string;
};

const IDENTITY_IMAGE_LONG_EDGE_PX = 1400;

const dataUrlToArrayBuffer = (url: string) => {
  const commaIndex = url.indexOf(",");
  if (commaIndex < 0) throw new Error("Invalid PDF data URL.");
  const meta = url.slice(0, commaIndex);
  const payload = url.slice(commaIndex + 1);
  const binary = meta.includes(";base64") ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const blobToBase64 = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const chunkSize = 32_768;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }
  return btoa(binary);
};

/**
 * Render legible full-sheet images only for pages whose vector title-block
 * text could not be read. The images are proposals input; the estimator still
 * confirms every returned identity before anything is renamed.
 */
export async function renderPlanSheetIdentityImages({
  source,
  sheets,
  onProgress,
}: {
  source: { url: string } | { data: ArrayBuffer };
  sheets: Array<Pick<PlanSheetRow, "id" | "page_number">>;
  onProgress?: (completed: number, total: number) => void;
}): Promise<PlanSheetIdentityImage[]> {
  const pdfjs = await import("pdfjs-dist");
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    String(pdfWorkerUrl);
  const documentSource =
    "url" in source && source.url.startsWith("data:")
      ? { data: dataUrlToArrayBuffer(source.url) }
      : source;
  const pdf = await pdfjs.getDocument(documentSource).promise;
  const images: PlanSheetIdentityImage[] = [];
  let completed = 0;
  for (const sheet of sheets) {
    try {
      const page = await pdf.getPage(Math.max(1, sheet.page_number));
      const baseViewport = page.getViewport({ scale: 1 });
      const longEdge = Math.max(baseViewport.width, baseViewport.height);
      if (!Number.isFinite(longEdge) || longEdge <= 0) continue;
      const viewport = page.getViewport({ scale: IDENTITY_IMAGE_LONG_EDGE_PX / longEdge });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/jpeg", 0.76),
      );
      if (blob) {
        images.push({
          sheet_id: sheet.id,
          page_number: sheet.page_number,
          media_type: "image/jpeg",
          base64: await blobToBase64(blob),
        });
      }
    } catch {
      // Keep the rest of the set available when one page cannot render.
    } finally {
      completed += 1;
      onProgress?.(completed, sheets.length);
    }
  }
  return images;
}
