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

const TONE_DOT: Record<BillingStageTone, string> = {
  home: "bg-muted-foreground/40",
  empty: "bg-muted-foreground/40",
  progress: "bg-accent",
  complete: "bg-success",
  blocked: "bg-warning",
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
    <div className="mt-5 space-y-3">
      <div
        role="tablist"
        aria-label="Billing stages"
        className="grid gap-1.5 rounded-lg border border-accent/25 bg-accent/[0.06] p-1.5 shadow-card ring-1 ring-accent/10 sm:grid-cols-2 lg:grid-cols-4"
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
                "flex flex-col gap-1 rounded-md border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                active
                  ? "border-accent bg-accent text-accent-foreground shadow-md"
                  : blocked
                    ? "border-hairline bg-card/60 hover:border-warning/40"
                    : "border-accent/35 bg-accent/10 text-foreground hover:border-accent/60 hover:bg-accent/20",
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold",
                    active
                      ? "bg-accent-foreground/20 text-accent-foreground"
                      : "bg-accent/15 text-accent",
                  )}
                >
                  {stage.step}
                </span>
                <span
                  className={cn(
                    "truncate text-sm font-semibold",
                    active
                      ? "text-accent-foreground"
                      : blocked
                        ? "text-muted-foreground"
                        : "text-foreground",
                  )}
                >
                  {stage.title}
                </span>
              </div>
              <div className="flex items-center gap-1.5 pl-7">
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    active ? "bg-accent-foreground/70" : TONE_DOT[stage.tone],
                  )}
                />
                <span
                  className={cn(
                    "truncate text-[11px] font-medium",
                    active
                      ? "text-accent-foreground/85"
                      : blocked
                        ? "text-warning"
                        : "text-muted-foreground",
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
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Ledgers &amp; history
          </span>
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
                  "rounded-md border px-2.5 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active
                    ? "border-accent bg-accent text-accent-foreground"
                    : "border-hairline bg-card text-muted-foreground hover:border-accent/40 hover:text-foreground",
                )}
              >
                {ledger.title}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
