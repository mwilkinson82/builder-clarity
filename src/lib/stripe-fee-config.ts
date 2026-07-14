export const MAX_OVERWATCH_APPLICATION_FEE_BPS = 3_000;

export const STRIPE_STANDARD_US_FEES = {
  cardPercent: 2.9,
  cardFixedCents: 30,
  achDebitPercent: 0.8,
  achDebitCapCents: 500,
} as const;

export function normalizeApplicationFeeBps(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.min(Math.round(parsed), MAX_OVERWATCH_APPLICATION_FEE_BPS);
}

export function formatBasisPoints(basisPoints: number) {
  const percent = normalizeApplicationFeeBps(basisPoints) / 100;
  return `${percent
    .toFixed(2)
    .replace(/\.00$/, "")
    .replace(/(\.\d)0$/, "$1")}%`;
}

export function applicationFeeFromDollars(amountDollars: number, basisPoints: number) {
  const safeAmount = Math.max(0, Number.isFinite(amountDollars) ? amountDollars : 0);
  return Math.round((safeAmount * normalizeApplicationFeeBps(basisPoints)) / 100) / 100;
}
