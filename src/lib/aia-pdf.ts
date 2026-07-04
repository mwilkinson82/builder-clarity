// AIA G702/G703-style payment application package (GETTINGPAID1 Task 1).
//
// Standard: an owner's rep or lender accepts it without comment. The face
// mirrors the G702 layout (application header, lines 1-9 with the retainage
// split, change order summary, contractor certification with notary block,
// architect's certificate) and the continuation sheet carries the full G703
// column set. All arithmetic comes from aia-math (integer cents), so the
// continuation totals and the face reconcile by construction.
import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
// Relative .ts imports so the node-based print fixture smoke can generate
// the real package (scripts/aia-pdf-fixture-smoke.ts).
import {
  computeG702Face,
  computeG703Rows,
  computeG703Totals,
  computePreviousCertificatesCents,
  type G702Face,
  type G703Row,
  type G703Totals,
} from "./aia-math.ts";
import { billingDocumentLabel } from "./billing-labels.ts";
import type { BillingLineItemRow } from "@/lib/billing.functions";
import type { BillingApplicationRow, ProjectRow } from "@/lib/projects.functions";
import { drawPdfBrand, embedPdfLogo } from "./pdf-branding.ts";

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

const clean = (value?: string | number | null) =>
  String(value ?? "")
    .replace(/[^\x20-\x7e]/g, "")
    .trim();

// Money always shows exact cents — the AIA package is where fractional-cent
// drift would hide behind whole-dollar rounding.
const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
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

function centerText(
  ctx: PdfCtx,
  value: string,
  x: number,
  y: number,
  width: number,
  size = 7,
  font: PDFFont = ctx.sans,
) {
  const label = clean(value);
  text(ctx, label, x + (width - font.widthOfTextAtSize(label, size)) / 2, y, { size, font });
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
  height = 30,
) {
  drawBox(ctx, x, y, width, height, SURFACE);
  text(ctx, label.toUpperCase(), x + 6, y + height - 10, {
    font: ctx.sansBold,
    size: 5.5,
    color: MUTED,
  });
  drawWrappedText(ctx, value || "-", x + 6, y + 7, width - 12, { size: 8, maxLines: 2 });
}

// Build a synthetic single-line G703 input when the application has no line
// detail, so the face still computes through the same cents math.
function fallbackG703Line(payApp: BillingApplicationRow) {
  const cents = (value: number) => Math.round((Number.isFinite(value) ? value : 0) * 100);
  const completedStored = cents(payApp.amount_billed);
  const retainage = Math.max(0, cents(payApp.retainage));
  const contract = cents(payApp.contract_amount) + cents(payApp.change_order_amount);
  return {
    cost_code: "1",
    description: "Application total (no line detail)",
    scheduled_value_cents: cents(payApp.contract_amount),
    change_order_value_cents: cents(payApp.change_order_amount),
    work_completed_previous_cents: cents(payApp.paid_to_date),
    materials_stored_previous_cents: 0,
    work_completed_this_period_cents: Math.max(0, completedStored - cents(payApp.paid_to_date)),
    materials_stored_this_period_cents: 0,
    work_completed_to_date_cents: completedStored,
    materials_stored_to_date_cents: 0,
    total_completed_and_stored_cents: completedStored,
    balance_to_finish_cents: Math.max(0, contract - completedStored),
    retainage_pct: completedStored > 0 ? (retainage / completedStored) * 100 : 0,
    retainage_held_cents: retainage,
    retainage_released_cents: 0,
  };
}

// ---------------------------------------------------------------------------
// G702 face
// ---------------------------------------------------------------------------

function faceLineRow(
  ctx: PdfCtx,
  x: number,
  width: number,
  y: number,
  lineNo: string,
  label: string,
  value: string,
  opts: { bold?: boolean; fill?: ReturnType<typeof rgb>; indent?: boolean } = {},
) {
  const height = 17;
  drawBox(ctx, x, y, width, height, opts.fill ?? WHITE);
  const font = opts.bold ? ctx.sansBold : ctx.sans;
  text(ctx, lineNo, x + 5, y + 5.5, { font, size: 6.5, color: MUTED });
  text(ctx, label, x + (opts.indent ? 30 : 20), y + 5.5, { font, size: 7 });
  rightText(ctx, value, x + width - 96, y + 5.5, 90, 7.5, font);
  return y - height;
}

