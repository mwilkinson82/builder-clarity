// Budget-vs-cost ledger (BUDGETENGINE Phase 2) — the per-cost-code accounting
// view. Columns read in plain English (no "EAC" jargon): Budget, Actuals, Open,
// At Risk, Contingency, Projected cost, Over/under budget. At Risk (E-Holds) and
// Contingency (C-Holds) come from the live exposure allocations — the IOR risk
// register, not a typed number. Each shorthand column carries a hover
// explanation because a PM or biller won't know our internal terms.
import type { ReactNode } from "react";

import { Info, Lock, PencilLine, Plus } from "lucide-react";

import { BudgetMovers } from "@/components/project/BudgetMovers";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
import { computeBudgetLedger, type BudgetLedgerRow } from "@/lib/budget-ledger";
import type {
  BucketRow,
  ChangeOrderAllocationListRow,
  ChangeOrderRow,
  ExposureAllocationRow,
  ExposureRow,
} from "@/lib/projects.functions";

// Over/under reads itself: "$3,000 over" in red, "$5,000 under" in green — never
// a bare parenthesized number nobody can decode at a glance.
function OverUnder({ value }: { value: number }) {
  if (value === 0) return <span className="tabular text-muted-foreground">On budget</span>;
  const under = value > 0;
  return (
    <span className={cn("tabular font-medium", under ? "text-success" : "text-danger")}>
      {fmtUSD(Math.abs(value))} {under ? "under" : "over"}
    </span>
  );
}

// An unpriced line says so, loudly — it must never masquerade as a $0-contract
// or zero-margin line (BUDGETVSCONTRACT1).
function UnpricedChip() {
  return (
    <span className="rounded-sm bg-warning/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-warning">
      Needs contract value
    </span>
  );
}

// Line margin reads itself: dollars with a percent-of-contract underneath,
// green for profit, red for a loss. null (unpriced) renders as a quiet dash —
// the contract column's chip carries the "why". `serif` = the totals-row
// treatment from the mock: serif numerals at 15px.
function MarginCell({
  margin,
  marginPct,
  serif,
}: {
  margin: number | null;
  marginPct: number | null;
  serif?: boolean;
}) {
  if (margin === null) return <span className="text-muted-foreground">—</span>;
  const negative = margin < 0;
  return (
    <div
      className={cn(
        "tabular font-medium",
        serif && "font-serif text-[15px] font-normal",
        negative ? "text-danger" : "text-success",
      )}
    >
      {negative ? "−" : ""}
      {fmtUSD(Math.abs(margin))}
      {marginPct !== null ? (
        <div className="font-sans text-[10px] font-normal text-muted-foreground">
          {marginPct.toFixed(1)}% of contract
        </div>
      ) : null}
    </div>
  );
}

// One figure in the dark stat bar: dim mono label over a serif value.
function StatFigure({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex-none">
      <div className="font-mono text-[9.5px] font-bold uppercase tracking-[0.14em] text-dark-panel-foreground/60">
        {label}
      </div>
      <div className="tabular mt-1.5 whitespace-nowrap font-serif text-[22px] leading-none">
        {children}
      </div>
    </div>
  );
}

