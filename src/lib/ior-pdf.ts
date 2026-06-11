// Client-side IOR PDF generator using pdf-lib.
// Two layouts: "executive" (one-pager + appendix) and "structured" (multi-page report).
// All drawing helpers operate in points (72 = 1 inch). US Letter portrait.

import {
  PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB,
} from "pdf-lib";
import type { Rollup, ExposureCategory, ResponsePath } from "@/lib/ior";
import type {
  ProjectRow, ExposureRow, ChangeOrderRow, BucketRow,
  DecisionRow, ReviewRow,
} from "@/lib/projects.functions";

export type IorPdfStyle = "executive" | "structured";

export interface IorPdfInput {
  project: ProjectRow;
  rollup: Rollup;
  exposures: ExposureRow[];
  changeOrders: ChangeOrderRow[];
  buckets: BucketRow[];
  decisions: DecisionRow[];
  reviews: ReviewRow[];
  narrative?: string;
  generatedAt?: Date;
}

const PAGE_W = 612;
const PAGE_H = 792;
const M = 48; // margin

const INK: RGB = rgb(0.06, 0.07, 0.1);
const MUTED: RGB = rgb(0.42, 0.45, 0.5);
const HAIR: RGB = rgb(0.85, 0.86, 0.9);
const ACCENT: RGB = rgb(0.78, 0.55, 0.18);
const DANGER: RGB = rgb(0.78, 0.18, 0.21);
const SUCCESS: RGB = rgb(0.16, 0.55, 0.35);
const SURFACE: RGB = rgb(0.97, 0.97, 0.95);

const RESPONSE_LABELS: Record<ResponsePath, string> = {
  eliminate: "Eliminate", recover: "Recover", offset: "Offset", accept: "Accept",
};
const CATEGORY_LABELS: Record<ExposureCategory, string> = {
  owner_decision: "Owner decision", design_drift: "Design drift",
  trade_performance: "Trade performance", procurement: "Procurement",
  schedule_compression: "Schedule compression", allowance_overrun: "Allowance overrun",
  field_change: "Field change", closeout_punch: "Closeout / punch", other: "Other",
};

const fmtUSD = (n: number) => {
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return n < 0 ? `(${s})` : s;
};
const fmtPct = (n: number, d = 1) => `${n.toFixed(d)}%`;
const fmtDate = (d?: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—");

interface Ctx {
  doc: PDFDocument;
  page: PDFPage;
  y: number;
  serif: PDFFont;
  sans: PDFFont;
  sansB: PDFFont;
}

function newPage(c: Ctx) {
  c.page = c.doc.addPage([PAGE_W, PAGE_H]);
  c.y = PAGE_H - M;
}
function ensure(c: Ctx, needed: number) {
  if (c.y - needed < M) newPage(c);
}
function text(c: Ctx, s: string, x: number, y: number, opts: { font?: PDFFont; size?: number; color?: RGB } = {}) {
  c.page.drawText(s, {
    x, y,
    font: opts.font ?? c.sans,
    size: opts.size ?? 10,
    color: opts.color ?? INK,
  });
}
function rule(c: Ctx, y: number, color: RGB = HAIR) {
  c.page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 0.5, color });
}
function chip(c: Ctx, label: string, x: number, y: number, color: RGB = MUTED) {
  const size = 7;
  const w = c.sansB.widthOfTextAtSize(label, size) + 8;
  c.page.drawRectangle({ x, y: y - 2, width: w, height: 12, color: rgb(0.98,0.98,0.96), borderColor: color, borderWidth: 0.5 });
  text(c, label, x + 4, y, { font: c.sansB, size, color });
  return w;
}
function wrap(c: Ctx, s: string, x: number, maxWidth: number, opts: { font?: PDFFont; size?: number; lineHeight?: number; color?: RGB } = {}) {
  const font = opts.font ?? c.sans;
  const size = opts.size ?? 10;
  const lh = opts.lineHeight ?? size * 1.35;
  const words = s.split(/\s+/);
  let line = "";
  const lines: string[] = [];
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line); line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  for (const ln of lines) {
    ensure(c, lh);
    text(c, ln, x, c.y, { font, size, color: opts.color });
    c.y -= lh;
  }
}
function sectionTitle(c: Ctx, label: string) {
  ensure(c, 36);
  c.y -= 14;
  text(c, label.toUpperCase(), M, c.y, { font: c.sansB, size: 8, color: MUTED });
  c.y -= 8;
  rule(c, c.y);
  c.y -= 18;
}

