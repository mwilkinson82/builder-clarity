// LETTER OF TRANSMITTAL PDF (docs/compliance arc, module 3). The cover sheet a
// GC sends to the architect/engineer with a batch of submittals (or RFIs). It
// carries the company's letterhead — logo, name, address, phone, license — so it
// looks like the contractor's own stationery, then lists the transmitted items.
// Built with pdf-lib (same engine + branding as the AIA package) so it prints
// clean and downloads as a real PDF.
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import { embedPdfLogo } from "./pdf-branding.ts";
import { downloadFileBytes } from "./download-file.ts";
import type {
  ProjectLetterhead,
  SubmittalLogEntryRow,
  SubmittalLogKind,
} from "./submittal-log.functions";

const PAGE_W = 612;
const PAGE_H = 792;
const M = 48;
const INK = rgb(0.11, 0.11, 0.12);
const MUTE = rgb(0.42, 0.42, 0.45);
const LINE = rgb(0.82, 0.82, 0.84);
const BAND = rgb(0.95, 0.95, 0.96);

const clean = (v: string) =>
  Array.from(v.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-"))
    .filter((c) => {
      const n = c.charCodeAt(0);
      return n === 10 || (n >= 32 && n <= 126);
    })
    .join("");

const fit = (font: PDFFont, v: string, size: number, maxW: number) => {
  let s = clean(v);
  if (font.widthOfTextAtSize(s, size) <= maxW) return s;
  while (s.length > 1 && font.widthOfTextAtSize(`${s}...`, size) > maxW) s = s.slice(0, -1);
  return `${s}...`;
};

// One transmitted item's attached document, already fetched to bytes by the
// caller (this module stays free of supabase/fetch). Inlined into the package
// after the cover letter.
export interface TransmittalAttachment {
  label: string; // e.g. "004 · Concrete Mix Design" — captions image pages
  fileName: string;
  bytes: Uint8Array;
  contentType: string;
}

export interface TransmittalInput {
  letterhead: ProjectLetterhead;
  projectName: string;
  jobNumber: string;
  kind: SubmittalLogKind;
  entries: SubmittalLogEntryRow[];
  to: string;
  attn: string;
  re: string;
  transmittalNumber: string;
  senderName: string;
  generatedAt?: Date;
  // The attached documents for the transmitted items — appended after the
  // cover so the package the A/E receives IS the letter + the actual submittals
  // (field request 2026-07-09). Optional so existing callers are unchanged.
  attachments?: TransmittalAttachment[];
}

type AttachmentKind = "pdf" | "png" | "jpg" | "other";

// Prefer magic bytes — Supabase can serve a stored file as octet-stream, so the
// content-type header and even the extension can lie. Fall back to those only
// when the signature is inconclusive.
function detectAttachmentKind(
  bytes: Uint8Array,
  fileName: string,
  contentType: string,
): AttachmentKind {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x25 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x44 &&
    bytes[3] === 0x46
  )
    return "pdf"; // %PDF
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return "png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return "jpg";
  const ct = contentType.toLowerCase();
  const name = fileName.toLowerCase();
  if (ct.includes("pdf") || name.endsWith(".pdf")) return "pdf";
  if (ct.includes("png") || name.endsWith(".png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg") || name.endsWith(".jpg") || name.endsWith(".jpeg"))
    return "jpg";
  return "other";
}

// Append one attachment to the package. PDFs are copied page-for-page; images
// get one captioned, fit-to-page sheet. Returns false for a format we can't
// inline (the caller reports it so it's downloaded/attached separately).
async function appendAttachment(
  doc: PDFDocument,
  att: TransmittalAttachment,
  font: PDFFont,
): Promise<boolean> {
  const kind = detectAttachmentKind(att.bytes, att.fileName, att.contentType);
  if (kind === "pdf") {
    const src = await PDFDocument.load(att.bytes, { ignoreEncryption: true });
    const pages = await doc.copyPages(src, src.getPageIndices());
    for (const p of pages) doc.addPage(p);
    return true;
  }
  if (kind === "png" || kind === "jpg") {
    const img = kind === "png" ? await doc.embedPng(att.bytes) : await doc.embedJpg(att.bytes);
    const page = doc.addPage([PAGE_W, PAGE_H]);
    const caption = clean(att.label || att.fileName);
    if (caption)
      page.drawText(fit(font, caption, 9, PAGE_W - 2 * M), {
        x: M,
        y: PAGE_H - M + 4,
        font,
        size: 9,
        color: MUTE,
      });
    const maxW = PAGE_W - 2 * M;
    const maxH = PAGE_H - 2 * M - 12;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const w = img.width * scale;
    const h = img.height * scale;
    page.drawImage(img, { x: (PAGE_W - w) / 2, y: (PAGE_H - h) / 2 - 6, width: w, height: h });
    return true;
  }
  return false;
}

