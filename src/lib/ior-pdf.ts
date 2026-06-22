// Client-side IOR PDF generator using pdf-lib.
// Two layouts: "executive" (one-pager + appendix) and "structured" (multi-page report).
// All drawing helpers operate in points (72 = 1 inch). US Letter portrait.

import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";
import {
  remainingExposureValue,
  type Rollup,
  type ExposureCategory,
  type ResponsePath,
} from "@/lib/ior";
import type {
  ProjectRow,
  ExposureRow,
  ChangeOrderRow,
  BucketRow,
  DecisionRow,
  ReviewRow,
} from "@/lib/projects.functions";
import type {
  MilestoneRow,
  ScheduleRiskRow,
  MilestoneStatus,
  ScheduleRiskKind,
} from "@/lib/schedule.functions";

export type IorPdfStyle = "executive" | "structured";

export interface IorPdfInput {
  project: ProjectRow;
  rollup: Rollup;
  exposures: ExposureRow[];
  changeOrders: ChangeOrderRow[];
  buckets: BucketRow[];
  decisions: DecisionRow[];
  reviews: ReviewRow[];
  milestones?: MilestoneRow[];
  scheduleRisks?: ScheduleRiskRow[];
  narrative?: string;
  generatedAt?: Date;
}

const MILESTONE_STATUS_LABEL: Record<MilestoneStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  delayed: "Delayed",
  complete: "Complete",
};
const RISK_KIND_LABEL: Record<ScheduleRiskKind, string> = {
  critical_decision: "Critical delayed decisions",
  procurement: "Procurement risks",
  trade_performance: "Trade performance risks",
};

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
  eliminate: "Eliminate",
  recover: "Recover",
  offset: "Offset",
  accept: "Accept",
};
const CATEGORY_LABELS: Record<ExposureCategory, string> = {
  owner_decision: "Owner decision",
  design_drift: "Design drift",
  trade_performance: "Trade performance",
  procurement: "Procurement",
  schedule_compression: "Schedule compression",
  allowance_overrun: "Allowance overrun",
  field_change: "Field change",
  closeout_punch: "Closeout / punch",
  other: "Other",
};

