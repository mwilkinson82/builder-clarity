import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { BillingLineItemRow } from "@/lib/billing.functions";
import type { BillingApplicationRow, ProjectRow } from "@/lib/projects.functions";

interface AiaPdfInput {
  project: ProjectRow;
  payApp: BillingApplicationRow;
  lineItems: BillingLineItemRow[];
  generatedAt?: Date;
}

const PORTRAIT_W = 612;
const PORTRAIT_H = 792;
const LANDSCAPE_W = 792;
const LANDSCAPE_H = 612;
const M = 32;
const INK = rgb(0.08, 0.07, 0.06);
const MUTED = rgb(0.42, 0.4, 0.36);
const HAIR = rgb(0.84, 0.82, 0.76);
const SURFACE = rgb(0.97, 0.96, 0.93);
const WHITE = rgb(1, 1, 1);

type PdfCtx = {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  sans: PDFFont;
  sansBold: PDFFont;
  serif: PDFFont;
};

type PaymentTotals = {
  scheduled: number;
  changeOrders: number;
  contract: number;
  previous: number;
  thisPeriod: number;
  stored: number;
  totalCompletedStored: number;
  balance: number;
  retainage: number;
};

const clean = (value?: string | number | null) =>
  String(value ?? "")
    .replace(/[^\x20-\x7e]/g, "")
    .trim();

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const dollars = (value: number) =>
  value.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const dateText = (value?: string | null) => {
  if (!value) return "-";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
};

function text(
  ctx: PdfCtx,
  value: string,
  x: number,
  y: number,
  opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb> } = {},
) {
  ctx.page.drawText(clean(value), {
    x,
    y,
    size: opts.size ?? 8,
    font: opts.font ?? ctx.sans,
    color: opts.color ?? INK,
  });
}

function rightText(
  ctx: PdfCtx,
  value: string,
  x: number,
  y: number,
  width: number,
  size = 7,
  font: PDFFont = ctx.sans,
) {
  const label = clean(value);
  text(ctx, label, x + width - font.widthOfTextAtSize(label, size), y, { size, font });
}

function drawRule(ctx: PdfCtx, x1: number, x2: number, y: number, thickness = 0.5) {
  ctx.page.drawLine({
    start: { x: x1, y },
    end: { x: x2, y },
    thickness,
    color: HAIR,
  });
}

function drawBox(ctx: PdfCtx, x: number, y: number, width: number, height: number, fill = WHITE) {
  ctx.page.drawRectangle({
    x,
    y,
    width,
    height,
    color: fill,
    borderColor: HAIR,
    borderWidth: 0.5,
  });
}

function wrapText(value: string, font: PDFFont, size: number, maxWidth: number, maxLines = 2) {
  const words = clean(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) <= maxWidth) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word;
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (words.length > 0 && lines.length === maxLines) {
    const last = lines[maxLines - 1];
    const original = clean(value);
    if (!original.endsWith(last)) {
      lines[maxLines - 1] = `${last.replace(/\.*$/, "")}...`;
    }
  }
  return lines.length ? lines : ["-"];
}

function drawWrappedText(
  ctx: PdfCtx,
  value: string,
  x: number,
  y: number,
  width: number,
  opts: { font?: PDFFont; size?: number; lineHeight?: number; maxLines?: number } = {},
) {
  const font = opts.font ?? ctx.sans;
  const size = opts.size ?? 8;
  const lines = wrapText(value, font, size, width, opts.maxLines ?? 2);
  lines.forEach((line, index) =>
    text(ctx, line, x, y - index * (opts.lineHeight ?? size + 2), { font, size }),
  );
}

function drawField(
  ctx: PdfCtx,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
  height = 34,
) {
  drawBox(ctx, x, y, width, height, SURFACE);
  text(ctx, label.toUpperCase(), x + 8, y + height - 12, {
    font: ctx.sansBold,
    size: 6,
    color: MUTED,
  });
  drawWrappedText(ctx, value || "-", x + 8, y + 8, width - 16, { size: 8.5, maxLines: 2 });
}

function computeTotals(lineItems: BillingLineItemRow[]): PaymentTotals {
  return lineItems.reduce(
    (sum, line) => {
      sum.scheduled += line.scheduled_value_cents;
      sum.changeOrders += line.change_order_value_cents;
      sum.contract += line.scheduled_value_cents + line.change_order_value_cents;
      sum.previous += line.work_completed_previous_cents + line.materials_stored_previous_cents;
      sum.thisPeriod += line.work_completed_this_period_cents;
      sum.stored += line.materials_stored_this_period_cents;
      sum.totalCompletedStored += line.total_completed_and_stored_cents;
      sum.balance += line.balance_to_finish_cents;
      sum.retainage += line.retainage_held_cents - line.retainage_released_cents;
      return sum;
    },
    {
      scheduled: 0,
      changeOrders: 0,
      contract: 0,
      previous: 0,
      thisPeriod: 0,
      stored: 0,
      totalCompletedStored: 0,
      balance: 0,
      retainage: 0,
    },
  );
}