function drawSignatureLine(
  ctx: PdfCtx,
  label: string,
  x: number,
  width: number,
  y: number,
  size = 6,
) {
  drawRule(ctx, x, x + width, y, 0.7);
  text(ctx, label.toUpperCase(), x, y - 8, { size, color: MUTED });
}

function drawCoverSheet(
  ctx: PdfCtx,
  project: ProjectRow,
  payApp: BillingApplicationRow,
  face: G702Face,
  totals: G703Totals,
  generatedAt: Date,
  companyLogo?: PDFImage | null,
) {
  const page = ctx.doc.addPage([PORTRAIT_W, PORTRAIT_H]);
  ctx.page = page;
  ctx.y = PORTRAIT_H - M;

  // -- Document header -------------------------------------------------------
  text(ctx, "APPLICATION AND CERTIFICATE FOR PAYMENT", M, ctx.y - 14, {
    font: ctx.serif,
    size: 16,
  });
  text(ctx, "AIA G702-style payment application", M, ctx.y - 28, { size: 7, color: MUTED });
  drawPdfBrand({
    page,
    logo: companyLogo,
    companyName: project.organization_name,
    font: ctx.sansBold,
    x: PORTRAIT_W - M - 170,
    y: ctx.y - 4,
    maxWidth: 170,
    maxHeight: 26,
    color: MUTED,
  });
  text(
    ctx,
    `Prepared ${dateText(generatedAt.toISOString().slice(0, 10))}`,
    PORTRAIT_W - M - 170,
    ctx.y - 28,
    {
      size: 7,
      color: MUTED,
    },
  );
  drawRule(ctx, M, PORTRAIT_W - M, ctx.y - 36);

  // -- Application header fields (To / From / Project / Via + app block) -----
  ctx.y -= 74;
  const fieldW = (PORTRAIT_W - M * 2 - 18) / 4;
  drawField(ctx, "To (Owner)", project.client || "-", M, ctx.y, fieldW * 2 + 6, 30);
  drawField(
    ctx,
    "From (Contractor)",
    project.organization_name || "-",
    M + fieldW * 2 + 12,
    ctx.y,
    fieldW * 2 + 6,
    30,
  );
  ctx.y -= 36;
  drawField(
    ctx,
    "Project",
    `${project.name}${project.job_number ? ` - Job ${project.job_number}` : ""}`,
    M,
    ctx.y,
    fieldW * 2 + 6,
    30,
  );
  drawField(ctx, "Via (Architect)", "-", M + fieldW * 2 + 12, ctx.y, fieldW * 2 + 6, 30);
  ctx.y -= 36;
  drawField(
    ctx,
    "Application no.",
    billingDocumentLabel(payApp.application_number, payApp.invoice_number, "-"),
    M,
    ctx.y,
    fieldW,
    30,
  );
  drawField(
    ctx,
    "Period to",
    payApp.billing_period || dateText(payApp.due_date),
    M + fieldW + 6,
    ctx.y,
    fieldW,
    30,
  );
  drawField(
    ctx,
    "Application date",
    dateText(payApp.submitted_date),
    M + fieldW * 2 + 12,
    ctx.y,
    fieldW,
    30,
  );
  drawField(ctx, "Contract date", "-", M + fieldW * 3 + 18, ctx.y, fieldW, 30);

  // -- Two-column body: certificates left, application lines right -----------
  ctx.y -= 48;
  const bodyTop = ctx.y;
  const leftX = M;
  const leftW = 258;
  const rightX = M + leftW + 14;
  const rightW = PORTRAIT_W - M - rightX;

  // Right column: lines 1-9 (the application face).
  let rowY = bodyTop;
  text(ctx, "CONTRACTOR'S APPLICATION FOR PAYMENT", rightX, rowY + 6, {
    font: ctx.sansBold,
    size: 7,
    color: MUTED,
  });
  rowY -= 12;
  rowY = faceLineRow(
    ctx,
    rightX,
    rightW,
    rowY,
    "1.",
    "Original contract sum",
    money(face.originalContractSumCents),
  );
  rowY = faceLineRow(
    ctx,
    rightX,
    rightW,
    rowY,
    "2.",
    "Net change by change orders",
    money(face.netChangeByChangeOrdersCents),
  );
  rowY = faceLineRow(
    ctx,
    rightX,
    rightW,
    rowY,
    "3.",
    "Contract sum to date (1 + 2)",
    money(face.contractSumToDateCents),
    { bold: true, fill: SURFACE },
  );
  rowY = faceLineRow(
    ctx,
    rightX,
    rightW,
    rowY,
    "4.",
    "Total completed & stored to date",
    money(face.totalCompletedStoredCents),
  );
  rowY = faceLineRow(
    ctx,
    rightX,
    rightW,
    rowY,
    "5.",
    "Retainage:",
    money(face.totalRetainageCents),
  );
  rowY = faceLineRow(
    ctx,
    rightX,
    rightW,
    rowY,
    "5a.",
    "Of completed work",
    money(face.retainageCompletedWorkCents),
    { indent: true },
  );
  rowY = faceLineRow(
    ctx,
    rightX,
    rightW,
    rowY,
    "5b.",
    "Of stored material",
    money(face.retainageStoredMaterialCents),
    { indent: true },
  );
  rowY = faceLineRow(
    ctx,
    rightX,
    rightW,
    rowY,
    "6.",
    "Total earned less retainage (4 - 5)",
    money(face.totalEarnedLessRetainageCents),
    { bold: true, fill: SURFACE },
  );
  rowY = faceLineRow(
    ctx,
    rightX,
    rightW,
    rowY,
    "7.",
    "Less previous certificates for payment",
    money(face.previousCertificatesCents),
  );
  rowY = faceLineRow(
    ctx,
    rightX,
    rightW,
    rowY,
    "8.",
    "Current payment due",
    money(face.currentPaymentDueCents),
    { bold: true, fill: SURFACE },
  );
  rowY = faceLineRow(
    ctx,
    rightX,
    rightW,
    rowY,
    "9.",
    "Balance to finish, incl. retainage (3 - 6)",
    money(face.balanceToFinishInclRetainageCents),
  );

  // Change order summary (additions/deductions known from allocated lines).
  rowY -= 14;
  text(ctx, "CHANGE ORDER SUMMARY", rightX, rowY + 4, {
    font: ctx.sansBold,
    size: 6.5,
    color: MUTED,
  });
  rowY -= 10;
  const additions = Math.max(0, face.netChangeByChangeOrdersCents);
  const deductions = Math.max(0, -face.netChangeByChangeOrdersCents);
  const coRow = (label: string, add: string, deduct: string, y: number, bold = false) => {
    const height = 15;
    drawBox(ctx, rightX, y, rightW, height, bold ? SURFACE : WHITE);
    const font = bold ? ctx.sansBold : ctx.sans;
    text(ctx, label, rightX + 5, y + 4.5, { font, size: 6.5 });
    rightText(ctx, add, rightX + rightW - 150, y + 4.5, 70, 6.5, font);
    rightText(ctx, deduct, rightX + rightW - 76, y + 4.5, 70, 6.5, font);
    return y - height;
  };
  const headerHeight = 15;
  drawBox(ctx, rightX, rowY, rightW, headerHeight, SURFACE);
  text(ctx, "APPROVED CHANGE ORDERS", rightX + 5, rowY + 4.5, { font: ctx.sansBold, size: 6 });
  rightText(ctx, "ADDITIONS", rightX + rightW - 150, rowY + 4.5, 70, 6, ctx.sansBold);
  rightText(ctx, "DEDUCTIONS", rightX + rightW - 76, rowY + 4.5, 70, 6, ctx.sansBold);
  rowY -= headerHeight;
  rowY = coRow("Total approved to date", money(additions), money(deductions), rowY);
  rowY = coRow(
    "Net change by change orders",
    money(face.netChangeByChangeOrdersCents),
    "",
    rowY,
    true,
  );

  // Left column: certifications, notary, architect's certificate.
  let leftY = bodyTop;
  text(ctx, "CONTRACTOR'S CERTIFICATION", leftX, leftY + 6, {
    font: ctx.sansBold,
    size: 7,
    color: MUTED,
  });
  leftY -= 8;
  drawBox(ctx, leftX, leftY - 118, leftW, 118, WHITE);
  drawWrappedText(
    ctx,
    "The undersigned contractor certifies that to the best of the contractor's knowledge, information and belief the work covered by this application for payment has been completed in accordance with the contract documents, that all amounts have been paid by the contractor for work for which previous certificates for payment were issued and payments received from the owner, and that current payment shown herein is now due.",
    leftX + 8,
    leftY - 12,
    leftW - 16,
    { size: 6.5, lineHeight: 8.5, maxLines: 8 },
  );
  drawSignatureLine(ctx, "Contractor (signature)", leftX + 8, 140, leftY - 92);
  drawSignatureLine(ctx, "Date", leftX + 170, leftW - 178, leftY - 92);
  text(ctx, `By: ${project.project_manager || "-"}`, leftX + 8, leftY - 112, {
    size: 6.5,
    color: MUTED,
  });
  leftY -= 130;

  // Notary block: laid out even where signing is manual.
  text(ctx, "NOTARY", leftX, leftY, { font: ctx.sansBold, size: 7, color: MUTED });
  leftY -= 8;
  drawBox(ctx, leftX, leftY - 84, leftW, 84, SURFACE);
  text(ctx, "State of:", leftX + 8, leftY - 14, { size: 6.5 });
  drawRule(ctx, leftX + 42, leftX + 120, leftY - 16, 0.7);
  text(ctx, "County of:", leftX + 128, leftY - 14, { size: 6.5 });
  drawRule(ctx, leftX + 166, leftW + leftX - 8, leftY - 16, 0.7);
  text(ctx, "Subscribed and sworn to before me this", leftX + 8, leftY - 30, { size: 6.5 });
  drawRule(ctx, leftX + 138, leftX + 168, leftY - 32, 0.7);
  text(ctx, "day of", leftX + 172, leftY - 30, { size: 6.5 });
  drawRule(ctx, leftX + 196, leftW + leftX - 8, leftY - 32, 0.7);
  drawSignatureLine(ctx, "Notary public", leftX + 8, 140, leftY - 54);
  text(ctx, "My commission expires:", leftX + 8, leftY - 70, { size: 6.5 });
  drawRule(ctx, leftX + 88, leftW + leftX - 8, leftY - 72, 0.7);
  leftY -= 96;

  // Architect's certificate for payment.
  text(ctx, "ARCHITECT'S CERTIFICATE FOR PAYMENT", leftX, leftY, {
    font: ctx.sansBold,
    size: 7,
    color: MUTED,
  });
  leftY -= 8;
  drawBox(ctx, leftX, leftY - 110, leftW, 110, WHITE);
  drawWrappedText(
    ctx,
    "In accordance with the contract documents, based on on-site observations and the data comprising this application, the architect certifies to the owner that to the best of the architect's knowledge, information and belief the work has progressed as indicated, the quality of the work is in accordance with the contract documents, and the contractor is entitled to payment of the AMOUNT CERTIFIED.",
    leftX + 8,
    leftY - 12,
    leftW - 16,
    { size: 6.5, lineHeight: 8.5, maxLines: 7 },
  );
  text(ctx, "AMOUNT CERTIFIED:", leftX + 8, leftY - 76, { font: ctx.sansBold, size: 6.5 });
  drawRule(ctx, leftX + 84, leftW + leftX - 8, leftY - 78, 0.7);
  drawSignatureLine(ctx, "Architect (signature)", leftX + 8, 140, leftY - 98);
  drawSignatureLine(ctx, "Date", leftX + 170, leftW - 178, leftY - 98);

  // -- Footer: reconciliation note -------------------------------------------
  const footerY = Math.min(leftY - 122, rowY - 16);
  drawRule(ctx, M, PORTRAIT_W - M, footerY + 8);
  text(
    ctx,
    `Continuation sheet total completed and stored ${money(totals.totalCompletedStoredCents)} reconciles to line 4. Amounts are exact to the cent.`,
    M,
    footerY - 2,
    { size: 6.5, color: MUTED },
  );
}