// The dark verdict bar above the ledger (Budget.html mock): working budget,
// projected cost, the position between them, and margin on contract — plus the
// risk holds and lock state on the right. Values come straight off the ledger
// totals so the bar can never disagree with the table it sits above. Rendered
// by the Budget route (or by BudgetLedgerTable itself via `showStatBar`).
// The green/red/amber literals are the documented on-dark tints for text on
// --dark-panel (the semantic tokens are tuned for light ground and go muddy
// on ink) — see docs/THEMING.md.
export function BudgetStatBar({
  totals,
  lockedAt,
  openHoldsAtRisk,
  openHoldsContingency,
}: {
  totals: BudgetLedgerRow;
  lockedAt?: string | null;
  // The TRUE open-holds figures from the IOR rollup (rollup.exposureHolds /
  // contingencyHold). `totals.atRisk`/`totals.contingency` only sum holds
  // ALLOCATED to a cost code, dropping the un-allocated remainder — so when these
  // are provided the bar shows the full open-holds number, matching the dashboard
  // "E-Hold" line and the portfolio open-holds tile. Falls back to the allocated
  // ledger totals when omitted (the bare ledger usage).
  openHoldsAtRisk?: number;
  openHoldsContingency?: number;
}) {
  const position = totals.overUnder;
  const atRisk = openHoldsAtRisk ?? totals.atRisk;
  const contingency = openHoldsContingency ?? totals.contingency;
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-3 rounded-xl bg-dark-panel px-5 py-4 text-dark-panel-foreground">
      <StatFigure label="Working budget">{fmtUSD(totals.budget)}</StatFigure>
      <StatFigure label="Projected cost">{fmtUSD(totals.eac)}</StatFigure>
      <StatFigure label="Position">
        {position === 0 ? (
          <span className="text-dark-panel-foreground/60">On budget</span>
        ) : position > 0 ? (
          <span className="text-[#7FB08A]">+{fmtUSD(position)} under</span>
        ) : (
          <span className="text-[#E08A76]">{fmtUSD(Math.abs(position))} over</span>
        )}
      </StatFigure>
      <StatFigure label="Margin on contract">
        {totals.margin !== null ? (
          <>
            {fmtUSD(totals.margin)}
            {totals.marginPct !== null ? (
              <span className="ml-1.5 font-sans text-xs text-dark-panel-foreground/60">
                {totals.marginPct.toFixed(1)}%
              </span>
            ) : null}
          </>
        ) : (
          <span className="text-dark-panel-foreground/60">—</span>
        )}
      </StatFigure>
      <div className="ml-auto text-right text-xs leading-relaxed text-dark-panel-foreground/60">
        <div>
          At risk <span className="font-medium text-dark-panel-foreground">{fmtUSD(atRisk)}</span> ·
          Contingency{" "}
          <span className="font-medium text-dark-panel-foreground">{fmtUSD(contingency)}</span>
        </div>
        <div>
          {lockedAt ? (
            <span className="inline-flex items-center gap-1">
              <Lock className="h-3 w-3" aria-hidden />
              Locked{" "}
              {new Date(lockedAt).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </span>
          ) : (
            <span className="text-[#C09A56]">Not locked</span>
          )}
        </div>
      </div>
    </div>
  );
}

// A column header whose plain-English meaning is one hover away — the accounting
// shorthand means nothing to a PM or biller otherwise.
function HelpHead({ label, help, className }: { label: string; help: string; className?: string }) {
  return (
    <TableHead className={className}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help items-center gap-1">
            {label}
            <Info className="h-3 w-3 opacity-60" />
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-[260px] text-xs font-normal normal-case tracking-normal">
          {help}
        </TooltipContent>
      </Tooltip>
    </TableHead>
  );
}

