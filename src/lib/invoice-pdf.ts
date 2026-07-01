import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import { billingDocumentLabel, normalizeBillingNumberLabel } from "@/lib/billing-labels";
import type {
  BillingApplicationRow,
  BillingInvoiceRow,
  ProjectRow,
} from "@/lib/projects.functions";
import { drawPdfBrand, embedPdfLogo } from "@/lib/pdf-branding";

export interface InvoicePdfInput {
  project: ProjectRow;
  invoice: BillingInvoiceRow;
  linkedPayApp?: BillingApplicationRow;
  generatedAt?: Date;
}

const PAGE_W = 612;
const PAGE_H = 792;
const M = 48;
const INK: RGB = rgb(0.07, 0.06, 0.05);
const MUTED: RGB = rgb(0.43, 0.41, 0.38);
const HAIR: RGB = rgb(0.86, 0.84, 0.8);
const SURFACE: RGB = rgb(0.97, 0.96, 0.93);
const ACCENT: RGB = rgb(0.82, 0.22, 0.13);
const SUCCESS: RGB = rgb(0.16, 0.48, 0.3);

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

const fmtUSD = (value: number) => {
  const amount = Number(value ?? 0);
  const formatted = Math.abs(amount).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  return amount < 0 ? `(${formatted})` : formatted;
};

const fmtDate = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

const fmtDateTime = (value: Date) =>
  value.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const statusLabel = (value: BillingInvoiceRow["status"]) =>
  value === "partially_paid" ? "Partially paid" : value.replace("_", " ");

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

function wrapLines(font: PDFFont, value: string, size: number, maxWidth: number) {
  const paragraphs = cleanPdfText(value).split(/\n+/);
  const lines: string[] = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }

  return lines.length ? lines : ["-"];
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
  const lines = wrapLines(font, value, size, maxWidth);
  for (const line of lines) {
    ensure(ctx, lineHeight);
    drawText(ctx, line, x, ctx.y, { font, size, color: opts.color });
    ctx.y -= lineHeight;
  }
}

function drawMetric(
  ctx: PdfCtx,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  color: RGB = INK,
) {
  ctx.page.drawRectangle({
    x,
    y,
    width,
    height: 58,
    color: SURFACE,
    borderColor: HAIR,
    borderWidth: 0.5,
  });
  drawText(ctx, label.toUpperCase(), x + 10, y + 38, {
    font: ctx.sansBold,
    size: 7,
    color: MUTED,
  });
  drawText(ctx, value, x + 10, y + 15, { font: ctx.serif, size: 18, color });
}

function drawSectionTitle(ctx: PdfCtx, label: string) {
  ensure(ctx, 34);
  ctx.y -= 8;
  drawText(ctx, label.toUpperCase(), M, ctx.y, {
    font: ctx.sansBold,
    size: 8,
    color: MUTED,
  });
  ctx.y -= 9;
  drawRule(ctx, ctx.y);
  ctx.y -= 18;
}

function drawAmountRow(ctx: PdfCtx, label: string, value: string, strong = false) {
  const font = strong ? ctx.sansBold : ctx.sans;
  const size = strong ? 11 : 10;
  const rowHeight = strong ? 28 : 26;
  ensure(ctx, rowHeight + 6);
  drawText(ctx, label, M, ctx.y, {
    font,
    size,
    color: strong ? INK : MUTED,
  });
  const textWidth = font.widthOfTextAtSize(value, size);
  drawText(ctx, value, PAGE_W - M - textWidth, ctx.y, {
    font,
    size,
    color: strong ? INK : MUTED,
  });
  const ruleY = ctx.y - rowHeight + 8;
  drawRule(ctx, ruleY);
  ctx.y = ruleY - 12;
}

