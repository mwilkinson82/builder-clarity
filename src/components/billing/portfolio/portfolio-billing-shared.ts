// Shared derivations + style vocabulary for the Portfolio Billing notebook
// tabs (Collections / Billing position / Cash forecast). Pure functions —
// every dollar figure rendered through these comes from listPortfolioBilling
// or getReceivablesCockpit; nothing here invents money.
import type { PortfolioBillingProject, PortfolioBillingSummary } from "@/lib/billing.functions";

export type PortfolioBillingTotals = PortfolioBillingSummary["totals"];

// House mono microlabel (mock: var(--mono) 8.5px, .12em tracking).
export const MONO_LABEL = "font-mono text-[8.5px] font-bold uppercase tracking-[0.12em]";

export type StatTone = "neutral" | "good" | "warn" | "crit";

export const STAT_TONE_LABEL: Record<StatTone, string> = {
  neutral: "text-muted-foreground",
  good: "text-success",
  warn: "text-warning",
  crit: "text-danger",
};

export const STAT_TONE_BORDER: Record<StatTone, string> = {
  neutral: "border-hairline",
  good: "border-success/30",
  warn: "border-warning/30",
  crit: "border-danger/30",
};

export function shortDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// Revenue earned but not yet invoiced, per project. Never negative — an
// overbilled job has nothing "ready to invoice".
export function projectUnbilled(project: PortfolioBillingProject) {
  return Math.max(0, project.total_earned - project.total_billed);
}

// Everything past due across the aging buckets (current excluded).
export function overdueTotal(aging: PortfolioBillingTotals["aging"]) {
  return aging.days_30 + aging.days_60 + aging.days_90;
}

// GP% tone thresholds (spec: crit <12%, warn <18%, good >=18% — the codebase
// has no prior GP-percent tone rule, so the spec's applies).
export function gpTone(pct: number) {
  if (pct < 12) return "text-danger";
  if (pct < 18) return "text-warning";
  return "text-success";
}
