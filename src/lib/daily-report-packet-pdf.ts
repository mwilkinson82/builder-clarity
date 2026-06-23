import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb, type RGB } from "pdf-lib";

export interface DailyReportPacketProject {
  name: string;
  client?: string | null;
  job_number?: string | null;
  project_manager?: string | null;
}

export interface DailyReportPacketAttachment {
  name?: string | null;
  path?: string | null;
  type?: string | null;
  size?: number | null;
  uploaded_at?: string | null;
  client_visible?: boolean | null;
}

export interface DailyReportPacketReport {
  id?: string;
  report_date: string;
  author?: string | null;
  weather?: string | null;
  crew_count?: number | null;
  manpower?: string | null;
  work_performed?: string | null;
  delays?: string | null;
  safety_notes?: string | null;
  visitors?: string | null;
  quality_notes?: string | null;
  notes?: string | null;
  client_visible?: boolean | null;
  attachments?: DailyReportPacketAttachment[];
  attachment_manifest?: DailyReportPacketAttachment[];
}

export interface DailyReportPacketInput {
  project: DailyReportPacketProject;
  reports: DailyReportPacketReport[];
  generatedAt?: Date;
  title?: string;
}

const PAGE_W = 612;
const PAGE_H = 792;
const M = 46;
const INK: RGB = rgb(0.08, 0.07, 0.06);
const MUTED: RGB = rgb(0.43, 0.42, 0.39);
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
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .trim();

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

const fmtBytes = (value?: number | null) => {
  const bytes = Number(value ?? 0);
  if (!bytes) return "";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
};

function addPage(ctx: PdfCtx) {
  ctx.page = ctx.doc.addPage([PAGE_W, PAGE_H]);
  ctx.y = PAGE_H - M;
}

function ensure(ctx: PdfCtx, needed: number) {
  if (ctx.y - needed < M) addPage(ctx);
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
    if (paragraphs.length > 1) lines.push("");
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
    if (line) drawText(ctx, line, x, ctx.y, { font, size, color: opts.color });
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
  drawText(ctx, value, x + 10, y + 15, { font: ctx.serif, size: 19, color });
}

function drawSectionTitle(ctx: PdfCtx, label: string) {
  ensure(ctx, 32);
  ctx.y -= 6;
  drawText(ctx, label.toUpperCase(), M, ctx.y, {
    font: ctx.sansBold,
    size: 8,
    color: MUTED,
  });
  ctx.y -= 9;
  drawRule(ctx, ctx.y);
  ctx.y -= 16;
}

function reportAttachments(report: DailyReportPacketReport) {
  return report.attachments ?? report.attachment_manifest ?? [];
}

function dateRange(reports: DailyReportPacketReport[]) {
  if (!reports.length) return "-";
  const sorted = [...reports].sort((a, b) => a.report_date.localeCompare(b.report_date));
  const first = sorted[0]?.report_date;
  const last = sorted[sorted.length - 1]?.report_date;
  return first === last ? fmtDate(first) : `${fmtDate(first)} - ${fmtDate(last)}`;
}

function drawReport(ctx: PdfCtx, report: DailyReportPacketReport, index: number) {
  ensure(ctx, 120);
  ctx.page.drawRectangle({
    x: M,
    y: ctx.y - 42,
    width: PAGE_W - M * 2,
    height: 42,
    color: rgb(0.995, 0.99, 0.975),
    borderColor: HAIR,
    borderWidth: 0.5,
  });
  drawText(ctx, `Report ${index + 1}`, M + 12, ctx.y - 16, {
    font: ctx.sansBold,
    size: 8,
    color: MUTED,
  });
  drawText(ctx, fmtDate(report.report_date), M + 12, ctx.y - 32, {
    font: ctx.serif,
    size: 18,
    color: INK,
  });
  drawText(
    ctx,
    report.client_visible ? "Client visible" : "Internal",
    PAGE_W - M - 96,
    ctx.y - 25,
    {
      font: ctx.sansBold,
      size: 8,
      color: report.client_visible ? SUCCESS : MUTED,
    },
  );
  ctx.y -= 60;

  const metricW = (PAGE_W - M * 2 - 20) / 3;
  drawMetric(ctx, "Author", report.author || "-", M, ctx.y - 58, metricW);
  drawMetric(ctx, "Weather", report.weather || "-", M + metricW + 10, ctx.y - 58, metricW);
  drawMetric(ctx, "Crew", `${report.crew_count ?? 0}`, M + metricW * 2 + 20, ctx.y - 58, metricW);
  ctx.y -= 82;

  const reportSections: Array<[string, string | null | undefined]> = [
    ["Work performed", report.work_performed],
    ["Manpower", report.manpower],
    ["Delays / blockers", report.delays],
    ["Safety notes", report.safety_notes],
    ["Visitors / inspections", report.visitors],
    ["Quality notes", report.quality_notes],
    ["Notes", report.notes],
  ];
  const sections = reportSections.filter(([, value]) => cleanPdfText(value).length > 0);

  if (!sections.length) {
    drawWrapped(ctx, "No field notes were recorded for this report.", M, PAGE_W - M * 2, {
      size: 10,
      color: MUTED,
    });
  } else {
    for (const [label, value] of sections) {
      ensure(ctx, 38);
      drawText(ctx, label.toUpperCase(), M, ctx.y, {
        font: ctx.sansBold,
        size: 7,
        color: MUTED,
      });
      ctx.y -= 13;
      drawWrapped(ctx, value || "-", M, PAGE_W - M * 2, { size: 10, lineHeight: 14 });
      ctx.y -= 7;
    }
  }

  const attachments = reportAttachments(report);
  ensure(ctx, 34);
  drawText(ctx, "ATTACHMENT INDEX", M, ctx.y, {
    font: ctx.sansBold,
    size: 7,
    color: MUTED,
  });
  ctx.y -= 14;
  if (!attachments.length) {
    drawText(ctx, "No attachments on this report.", M, ctx.y, { size: 9, color: MUTED });
    ctx.y -= 18;
  } else {
    for (const attachment of attachments) {
      const size = fmtBytes(attachment.size);
      const type = cleanPdfText(attachment.type);
      const meta = [type, size].filter(Boolean).join(" - ");
      drawWrapped(
        ctx,
        `- ${attachment.name || "Attachment"}${meta ? ` (${meta})` : ""}`,
        M,
        PAGE_W - M * 2,
        { size: 9, color: MUTED, lineHeight: 12 },
      );
    }
  }
  ctx.y -= 14;
}