const fmtUSD = (n: number) => {
  const abs = Math.abs(n);
  const s = abs.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  return n < 0 ? `(${s})` : s;
};
const fmtPct = (n: number, d = 1) => `${n.toFixed(d)}%`;
const fmtDate = (d?: string | null) =>
  d
    ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : "—";

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
function text(
  c: Ctx,
  s: string,
  x: number,
  y: number,
  opts: { font?: PDFFont; size?: number; color?: RGB } = {},
) {
  c.page.drawText(s, {
    x,
    y,
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
  c.page.drawRectangle({
    x,
    y: y - 2,
    width: w,
    height: 12,
    color: rgb(0.98, 0.98, 0.96),
    borderColor: color,
    borderWidth: 0.5,
  });
  text(c, label, x + 4, y, { font: c.sansB, size, color });
  return w;
}
function wrap(
  c: Ctx,
  s: string,
  x: number,
  maxWidth: number,
  opts: { font?: PDFFont; size?: number; lineHeight?: number; color?: RGB } = {},
) {
  const font = opts.font ?? c.sans;
  const size = opts.size ?? 10;
  const lh = opts.lineHeight ?? size * 1.35;
  const words = s.split(/\s+/);
  let line = "";
  const lines: string[] = [];
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = w;
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
    {
      label: "Indicated GP",
      value: fmtUSD(r.indicatedGP),
      sub: fmtPct(r.indicatedGPpct),
      color: ACCENT,
    },
    { label: "GP at Risk", value: fmtUSD(r.gpAtRisk), color: r.gpAtRisk > 0 ? DANGER : SUCCESS },
    { label: "E-Hold", value: fmtUSD(r.exposureHolds), sub: "Specific risks" },
    { label: "C-Hold", value: fmtUSD(r.contingencyHold), sub: "Uncertainty" },
    {
      label: "Schedule",
      value:
        project.schedule_variance_weeks > 0 ? `+${project.schedule_variance_weeks}w` : "On time",
      sub: "vs baseline",
      color: project.schedule_variance_weeks > 0 ? DANGER : SUCCESS,
    },
  ];
  const w = (PAGE_W - 2 * M) / cells.length;
  ensure(c, 70);
  const top = c.y;
  const boxH = 64;
  c.page.drawRectangle({
    x: M,
    y: top - boxH,
    width: PAGE_W - 2 * M,
    height: boxH,
    color: SURFACE,
    borderColor: HAIR,
    borderWidth: 0.5,
  });
  cells.forEach((cell, i) => {
    const cx = M + i * w + 8;
    if (i > 0) {
      c.page.drawLine({
        start: { x: M + i * w, y: top - 8 },
        end: { x: M + i * w, y: top - boxH + 8 },
        thickness: 0.4,
        color: HAIR,
      });
    }
    text(c, cell.label.toUpperCase(), cx, top - 14, { font: c.sansB, size: 6.5, color: MUTED });
    text(c, cell.value, cx, top - 34, { font: c.serif, size: 12, color: cell.color ?? INK });
    if (cell.sub) text(c, cell.sub, cx, top - 50, { size: 7, color: MUTED });
  });
  c.y -= boxH + 14;
}

// ---------------- Bar chart (each bar a single magnitude; color = sign) ----------------
function drawWaterfall(c: Ctx, r: Rollup, project: ProjectRow) {
  ensure(c, 150);
  // Add breathing room between the section title and the chart
  c.y -= 6;
  const top = c.y;
  const h = 90;
  const left = M;
  const right = PAGE_W - M;
  type Bar = { label: string; v: number; color: RGB; neg?: boolean };
  const bars: Bar[] = [
    { label: "Original Contract", v: project.original_contract, color: rgb(0.7, 0.72, 0.78) },
    { label: "Approved COs", v: r.approvedCOContract, color: rgb(0.45, 0.55, 0.7) },
    { label: "Pending (wtd)", v: r.weightedPendingCOContract, color: rgb(0.55, 0.6, 0.72) },
    { label: "Forecasted Final", v: r.forecastedFinalContract, color: ACCENT },
    { label: "Forecasted Cost", v: r.forecastedFinalCost, color: rgb(0.55, 0.4, 0.4), neg: true },
    { label: "Exposure Holds", v: r.exposureHolds, color: DANGER, neg: true },
    { label: "C-Hold", v: r.contingencyHold, color: rgb(0.6, 0.4, 0.4), neg: true },
    { label: "Indicated GP", v: r.indicatedGP, color: r.indicatedGP >= 0 ? SUCCESS : DANGER },
  ];
  const maxAbs = Math.max(...bars.map((b) => Math.abs(b.v)), 1);
  const slot = (right - left) / bars.length;
  const bw = slot - 8;
  // baseline
  c.page.drawLine({
    start: { x: left, y: top - h },
    end: { x: right, y: top - h },
    thickness: 0.5,
    color: HAIR,
  });
  bars.forEach((b, i) => {
    const x = left + i * slot + 4;
    const barH = (Math.abs(b.v) / maxAbs) * h;
    // All bars grow upward from shared baseline; negative magnitudes shown via muted/red color + label prefix.
    c.page.drawRectangle({ x, y: top - h, width: bw, height: barH, color: b.color });
  });
  // Two-line labels under the baseline to prevent overlap
  bars.forEach((b, i) => {
    const x = left + i * slot + 4;
    const lines = splitToWidth(c.sansB, 6.5, b.label, slot - 4);
    let ly = top - h - 10;
    for (const ln of lines.slice(0, 2)) {
      text(c, ln, x, ly, { font: c.sansB, size: 6.5, color: MUTED });
      ly -= 8;
    }
    const valStr = b.neg ? `(${fmtUSD(Math.abs(b.v))})` : fmtUSD(b.v);
    text(c, valStr, x, ly - 1, { font: c.sans, size: 7, color: INK });
  });
  c.y = top - h - 46;
}

// ---------------- Header / Cover ----------------
function drawHeader(c: Ctx, project: ProjectRow, label: string, date: Date) {
  ensure(c, 92);
  const top = c.y;
  text(c, "INDICATED OUTCOME REPORT", M, top, { font: c.sansB, size: 8, color: ACCENT });
  c.y = top - 18;
  text(c, project.name, M, c.y, { font: c.serif, size: 22 });
  c.y -= 18;
  text(
    c,
    `${project.client || "—"}  ·  ${label}  ·  ${date.toLocaleDateString("en-US", { dateStyle: "long" })}`,
    M,
    c.y,
    { size: 9, color: MUTED },
  );
  c.y -= 12;
  text(c, `Project Manager: ${project.project_manager || "—"}`, M, c.y, {
    font: c.sansB,
    size: 9,
    color: INK,
  });
  c.y -= 12;
  text(
    c,
    `${project.phase} phase  -  ${project.percent_complete}% complete  -  Baseline ${fmtDate(project.baseline_completion_date)}  ->  Forecast ${fmtDate(project.forecast_completion_date)}`,
    M,
    c.y,
    { size: 9, color: MUTED },
  );
  c.y -= 14;
  rule(c, c.y);
  c.y -= 16;
}

// ---------------- Exposure tables ----------------
interface ExpRow {
  e: ExposureRow;
}
function drawExposuresTable(
  c: Ctx,
  exposures: ExposureRow[],
  opts: { title?: string; limit?: number; groupByPath?: boolean } = {},
) {
  const list = opts.limit ? exposures.slice(0, opts.limit) : exposures;
  if (opts.title) sectionTitle(c, opts.title);
  const cols = [
    { label: "Exposure", x: M, w: 180 },
    { label: "Category", x: M + 184, w: 90 },
    { label: "Treatment", x: M + 278, w: 60 },
    { label: "$ Exposure", x: M + 342, w: 60 },
    { label: "Prob", x: M + 408, w: 30 },
    { label: "Remaining", x: M + 442, w: 70 },
  ];
  ensure(c, 16);
  cols.forEach((col) =>
    text(c, col.label.toUpperCase(), col.x, c.y, { font: c.sansB, size: 7, color: MUTED }),
  );
  c.y -= 8;
  rule(c, c.y);
  c.y -= 10;

  const groups: { key: string; items: ExposureRow[] }[] = opts.groupByPath
    ? (["eliminate", "recover", "offset", "accept"] as ResponsePath[])
        .map((p) => ({
          key: RESPONSE_LABELS[p],
          items: list.filter((x) => x.response_path === p),
        }))
        .filter((g) => g.items.length > 0)
    : [{ key: "", items: list }];

  for (const g of groups) {
    if (g.key) {
      ensure(c, 14);
      const groupTotal = g.items.reduce((s, e) => s + remainingExposureValue(e), 0);
      text(
        c,
        `${g.key.toUpperCase()}  ·  ${g.items.length} item${g.items.length === 1 ? "" : "s"}  ·  ${fmtUSD(groupTotal)} remaining`,
        M,
        c.y,
        { font: c.sansB, size: 7, color: ACCENT },
      );
      c.y -= 10;
    }
    for (const e of g.items) {
      ensure(c, 24);
      const titleLines = splitToWidth(c.sansB, 8.5, e.title, cols[0].w);
      text(c, titleLines[0], cols[0].x, c.y, { font: c.sansB, size: 8.5 });
      text(c, CATEGORY_LABELS[e.category], cols[1].x, c.y, { size: 8, color: MUTED });
      text(c, RESPONSE_LABELS[e.response_path], cols[2].x, c.y, {
        font: c.sansB,
        size: 8,
        color: ACCENT,
      });
      text(c, fmtUSD(e.dollar_exposure), cols[3].x, c.y, { size: 8.5 });
      text(c, `${e.probability}%`, cols[4].x, c.y, { size: 8.5, color: MUTED });
      text(c, fmtUSD(remainingExposureValue(e)), cols[5].x, c.y, {
        font: c.sansB,
        size: 8.5,
      });
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
    if (font.widthOfTextAtSize(t, size) > maxWidth && line) {
      out.push(line);
      line = w;
    } else line = t;
  }
  if (line) out.push(line);
  return out;
}

function drawDecisions(c: Ctx, decisions: DecisionRow[]) {
  const open = decisions.filter((d) => d.status !== "resolved");
  if (open.length === 0) {
    text(c, "All required decisions have been resolved.", M, c.y, { size: 9, color: MUTED });
    c.y -= 14;
    return;
  }
  for (const d of open) {
    ensure(c, 30);
    chip(
      c,
      d.status.replace("_", " ").toUpperCase(),
      M,
      c.y + 1,
      d.status === "overdue" ? DANGER : d.status === "in_progress" ? ACCENT : MUTED,
    );
    text(c, d.decision, M + 70, c.y, { font: c.sansB, size: 9.5 });
    c.y -= 11;
    text(c, `Owner: ${d.owner || "—"}    Due: ${fmtDate(d.due_date)}`, M, c.y, {
      size: 8,
      color: MUTED,
    });
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
    { label: "Bucket", x: M, w: 175 },
    { label: "Original", x: M + 185, w: 64 },
    { label: "Actual", x: M + 253, w: 64 },
    { label: "FTC", x: M + 321, w: 64 },
    { label: "Forecast", x: M + 389, w: 64 },
    { label: "Variance", x: M + 457, w: 64 },
  ];
  ensure(c, 16);
  cols.forEach((col) =>
    text(c, col.label.toUpperCase(), col.x, c.y, { font: c.sansB, size: 7, color: MUTED }),
  );
  c.y -= 8;
  rule(c, c.y);
  c.y -= 10;
  for (const b of buckets) {
    const nameLines = splitToWidth(c.sansB, 8.5, b.bucket, cols[0].w).slice(0, 2);
    const rowH = Math.max(14, 4 + nameLines.length * 11);
    ensure(c, rowH);
    const fac = b.actual_to_date + b.ftc;
    const variance = b.original_budget - fac;
    let ny = c.y;
    for (const ln of nameLines) {
      text(c, ln, cols[0].x, ny, { font: c.sansB, size: 8.5 });
      ny -= 11;
    }
    text(c, fmtUSD(b.original_budget), cols[1].x, c.y, { size: 8.5, color: MUTED });
    text(c, fmtUSD(b.actual_to_date), cols[2].x, c.y, { size: 8.5 });
    text(c, fmtUSD(b.ftc), cols[3].x, c.y, { size: 8.5 });
    text(c, fmtUSD(fac), cols[4].x, c.y, { font: c.sansB, size: 8.5 });
    text(c, fmtUSD(variance), cols[5].x, c.y, {
      size: 8.5,
      color: variance < 0 ? DANGER : SUCCESS,
    });
    c.y -= rowH;
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
  cols.forEach((col) =>
    text(c, col.label.toUpperCase(), col.x, c.y, { font: c.sansB, size: 7, color: MUTED }),
  );
  c.y -= 8;
  rule(c, c.y);
  c.y -= 10;
  for (const co of cos) {
    ensure(c, 14);
    text(c, co.number || "—", cols[0].x, c.y, { size: 8, color: MUTED });
    text(c, splitToWidth(c.sansB, 8.5, co.description, cols[1].w)[0], cols[1].x, c.y, {
      font: c.sansB,
      size: 8.5,
    });
    text(c, co.status, cols[2].x, c.y, {
      size: 8,
      color: co.status === "Approved" ? SUCCESS : co.status === "Pending" ? ACCENT : DANGER,
    });
    text(c, fmtUSD(co.contract_amount), cols[3].x, c.y, { size: 8.5 });
    text(c, fmtUSD(co.cost_amount), cols[4].x, c.y, { size: 8.5, color: MUTED });
    text(c, co.status === "Pending" ? `${co.probability}%` : "—", cols[5].x, c.y, {
      size: 8.5,
      color: MUTED,
    });
    c.y -= 12;
  }
}

function drawFooter(c: Ctx, page: number, total: number, project: ProjectRow) {
  c.page.drawText(`${project.name}  ·  IOR Report  ·  Page ${page} of ${total}`, {
    x: M,
    y: 24,
    font: c.sans,
    size: 7,
    color: MUTED,
  });
}

// ---------------- Public API ----------------

function drawSchedule(
  c: Ctx,
  milestones: MilestoneRow[],
  risks: ScheduleRiskRow[],
  project: ProjectRow,
) {
  // Completion summary line
  ensure(c, 16);
  text(
    c,
    `Baseline ${fmtDate(project.baseline_completion_date)}   ->   Forecast ${fmtDate(project.forecast_completion_date)}   ·   Variance ${project.schedule_variance_weeks > 0 ? "+" : ""}${project.schedule_variance_weeks} wk`,
    M,
    c.y,
    { font: c.sansB, size: 9, color: project.schedule_variance_weeks > 0 ? DANGER : SUCCESS },
  );
  c.y -= 14;

  // Interim milestones table
  if (milestones.length > 0) {
    ensure(c, 16);
    text(c, "INTERIM MILESTONES", M, c.y, { font: c.sansB, size: 7.5, color: MUTED });
    c.y -= 8;
    rule(c, c.y);
    c.y -= 10;
    const cols = [
      { label: "Milestone", x: M, w: 160 },
      { label: "Baseline", x: M + 164, w: 70 },
      { label: "Forecast", x: M + 238, w: 70 },
      { label: "Status", x: M + 312, w: 70 },
      { label: "Owner", x: M + 386, w: 120 },
    ];
    cols.forEach((col) =>
      text(c, col.label.toUpperCase(), col.x, c.y, { font: c.sansB, size: 7, color: MUTED }),
    );
    c.y -= 10;
    for (const m of milestones) {
      ensure(c, 14);
      const statusColor =
        m.status === "delayed"
          ? DANGER
          : m.status === "at_risk"
            ? ACCENT
            : m.status === "complete"
              ? MUTED
              : SUCCESS;
      text(c, splitToWidth(c.sansB, 8.5, m.name, cols[0].w)[0], cols[0].x, c.y, {
        font: c.sansB,
        size: 8.5,
      });
      text(c, fmtDate(m.baseline_date), cols[1].x, c.y, { size: 8.5, color: MUTED });
      text(c, fmtDate(m.forecast_date), cols[2].x, c.y, { size: 8.5 });
      text(c, MILESTONE_STATUS_LABEL[m.status], cols[3].x, c.y, {
        font: c.sansB,
        size: 8,
        color: statusColor,
      });
      text(c, splitToWidth(c.sans, 8.5, m.owner || "—", cols[4].w)[0], cols[4].x, c.y, {
        size: 8.5,
        color: MUTED,
      });
      c.y -= 11;
      if ((m.status === "at_risk" || m.status === "delayed") && m.delay_reason) {
        const lines = splitToWidth(c.sans, 8, `Reason: ${m.delay_reason}`, PAGE_W - 2 * M);
        for (const ln of lines.slice(0, 3)) {
          ensure(c, 10);
          text(c, ln, M, c.y, { size: 8, color: INK });
          c.y -= 9;
        }
      }
      c.y -= 3;
    }
    c.y -= 4;
  }

  // Risk groups
  const kinds: ScheduleRiskKind[] = ["critical_decision", "procurement", "trade_performance"];
  for (const kind of kinds) {
    const items = risks.filter((r) => r.kind === kind);
    if (items.length === 0) continue;
    ensure(c, 18);
    text(c, RISK_KIND_LABEL[kind].toUpperCase(), M, c.y, {
      font: c.sansB,
      size: 7.5,
      color: ACCENT,
    });
    c.y -= 8;
    rule(c, c.y);
    c.y -= 10;
    for (const r of items) {
      ensure(c, 16);
      text(c, r.title, M, c.y, { font: c.sansB, size: 9 });
      c.y -= 11;
      if (r.detail) {
        wrap(c, r.detail, M, PAGE_W - 2 * M, { size: 8.5, color: INK, lineHeight: 11 });
      }
      c.y -= 4;
    }
    c.y -= 2;
  }
}

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
    drawExposuresTable(
      c,
      input.exposures
        .filter((e) => remainingExposureValue(e) > 0)
        .sort((a, b) => remainingExposureValue(b) - remainingExposureValue(a)),
      { limit: 5 },
    );
    sectionTitle(c, "Required decisions");
    drawDecisions(c, input.decisions);

    // Appendix
    newPage(c);
    sectionTitle(c, "Schedule — milestones & risk");
    drawSchedule(c, input.milestones ?? [], input.scheduleRisks ?? [], input.project);
    sectionTitle(c, "Exposure register — by treatment path");
    drawExposuresTable(
      c,
      input.exposures.filter((e) => remainingExposureValue(e) > 0),
      { groupByPath: true },
    );
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
    text(
      c,
      `Phase: ${input.project.phase}   ·   ${input.project.percent_complete}% complete`,
      M,
      c.y,
      { size: 10, color: MUTED },
    );
    c.y -= 14;
    text(
      c,
      `Baseline: ${fmtDate(input.project.baseline_completion_date)}   ->   Forecast: ${fmtDate(input.project.forecast_completion_date)}`,
      M,
      c.y,
      { size: 10, color: MUTED },
    );
    c.y -= 60;
    chip(
      c,
      input.rollup.gpAtRisk > 0 ? "MARGIN AT RISK" : "ON PLAN",
      M,
      c.y,
      input.rollup.gpAtRisk > 0 ? DANGER : SUCCESS,
    );

    // Executive summary
    newPage(c);
    drawHeader(c, input.project, weekLabel, generatedAt);
    sectionTitle(c, "Executive summary");
    const narrative =
      input.narrative ||
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
    drawExposuresTable(
      c,
      input.exposures.filter((e) => remainingExposureValue(e) > 0),
      { groupByPath: true },
    );

    // Decisions + COs + schedule
    newPage(c);
    drawHeader(c, input.project, weekLabel, generatedAt);
    sectionTitle(c, "Schedule — milestones & risk");
    drawSchedule(c, input.milestones ?? [], input.scheduleRisks ?? [], input.project);
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
      text(
        c,
        new Date(r.reviewed_at).toLocaleString("en-US", {
          dateStyle: "medium",
          timeStyle: "short",
        }),
        M,
        c.y,
        { font: c.sansB, size: 9 },
      );
      text(c, r.reviewer || "—", PAGE_W - M - 80, c.y, { size: 8, color: MUTED });
      c.y -= 11;
      if (r.summary_notes) wrap(c, r.summary_notes, M, PAGE_W - 2 * M, { size: 9, color: INK });
      c.y -= 6;
      rule(c, c.y);
      c.y -= 8;
    }
  }

  // Page footers
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(`${input.project.name}  ·  IOR Report  ·  Page ${i + 1} of ${pages.length}`, {
      x: M,
      y: 24,
      font: sans,
      size: 7,
      color: MUTED,
    });
  });

  return await doc.save();
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string) {
  const blob = new Blob([new Uint8Array(bytes)], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
