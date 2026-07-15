import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  groupPdfMeasurementText,
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

export async function extractPdfMeasurementSourceLines({
  fileUrl,
  pageNumber,
}: {
  fileUrl: string;
  pageNumber: number;
}): Promise<MeasurementSourceLine[]> {
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);
  const pdf = await pdfjs.getDocument({ url: fileUrl }).promise;
  try {
    const page = await pdf.getPage(Math.max(1, pageNumber));
    const content = (await page.getTextContent()) as {
      items: Array<{ str?: string; transform?: number[] }>;
    };
    const grouped = groupPdfMeasurementText(
      content.items
        .filter((item) => typeof item.str === "string" && Array.isArray(item.transform))
        .map((item) => {
          const transform = item.transform as number[];
          return {
            text: item.str as string,
            x: transform[4] ?? 0,
            y: transform[5] ?? 0,
            height: Math.hypot(transform[2] ?? 0, transform[3] ?? 0),
          };
        }),
    );
    return withinCharacterBudget(grouped);
  } finally {
    const destroy = (pdf as unknown as { destroy?: () => Promise<void> }).destroy;
    await destroy?.call(pdf).catch(() => undefined);
  }
}