export async function generateInvoicePdf({
  project,
  invoice,
  linkedPayApp,
  generatedAt = new Date(),
}: InvoicePdfInput) {
  const doc = await PDFDocument.create();
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: PdfCtx = { doc, page, y: PAGE_H - M, serif, sans, sansBold };
  const openBalance = Math.max(0, invoice.total_due - invoice.paid_amount);
  const hasRetainage = Math.abs(invoice.retainage) > 0.005;
  const companyLogo = await embedPdfLogo(doc, project.organization_logo_url);

  drawText(ctx, "OVERWATCH BILLING", M, ctx.y, {
    font: sansBold,
    size: 8,
    color: MUTED,
  });
  drawPdfBrand({
    page: ctx.page,
    logo: companyLogo,
    companyName: project.organization_name,
    font: sansBold,
    x: PAGE_W - M - 170,
    y: ctx.y + 2,
    maxWidth: 170,
    maxHeight: 34,
    color: MUTED,
  });
  ctx.y -= 30;
  drawWrapped(ctx, "Invoice", M, 300, { font: serif, size: 40, lineHeight: 42 });
  drawWrapped(ctx, billingDocumentLabel(invoice.invoice_number, invoice.title, "Invoice"), M, 280, {
    font: serif,
    size: 22,
    color: ACCENT,
    lineHeight: 26,
  });

  const headerX = 360;
  drawText(ctx, "Project", headerX, PAGE_H - M - 34, { font: sansBold, size: 8, color: MUTED });
  drawWrapped(ctx, project.name || "-", headerX, PAGE_W - M - headerX, {
    font: sansBold,
    size: 11,
    lineHeight: 14,
  });
  drawText(ctx, `Client: ${project.client || "-"}`, headerX, ctx.y - 2, { size: 9, color: MUTED });
  ctx.y -= 15;
  drawText(ctx, `Job #: ${project.job_number || "-"}`, headerX, ctx.y, { size: 9, color: MUTED });
  ctx.y = PAGE_H - M - 118;

  const metricW = (PAGE_W - M * 2 - 30) / 4;
  drawMetric(ctx, "Issue date", fmtDate(invoice.issue_date), M, ctx.y - 58, metricW);
  drawMetric(ctx, "Due date", fmtDate(invoice.due_date), M + metricW + 10, ctx.y - 58, metricW);
  drawMetric(
    ctx,
    "Status",
    statusLabel(invoice.status),
    M + metricW * 2 + 20,
    ctx.y - 58,
    metricW,
    invoice.status === "paid" ? SUCCESS : ACCENT,
  );
  drawMetric(
    ctx,
    "Open balance",
    fmtUSD(openBalance),
    M + metricW * 3 + 30,
    ctx.y - 58,
    metricW,
    openBalance > 0 ? ACCENT : SUCCESS,
  );
  ctx.y -= 92;

  drawSectionTitle(ctx, "Billing summary");
  drawAmountRow(ctx, "Subtotal", fmtUSD(invoice.subtotal));
  if (hasRetainage) {
    drawAmountRow(ctx, "Less retainage", fmtUSD(invoice.retainage));
  }
  drawAmountRow(ctx, "Total due", fmtUSD(invoice.total_due), true);
  drawAmountRow(ctx, "Paid to date", fmtUSD(invoice.paid_amount));
  drawAmountRow(ctx, "Open balance", fmtUSD(openBalance), true);
  ctx.y -= 12;

  drawSectionTitle(ctx, "Source");
  const source = linkedPayApp
    ? [
        billingDocumentLabel(
          linkedPayApp.application_number,
          linkedPayApp.invoice_number,
          "Pay application",
        ),
        linkedPayApp.invoice_number
          ? `Invoice ${normalizeBillingNumberLabel(linkedPayApp.invoice_number)}`
          : "",
        linkedPayApp.billing_period,
      ]
        .filter(Boolean)
        .join(" - ")
    : "Direct invoice";
  drawWrapped(ctx, source, M, PAGE_W - M * 2, { font: sansBold, size: 11, lineHeight: 15 });
  ctx.y -= 6;

  if (invoice.notes) {
    drawSectionTitle(ctx, "Notes");
    drawWrapped(ctx, invoice.notes, M, PAGE_W - M * 2, { size: 10, lineHeight: 14 });
    ctx.y -= 6;
  }

  drawSectionTitle(ctx, "Payment history");
  if (!invoice.payment_events.length) {
    drawWrapped(ctx, "No payments have been recorded against this invoice.", M, PAGE_W - M * 2, {
      size: 10,
      color: MUTED,
    });
  } else {
    invoice.payment_events.slice(0, 8).forEach((payment) => {
      drawWrapped(
        ctx,
        `${fmtDate(payment.paid_at)} - ${fmtUSD(payment.amount)} via ${payment.payment_method || "manual"}${payment.notes ? ` - ${payment.notes}` : ""}`,
        M,
        PAGE_W - M * 2,
        { size: 9, lineHeight: 12, color: MUTED },
      );
    });
  }

  const pageCount = doc.getPageCount();
  doc.getPages().forEach((footerPage, index) => {
    footerPage.drawText(
      `Overwatch Invoice | Generated ${fmtDateTime(generatedAt)} | Page ${index + 1} of ${pageCount}`,
      {
        x: M,
        y: 24,
        font: sans,
        size: 8,
        color: MUTED,
      },
    );
  });

  return doc.save();
}