// ---------------- KPI strip ----------------
function drawKpiStrip(c: Ctx, r: Rollup, project: ProjectRow) {
  const cells: { label: string; value: string; sub?: string; color?: RGB }[] = [
    { label: "Original GP", value: fmtUSD(r.originalGP), sub: fmtPct(r.originalGPpct) },
    { label: "Indicated GP", value: fmtUSD(r.indicatedGP), sub: fmtPct(r.indicatedGPpct), color: ACCENT },
    { label: "GP at Risk", value: fmtUSD(r.gpAtRisk), sub: "Orig − Indicated", color: r.gpAtRisk > 0 ? DANGER : SUCCESS },
    { label: "E-Hold", value: fmtUSD(r.exposureHolds), sub: "Specific risks" },
    { label: "C-Hold", value: fmtUSD(r.contingencyHold), sub: "Uncertainty" },
    { label: "Schedule", value: project.schedule_variance_weeks > 0 ? `+${project.schedule_variance_weeks}w` : "On time", sub: "vs baseline", color: project.schedule_variance_weeks > 0 ? DANGER : SUCCESS },
  ];
  const w = (PAGE_W - 2 * M) / cells.length;
  ensure(c, 70);
  const top = c.y;
  const boxH = 64;
  c.page.drawRectangle({ x: M, y: top - boxH, width: PAGE_W - 2 * M, height: boxH, color: SURFACE, borderColor: HAIR, borderWidth: 0.5 });
  cells.forEach((cell, i) => {
    const cx = M + i * w + 8;
    if (i > 0) {
      c.page.drawLine({ start: { x: M + i * w, y: top - 8 }, end: { x: M + i * w, y: top - boxH + 8 }, thickness: 0.4, color: HAIR });
    }
    text(c, cell.label.toUpperCase(), cx, top - 14, { font: c.sansB, size: 6.5, color: MUTED });
    text(c, cell.value, cx, top - 34, { font: c.serif, size: 12, color: cell.color ?? INK });
    if (cell.sub) text(c, cell.sub, cx, top - 50, { size: 7, color: MUTED });
  });
  c.y -= boxH + 14;
}

// ---------------- Waterfall (simplified bar chart) ----------------
function drawWaterfall(c: Ctx, r: Rollup, project: ProjectRow) {
  ensure(c, 120);
  const top = c.y;
  const h = 90;
  const left = M;
  const right = PAGE_W - M;
  const bars: { label: string; v: number; color: RGB }[] = [
    { label: "Original Contract", v: project.original_contract, color: rgb(0.7, 0.72, 0.78) },
    { label: "Approved COs", v: r.approvedCOContract, color: rgb(0.45, 0.55, 0.7) },
    { label: "Pending (wtd)", v: r.weightedPendingCOContract, color: rgb(0.55, 0.6, 0.72) },
    { label: "Forecasted Final", v: r.forecastedFinalContract, color: ACCENT },
    { label: "Forecasted Cost", v: -r.forecastedFinalCost, color: rgb(0.55, 0.4, 0.4) },
    { label: "Exposure Holds", v: -r.exposureHolds, color: DANGER },
    { label: "C-Hold", v: -r.contingencyHold, color: rgb(0.6, 0.4, 0.4) },
    { label: "Indicated GP", v: r.indicatedGP, color: r.indicatedGP > 0 ? SUCCESS : DANGER },
  ];
  const maxAbs = Math.max(...bars.map((b) => Math.abs(b.v)), 1);
  const bw = (right - left) / bars.length - 6;
  bars.forEach((b, i) => {
    const x = left + i * ((right - left) / bars.length) + 3;
    const barH = (Math.abs(b.v) / maxAbs) * h;
    const y = b.v >= 0 ? top - h + (h - barH) : top - h;
    c.page.drawRectangle({ x, y, width: bw, height: barH, color: b.color });
    text(c, b.label, x, top - h - 10, { font: c.sansB, size: 6, color: MUTED });
    text(c, fmtUSD(b.v), x, top - h - 20, { font: c.sans, size: 7, color: INK });
  });
  c.y = top - h - 36;
}

// ---------------- Header / Cover ----------------
function drawHeader(c: Ctx, project: ProjectRow, label: string, date: Date) {
  ensure(c, 80);
  const top = c.y;
  text(c, "INDICATED OUTCOME REPORT", M, top, { font: c.sansB, size: 8, color: ACCENT });
  c.y = top - 18;
  text(c, project.name, M, c.y, { font: c.serif, size: 22 });
  c.y -= 18;
  text(c, `${project.client || "—"}  ·  ${label}  ·  ${date.toLocaleDateString("en-US", { dateStyle: "long" })}`, M, c.y, { size: 9, color: MUTED });
  c.y -= 12;
  text(c, `${project.phase} phase  -  ${project.percent_complete}% complete  -  Baseline ${fmtDate(project.baseline_completion_date)}  ->  Forecast ${fmtDate(project.forecast_completion_date)}`, M, c.y, { size: 9, color: MUTED });
  c.y -= 14;
  rule(c, c.y);
  c.y -= 14;
}

