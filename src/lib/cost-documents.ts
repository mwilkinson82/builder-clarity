import type { CostActualRow } from "@/lib/billing.functions";

export type CostDocumentGroup = {
  id: string;
  lines: CostActualRow[];
};

/**
 * Cost actuals remain one row per cost-code allocation. This view groups rows
 * that belong to the same supplier invoice without changing accounting math.
 * Pre-migration rows fall back to their own id, so every historical cost stays
 * visible as a one-line document.
 */
export function groupCostActualsByDocument(actuals: CostActualRow[]): CostDocumentGroup[] {
  const documents = new Map<string, CostActualRow[]>();

  for (const actual of actuals) {
    const documentId = actual.cost_document_id || actual.id;
    const lines = documents.get(documentId);
    if (lines) lines.push(actual);
    else documents.set(documentId, [actual]);
  }

  return [...documents.entries()].map(([id, lines]) => ({ id, lines }));
}

export function recognizedRiskActuals(actuals: CostActualRow[]): CostActualRow[] {
  return actuals.filter(
    (actual) =>
      Boolean(actual.exposure_id) && actual.status !== "draft" && actual.status !== "void",
  );
}
