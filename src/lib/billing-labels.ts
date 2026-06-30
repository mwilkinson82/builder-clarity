const LEADING_ZERO_NUMBER_TOKEN = /(^|[^\d])0+(\d+)(?=\D|$)/g;

export function normalizeBillingNumberLabel(value?: string | number | null) {
  const label = String(value ?? "").trim();
  if (!label) return "";

  return label.replace(LEADING_ZERO_NUMBER_TOKEN, (_match, prefix: string, digits: string) => {
    const normalized = digits.replace(/^0+/, "") || "0";
    return `${prefix}${normalized}`;
  });
}

export function billingDocumentLabel(
  primary?: string | number | null,
  fallback?: string | number | null,
  emptyLabel = "Pay app",
) {
  return normalizeBillingNumberLabel(primary || fallback || emptyLabel);
}
