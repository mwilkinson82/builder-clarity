import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type { PlanSheetRow } from "@/lib/plan-room.functions";

export type PlanSheetIdentityImage = {
  sheet_id: string;
  page_number: number;
  media_type: "image/jpeg";
  base64: string;
};

const IDENTITY_SOURCE_LONG_EDGE_PX = 2200;
const IDENTITY_CONTACT_WIDTH_PX = 1000;
const IDENTITY_CONTACT_HEIGHT_PX = 700;

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

function drawContained(
  context: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sourceWidth: number,
  sourceHeight: number,
  targetX: number,
  targetY: number,
  targetWidth: number,
  targetHeight: number,
) {
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;
  context.drawImage(
    source,
    targetX + (targetWidth - width) / 2,
    targetY + (targetHeight - height) / 2,
    width,
    height,
  );
}

function titleBlockContactSheet(source: HTMLCanvasElement) {
  const contact = document.createElement("canvas");
  contact.width = IDENTITY_CONTACT_WIDTH_PX;
  contact.height = IDENTITY_CONTACT_HEIGHT_PX;
  const context = contact.getContext("2d");
  if (!context) throw new Error("The title-block canvas is unavailable.");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, contact.width, contact.height);

  // Construction title blocks most commonly live in a bottom band or a
  // vertical right-edge strip. Present both at useful scale instead of asking
  // vision to spend its context on the entire drawing. Rotate the right strip
  // so both candidates read as wide horizontal bands.
  const bottomY = Math.floor(source.height * 0.62);
  const bottomHeight = Math.max(1, source.height - bottomY);
  const bottom = document.createElement("canvas");
  bottom.width = source.width;
  bottom.height = bottomHeight;
  bottom
    .getContext("2d")
    ?.drawImage(source, 0, bottomY, source.width, bottomHeight, 0, 0, bottom.width, bottom.height);

  const rightX = Math.floor(source.width * 0.68);
  const rightWidth = Math.max(1, source.width - rightX);
  const rightRotated = document.createElement("canvas");
  rightRotated.width = source.height;
  rightRotated.height = rightWidth;
  const rightContext = rightRotated.getContext("2d");
  if (!rightContext) throw new Error("The title-block canvas is unavailable.");
  rightContext.translate(rightRotated.width, 0);
  rightContext.rotate(Math.PI / 2);
  rightContext.drawImage(
    source,
    rightX,
    0,
    rightWidth,
    source.height,
    0,
    0,
    rightWidth,
    source.height,
  );

  drawContained(context, bottom, bottom.width, bottom.height, 0, 0, contact.width, 340);
  context.fillStyle = "#e5e7eb";
  context.fillRect(0, 349, contact.width, 2);
  drawContained(
    context,
    rightRotated,
    rightRotated.width,
    rightRotated.height,
    0,
    360,
    contact.width,
    340,
  );
  return contact;
}

/**
 * Render compact title-block contact sheets only for pages whose vector text
 * could not be read. The top band is the drawing's bottom region; the lower
 * band is its right edge rotated for reading. This keeps vision context bounded
 * while the estimator still confirms every identity before anything changes.
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
      const viewport = page.getViewport({ scale: IDENTITY_SOURCE_LONG_EDGE_PX / longEdge });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width));
      canvas.height = Math.max(1, Math.round(viewport.height));
      const context = canvas.getContext("2d");
      if (!context) continue;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const contact = titleBlockContactSheet(canvas);
      const blob = await new Promise<Blob | null>((resolve) =>
        contact.toBlob(resolve, "image/jpeg", 0.82),
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
