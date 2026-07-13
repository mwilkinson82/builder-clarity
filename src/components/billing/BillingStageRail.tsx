import { cn } from "@/lib/utils";

// The billing workspace is one pipeline — budget your costs, bill against them, read
// over/under — but it used to render as seven equal sibling tabs with no implied order.
// This rail presents it as a numbered progression with honest state, and demotes the
// backward-looking ledgers into a secondary group (audit 1.1 / BILLINGRAIL1).

export type BillingStageTone = "home" | "empty" | "progress" | "complete" | "blocked";

export interface BillingRailStage {
  /** The underlying Tabs value this stage drives. */
  value: string;
  step: number;
  title: string;
  /** Short state line (e.g. "6 cost actuals", "4 of 7 assessed"). */
  chip: string;
  tone: BillingStageTone;
  /** When set, the stage's prerequisite is unmet: it renders disabled-with-reason and a
   * click routes to `routeTo` (the blocking stage) instead of opening a dead screen. */
  blockedReason?: string;
  routeTo?: string;
}

export interface BillingRailLedger {
  value: string;
  title: string;
}

// Sub-line dot + text tone. good=on-plan, clay=in-progress, muted=idle/empty,
// crit(warn)=blocked. Mirrors the schedule-health color rule (THEMING.md).
const TONE_DOT: Record<BillingStageTone, string> = {
  home: "bg-muted-foreground/40",
  empty: "bg-muted-foreground/40",
  progress: "bg-clay",
  complete: "bg-success",
  blocked: "bg-warning",
};

const TONE_TEXT: Record<BillingStageTone, string> = {
  home: "text-muted-foreground",
  empty: "text-muted-foreground",
  progress: "text-clay",
  complete: "text-success",
  blocked: "text-warning",
};

export function BillingStageRail({
  value,
  onValueChange,
  stages,
  ledgers,
}: {
  value: string;
  onValueChange: (value: string) => void;
  stages: BillingRailStage[];
  ledgers: BillingRailLedger[];
}) {
  const handleStageClick = (stage: BillingRailStage) => {
    // Out-of-order click on a blocked stage routes to the stage that unblocks it.
    if (stage.blockedReason && stage.routeTo) {
      onValueChange(stage.routeTo);
      return;
    }
    onValueChange(stage.value);
  };

  return (
    <div className="lg:w-[186px] lg:flex-none lg:pt-1.5">
      <div
        role="tablist"
        aria-label="Billing stages"
        className="grid gap-2 sm:grid-cols-2 lg:grid-cols-1"
      >
        {stages.map((stage) => {
          const active = stage.value === value;
          const blocked = Boolean(stage.blockedReason);
          return (
            <button
              key={stage.value}
              type="button"
              role="tab"
              aria-selected={active}
              aria-disabled={blocked}
              title={blocked ? stage.blockedReason : undefined}
              onClick={() => handleStageClick(stage)}
              className={cn(
                // The active card connects into the panel on lg (square right
                // edge, tucked 1px under the panel's left border).
                "relative z-[1] flex flex-col gap-1.5 rounded-xl border px-3.5 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:rounded-r-none lg:border-r-transparent",
                active
                  ? "border-hairline bg-secondary lg:z-10 lg:-mr-px lg:rounded-l-xl"
                  : "border-transparent hover:bg-secondary/60",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-[19px] w-[19px] shrink-0 items-center justify-center rounded-full font-mono text-[10px] font-bold",
                    active ? "bg-clay/15 text-clay" : "bg-secondary text-muted-foreground",
                  )}
                >
                  {stage.step}
                </span>
                <span
                  className={cn(
                    "truncate text-[13px] font-semibold",
                    blocked ? "text-muted-foreground" : "text-foreground",
                  )}
                >
                  {stage.title}
                </span>
              </div>
              <div className="flex items-start gap-1.5 pl-[27px]">
                <span
                  className={cn(
                    "mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full",
                    blocked ? "bg-warning" : TONE_DOT[stage.tone],
                  )}
                />
                <span
                  className={cn(
                    // Wrap the state line instead of truncating it — the rail is
                    // only ~186px wide, so chips like "Application 2 ready to
                    // certify" or "Underbilled $128,312" were getting cut mid-word
                    // and left unreadable (field feedback 2026-07-13).
                    "min-w-0 text-[11px] leading-snug",
                    blocked
                      ? "text-warning"
                      : active
                        ? "text-foreground/70"
                        : TONE_TEXT[stage.tone],
                  )}
                >
                  {blocked ? stage.blockedReason : stage.chip}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {ledgers.length > 0 ? (
        // The backward-looking ledgers continue the same tab column — first-class
        // rows with the identical active-connects-to-panel treatment, under a
        // hairline so the rail reads as one continuous set of tabs top to bottom.
        <div
          role="tablist"
          aria-label="Billing ledgers"
          className="mt-2.5 grid gap-1.5 border-t border-hairline pt-2.5 sm:grid-cols-2 lg:grid-cols-1"
        >
          {ledgers.map((ledger) => {
            const active = ledger.value === value;
            return (
              <button
                key={ledger.value}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onValueChange(ledger.value)}
                className={cn(
                  "relative z-[1] flex w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left text-[13px] font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:rounded-r-none lg:border-r-transparent",
                  active
                    ? "border-hairline bg-secondary text-foreground lg:z-10 lg:-mr-px lg:rounded-l-xl"
                    : "border-transparent text-muted-foreground hover:bg-secondary/60 hover:text-foreground",
                )}
              >
                <span className="truncate">{ledger.title}</span>
                <span
                  aria-hidden="true"
                  className={cn(
                    "shrink-0 text-[11px]",
                    active ? "text-clay" : "text-muted-foreground",
                  )}
                >
                  ›
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
