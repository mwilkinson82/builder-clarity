import { type PDFDocument, type PDFFont, type PDFImage, type PDFPage, type RGB } from "pdf-lib";

const cleanPdfText = (value?: string | null) =>
  Array.from(
    String(value ?? "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2022/g, "-"),
  )
    .filter((char) => {
      const code = char.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    })
    .join("")
    .trim();

// A logo fetch must never be able to hang the whole PDF generation. If the
// company's logo lives on a slow or unreachable host, an un-timed fetch would
// leave generateAiaBillingPdf() pending forever — the package never finishes,
// nothing downloads, and the user just sees "Generating..." with no error.
// (A prime suspect in the "AIA download won't push through" field report.)
// On timeout or any failure we simply skip the logo and draw the name.
const LOGO_FETCH_TIMEOUT_MS = 6_000;

export async function embedPdfLogo(
  doc: PDFDocument,
  logoUrl?: string | null,
): Promise<PDFImage | null> {
  const url = logoUrl?.trim();
  if (!url || typeof fetch === "undefined") return null;

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS) : null;
  try {
    const response = await fetch(url, controller ? { signal: controller.signal } : undefined);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    const bytes = await response.arrayBuffer();
    if (contentType.includes("png") || /\.png(?:\?|$)/i.test(url)) {
      return await doc.embedPng(bytes);
    }
    if (
      contentType.includes("jpeg") ||
      contentType.includes("jpg") ||
      /\.(?:jpe?g)(?:\?|$)/i.test(url)
    ) {
      return await doc.embedJpg(bytes);
    }
  } catch {
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }

  return null;
}

function fitText(font: PDFFont, value: string, size: number, maxWidth: number) {
  const clean = cleanPdfText(value);
  if (font.widthOfTextAtSize(clean, size) <= maxWidth) return clean;
  let next = clean;
  while (next.length > 3 && font.widthOfTextAtSize(`${next}...`, size) > maxWidth) {
    next = next.slice(0, -1);
  }
  return `${next.trim()}...`;
}

export function drawPdfBrand({
  page,
  logo,
  companyName,
  font,
  x,
  y,
  maxWidth,
  maxHeight,
  color,
  align = "right",
  size = 8,
}: {
  page: PDFPage;
  logo?: PDFImage | null;
  companyName?: string | null;
  font: PDFFont;
  x: number;
  y: number;
  maxWidth: number;
  maxHeight: number;
  color: RGB;
  align?: "left" | "right";
  size?: number;
}) {
  const name = cleanPdfText(companyName);
  if (!logo && !name) return;

  const logoScale = logo ? Math.min(maxHeight / logo.height, 48 / logo.width, 1) : 0;
  const logoWidth = logo ? logo.width * logoScale : 0;
  const logoHeight = logo ? logo.height * logoScale : 0;
  const gap = logo && name ? 6 : 0;
  const textMaxWidth = Math.max(0, maxWidth - logoWidth - gap);
  const label = name ? fitText(font, name, size, textMaxWidth) : "";
  const textWidth = label ? font.widthOfTextAtSize(label, size) : 0;
  const contentWidth = logoWidth + gap + textWidth;
  const startX = align === "right" ? x + maxWidth - contentWidth : x;
  const topY = y;

  if (logo) {
    page.drawImage(logo, {
      x: startX,
      y: topY - logoHeight,
      width: logoWidth,
      height: logoHeight,
    });
  }

  if (label) {
    page.drawText(label, {
      x: startX + logoWidth + gap,
      y: topY - Math.max(logoHeight / 2 + size / 3, size),
      font,
      size,
      color,
    });
  }
}
