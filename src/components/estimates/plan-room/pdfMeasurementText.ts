import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  groupPdfMeasurementEvidence,
  withMeasurementEvidenceTimeout,
  type MeasurementEvidenceAnchor,
  type MeasurementSourceLine,
} from "@/lib/plan-room-measurement-assistant";
import {
  selectPlanScopeBriefSourceLines,
  type PlanScopeBriefSourceSheet,
} from "@/lib/plan-scope-brief";

const MAX_SOURCE_CHARACTERS = 45_000;

const configurePdfWorker = (pdfjs: unknown) => {
  const workerSrc = String(pdfWorkerUrl || "");
  if (!workerSrc) throw new Error("PDF worker is not available.");
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    workerSrc;
};

function withinCharacterBudget(lines: MeasurementSourceLine[]) {
  const accepted: MeasurementSourceLine[] = [];
  let characters = 0;
  for (const line of lines) {
    const next = line.text.length + line.line_number.length + 3;
    if (characters + next > MAX_SOURCE_CHARACTERS) break;
    accepted.push(line);
    characters += next;
  }
  return accepted;
}

export interface ExtractedPdfMeasurementEvidence {
  sourceLines: MeasurementSourceLine[];
  anchors: Record<string, MeasurementEvidenceAnchor>;
}

type PdfPageLike = {
  getViewport(options: { scale: number }): { width: number; height: number };
  getTextContent(): Promise<{
    items: Array<{ str?: string; transform?: number[]; width?: number }>;
  }>;
};

async function extractPageMeasurementEvidence(page: PdfPageLike) {
  const viewport = page.getViewport({ scale: 1 });
  const content = await withMeasurementEvidenceTimeout(
    page.getTextContent(),
    "Reading selectable drawing notes",
  );
  const grouped = groupPdfMeasurementEvidence(
    content.items
      .filter((item) => typeof item.str === "string" && Array.isArray(item.transform))
      .map((item) => {
        const transform = item.transform as number[];
        return {
          text: item.str as string,
          x: transform[4] ?? 0,
          y: transform[5] ?? 0,
          height: Math.hypot(transform[2] ?? 0, transform[3] ?? 0),
          width: item.width,
        };
      }),
    viewport.width,
    viewport.height,
  );
  const sourceLines = withinCharacterBudget(grouped);
  const acceptedLineNumbers = new Set(sourceLines.map((line) => line.line_number));
  return {
    sourceLines,
    anchors: Object.fromEntries(
      grouped
        .filter((line) => acceptedLineNumbers.has(line.line_number))
        .map((line) => [line.line_number, line.anchor]),
    ),
  };
}

export async function extractPdfMeasurementEvidence({
  fileUrl,
  pageNumber,
}: {
  fileUrl: string;
  pageNumber: number;
}): Promise<ExtractedPdfMeasurementEvidence> {
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);
  const loadingTask = pdfjs.getDocument({ url: fileUrl });
  let pdf: Awaited<typeof loadingTask.promise> | null = null;
  try {
    pdf = await withMeasurementEvidenceTimeout(
      loadingTask.promise,
      "Opening the drawing for note review",
    );
    const page = await withMeasurementEvidenceTimeout(
      pdf.getPage(Math.max(1, pageNumber)),
      "Opening the selected drawing page",
    );
    return extractPageMeasurementEvidence(page as unknown as PdfPageLike);
  } finally {
    const disposable = (pdf ?? loadingTask) as unknown as { destroy?: () => Promise<void> };
    await disposable.destroy?.call(disposable).catch(() => undefined);
  }
}

export async function extractPdfMeasurementSourceLines(input: {
  fileUrl: string;
  pageNumber: number;
}) {
  return (await extractPdfMeasurementEvidence(input)).sourceLines;
}

/**
 * Read one retained vector PDF once and collect a bounded, fair note sample
 * from each sheet for the plan-set Scope Brief. Empty/scanned pages are kept
 * out of the AI request and reported by the resulting coverage counts.
 */
export async function extractPdfPlanScopeBriefEvidence({
  fileUrl,
  sheets,
  onProgress,
}: {
  fileUrl: string;
  sheets: Array<{
    id: string;
    page_number: number;
    sheet_number: string;
    sheet_name: string;
    discipline: string;
  }>;
  onProgress?: (completed: number, total: number) => void;
}) {
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);
  const loadingTask = pdfjs.getDocument({ url: fileUrl });
  let pdf: Awaited<typeof loadingTask.promise> | null = null;
  const sourceSheets: PlanScopeBriefSourceSheet[] = [];
  try {
    pdf = await withMeasurementEvidenceTimeout(
      loadingTask.promise,
      "Opening the drawing set for the scope brief",
    );
    for (const [index, sheet] of sheets.entries()) {
      try {
        const page = await withMeasurementEvidenceTimeout(
          pdf.getPage(Math.max(1, sheet.page_number)),
          "Opening a drawing page for the scope brief",
        );
        const evidence = await extractPageMeasurementEvidence(page as unknown as PdfPageLike);
        const selectedLines = selectPlanScopeBriefSourceLines(evidence.sourceLines);
        if (selectedLines.length > 0) {
          sourceSheets.push({
            plan_sheet_id: sheet.id,
            sheet_number: sheet.sheet_number,
            sheet_name: sheet.sheet_name,
            discipline: sheet.discipline,
            source_lines: selectedLines,
          });
        }
      } catch {
        // One unreadable/scanned page must not erase evidence from the rest of
        // the set. Coverage copy reports that it still needs manual review.
      } finally {
        onProgress?.(index + 1, sheets.length);
      }
    }
    return sourceSheets;
  } finally {
    const disposable = (pdf ?? loadingTask) as unknown as { destroy?: () => Promise<void> };
    await disposable.destroy?.call(disposable).catch(() => undefined);
  }
}