export function BudgetLedgerTable({
  buckets,
  exposures,
  allocations,
  changeOrders = [],
  changeOrderAllocations = [],
  subCostByBucket,
  selfPerformByBucket,
  onOpenLine,
  onAddLine,
  editedBucketIds,
  showStatBar,
  lockedAt,
  openHoldsAtRisk,
  openHoldsContingency,
}: {
  buckets: BucketRow[];
  exposures: ExposureRow[];
  allocations: ExposureAllocationRow[];
  // BUDGETLOCK1: approved change-order cost is the ONLY thing that moves a
  // locked budget — the ledger layers it onto the frozen baseline.
  changeOrders?: ChangeOrderRow[];
  changeOrderAllocations?: ChangeOrderAllocationListRow[];
  // SUBCONTRACTORS Slice 1: the sub cost layer per bucket. `committed` (the
  // buyout) displaces the code's own forecast, `paid` → actuals, `open` → the
  // remaining forecast. Built by the route from the subcontract query.
  subCostByBucket?: ReadonlyMap<
    string,
    { paid: number; open: number; committed?: number; earned?: number }
  >;
  // Self-perform daily WIP cost per bucket (id → dollars) already folded into the
  // buckets' actuals — passed here only so a rolled-up line can show how much of
  // its actual came from the daily log.
  selfPerformByBucket?: ReadonlyMap<string, number>;
  // BUDGETCONSOLIDATE1: when provided, the ledger becomes the single editable
  // Budget table — click a line to open its editor, "Add line" to create one.
  // Omitted (e.g. the read-only billing usage) → the ledger stays display-only.
  onOpenLine?: (bucketId: string) => void;
  onAddLine?: () => void;
  // Cost-bucket ids that carry a manual override, marked so a hand-touched line
  // is never invisible.
  editedBucketIds?: ReadonlySet<string>;
  // Render the dark BudgetStatBar above the table (the route passes this on
  // the Budget tab; other usages keep the bare ledger).
  showStatBar?: boolean;
  // projects.budget_locked_at — shown in the stat bar's lock-state line.
  lockedAt?: string | null;
  // TRUE open-holds figures from the IOR rollup (rollup.exposureHolds /
  // contingencyHold). When provided, the stat bar's "At risk"/"Contingency" show
  // these (the full open holds) instead of the ledger's allocated-only sums, so
  // the Budget bar agrees with the dashboard E-Hold line and the portfolio.
  openHoldsAtRisk?: number;
  openHoldsContingency?: number;
}) {
  const ledger = computeBudgetLedger(
    buckets,
    exposures,
    allocations,
    changeOrders.map((co) => ({
      id: co.id,
      status: co.status,
      contract_amount: co.contract_amount,
      cost_amount: co.cost_amount,
    })),
    changeOrderAllocations.map((allocation) => ({
      change_order_id: allocation.change_order_id,
      cost_bucket_id: allocation.cost_bucket_id,
      contract_amount: allocation.contract_amount,
      cost_amount: allocation.cost_amount,
    })),
    subCostByBucket,
  );

  if (ledger.rows.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          No budget lines yet. Import or add cost codes to your budget, then allocate risk to see
          the At Risk column go live.
        </p>
        {onAddLine ? (
          <Button variant="outline" size="sm" className="gap-1.5" onClick={onAddLine}>
            <Plus className="h-3.5 w-3.5" /> Add line
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showStatBar ? (
        <BudgetStatBar
          totals={ledger.totals}
          lockedAt={lockedAt}
          openHoldsAtRisk={openHoldsAtRisk}
          openHoldsContingency={openHoldsContingency}
        />
      ) : null}
      <BudgetMovers rows={ledger.rows} />
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Budget vs cost by code
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            <strong className="font-medium text-foreground">Projected cost</strong> is what you've
            spent plus what's still committed.{" "}
            <strong className="font-medium text-foreground">Over / under budget</strong> is your
            budget minus that — <span className="text-success">green</span> means you're coming in
            under budget, <span className="text-danger">red</span> means over. Budget is your locked
            baseline plus approved change-order cost; At Risk and Contingency come straight from
            your IOR risk holds. Hover any column for what it means.
          </p>
        </div>
        {onAddLine ? (
          <Button variant="outline" size="sm" className="shrink-0 gap-1.5" onClick={onAddLine}>
            <Plus className="h-3.5 w-3.5" /> Add line
          </Button>
        ) : null}
      </div>
      <TooltipProvider delayDuration={150}>
        {/* The Table wrapper gets a max-height so it becomes its own vertical scroll
            box; the sticky header then pins to the top of that box as the rows scroll
            inside it. (Pinning to the page scroll is unreliable — the app shell's
            overflow ancestors capture the stickiness first.) */}
        <div className="overflow-x-clip rounded-lg border border-hairline bg-card">
          <Table wrapperClassName="max-h-[70vh]">
            <TableHeader className="sticky top-0 z-10">
              {/* Mock header treatment: mono 9.5px bold uppercase, .1em tracking.
                  Headers abbreviate (Conting., Projected, Over / under) — the
                  HelpHead tooltips keep carrying the full plain-English meaning. */}
              <TableRow className="border-b border-hairline bg-surface font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground [&_th]:font-bold">
                <TableHead className="w-[90px]">Code</TableHead>
                <TableHead>Description</TableHead>
                <HelpHead
                  label="Contract"
                  help="What the owner pays for this line — the SOV price plus approved change-order value. This is NOT your budget; the gap between them is your margin."
                  className="text-right"
                />
                <HelpHead
                  label="Budget"
                  help="Your internal cost baseline plus approved change-order cost — what you drive the job on. Once locked, the only thing that moves it is a change order."
                  className="text-right"
                />
                <TableHead className="text-right">Actuals</TableHead>
                <HelpHead
                  label="Open"
                  help="Committed cost you still owe — POs and subcontracts not yet paid."
                  className="text-right"
                />
                <HelpHead
                  label="At risk"
                  help="Your E-Holds (exposure holds) allocated to this cost code — live from the IOR risk register."
                  className="text-right"
                />
                <HelpHead
                  label="Conting."
                  help="Your C-Holds (contingency holds) allocated to this cost code — live from the IOR risk register."
                  className="text-right"
                />
                <HelpHead
                  label="Projected"
                  help="Actuals + Open — everything you've spent plus everything committed. The projected final cost of this line."
                  className="text-right"
                />
                <HelpHead
                  label="Over / under"
                  help="Budget minus Projected cost. Green means you're under budget; red means over."
                  className="text-right"
                />
                <HelpHead
                  label="Margin"
                  help="Contract value minus budget — your profit on this line, in dollars and as a percent of contract. Only shown once the line has a contract value."
                  className="text-right"
                />
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.rows.map((row) => {
                const clickable = Boolean(onOpenLine && row.costBucketId);
                const edited = Boolean(row.costBucketId && editedBucketIds?.has(row.costBucketId));
                return (
                  <TableRow
                    key={row.costBucketId ?? `general-${row.costCode}`}
                    className={cn(
                      clickable && "cursor-pointer transition-colors hover:bg-surface/70",
                    )}
                    onClick={clickable ? () => onOpenLine!(row.costBucketId as string) : undefined}
                  >
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {row.costCode || "—"}
                    </TableCell>
                    <TableCell className="font-medium">
                      <span className="inline-flex items-center gap-1.5">
                        {row.description}
                        {edited ? (
                          <span
                            title="Manually overridden — see the line editor"
                            className="inline-flex items-center gap-0.5 rounded-sm bg-accent/10 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-accent"
                          >
                            <PencilLine className="h-2.5 w-2.5" />
                            edited
                          </span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {row.costBucketId !== null && !row.priced ? (
                        <UnpricedChip />
                      ) : row.contractValue !== 0 ? (
                        <>
                          {fmtUSD(row.contractValue)}
                          {row.changeOrderContract !== 0 ? (
                            <div className="text-[10px] font-normal text-muted-foreground">
                              incl. {fmtUSD(row.changeOrderContract)} CO
                            </div>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {fmtUSD(row.budget)}
                      {row.changeOrderBudget !== 0 ? (
                        <div className="text-[10px] font-normal text-muted-foreground">
                          incl. {fmtUSD(row.changeOrderBudget)} CO
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {fmtUSD(row.actuals)}
                      {(() => {
                        const sub = row.costBucketId
                          ? subCostByBucket?.get(row.costBucketId)
                          : null;
                        // Actuals is cash paid; show the earned value alongside when the
                        // sub has produced more work than it's been paid for, so the gap
                        // (work done, not yet paid) is visible.
                        return sub && (sub.earned ?? 0) > sub.paid ? (
                          <div className="text-[10px] font-normal text-muted-foreground">
                            {fmtUSD(sub.earned ?? 0)} earned
                          </div>
                        ) : null;
                      })()}
                      {(() => {
                        // Self-perform daily WIP folded into this line's actual — show
                        // how much, so the roll-up from the daily log is visible.
                        const wip = row.costBucketId
                          ? (selfPerformByBucket?.get(row.costBucketId) ?? 0)
                          : 0;
                        return wip > 0 ? (
                          <div
                            className="text-[10px] font-normal text-muted-foreground underline decoration-dotted underline-offset-2"
                            title="Open this line to see which days' logs roll up into it"
                          >
                            incl. {fmtUSD(wip)} from daily WIP
                          </div>
                        ) : null;
                      })()}
                    </TableCell>
                    <TableCell className="text-right tabular text-muted-foreground">
                      {fmtUSD(row.open)}
                    </TableCell>
                    <TableCell className="text-right tabular text-warning">
                      {row.atRisk > 0 ? fmtUSD(row.atRisk) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular text-accent">
                      {row.contingency > 0 ? fmtUSD(row.contingency) : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular font-medium">
                      {fmtUSD(row.eac)}
                    </TableCell>
                    <TableCell className="text-right">
                      <OverUnder value={row.overUnder} />
                    </TableCell>
                    <TableCell className="text-right">
                      <MarginCell margin={row.margin} marginPct={row.marginPct} />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
            <TableFooter>
              {/* Totals wear the mock's serif numerals (15px); the label is
                  "All cost codes" — plainer than a bare "Total". */}
              <TableRow className="bg-surface font-semibold">
                <TableCell />
                <TableCell>All cost codes</TableCell>
                <TableCell className="text-right tabular font-serif text-[15px] font-normal">
                  {ledger.totals.contractValue !== 0 ? (
                    <>
                      {fmtUSD(ledger.totals.contractValue)}
                      {ledger.totals.changeOrderContract !== 0 ? (
                        <div className="font-sans text-[10px] text-muted-foreground">
                          incl. {fmtUSD(ledger.totals.changeOrderContract)} CO
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular font-serif text-[15px] font-normal">
                  {fmtUSD(ledger.totals.budget)}
                  {ledger.totals.changeOrderBudget !== 0 ? (
                    <div className="font-sans text-[10px] text-muted-foreground">
                      incl. {fmtUSD(ledger.totals.changeOrderBudget)} CO
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular font-serif text-[15px] font-normal">
                  {fmtUSD(ledger.totals.actuals)}
                </TableCell>
                <TableCell className="text-right tabular font-serif text-[15px] font-normal">
                  {fmtUSD(ledger.totals.open)}
                </TableCell>
                <TableCell className="text-right tabular font-serif text-[15px] font-normal text-warning">
                  {fmtUSD(ledger.totals.atRisk)}
                </TableCell>
                <TableCell className="text-right tabular font-serif text-[15px] font-normal text-accent">
                  {fmtUSD(ledger.totals.contingency)}
                </TableCell>
                <TableCell className="text-right tabular font-serif text-[15px] font-normal">
                  {fmtUSD(ledger.totals.eac)}
                </TableCell>
                <TableCell className="text-right">
                  <OverUnder value={ledger.totals.overUnder} />
                </TableCell>
                <TableCell className="text-right">
                  <MarginCell
                    margin={ledger.totals.margin}
                    marginPct={ledger.totals.marginPct}
                    serif
                  />
                </TableCell>
              </TableRow>
            </TableFooter>
          </Table>
        </div>
        {ledger.unpricedCount > 0 ? (
          <p className="mt-2 text-[11px] text-muted-foreground">
            <span className="font-medium text-warning">
              {ledger.unpricedCount} line{ledger.unpricedCount === 1 ? "" : "s"} without a contract
              value
            </span>{" "}
            — the margin total covers priced lines only.{" "}
            {onOpenLine
              ? "Open each line to set its contract value (what the owner pays) and complete the picture."
              : "Enter each line's contract value (what the owner pays) to complete the picture."}
          </p>
        ) : null}
      </TooltipProvider>
    </div>
  );
}