// ---------------- Exposure tables ----------------
interface ExpRow { e: ExposureRow }
function drawExposuresTable(c: Ctx, exposures: ExposureRow[], opts: { title?: string; limit?: number; groupByPath?: boolean } = {}) {
  const list = opts.limit ? exposures.slice(0, opts.limit) : exposures;
  if (opts.title) sectionTitle(c, opts.title);
  const cols = [
    { label: "Exposure", x: M, w: 180 },
    { label: "Category", x: M + 184, w: 90 },
    { label: "Treatment", x: M + 278, w: 60 },
    { label: "$ Exposure", x: M + 342, w: 60 },
    { label: "Prob", x: M + 408, w: 30 },
    { label: "Weighted", x: M + 442, w: 70 },
  ];
  ensure(c, 16);
  cols.forEach((col) => text(c, col.label.toUpperCase(), col.x, c.y, { font: c.sansB, size: 7, color: MUTED }));
  c.y -= 8;
  rule(c, c.y);
  c.y -= 10;

  const groups: { key: string; items: ExposureRow[] }[] = opts.groupByPath
    ? (["eliminate", "recover", "offset", "accept"] as ResponsePath[]).map((p) => ({
        key: RESPONSE_LABELS[p],
        items: list.filter((x) => x.response_path === p),
      })).filter((g) => g.items.length > 0)
    : [{ key: "", items: list }];

  for (const g of groups) {
    if (g.key) {
      ensure(c, 14);
      const groupTotal = g.items.reduce((s, e) => s + e.dollar_exposure * (e.probability / 100), 0);
      text(c, `${g.key.toUpperCase()}  ·  ${g.items.length} item${g.items.length === 1 ? "" : "s"}  ·  ${fmtUSD(groupTotal)} weighted`, M, c.y, { font: c.sansB, size: 7, color: ACCENT });
      c.y -= 10;
    }
    for (const e of g.items) {
      ensure(c, 24);
      const titleLines = splitToWidth(c.sansB, 8.5, e.title, cols[0].w);
      text(c, titleLines[0], cols[0].x, c.y, { font: c.sansB, size: 8.5 });
      text(c, CATEGORY_LABELS[e.category], cols[1].x, c.y, { size: 8, color: MUTED });
      text(c, RESPONSE_LABELS[e.response_path], cols[2].x, c.y, { font: c.sansB, size: 8, color: ACCENT });
      text(c, fmtUSD(e.dollar_exposure), cols[3].x, c.y, { size: 8.5 });
      text(c, `${e.probability}%`, cols[4].x, c.y, { size: 8.5, color: MUTED });
      text(c, fmtUSD(e.dollar_exposure * (e.probability / 100)), cols[5].x, c.y, { font: c.sansB, size: 8.5 });
      c.y -= 12;
      if (e.description) {
        const desc = splitToWidth(c.sans, 7.5, e.description, cols[0].w + cols[1].w);
        for (const ln of desc.slice(0, 2)) {
          ensure(c, 10);
          text(c, ln, cols[0].x, c.y, { size: 7.5, color: MUTED });
          c.y -= 9;
        }
      }
      c.y -= 4;
    }
  }
}

function splitToWidth(font: PDFFont, size: number, s: string, maxWidth: number): string[] {
  const words = s.split(/\s+/);
  const out: string[] = [];
  let line = "";
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > maxWidth && line) { out.push(line); line = w; }
    else line = t;
  }
  if (line) out.push(line);
  return out;
}

function drawDecisions(c: Ctx, decisions: DecisionRow[]) {
  const open = decisions.filter((d) => d.status !== "resolved");
  if (open.length === 0) {
    text(c, "All required decisions have been resolved.", M, c.y, { size: 9, color: MUTED });
    c.y -= 14; return;
  }
  for (const d of open) {
    ensure(c, 30);
    chip(c, d.status.replace("_", " ").toUpperCase(), M, c.y + 1, d.status === "overdue" ? DANGER : d.status === "in_progress" ? ACCENT : MUTED);
    text(c, d.decision, M + 70, c.y, { font: c.sansB, size: 9.5 });
    c.y -= 11;
    text(c, `Owner: ${d.owner || "—"}    Due: ${fmtDate(d.due_date)}`, M, c.y, { size: 8, color: MUTED });
    if (d.impact) {
      c.y -= 9;
      wrap(c, `Impact: ${d.impact}`, M, PAGE_W - 2 * M, { size: 8.5, color: INK });
    }
    c.y -= 4;
    rule(c, c.y);
    c.y -= 6;
  }
}

