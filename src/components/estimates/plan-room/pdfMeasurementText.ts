import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  groupPdfMeasurementEvidence,
  withMeasurementEvidenceTimeout,
  type MeasurementEvidenceAnchor,
  type MeasurementSourceLine,
} from "@/lib/plan-room-measurement-assistant";

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
    const viewport = page.getViewport({ scale: 1 });
    const content = (await withMeasurementEvidenceTimeout(
      page.getTextContent(),
      "Reading selectable drawing notes",
    )) as {
      items: Array<{ str?: string; transform?: number[]; width?: number }>;
    };
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