function drawCoverSummaryRow(
  ctx: PdfCtx,
  label: string,
  value: string,
  y: number,
  opts: { bold?: boolean; fill?: ReturnType<typeof rgb> } = {},
) {
  const x = M;
  const width = PORTRAIT_W - M * 2;
  drawBox(ctx, x, y, width, 25, opts.fill ?? WHITE);
  text(ctx, label, x + 9, y + 8, {
    font: opts.bold ? ctx.sansBold : ctx.sans,
    size: 8.5,
  });
  rightText(ctx, value, x + width - 190, y + 8, 178, 8.5, opts.bold ? ctx.sansBold : ctx.sans);
}

function drawCoverSheet(
  ctx: PdfCtx,
  project: ProjectRow,
  payApp: BillingApplicationRow,
  totals: PaymentTotals,
  generatedAt: Date,
) {
  const page = ctx.doc.addPage([PORTRAIT_W, PORTRAIT_H]);
  ctx.page = page;
  ctx.y = PORTRAIT_H - M;

  text(ctx, "OVERWATCH BILLING", M, ctx.y, { font: ctx.sansBold, size: 7, color: MUTED });
  text(ctx, "APPLICATION AND CERTIFICATE FOR PAYMENT", M, ctx.y - 26, {
    font: ctx.serif,
    size: 21,
  });
  text(ctx, `Prepared ${generatedAt.toLocaleString("en-US")}`, PORTRAIT_W - 210, ctx.y - 2, {
    size: 8,
    color: MUTED,
  });
  drawRule(ctx, M, PORTRAIT_W - M, ctx.y - 39);

  ctx.y -= 82;
  const fieldW = (PORTRAIT_W - M * 2 - 12) / 2;
  drawField(ctx, "Project", project.name, M, ctx.y, fieldW, 40);
  drawField(ctx, "Owner / Company", project.client || "-", M + fieldW + 12, ctx.y, fieldW, 40);
  ctx.y -= 46;
  drawField(ctx, "Job number", project.job_number || "-", M, ctx.y, fieldW, 34);
  drawField(
    ctx,
    "Project manager",
    project.project_manager || "-",
    M + fieldW + 12,
    ctx.y,
    fieldW,
    34,
  );
  ctx.y -= 42;
  drawField(ctx, "Application no.", payApp.application_number || "-", M, ctx.y, fieldW, 34);
  drawField(ctx, "Invoice no.", payApp.invoice_number || "-", M + fieldW + 12, ctx.y, fieldW, 34);
  ctx.y -= 42;
  drawField(ctx, "Billing period", payApp.billing_period || "-", M, ctx.y, fieldW, 34);
  drawField(
    ctx,
    "Submitted / due",
    `${dateText(payApp.submitted_date)} / ${dateText(payApp.due_date)}`,
    M + fieldW + 12,
    ctx.y,
    fieldW,
    34,
  );

  const contractSumToDate = payApp.contract_amount + payApp.change_order_amount;
  const totalCompletedStored =
    totals.totalCompletedStored || Math.round(payApp.amount_billed * 100);
  const retainage = Math.max(totals.retainage, Math.round(payApp.retainage * 100));
  const earnedLessRetainage = Math.max(0, totalCompletedStored - retainage);
  const previousCertificates = Math.max(0, Math.round(payApp.paid_to_date * 100));
  const currentPaymentDue = Math.max(0, earnedLessRetainage - previousCertificates);
  const balanceToFinish = Math.max(0, Math.round(contractSumToDate * 100) - earnedLessRetainage);

  ctx.y -= 66;
  text(ctx, "CONTRACT SUMMARY", M, ctx.y, { font: ctx.sansBold, size: 8, color: MUTED });
  ctx.y -= 28;
  drawCoverSummaryRow(ctx, "Original contract sum", dollars(payApp.contract_amount), ctx.y);
  ctx.y -= 25;
  drawCoverSummaryRow(
    ctx,
    "Net change by approved change orders",
    dollars(payApp.change_order_amount),
    ctx.y,
  );
  ctx.y -= 25;
  drawCoverSummaryRow(ctx, "Contract sum to date", dollars(contractSumToDate), ctx.y, {
    bold: true,
    fill: SURFACE,
  });
  ctx.y -= 25;
  drawCoverSummaryRow(
    ctx,
    "Total completed and stored to date",
    money(totalCompletedStored),
    ctx.y,
  );
  ctx.y -= 25;
  drawCoverSummaryRow(ctx, "Retainage held less retainage released", money(retainage), ctx.y);
  ctx.y -= 25;
  drawCoverSummaryRow(ctx, "Total earned less retainage", money(earnedLessRetainage), ctx.y, {
    bold: true,
    fill: SURFACE,
  });
  ctx.y -= 25;
  drawCoverSummaryRow(ctx, "Less previous payments recorded", money(previousCertificates), ctx.y);
  ctx.y -= 25;
  drawCoverSummaryRow(ctx, "Current payment due", money(currentPaymentDue), ctx.y, {
    bold: true,
    fill: SURFACE,
  });
  ctx.y -= 25;
  drawCoverSummaryRow(ctx, "Balance to finish, including retainage", money(balanceToFinish), ctx.y);

  ctx.y -= 58;
  text(ctx, "CONTRACTOR CERTIFICATION", M, ctx.y, { font: ctx.sansBold, size: 8, color: MUTED });
  drawBox(ctx, M, ctx.y - 76, PORTRAIT_W - M * 2, 64, WHITE);
  drawWrappedText(
    ctx,
    "The contractor confirms this application reflects work completed, stored materials, retainage, payments received, and known contract adjustments for the billing period shown above.",
    M + 10,
    ctx.y - 28,
    PORTRAIT_W - M * 2 - 20,
    { size: 8, lineHeight: 11, maxLines: 3 },
  );
  drawRule(ctx, M + 10, M + 250, ctx.y - 62);
  drawRule(ctx, M + 310, PORTRAIT_W - M - 10, ctx.y - 62);
  text(ctx, "Authorized signature", M + 10, ctx.y - 73, { size: 6.5, color: MUTED });
  text(ctx, "Date", M + 310, ctx.y - 73, { size: 6.5, color: MUTED });
}

