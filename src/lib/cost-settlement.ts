export type CostSettlement = {
  invoiceCents: number;
  cashPaidCents: number;
  creditCents: number;
  settledCents: number;
  remainingCents: number;
  state: "unsettled" | "partial" | "settled";
};

export function summarizeCostSettlement(input: {
  invoiceCents: number;
  cashPaidCents: number;
  creditCents: number;
  legacyPaid?: boolean;
}): CostSettlement {
  const invoiceCents = Math.max(0, Math.round(input.invoiceCents));
  const explicitCashCents = Math.max(0, Math.round(input.cashPaidCents));
  const creditCents = Math.max(0, Math.round(input.creditCents));
  const cashPaidCents =
    input.legacyPaid && explicitCashCents === 0 ? invoiceCents : explicitCashCents;
  const settledCents = Math.min(invoiceCents, cashPaidCents + creditCents);
  const remainingCents = Math.max(0, invoiceCents - settledCents);

  return {
    invoiceCents,
    cashPaidCents,
    creditCents,
    settledCents,
    remainingCents,
    state: settledCents === 0 ? "unsettled" : remainingCents === 0 ? "settled" : "partial",
  };
}
