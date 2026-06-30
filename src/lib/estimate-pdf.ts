import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import type {
  EstimateLineItemRow,
  EstimateRow,
  EstimateTotalsBreakdown,
} from "@/lib/estimates.functions";

export interface EstimatePdfInput {
  estimate: EstimateRow;
  lineItems: EstimateLineItemRow[];
  totals: EstimateTotalsBreakdown;
  generatedAt?: Date;
}

const PAGE_W = 612;
const PAGE_H = 792;
const M = 44;
const INK: RGB = rgb(0.07, 0.06, 0.05);
const MUTED: RGB = rgb(0.43, 0.41, 0.38);
const HAIR: RGB = rgb(0.86, 0.84, 0.8);
const SURFACE: RGB = rgb(0.97, 0.96, 0.93);
const ACCENT: RGB = rgb(0.82, 0.22, 0.13);

interface PdfCtx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  serif: PDFFont;
  sans: PDFFont;
  sansBold: PDFFont;
}

const cleanPdfText = (value?: string | number | null) =>
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

const fmtUSD = (cents: number) =>
  (Math.round(cents) / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const fmtRate = (pct: number) => `${(pct / 100).toFixed(2)}%`;

function ensure(ctx: PdfCtx, needed: number) {
  if (ctx.y - needed >= M) return;
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - M;
}

function drawText(
  ctx: PdfCtx,
  value: string,
  x: number,
  y: number,
  opts: { font?: PDFFont; size?: number; color?: RGB } = {},
) {
  ctx.page.drawText(cleanPdfText(value), {
    x,
    y,
    font: opts.font ?? ctx.sans,
    size: opts.size ?? 10,
    color: opts.color ?? INK,
  });
}

function drawRule(ctx: PdfCtx, y: number) {
  ctx.page.drawLine({
    start: { x: M, y },
    end: { x: PAGE_W - M, y },
    thickness: 0.5,
    color: HAIR,
  });
}

function drawAmountRow(ctx: PdfCtx, label: string, value: string, strong = false) {
  ensure(ctx, 22);
  const font = strong ? ctx.sansBold : ctx.sans;
  const size = strong ? 11 : 9;
  drawText(ctx, label, 340, ctx.y, { font, size, color: strong ? INK : MUTED });
  const width = font.widthOfTextAtSize(value, size);
  drawText(ctx, value, PAGE_W - M - width, ctx.y, { font, size, color: strong ? INK : MUTED });
  ctx.y -= 17;
}

function drawWrapped(
  ctx: PdfCtx,
  value: string,
  x: number,
  maxWidth: number,
  opts: { font?: PDFFont; size?: number; color?: RGB; lineHeight?: number } = {},
) {
  const font = opts.font ?? ctx.sans;
  const size = opts.size ?? 10;
  const lineHeight = opts.lineHeight ?? size * 1.35;
  const words = cleanPdfText(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  for (const item of lines.length ? lines : ["-"]) {
    ensure(ctx, lineHeight);
    drawText(ctx, item, x, ctx.y, { font, size, color: opts.color });
    ctx.y -= lineHeight;
  }
}

export async function generateEstimatePdf({
  estimate,
  lineItems,
  totals,
  generatedAt = new Date(),
}: EstimatePdfInput) {
  const doc = await PDFDocument.create();
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: PdfCtx = { doc, page, y: PAGE_H - M, serif, sans, sansBold };

  drawText(ctx, "OVERWATCH ESTIMATE", M, ctx.y, { font: sansBold, size: 8, color: MUTED });
  ctx.y -= 32;
  drawWrapped(ctx, estimate.name, M, 320, { font: serif, size: 34, lineHeight: 36 });
  drawText(ctx, `Status: ${estimate.status}`, M, ctx.y - 2, { size: 9, color: MUTED });
  drawText(
    ctx,
    `Generated ${generatedAt.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    })}`,
    390,
    PAGE_H - M - 10,
    { size: 9, color: MUTED },
  );
  drawText(
    ctx,
    `Region: ${estimate.region || "National"} (${estimate.region_multiplier.toFixed(2)}x)`,
    390,
    PAGE_H - M - 26,
    {
      size: 9,
      color: MUTED,
    },
  );
  ctx.y -= 26;

  const metricW = (PAGE_W - M * 2 - 20) / 3;
  const metricY = ctx.y - 56;
  for (const [index, metric] of [
    ["Direct Cost", fmtUSD(totals.adjusted_direct_cents)],
    ["Total Bid", fmtUSD(totals.total_cents)],
    ["Indicated GP", `${totals.indicated_gp_pct.toFixed(1)}%`],
  ].entries()) {
    const x = M + index * (metricW + 10);
    ctx.page.drawRectangle({
      x,
      y: metricY,
      width: metricW,
      height: 56,
      color: SURFACE,
      borderColor: HAIR,
      borderWidth: 0.5,
    });
    drawText(ctx, metric[0], x + 10, metricY + 36, { font: sansBold, size: 7, color: MUTED });
    drawText(ctx, metric[1], x + 10, metricY + 13, {
      font: serif,
      size: 18,
      color: index === 1 ? ACCENT : INK,
    });
  }
  ctx.y = metricY - 34;

  drawText(ctx, "LINE ITEMS", M, ctx.y, { font: sansBold, size: 8, color: MUTED });
  ctx.y -= 10;
  drawRule(ctx, ctx.y);
  ctx.y -= 16;

  drawText(ctx, "Description", M, ctx.y, { font: sansBold, size: 8, color: MUTED });
  drawText(ctx, "Qty", 320, ctx.y, { font: sansBold, size: 8, color: MUTED });
  drawText(ctx, "Unit", 365, ctx.y, { font: sansBold, size: 8, color: MUTED });
  drawText(ctx, "Total", 500, ctx.y, { font: sansBold, size: 8, color: MUTED });
  ctx.y -= 12;
  drawRule(ctx, ctx.y);
  ctx.y -= 12;

  for (const line of lineItems) {
    ensure(ctx, 28);
    drawWrapped(ctx, line.description, M, 250, { size: 9, lineHeight: 10.5 });
    const rowY = ctx.y + 10.5;
    drawText(ctx, line.quantity.toLocaleString("en-US", { maximumFractionDigits: 2 }), 320, rowY, {
      size: 9,
    });
    drawText(ctx, line.unit, 365, rowY, { size: 9 });
    const total = fmtUSD(line.total_extended_cents * estimate.region_multiplier);
    const totalWidth = ctx.sans.widthOfTextAtSize(total, 9);
    drawText(ctx, total, PAGE_W - M - totalWidth, rowY, { size: 9 });
    ctx.y -= 8;
  }

  ctx.y -= 14;
  drawText(ctx, "SUMMARY", 340, ctx.y, { font: sansBold, size: 8, color: MUTED });
  ctx.y -= 15;
  drawAmountRow(ctx, "Material", fmtUSD(totals.material_cents));
  drawAmountRow(ctx, "Labor", fmtUSD(totals.labor_cents));
  drawAmountRow(ctx, "Regional adjustment", fmtUSD(totals.regional_adjustment_cents));
  drawAmountRow(ctx, `Tax (${fmtRate(estimate.tax_pct)})`, fmtUSD(totals.tax_cents));
  drawAmountRow(ctx, `Overhead (${fmtRate(estimate.overhead_pct)})`, fmtUSD(totals.overhead_cents));
  drawAmountRow(ctx, `Profit (${fmtRate(estimate.profit_pct)})`, fmtUSD(totals.profit_cents));
  drawAmountRow(
    ctx,
    `Contingency (${fmtRate(estimate.contingency_pct)})`,
    fmtUSD(totals.contingency_cents),
  );
  drawAmountRow(ctx, `Bond (${fmtRate(estimate.bond_pct)})`, fmtUSD(totals.bond_cents));
  drawAmountRow(
    ctx,
    `GC (${fmtRate(estimate.general_conditions_pct)})`,
    fmtUSD(totals.general_conditions_cents),
  );
  if (totals.custom_markup_cents > 0) {
    drawAmountRow(ctx, "Custom markups", fmtUSD(totals.custom_markup_cents));
  }
  ctx.y -= 4;
  drawRule(ctx, ctx.y);
  ctx.y -= 18;
  drawAmountRow(ctx, "TOTAL BID", fmtUSD(totals.total_cents), true);

  return doc.save();
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