// ---------------------------------------------------------------------------
// G703 continuation sheet
// ---------------------------------------------------------------------------

const CONTINUATION_COLUMNS = [
  { key: "item", letter: "A", label: "Item No.", x: 32, width: 40, align: "left" },
  {
    key: "description",
    letter: "B",
    label: "Description of Work",
    x: 72,
    width: 150,
    align: "left",
  },
  { key: "scheduled", letter: "C", label: "Scheduled Value", x: 222, width: 74, align: "right" },
  {
    key: "previous",
    letter: "D+E",
    label: "From Previous Application",
    x: 296,
    width: 68,
    align: "right",
  },
  { key: "period", letter: "E", label: "This Period", x: 364, width: 66, align: "right" },
  {
    key: "stored",
    letter: "F",
    label: "Materials Presently Stored",
    x: 430,
    width: 66,
    align: "right",
  },
  {
    key: "total",
    letter: "G",
    label: "Total Completed and Stored (D+E+F)",
    x: 496,
    width: 76,
    align: "right",
  },
  { key: "pct", letter: "%", label: "(G / C)", x: 572, width: 36, align: "center" },
  {
    key: "balance",
    letter: "H",
    label: "Balance to Finish (C - G)",
    x: 608,
    width: 68,
    align: "right",
  },
  { key: "retainage", letter: "I", label: "Retainage", x: 676, width: 84, align: "right" },
] as const;