function drawBuckets(c: Ctx, buckets: BucketRow[]) {
  const cols = [
    { label: "Bucket", x: M, w: 130 },
    { label: "Original", x: M + 134, w: 70 },
    { label: "Actual", x: M + 208, w: 70 },
    { label: "FTC", x: M + 282, w: 70 },
    { label: "Forecast", x: M + 356, w: 70 },
    { label: "Variance", x: M + 430, w: 80 },
  ];
  ensure(c, 16);
  cols.forEach((col) => text(c, col.label.toUpperCase(), col.x, c.y, { font: c.sansB, size: 7, color: MUTED }));
  c.y -= 8; rule(c, c.y); c.y -= 10;
  for (const b of buckets) {
    ensure(c, 14);
    const fac = b.actual_to_date + b.ftc;
    const variance = b.original_budget - fac;
    text(c, b.bucket, cols[0].x, c.y, { font: c.sansB, size: 8.5 });
    text(c, fmtUSD(b.original_budget), cols[1].x, c.y, { size: 8.5, color: MUTED });
    text(c, fmtUSD(b.actual_to_date), cols[2].x, c.y, { size: 8.5 });
    text(c, fmtUSD(b.ftc), cols[3].x, c.y, { size: 8.5 });
    text(c, fmtUSD(fac), cols[4].x, c.y, { font: c.sansB, size: 8.5 });
    text(c, fmtUSD(variance), cols[5].x, c.y, { size: 8.5, color: variance < 0 ? DANGER : SUCCESS });
    c.y -= 12;
  }
}

function drawCOs(c: Ctx, cos: ChangeOrderRow[]) {
  const cols = [
    { label: "CO #", x: M, w: 50 },
    { label: "Description", x: M + 54, w: 170 },
    { label: "Status", x: M + 228, w: 60 },
    { label: "Contract", x: M + 292, w: 70 },
    { label: "Cost", x: M + 366, w: 70 },
    { label: "Prob", x: M + 440, w: 40 },
  ];
  ensure(c, 16);
  cols.forEach((col) => text(c, col.label.toUpperCase(), col.x, c.y, { font: c.sansB, size: 7, color: MUTED }));
  c.y -= 8; rule(c, c.y); c.y -= 10;
  for (const co of cos) {
    ensure(c, 14);
    text(c, co.number || "—", cols[0].x, c.y, { size: 8, color: MUTED });
    text(c, splitToWidth(c.sansB, 8.5, co.description, cols[1].w)[0], cols[1].x, c.y, { font: c.sansB, size: 8.5 });
    text(c, co.status, cols[2].x, c.y, { size: 8, color: co.status === "Approved" ? SUCCESS : co.status === "Pending" ? ACCENT : DANGER });
    text(c, fmtUSD(co.contract_amount), cols[3].x, c.y, { size: 8.5 });
    text(c, fmtUSD(co.cost_amount), cols[4].x, c.y, { size: 8.5, color: MUTED });
    text(c, co.status === "Pending" ? `${co.probability}%` : "—", cols[5].x, c.y, { size: 8.5, color: MUTED });
    c.y -= 12;
  }
}

function drawFooter(c: Ctx, page: number, total: number, project: ProjectRow) {
  c.page.drawText(`${project.name}  ·  IOR Report  ·  Page ${page} of ${total}`, {
    x: M, y: 24, font: c.sans, size: 7, color: MUTED,
  });
}

// ---------------- Public API ----------------

