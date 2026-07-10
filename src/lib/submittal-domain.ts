// SUBMITTAL / RFI pipeline domain (field request, DB3T 2026-07-10). Pure date
// math for the log's tracking columns and dashboard tiles: how long an item has
// been out for review, and whether it's overdue against its due date. All dates
// are YYYY-MM-DD strings; the caller supplies "today" so nothing reads the
// clock here (testable + no drift) — mirrors compliance-domain.ts.

export interface SubmittalTrackLike {
  status: string;
  date_submitted: string | null;
  date_returned: string | null;
  due_date: string | null;
}

// Whole days from `from` to `to` (both YYYY-MM-DD). UTC-noon anchor avoids DST
// edge cases; string parse avoids new Date() drift.
function daysBetween(from: string, to: string): number {
  const parse = (d: string) => {
    const [y, m, day] = d.split("-").map(Number);
    return Date.UTC(y, (m || 1) - 1, day || 1, 12);
  };
  return Math.round((parse(to) - parse(from)) / 86_400_000);
}

// The reviewer has acted — the item is back in the GC's hands.
export function isReturned(e: SubmittalTrackLike): boolean {
  return Boolean(e.date_returned) || e.status === "a" || e.status === "aan" || e.status === "rar";
}

// Days the item has been sitting with the reviewer: today − date submitted,
// while nothing has come back. Null when it hasn't been sent (pending / no
// submitted date) or the ball is back in the GC's court.
export function daysOutstanding(e: SubmittalTrackLike, today: string): number | null {
  if (!e.date_submitted || isReturned(e)) return null;
  return Math.max(0, daysBetween(e.date_submitted, today));
}

// Overdue = it has a due date, the due date has passed, and nothing is back.
// Applies to pending items too — a planned submittal that was never sent can
// absolutely blow its deadline.
export function isOverdue(e: SubmittalTrackLike, today: string): boolean {
  if (!e.due_date || isReturned(e)) return false;
  return e.due_date < today;
}

export interface SubmittalPipelineCounts {
  pending: number; // planned, not sent yet
  outForReview: number; // sent, waiting on the reviewer
  overdue: number; // due date blown, nothing back (subset of the two above)
  returned: number; // reviewer acted (A / AAN / RAR or a returned date)
  // Longest current wait among out-for-review items, days. 0 with none out.
  maxDaysOut: number;
}

// The dashboard tiles over one log (already filtered to a kind).
export function pipelineCounts(
  entries: readonly SubmittalTrackLike[],
  today: string,
): SubmittalPipelineCounts {
  const counts: SubmittalPipelineCounts = {
    pending: 0,
    outForReview: 0,
    overdue: 0,
    returned: 0,
    maxDaysOut: 0,
  };
  for (const e of entries) {
    if (isReturned(e)) {
      counts.returned += 1;
    } else if (e.date_submitted) {
      counts.outForReview += 1;
      const days = daysOutstanding(e, today) ?? 0;
      if (days > counts.maxDaysOut) counts.maxDaysOut = days;
    } else {
      // Not sent yet — planned ('pending') or legacy not-set rows.
      counts.pending += 1;
    }
    if (isOverdue(e, today)) counts.overdue += 1;
  }
  return counts;
}