const CONTINUATION_COLUMNS = [
  { key: "item", label: "Item", x: 30, width: 38, align: "left" },
  { key: "description", label: "Description of Work", x: 68, width: 164, align: "left" },
  { key: "scheduled", label: "Scheduled Value", x: 232, width: 72, align: "right" },
  { key: "previous", label: "Previous Work", x: 304, width: 66, align: "right" },
  { key: "period", label: "This Period", x: 370, width: 66, align: "right" },
  { key: "stored", label: "Stored Material", x: 436, width: 66, align: "right" },
  { key: "total", label: "Completed & Stored", x: 502, width: 74, align: "right" },
  { key: "pct", label: "%", x: 576, width: 34, align: "right" },
  { key: "balance", label: "Balance", x: 610, width: 62, align: "right" },
  { key: "retainage", label: "Retainage", x: 672, width: 90, align: "right" },
] as const;

function drawContinuationHeader(
  ctx: PdfCtx,
  project: ProjectRow,
  payApp: BillingApplicationRow,
  pageNumber: number,
) {
  text(ctx, "CONTINUATION SHEET", M, LANDSCAPE_H - M, { font: ctx.serif, size: 18 });
  text(ctx, `Project: ${project.name}`, M, LANDSCAPE_H - M - 18, { font: ctx.sansBold, size: 8 });
  text(ctx, `Application: ${payApp.application_number || "-"}`, M + 320, LANDSCAPE_H - M - 18, {
    size: 8,
  });
  text(ctx, `Page ${pageNumber}`, LANDSCAPE_W - 82, LANDSCAPE_H - M - 18, { size: 8 });
  ctx.y = LANDSCAPE_H - M - 48;
  ctx.page.drawRectangle({
    x: M,
    y: ctx.y - 24,
    width: LANDSCAPE_W - M * 2,
    height: 24,
    color: SURFACE,
    borderColor: HAIR,
    borderWidth: 0.5,
  });
  CONTINUATION_COLUMNS.forEach((column) =>
    drawWrappedText(ctx, column.label.toUpperCase(), column.x + 4, ctx.y - 9, column.width - 8, {
      font: ctx.sansBold,
      size: 5.5,
      lineHeight: 6.5,
      maxLines: 2,
    }),
  );
  ctx.y -= 31;
}

