// Receivables cockpit math (GETTINGPAID1 Task 0).
//
// Pure functions for the number that runs the biller's day: days until due
// (or days overdue), the aging bucket, and the collections cue. Day math is
// calendar-date based (UTC midnights) so counts are exact across month and
// DST boundaries.
// Relative .ts import so node-based smoke tests can load this module.
import { dollarsToCents } from "./payments-domain.ts";

export const DEFAULT_COLLECTIONS_OVERDUE_DAYS = 15;

const DAY_MS = 86_400_000;

function utcMidnight(value: string): number | null {
  // Accepts date-only (YYYY-MM-DD) or full ISO strings.
  const datePart = value.slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart);
  if (!match) return null;
  const [, year, month, day] = match;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day));
  return Number.isFinite(ms) ? ms : null;
}

// Positive = days remaining, 0 = due today, negative = days overdue.
export function daysUntilDue(dueDate: string | null, today: string): number | null {
  if (!dueDate) return null;
  const due = utcMidnight(dueDate);
  const now = utcMidnight(today);
  if (due === null || now === null) return null;
  return Math.round((due - now) / DAY_MS);
}

export function daysOverdue(dueDate: string | null, today: string): number {
  const remaining = daysUntilDue(dueDate, today);
  if (remaining === null) return 0;
  return Math.max(0, -remaining);
}

export type ReceivableAgingBucket =
  "current" | "days_1_30" | "days_31_60" | "days_61_90" | "days_90_plus";

export const RECEIVABLE_AGING_BUCKETS: ReadonlyArray<{
  key: ReceivableAgingBucket;
  label: string;
}> = [
  { key: "current", label: "Current" },
  { key: "days_1_30", label: "1-30" },
  { key: "days_31_60", label: "31-60" },
  { key: "days_61_90", label: "61-90" },
  { key: "days_90_plus", label: "90+" },
];

// Bucket boundaries are inclusive on both ends (30 overdue is 1-30, 31 is
// 31-60, 90 is 61-90, 91+ is the 90+ bucket). Invoices with no due date age
// from nothing: they sit in Current until a due date exists.
export function receivableAgingBucket(overdueDays: number): ReceivableAgingBucket {
  if (overdueDays <= 0) return "current";
  if (overdueDays <= 30) return "days_1_30";
  if (overdueDays <= 60) return "days_31_60";
  if (overdueDays <= 90) return "days_61_90";
  return "days_90_plus";
}

// The collections cue: past the configurable threshold the row carries a
// "start collections" flag. Founder default: 15 days.
export function collectionsFlag(
  overdueDays: number,
  thresholdDays: number = DEFAULT_COLLECTIONS_OVERDUE_DAYS,
): boolean {
  const threshold = thresholdDays > 0 ? thresholdDays : DEFAULT_COLLECTIONS_OVERDUE_DAYS;
  return overdueDays >= threshold;
}

// Append-only plain-text collections log: newest entry first, one line per
// entry, stamped with the calendar date. No CRM machinery by design.
export function appendCollectionsNote(log: string, note: string, today: string): string {
  const trimmed = note.replace(/\s+/g, " ").trim();
  if (!trimmed) return log;
  const entry = `${today.slice(0, 10)} — ${trimmed}`;
  return [entry, log.trim()].filter(Boolean).join("\n");
}

export interface AgingBucketTotals {
  bucket: ReceivableAgingBucket;
  label: string;
  count: number;
  openBalance: number;
}

export interface OpenInvoiceForAging {
  due_date: string | null;
  total_due: number;
  paid_amount: number;
}

export function invoiceOpenBalanceCents(invoice: {
  total_due: number;
  paid_amount: number;
}): number {
  return Math.max(0, dollarsToCents(invoice.total_due) - dollarsToCents(invoice.paid_amount));
}

// Bucket totals across open invoices, summed in integer cents.
export function agingBucketTotals(
  invoices: readonly OpenInvoiceForAging[],
  today: string,
): AgingBucketTotals[] {
  const centsByBucket = new Map<ReceivableAgingBucket, { count: number; cents: number }>();
  for (const invoice of invoices) {
    const openCents = invoiceOpenBalanceCents(invoice);
    if (openCents <= 0) continue;
    const bucket = receivableAgingBucket(daysOverdue(invoice.due_date, today));
    const entry = centsByBucket.get(bucket) ?? { count: 0, cents: 0 };
    entry.count += 1;
    entry.cents += openCents;
    centsByBucket.set(bucket, entry);
  }
  return RECEIVABLE_AGING_BUCKETS.map(({ key, label }) => {
    const entry = centsByBucket.get(key);
    return {
      bucket: key,
      label,
      count: entry?.count ?? 0,
      openBalance: (entry?.cents ?? 0) / 100,
    };
  });
}