function getContinuationColumns(showRetainage: boolean) {
  return CONTINUATION_COLUMNS.filter((column) => showRetainage || column.key !== "retainage");
}

function drawContinuationHeader(
  ctx: PdfCtx,
  project: ProjectRow,
  payApp: BillingApplicationRow,
  pageNumber: number,
  showRetainage: boolean,
  companyLogo?: PDFImage | null,
) {
  text(ctx, "CONTINUATION SHEET", M, LANDSCAPE_H - M, { font: ctx.serif, size: 16 });
  text(ctx, "AIA G703-style schedule of values detail", M, LANDSCAPE_H - M - 12, {
    size: 6.5,
    color: MUTED,
  });
  drawPdfBrand({
    page: ctx.page,
    logo: companyLogo,
    companyName: project.organization_name,
    font: ctx.sansBold,
    x: LANDSCAPE_W - M - 185,
    y: LANDSCAPE_H - M + 2,
    maxWidth: 185,
    maxHeight: 26,
    color: MUTED,
  });
  text(ctx, `Project: ${project.name}`, M, LANDSCAPE_H - M - 26, { font: ctx.sansBold, size: 8 });
  text(
    ctx,
    `Application: ${billingDocumentLabel(payApp.application_number, payApp.invoice_number, "-")}`,
    M + 300,
    LANDSCAPE_H - M - 26,
    { size: 8 },
  );
  text(
    ctx,
    `Period: ${payApp.billing_period || dateText(payApp.due_date)}`,
    M + 470,
    LANDSCAPE_H - M - 26,
    { size: 8 },
  );
  text(ctx, `Page ${pageNumber}`, LANDSCAPE_W - M - 60, LANDSCAPE_H - M - 26, {
    size: 8,
    color: MUTED,
  });
  ctx.y = LANDSCAPE_H - M - 40;

  // Column letter strip + header row (headers repeat on every page).
  const columns = getContinuationColumns(showRetainage);
  ctx.page.drawRectangle({
    x: M,
    y: ctx.y - 12,
    width: LANDSCAPE_W - M * 2,
    height: 12,
    color: SURFACE,
    borderColor: HAIR,
    borderWidth: 0.5,
  });
  columns.forEach((column) =>
    centerText(ctx, column.letter, column.x + 2, ctx.y - 9, column.width - 4, 6, ctx.sansBold),
  );
  ctx.y -= 12;
  ctx.page.drawRectangle({
    x: M,
    y: ctx.y - 24,
    width: LANDSCAPE_W - M * 2,
    height: 24,
    color: SURFACE,
    borderColor: HAIR,
    borderWidth: 0.5,
  });
  columns.forEach((column) => {
    const label = column.label.toUpperCase();
    const x = column.x + 4;
    const width = column.width - 8;
    if (column.align === "center") {
      centerText(ctx, label, x, ctx.y - 12, width, 5.5, ctx.sansBold);
      return;
    }
    drawWrappedText(ctx, label, x, ctx.y - 9, width, {
      font: ctx.sansBold,
      size: 5.5,
      lineHeight: 6.5,
      maxLines: 3,
    });
  });
  ctx.y -= 31;
}

