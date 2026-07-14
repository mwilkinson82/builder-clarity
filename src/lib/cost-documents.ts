import type { CostActualRow } from "@/lib/billing.functions";
import { centsToDollars, dollarsToCents } from "@/lib/payments-domain";
import type {
  SubcontractChangeOrderRow,
  SubcontractPaymentRow,
} from "@/lib/subcontracts.functions";

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

export function summarizeRiskLinkedCosts(
  actuals: CostActualRow[],
  payments: SubcontractPaymentRow[],
  changeOrders: SubcontractChangeOrderRow[],
) {
  const actualByExposureCents = new Map<string, number>();
  const committedByExposureCents = new Map<string, number>();

  for (const actual of recognizedRiskActuals(actuals)) {
    if (!actual.exposure_id) continue;
    actualByExposureCents.set(
      actual.exposure_id,
      (actualByExposureCents.get(actual.exposure_id) ?? 0) + dollarsToCents(actual.amount),
    );
  }
  for (const payment of payments) {
    if (!payment.exposure_id || payment.status !== "paid") continue;
    actualByExposureCents.set(
      payment.exposure_id,
      (actualByExposureCents.get(payment.exposure_id) ?? 0) + dollarsToCents(payment.amount),
    );
  }
  for (const changeOrder of changeOrders) {
    if (!changeOrder.exposure_id) continue;
    committedByExposureCents.set(
      changeOrder.exposure_id,
      (committedByExposureCents.get(changeOrder.exposure_id) ?? 0) +
        dollarsToCents(changeOrder.amount),
    );
  }

  return {
    actualByExposure: new Map(
      [...actualByExposureCents].map(([id, cents]) => [id, centsToDollars(cents)]),
    ),
    committedByExposure: new Map(
      [...committedByExposureCents].map(([id, cents]) => [id, centsToDollars(cents)]),
    ),
  };
}
