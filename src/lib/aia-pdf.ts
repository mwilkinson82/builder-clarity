import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { BillingLineItemRow } from "@/lib/billing.functions";
import type { BillingApplicationRow, ProjectRow } from "@/lib/projects.functions";

interface AiaPdfInput {
  project: ProjectRow;
  payApp: BillingApplicationRow;
  lineItems: BillingLineItemRow[];
  generatedAt?: Date;
}

const PAGE_W = 792;
const PAGE_H = 612;
const M = 32;
const INK = rgb(0.08, 0.07, 0.06);
const MUTED = rgb(0.42, 0.4, 0.36);
const HAIR = rgb(0.84, 0.82, 0.76);
const SURFACE = rgb(0.97, 0.96, 0.93);

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

function rightText(ctx: PdfCtx, value: string, x: number, y: number, width: number, size = 7) {
  const label = clean(value);
  const font = ctx.sans;
  text(ctx, label, x + width - font.widthOfTextAtSize(label, size), y, { size });
}

function ensure(ctx: PdfCtx, needed = 34) {
  if (ctx.y - needed > M) return;
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - M;
  drawTableHeader(ctx);
}

function drawRule(ctx: PdfCtx, y: number) {
  ctx.page.drawLine({
    start: { x: M, y },
    end: { x: PAGE_W - M, y },
    thickness: 0.5,
    color: HAIR,
  });
}

function drawMetric(
  ctx: PdfCtx,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number,
) {
  ctx.page.drawRectangle({
    x,
    y,
    width,
    height: 46,
    color: SURFACE,
    borderColor: HAIR,
    borderWidth: 0.5,
  });
  text(ctx, label.toUpperCase(), x + 8, y + 29, { font: ctx.sansBold, size: 6.5, color: MUTED });
  text(ctx, value, x + 8, y + 10, { font: ctx.serif, size: 15 });
}

function drawTableHeader(ctx: PdfCtx) {
  ctx.page.drawRectangle({
    x: M,
    y: ctx.y - 20,
    width: PAGE_W - M * 2,
    height: 20,
    color: SURFACE,
    borderColor: HAIR,
    borderWidth: 0.5,
  });
  const headers = [
    ["Code", 36],
    ["Description", 102],
    ["Scheduled", 270],
    ["CO", 344],
    ["Previous", 404],
    ["This Period", 468],
    ["Stored", 536],
    ["Total", 598],
    ["%", 660],
    ["Balance", 694],
  ] as const;
  headers.forEach(([label, x]) =>
    text(ctx, label.toUpperCase(), x, ctx.y - 13, { font: ctx.sansBold, size: 6, color: MUTED }),
  );
  ctx.y -= 28;
}

export async function generateAiaBillingPdf({
  project,
  payApp,
  lineItems,
  generatedAt = new Date(),
}: AiaPdfInput) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const ctx: PdfCtx = { doc, page, y: PAGE_H - M, sans, sansBold, serif };

  text(ctx, "OVERWATCH", M, ctx.y, { font: sansBold, size: 7, color: MUTED });
  text(ctx, "AIA-style Billing Continuation", M, ctx.y - 22, { font: serif, size: 22 });
  text(ctx, "Generated package for G702/G703 review. Not a licensed AIA form.", M, ctx.y - 38, {
    size: 8,
    color: MUTED,
  });
  text(ctx, `Generated ${generatedAt.toLocaleString("en-US")}`, PAGE_W - 210, ctx.y - 2, {
    size: 8,
    color: MUTED,
  });
  ctx.y -= 62;

  const left = [
    `Project: ${project.name}`,
    `Client: ${project.client || "-"}`,
    `Job: ${project.job_number || "-"}`,
  ];
  const right = [
    `Pay app: ${payApp.application_number || payApp.invoice_number || "-"}`,
    `Invoice: ${payApp.invoice_number || "-"}`,
    `Period: ${payApp.billing_period || "-"}`,
    `Submitted: ${dateText(payApp.submitted_date)}    Due: ${dateText(payApp.due_date)}`,
  ];
  left.forEach((line, index) =>
    text(ctx, line, M, ctx.y - index * 14, { font: index === 0 ? sansBold : sans, size: 9 }),
  );
  right.forEach((line, index) => text(ctx, line, PAGE_W - 300, ctx.y - index * 14, { size: 9 }));
  ctx.y -= 72;

  const totals = lineItems.reduce(
    (sum, line) => {
      sum.contract += line.scheduled_value_cents + line.change_order_value_cents;
      sum.previous += line.work_completed_previous_cents + line.materials_stored_previous_cents;
      sum.thisPeriod += line.work_completed_this_period_cents;
      sum.stored += line.materials_stored_this_period_cents;
      sum.total += line.total_completed_and_stored_cents;
      sum.balance += line.balance_to_finish_cents;
      sum.retainage += line.retainage_held_cents - line.retainage_released_cents;
      return sum;
    },
    { contract: 0, previous: 0, thisPeriod: 0, stored: 0, total: 0, balance: 0, retainage: 0 },
  );

  drawMetric(ctx, "Contract", money(totals.contract), M, ctx.y - 46, 116);
  drawMetric(ctx, "Previous", money(totals.previous), M + 124, ctx.y - 46, 116);
  drawMetric(ctx, "This period", money(totals.thisPeriod), M + 248, ctx.y - 46, 116);
  drawMetric(ctx, "Stored", money(totals.stored), M + 372, ctx.y - 46, 116);
  drawMetric(ctx, "Total", money(totals.total), M + 496, ctx.y - 46, 116);
  drawMetric(ctx, "Retainage", money(totals.retainage), M + 620, ctx.y - 46, 108);
  ctx.y -= 70;

  drawTableHeader(ctx);
  lineItems.forEach((line) => {
    ensure(ctx);
    const y = ctx.y;
    text(ctx, line.cost_code || "-", 36, y, { size: 7 });
    text(ctx, line.description.slice(0, 36), 102, y, { size: 7 });
    rightText(ctx, money(line.scheduled_value_cents), 264, y, 60);
    rightText(ctx, money(line.change_order_value_cents), 336, y, 48);
    rightText(
      ctx,
      money(line.work_completed_previous_cents + line.materials_stored_previous_cents),
      396,
      y,
      54,
    );
    rightText(ctx, money(line.work_completed_this_period_cents), 462, y, 58);
    rightText(ctx, money(line.materials_stored_this_period_cents), 528, y, 50);
    rightText(ctx, money(line.total_completed_and_stored_cents), 588, y, 54);
    rightText(ctx, `${line.billing_percent_complete.toFixed(1)}%`, 652, y, 32);
    rightText(ctx, money(line.balance_to_finish_cents), 688, y, 62);
    drawRule(ctx, y - 8);
    ctx.y -= 20;
  });

  ensure(ctx, 64);
  ctx.y -= 8;
  text(ctx, "Application summary", M, ctx.y, { font: sansBold, size: 9 });
  ctx.y -= 18;
  text(ctx, `Original contract: ${dollars(project.original_contract)}`, M, ctx.y, { size: 8 });
  text(ctx, `Amount billed this period: ${dollars(payApp.amount_billed)}`, M + 220, ctx.y, {
    size: 8,
  });
  text(ctx, `Retainage held: ${dollars(payApp.retainage)}`, M + 460, ctx.y, { size: 8 });

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
  return `${projectName || "project"}-${appName || "pay-app"}-aia-continuation.pdf`;
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