function drawContinuationRow(ctx: PdfCtx, row: G703Row, y: number, showRetainage: boolean) {
  drawBox(ctx, M, y - 8, LANDSCAPE_W - M * 2, 27, WHITE);
  text(ctx, row.item, 36, y + 4, { size: 7 });
  drawWrappedText(ctx, row.description || "-", 76, y + 6, 140, {
    size: 7,
    lineHeight: 8,
    maxLines: 2,
  });
  rightText(ctx, money(row.scheduledValueCents), 226, y + 4, 66);
  rightText(ctx, money(row.fromPreviousCents), 300, y + 4, 60);
  rightText(ctx, money(row.thisPeriodCents), 368, y + 4, 58);
  rightText(ctx, money(row.storedMaterialCents), 434, y + 4, 58);
  rightText(ctx, money(row.totalCompletedStoredCents), 500, y + 4, 68);
  centerText(ctx, `${row.percentComplete.toFixed(1)}%`, 576, y + 4, 28);
  rightText(ctx, money(row.balanceToFinishCents), 612, y + 4, 60);
  if (showRetainage) {
    rightText(ctx, money(row.retainageCents), 680, y + 4, 76);
  }
}

function addContinuationPage(
  ctx: PdfCtx,
  project: ProjectRow,
  payApp: BillingApplicationRow,
  pageNumber: number,
  showRetainage: boolean,
  companyLogo?: PDFImage | null,
) {
  ctx.page = ctx.doc.addPage([LANDSCAPE_W, LANDSCAPE_H]);
  drawContinuationHeader(ctx, project, payApp, pageNumber, showRetainage, companyLogo);
}