export async function generateDailyReportPacketPdf({
  project,
  reports,
  generatedAt = new Date(),
  title = "Daily Report Packet",
}: DailyReportPacketInput) {
  const doc = await PDFDocument.create();
  const serif = await doc.embedFont(StandardFonts.TimesRoman);
  const sans = await doc.embedFont(StandardFonts.Helvetica);
  const sansBold = await doc.embedFont(StandardFonts.HelveticaBold);
  const firstPage = doc.addPage([PAGE_W, PAGE_H]);
  const ctx: PdfCtx = { doc, page: firstPage, y: PAGE_H - M, serif, sans, sansBold };

  drawText(ctx, "OVERWATCH FIELD RECORD", M, ctx.y, {
    font: sansBold,
    size: 8,
    color: MUTED,
  });
  ctx.y -= 32;
  drawWrapped(ctx, title, M, PAGE_W - M * 2, { font: serif, size: 34, lineHeight: 38 });
  drawWrapped(ctx, project.name || "Project", M, PAGE_W - M * 2, {
    font: serif,
    size: 22,
    color: ACCENT,
    lineHeight: 26,
  });
  ctx.y -= 8;
  drawWrapped(ctx, `Generated ${fmtDateTime(generatedAt)}`, M, PAGE_W - M * 2, {
    size: 9,
    color: MUTED,
  });
  ctx.y -= 18;

  const metricW = (PAGE_W - M * 2 - 30) / 4;
  drawMetric(ctx, "Client", project.client || "-", M, ctx.y - 58, metricW);
  drawMetric(ctx, "Job #", project.job_number || "-", M + metricW + 10, ctx.y - 58, metricW);
  drawMetric(
    ctx,
    "Project manager",
    project.project_manager || "-",
    M + metricW * 2 + 20,
    ctx.y - 58,
    metricW,
  );
  drawMetric(
    ctx,
    "Reports",
    `${reports.length}`,
    M + metricW * 3 + 30,
    ctx.y - 58,
    metricW,
    ACCENT,
  );
  ctx.y -= 88;

  drawMetric(ctx, "Date range", dateRange(reports), M, ctx.y - 58, PAGE_W - M * 2, ACCENT);
  ctx.y -= 88;

  drawSectionTitle(ctx, "Daily reports");
  if (!reports.length) {
    drawWrapped(ctx, "No daily reports were available for this packet.", M, PAGE_W - M * 2, {
      color: MUTED,
    });
  } else {
    const sortedReports = [...reports].sort((a, b) => b.report_date.localeCompare(a.report_date));
    sortedReports.forEach((report, index) => drawReport(ctx, report, index));
  }

  const pageCount = doc.getPageCount();
  doc.getPages().forEach((page, index) => {
    page.drawText(`Overwatch Daily Report Packet | Page ${index + 1} of ${pageCount}`, {
      x: M,
      y: 24,
      font: sans,
      size: 8,
      color: MUTED,
    });
  });

  return doc.save();
}

export function downloadPdfBytes(pdfBytes: Uint8Array, filename: string) {
  const blob = new Blob([pdfBytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
