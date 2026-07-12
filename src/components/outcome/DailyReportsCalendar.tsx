import { useMemo } from "react";
import { cn } from "@/lib/utils";

// All date math here is on local "YYYY-MM-DD" / "YYYY-MM" strings, anchored at
// noon when a Date is unavoidable — so a superintendent filling the log at
// 11 pm never sees the calendar drift a day.
const pad2 = (value: number) => String(value).padStart(2, "0");

/** "YYYY-MM" for the month `delta` months away from a "YYYY-MM". */
export function shiftMonth(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const d = new Date(year, monthNumber - 1 + delta, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

/** "July" for "2026-07". */
export function monthName(month: string) {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Date(year, monthNumber - 1, 1).toLocaleDateString("en-US", { month: "long" });
}

/** "Jul 9" for "2026-07-09". */
export function formatShortDate(date: string) {
  return new Date(`${date}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

type DayCell = {
  date: string;
  day: number;
  logged: boolean;
  gap: boolean;
  future: boolean;
  isToday: boolean;
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

const CELL_BASE =
  "flex aspect-[1.15] flex-col items-center justify-center rounded-[9px] border font-mono text-[11px] font-bold transition-colors";

export function DailyReportsCalendar({
  month,
  onMonthChange,
  loggedDates,
  firstReportDate,
  totalReports,
  sinceLabel,
  today,
  onSelectDay,
}: {
  /** "YYYY-MM" month being browsed. */
  month: string;
  onMonthChange: (month: string) => void;
  /** Set of "YYYY-MM-DD" days that have a saved report. */
  loggedDates: Set<string>;
  /** Earliest report date on the project — gaps only count after it. */
  firstReportDate: string | null;
  totalReports: number;
  /** e.g. "Feb" — month of the first report, for the footer strip. */
  sinceLabel: string | null;
  /** Local "YYYY-MM-DD" today. */
  today: string;
  onSelectDay: (date: string) => void;
}) {
  const [yearNumber, monthNumber] = month.split("-").map(Number);
  const monthTitle = new Date(yearNumber, monthNumber - 1, 1).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const { cells, leading, loggedInMonth, gapDates } = useMemo(() => {
    const daysInMonth = new Date(yearNumber, monthNumber, 0).getDate();
    const built: DayCell[] = [];
    const gaps: string[] = [];
    let logged = 0;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = `${month}-${pad2(day)}`;
      const isLogged = loggedDates.has(date);
      // A logged day is always reachable, even if someone dated a report ahead.
      const future = date > today && !isLogged;
      // A "gap" is a past day with no report — but only after the project's
      // first report; before that the job simply wasn't logging yet.
      const gap = !isLogged && date < today && firstReportDate !== null && date > firstReportDate;
      if (isLogged) logged += 1;
      if (gap) gaps.push(date);
      built.push({ date, day, logged: isLogged, gap, future, isToday: date === today });
    }
    return {
      cells: built,
      leading: new Date(yearNumber, monthNumber - 1, 1).getDay(),
      loggedInMonth: logged,
      gapDates: gaps,
    };
  }, [month, yearNumber, monthNumber, loggedDates, firstReportDate, today]);

  return (
    <section className="rounded-xl border border-hairline bg-card p-5 shadow-card">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <div className="text-[13px] font-semibold text-foreground">Browse by day</div>
        <span className="text-xs text-muted-foreground">
          <span className="text-success">● logged</span> ·{" "}
          <span className="text-danger">○ gap</span>
          <span className="hidden sm:inline"> · click a day to open its report</span>
        </span>
        <div className="ml-auto flex items-center gap-2.5">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => onMonthChange(shiftMonth(month, -1))}
            className="px-1.5 text-[15px] text-muted-foreground transition-colors hover:text-foreground"
          >
            ‹
          </button>
          <span className="font-serif text-lg text-foreground">{monthTitle}</span>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => onMonthChange(shiftMonth(month, 1))}
            className="px-1.5 text-[15px] text-muted-foreground transition-colors hover:text-foreground"
          >
            ›
          </button>
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-7 gap-1.5">
        {WEEKDAYS.map((label, index) => (
          <div
            key={`${label}-${index}`}
            className="pb-1 text-center font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground"
          >
            {label}
          </div>
        ))}
        {Array.from({ length: leading }, (_, index) => (
          <div key={`lead-${index}`} />
        ))}
        {cells.map((cell) => {
          const ring = cell.isToday ? "ring-2 ring-clay" : "";
          if (cell.future) {
            return (
              <div
                key={cell.date}
                className={cn(
                  CELL_BASE,
                  "border-hairline bg-secondary text-muted-foreground",
                  ring,
                )}
              >
                {cell.day}
              </div>
            );
          }
          return (
            <button
              key={cell.date}
              type="button"
              title={
                cell.logged
                  ? `Read the ${formatShortDate(cell.date)} report`
                  : `Fill the ${formatShortDate(cell.date)} report`
              }
              onClick={() => onSelectDay(cell.date)}
              className={cn(
                CELL_BASE,
                cell.logged
                  ? "border-success bg-success text-primary-foreground hover:bg-success/90"
                  : cell.gap
                    ? "border-danger bg-surface text-danger hover:bg-danger/5"
                    : "border-hairline bg-secondary text-muted-foreground hover:bg-secondary/70",
                ring,
              )}
            >
              {cell.day}
              {cell.logged ? (
                <span className="mt-0.5 block h-1 w-1 rounded-full bg-current" />
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="mt-3.5 flex flex-wrap gap-x-5 gap-y-1 border-t border-hairline pt-3 text-xs text-muted-foreground">
        <span>
          {loggedInMonth} logged in {monthName(month)}
        </span>
        <span>
          {gapDates.length > 0 ? (
            <>
              <b className="font-semibold text-danger">
                {gapDates.length} gap{gapDates.length === 1 ? "" : "s"}
              </b>
              {" · "}
              {gapDates.slice(0, 4).map(formatShortDate).join(", ")}
              {gapDates.length > 4 ? ` +${gapDates.length - 4} more` : ""}
            </>
          ) : (
            "no gaps"
          )}
        </span>
        <span>
          {totalReports} on file
          {sinceLabel ? ` since ${sinceLabel}` : ""}
        </span>
      </div>
    </section>
  );
}