function drawContinuationRow(ctx: PdfCtx, line: BillingLineItemRow, rowNumber: number, y: number) {
  drawBox(ctx, M, y - 8, LANDSCAPE_W - M * 2, 27, WHITE);
  text(ctx, line.cost_code || String(rowNumber), 34, y + 4, { size: 7 });
  drawWrappedText(ctx, line.description || "-", 72, y + 6, 154, {
    size: 7,
    lineHeight: 8,
    maxLines: 2,
  });
  rightText(ctx, money(line.scheduled_value_cents + line.change_order_value_cents), 236, y + 4, 62);
  rightText(
    ctx,
    money(line.work_completed_previous_cents + line.materials_stored_previous_cents),
    308,
    y + 4,
    56,
  );
  rightText(ctx, money(line.work_completed_this_period_cents), 374, y + 4, 56);
  rightText(ctx, money(line.materials_stored_this_period_cents), 440, y + 4, 56);
  rightText(ctx, money(line.total_completed_and_stored_cents), 506, y + 4, 64);
  rightText(ctx, `${line.billing_percent_complete.toFixed(1)}%`, 580, y + 4, 24);
  rightText(ctx, money(line.balance_to_finish_cents), 614, y + 4, 52);
  rightText(ctx, money(line.retainage_held_cents - line.retainage_released_cents), 676, y + 4, 80);
}

function addContinuationPage(
  ctx: PdfCtx,
  project: ProjectRow,
  payApp: BillingApplicationRow,
  pageNumber: number,
) {
  ctx.page = ctx.doc.addPage([LANDSCAPE_W, LANDSCAPE_H]);
  drawContinuationHeader(ctx, project, payApp, pageNumber);
}

function drawContinuationSheets(
  ctx: PdfCtx,
  project: ProjectRow,
  payApp: BillingApplicationRow,
  lineItems: BillingLineItemRow[],
  totals: PaymentTotals,
) {
  let pageNumber = 1;
  addContinuationPage(ctx, project, payApp, pageNumber);

  lineItems.forEach((line, index) => {
    if (ctx.y < M + 44) {
      pageNumber += 1;
      addContinuationPage(ctx, project, payApp, pageNumber);
    }
    drawContinuationRow(ctx, line, index + 1, ctx.y);
    ctx.y -= 27;
  });

  if (ctx.y < M + 58) {
    pageNumber += 1;
    addContinuationPage(ctx, project, payApp, pageNumber);
  }
  drawBox(ctx, M, ctx.y - 8, LANDSCAPE_W - M * 2, 30, SURFACE);
  text(ctx, "TOTALS", 72, ctx.y + 4, { font: ctx.sansBold, size: 7 });
  rightText(ctx, money(totals.contract), 236, ctx.y + 4, 62, 7, ctx.sansBold);
  rightText(ctx, money(totals.previous), 308, ctx.y + 4, 56, 7, ctx.sansBold);
  rightText(ctx, money(totals.thisPeriod), 374, ctx.y + 4, 56, 7, ctx.sansBold);
  rightText(ctx, money(totals.stored), 440, ctx.y + 4, 56, 7, ctx.sansBold);
  rightText(ctx, money(totals.totalCompletedStored), 506, ctx.y + 4, 64, 7, ctx.sansBold);
  rightText(ctx, money(totals.balance), 614, ctx.y + 4, 52, 7, ctx.sansBold);
  rightText(ctx, money(totals.retainage), 676, ctx.y + 4, 80, 7, ctx.sansBold);
}

export async function generateAiaBillingPdf({
  project,
  payApp,
  lineItems,
  generatedAt = new Date(),
}: AiaPdfInput) {
  const doc = await PDFDocument.create();
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const ctx: PdfCtx = {
    doc,
    page: doc.addPage([PORTRAIT_W, PORTRAIT_H]),
    y: PORTRAIT_H - M,
    sans,
    sansBold,
    serif,
  };
  doc.removePage(0);

  const totals = computeTotals(lineItems);
  drawCoverSheet(ctx, project, payApp, totals, generatedAt);
  drawContinuationSheets(ctx, project, payApp, lineItems, totals);

  return doc.save();
}

export function aiaBillingFilename(project: ProjectRow, payApp: BillingApplicationRow) {
  const projectName = clean(project.name)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
  const appName = clean(payApp.application_number || payApp.invoice_number || "pay-app").replace(
    /[^a-z0-9]+/gi,
    "-",
  );
  return `${projectName || "project"}-${appName || "pay-app"}-aia-pay-application-package.pdf`;
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  const arrayBuffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(arrayBuffer).set(bytes);
  const blob = new Blob([arrayBuffer], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