export async function generateIorPdf(
  input: IorPdfInput,
  style: IorPdfStyle = "executive",
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansB = await doc.embedFont(StandardFonts.HelveticaBold);
  const c: Ctx = { doc, page: doc.addPage([PAGE_W, PAGE_H]), y: PAGE_H - M, serif, sans, sansB };
  const generatedAt = input.generatedAt ?? new Date();
  const weekLabel = `Week of ${generatedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  if (style === "executive") {
    drawHeader(c, input.project, weekLabel, generatedAt);
    drawKpiStrip(c, input.rollup, input.project);
    sectionTitle(c, "Financial outcome");
    drawWaterfall(c, input.rollup, input.project);
    sectionTitle(c, "Top exposures");
    drawExposuresTable(c, input.exposures.filter((e) => e.status === "active" || e.status === "escalated").sort((a, b) => b.dollar_exposure * b.probability - a.dollar_exposure * a.probability), { limit: 5 });
    sectionTitle(c, "Required decisions");
    drawDecisions(c, input.decisions);

    // Appendix
    newPage(c);
    sectionTitle(c, "Exposure register — by treatment path");
    drawExposuresTable(c, input.exposures.filter((e) => e.status !== "released"), { groupByPath: true });
    sectionTitle(c, "Cost buckets");
    drawBuckets(c, input.buckets);
    sectionTitle(c, "Change orders");
    drawCOs(c, input.changeOrders);
    if (input.narrative) {
      sectionTitle(c, "Review narrative");
      wrap(c, input.narrative, M, PAGE_W - 2 * M, { size: 10 });
    }
  } else {
    // Structured — cover
    c.y = PAGE_H - 200;
    text(c, "INDICATED OUTCOME REPORT", M, c.y, { font: c.sansB, size: 10, color: ACCENT });
    c.y -= 30;
    text(c, input.project.name, M, c.y, { font: c.serif, size: 36 });
    c.y -= 26;
    text(c, input.project.client || "—", M, c.y, { font: c.serif, size: 16, color: MUTED });
    c.y -= 50;
    text(c, weekLabel, M, c.y, { size: 10 });
    c.y -= 14;
    text(c, `Phase: ${input.project.phase}   ·   ${input.project.percent_complete}% complete`, M, c.y, { size: 10, color: MUTED });
    c.y -= 14;
    text(c, `Baseline: ${fmtDate(input.project.baseline_completion_date)}   ->   Forecast: ${fmtDate(input.project.forecast_completion_date)}`, M, c.y, { size: 10, color: MUTED });
    c.y -= 60;
    chip(c, input.rollup.gpAtRisk > 0 ? "MARGIN AT RISK" : "ON PLAN", M, c.y, input.rollup.gpAtRisk > 0 ? DANGER : SUCCESS);

    // Executive summary
    newPage(c);
    drawHeader(c, input.project, weekLabel, generatedAt);
    sectionTitle(c, "Executive summary");
    const narrative = input.narrative ||
      `This project began as a ${fmtPct(input.rollup.originalGPpct)} GP job. Based on current exposures and forecasted final cost, it is now indicating ${fmtPct(input.rollup.indicatedGPpct)}. The company has ${fmtUSD(input.rollup.gpAtRisk)} of original expected profit at risk.`;
    wrap(c, narrative, M, PAGE_W - 2 * M, { size: 11, lineHeight: 16 });
    c.y -= 8;
    drawKpiStrip(c, input.rollup, input.project);

    // Financial outcome page
    newPage(c);
    drawHeader(c, input.project, weekLabel, generatedAt);
    sectionTitle(c, "Financial outcome");
    drawWaterfall(c, input.rollup, input.project);
    sectionTitle(c, "Cost buckets");
    drawBuckets(c, input.buckets);

    // Exposure register
    newPage(c);
    drawHeader(c, input.project, weekLabel, generatedAt);
    sectionTitle(c, "Exposure register — grouped by treatment path");
    drawExposuresTable(c, input.exposures.filter((e) => e.status !== "released"), { groupByPath: true });

    // Decisions + COs + schedule
    newPage(c);
    drawHeader(c, input.project, weekLabel, generatedAt);
    sectionTitle(c, "Decisions required");
    drawDecisions(c, input.decisions);
    sectionTitle(c, "Change orders");
    drawCOs(c, input.changeOrders);

    // Review log
    newPage(c);
    drawHeader(c, input.project, weekLabel, generatedAt);
    sectionTitle(c, "Review log");
    for (const r of input.reviews.slice(0, 5)) {
      ensure(c, 30);
      text(c, new Date(r.reviewed_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }), M, c.y, { font: c.sansB, size: 9 });
      text(c, r.reviewer || "—", PAGE_W - M - 80, c.y, { size: 8, color: MUTED });
      c.y -= 11;
      if (r.summary_notes) wrap(c, r.summary_notes, M, PAGE_W - 2 * M, { size: 9, color: INK });
      c.y -= 6; rule(c, c.y); c.y -= 8;
    }
  }

  // Page footers
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`${input.project.name}  ·  IOR Report  ·  Page ${i + 1} of ${pages.length}`, {
      x: M, y: 24, font: sans, size: 7, color: MUTED,
    });
  });

  return await doc.save();
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