export async function generateTransmittalPdf(
  input: TransmittalInput,
): Promise<{ skipped: string[] }> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([PAGE_W, PAGE_H]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const logo = await embedPdfLogo(doc, input.letterhead.logo_url);

  const now = input.generatedAt ?? new Date();
  const dateStr = `${String(now.getMonth() + 1).padStart(2, "0")}/${String(now.getDate()).padStart(2, "0")}/${now.getFullYear()}`;
  const lh = input.letterhead;
  const label = input.kind === "rfi" ? "REQUEST FOR INFORMATION" : "SUBMITTAL";

  let y = PAGE_H - M;

  // ── Letterhead ──────────────────────────────────────────────────────────
  const companyName = lh.company_name || lh.legal_name || "Contractor";
  if (logo) {
    const scale = Math.min(56 / logo.height, 150 / logo.width, 1);
    page.drawImage(logo, {
      x: M,
      y: y - logo.height * scale,
      width: logo.width * scale,
      height: logo.height * scale,
    });
  }
  // Company block, right-aligned.
  const cityLine =
    [lh.city, lh.state].filter(Boolean).join(", ") + (lh.postal_code ? ` ${lh.postal_code}` : "");
  const rightLines = [
    { t: companyName, f: bold, s: 13, c: INK },
    { t: lh.address_line1, f: font, s: 9, c: MUTE },
    {
      t: [lh.address_line2, cityLine].filter(Boolean).join(lh.address_line2 ? " · " : ""),
      f: font,
      s: 9,
      c: MUTE,
    },
    {
      t: [lh.office_phone, lh.license_number ? `Lic. ${lh.license_number}` : ""]
        .filter(Boolean)
        .join("   "),
      f: font,
      s: 9,
      c: MUTE,
    },
  ].filter((l) => l.t);
  let ry = y;
  for (const l of rightLines) {
    const w = l.f.widthOfTextAtSize(clean(l.t), l.s);
    page.drawText(clean(l.t), { x: PAGE_W - M - w, y: ry - l.s, font: l.f, size: l.s, color: l.c });
    ry -= l.s + 3;
  }
  y = Math.min(y - 56, ry) - 14;
  page.drawLine({ start: { x: M, y }, end: { x: PAGE_W - M, y }, thickness: 1.4, color: INK });
  y -= 26;

  // ── Title ───────────────────────────────────────────────────────────────
  const title = "LETTER OF TRANSMITTAL";
  page.drawText(title, { x: M, y: y - 16, font: bold, size: 17, color: INK });
  const sub = "For Approval";
  page.drawText(sub, {
    x: PAGE_W - M - font.widthOfTextAtSize(sub, 10),
    y: y - 12,
    font,
    size: 10,
    color: MUTE,
  });
  y -= 34;

  // ── Meta grid (two columns) ─────────────────────────────────────────────
  const colX = M;
  const col2X = PAGE_W / 2 + 12;
  const meta: Array<[string, string, boolean]> = [
    ["Date", dateStr, false],
    ["Transmittal No.", input.transmittalNumber || "—", true],
    ["To", input.to || "—", false],
    ["Project", input.projectName || "—", true],
    ["Attn", input.attn || "—", false],
    ["Job No.", input.jobNumber || "—", true],
    ["Re", input.re || label.toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase()), false],
    ["Type", label === "SUBMITTAL" ? "Submittal transmittal" : "RFI transmittal", true],
  ];
  const rowH = 15;
  for (let i = 0; i < meta.length; i += 2) {
    const rowY = y - (i / 2) * rowH;
    for (const [j, x] of [
      [i, colX],
      [i + 1, col2X],
    ] as const) {
      const cell = meta[j];
      if (!cell) continue;
      page.drawText(`${cell[0]}:`, { x, y: rowY - 10, font: bold, size: 9, color: MUTE });
      page.drawText(fit(font, cell[1], 9.5, PAGE_W / 2 - 90), {
        x: x + 74,
        y: rowY - 10,
        font,
        size: 9.5,
        color: INK,
      });
    }
  }
  y -= (meta.length / 2) * rowH + 16;

  // ── Items table ─────────────────────────────────────────────────────────
  page.drawText(`We are transmitting the following for your review:`, {
    x: M,
    y: y - 10,
    font,
    size: 9.5,
    color: MUTE,
  });
  y -= 24;

  const cols = [
    { key: "num", head: "No.", w: 48 },
    { key: "spec", head: "Spec", w: 62 },
    { key: "rev", head: "Sub/Rev", w: 52 },
    { key: "desc", head: "Description", w: 210 },
    { key: "action", head: "Action", w: 44 },
    { key: "copies", head: "Copies", w: 40 },
  ];
  const tableX = M;
  const tableW = cols.reduce((s, c) => s + c.w, 0);
  const drawRow = (cells: string[], rowY: number, headRow: boolean, p: PDFPage) => {
    if (headRow)
      p.drawRectangle({ x: tableX, y: rowY - 16, width: tableW, height: 18, color: INK });
    let cx = tableX;
    cols.forEach((c, i) => {
      p.drawText(fit(headRow ? bold : font, cells[i] ?? "", 8.5, c.w - 8), {
        x: cx + 4,
        y: rowY - 12,
        font: headRow ? bold : font,
        size: 8.5,
        color: headRow ? rgb(1, 1, 1) : INK,
      });
      cx += c.w;
    });
    p.drawLine({
      start: { x: tableX, y: rowY - 18 },
      end: { x: tableX + tableW, y: rowY - 18 },
      thickness: 0.5,
      color: LINE,
    });
  };

  drawRow(
    cols.map((c) => c.head),
    y,
    true,
    page,
  );
  y -= 20;
  const actionOf = (e: SubmittalLogEntryRow) =>
    e.status === "a" ? "A" : e.status === "aan" ? "AAN" : e.status === "rar" ? "RAR" : "U/R";
  input.entries.forEach((e, i) => {
    if (i % 2 === 1)
      page.drawRectangle({ x: tableX, y: y - 16, width: tableW, height: 18, color: BAND });
    drawRow(
      [e.number, e.spec_section, e.sub_rev, e.description || e.item, actionOf(e), "1"],
      y,
      false,
      page,
    );
    y -= 18;
  });
  if (input.entries.length === 0) {
    page.drawText("(no items selected)", { x: tableX + 4, y: y - 12, font, size: 9, color: MUTE });
    y -= 18;
  }

  // ── Legend + signature ──────────────────────────────────────────────────
  y -= 18;
  page.drawText(
    "Action legend:  A = Approved   AAN = Approved as noted   RAR = Revise & resubmit   U/R = Under review",
    { x: M, y, font, size: 7.5, color: MUTE },
  );
  y -= 40;
  page.drawText("Transmitted by:", { x: M, y, font, size: 9, color: MUTE });
  page.drawLine({
    start: { x: M + 84, y: y - 2 },
    end: { x: M + 300, y: y - 2 },
    thickness: 0.8,
    color: LINE,
  });
  if (input.senderName)
    page.drawText(clean(input.senderName), { x: M + 90, y: y + 2, font, size: 10, color: INK });
  page.drawText(companyName, { x: M + 90, y: y - 14, font, size: 8.5, color: MUTE });

  // Footer.
  page.drawLine({
    start: { x: M, y: M + 6 },
    end: { x: PAGE_W - M, y: M + 6 },
    thickness: 0.5,
    color: LINE,
  });
  const foot = `${companyName} · Generated ${dateStr}`;
  page.drawText(clean(foot), { x: M, y: M - 6, font, size: 7, color: MUTE });

  // ── Attached documents ───────────────────────────────────────────────────
  // Append each transmitted item's file so the download is the cover letter
  // followed by the actual submittals. One bad file never sinks the package —
  // it's collected in `skipped` for the caller to flag.
  const skipped: string[] = [];
  for (const att of input.attachments ?? []) {
    try {
      const ok = await appendAttachment(doc, att, font);
      if (!ok) skipped.push(att.label || att.fileName || "attachment");
    } catch {
      skipped.push(att.label || att.fileName || "attachment");
    }
  }

  const bytes = await doc.save();
  const safeProject = (input.projectName || "project").replace(/[^a-zA-Z0-9._-]+/g, "-");
  downloadFileBytes(
    bytes,
    `Transmittal-${safeProject}-${input.transmittalNumber || dateStr.replace(/\//g, "")}.pdf`,
  );
  return { skipped };
}