function drawContinuationSheets(
  ctx: PdfCtx,
  project: ProjectRow,
  payApp: BillingApplicationRow,
  rows: G703Row[],
  totals: G703Totals,
  showRetainage: boolean,
  companyLogo?: PDFImage | null,
) {
  let pageNumber = 1;
  addContinuationPage(ctx, project, payApp, pageNumber, showRetainage, companyLogo);

  rows.forEach((row) => {
    if (ctx.y < M + 44) {
      pageNumber += 1;
      addContinuationPage(ctx, project, payApp, pageNumber, showRetainage, companyLogo);
    }
    drawContinuationRow(ctx, row, ctx.y, showRetainage);
    ctx.y -= 27;
  });

  // Totals row never orphans: it moves with at least the reconciliation note.
  if (ctx.y < M + 58) {
    pageNumber += 1;
    addContinuationPage(ctx, project, payApp, pageNumber, showRetainage, companyLogo);
  }
  drawBox(ctx, M, ctx.y - 8, LANDSCAPE_W - M * 2, 30, SURFACE);
  text(ctx, "GRAND TOTALS", 76, ctx.y + 4, { font: ctx.sansBold, size: 7 });
  rightText(ctx, money(totals.scheduledValueCents), 226, ctx.y + 4, 66, 7, ctx.sansBold);
  rightText(ctx, money(totals.fromPreviousCents), 300, ctx.y + 4, 60, 7, ctx.sansBold);
  rightText(ctx, money(totals.thisPeriodCents), 368, ctx.y + 4, 58, 7, ctx.sansBold);
  rightText(ctx, money(totals.storedMaterialCents), 434, ctx.y + 4, 58, 7, ctx.sansBold);
  rightText(ctx, money(totals.totalCompletedStoredCents), 500, ctx.y + 4, 68, 7, ctx.sansBold);
  centerText(ctx, `${totals.percentComplete.toFixed(1)}%`, 576, ctx.y + 4, 28, 7, ctx.sansBold);
  rightText(ctx, money(totals.balanceToFinishCents), 612, ctx.y + 4, 60, 7, ctx.sansBold);
  if (showRetainage) {
    rightText(ctx, money(totals.retainageCents), 680, ctx.y + 4, 76, 7, ctx.sansBold);
  }
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

  // One arithmetic system for the whole package: with line detail the face
  // derives from the continuation rows; without it a synthetic single line
  // built from the application totals goes through the identical math.
  const g703Inputs = lineItems.length > 0 ? lineItems : [fallbackG703Line(payApp)];
  const rows = computeG703Rows(g703Inputs);
  const totals = computeG703Totals(rows);
  const face = computeG702Face({
    originalContractSumCents:
      lineItems.length > 0
        ? rows.reduce(
            (sum, row, index) => sum + Math.round(g703Inputs[index].scheduled_value_cents),
            0,
          )
        : Math.round(payApp.contract_amount * 100),
    netChangeByChangeOrdersCents:
      lineItems.length > 0
        ? g703Inputs.reduce((sum, line) => sum + Math.round(line.change_order_value_cents), 0)
        : Math.round(payApp.change_order_amount * 100),
    totals,
    previousCertificatesCents: computePreviousCertificatesCents(g703Inputs),
  });
  const showRetainage = totals.retainageCents > 0 || totals.retainageCompletedWorkCents > 0;

  const companyLogo = await embedPdfLogo(doc, project.organization_logo_url);
  drawCoverSheet(ctx, project, payApp, face, totals, generatedAt, companyLogo);
  drawContinuationSheets(ctx, project, payApp, rows, totals, showRetainage, companyLogo);

  return doc.save();
}

export function aiaBillingFilename(project: ProjectRow, payApp: BillingApplicationRow) {
  const projectName = clean(project.name)
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-|-$/g, "");
  const appName = clean(
    billingDocumentLabel(payApp.application_number, payApp.invoice_number, "pay-app"),
  ).replace(/[^a-z0-9]+/gi, "-");
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
