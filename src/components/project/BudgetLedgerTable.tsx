// Budget-vs-cost ledger (BUDGETENGINE Phase 2) — the per-cost-code accounting
// view. Columns read in plain English (no "EAC" jargon): Budget, Actuals, Open,
// At Risk, Contingency, Projected cost, Over/under budget. At Risk (E-Holds) and
// Contingency (C-Holds) come from the live exposure allocations — the IOR risk
// register, not a typed number. Each shorthand column carries a hover
// explanation because a PM or biller won't know our internal terms.
import { Info } from "lucide-react";

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
import { computeBudgetLedger } from "@/lib/budget-ledger";
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
// the contract column's chip carries the "why".
function MarginCell({ margin, marginPct }: { margin: number | null; marginPct: number | null }) {
  if (margin === null) return <span className="text-muted-foreground">—</span>;
  const negative = margin < 0;
  return (
    <div className={cn("tabular font-medium", negative ? "text-danger" : "text-success")}>
      {negative ? "−" : ""}
      {fmtUSD(Math.abs(margin))}
      {marginPct !== null ? (
        <div className="text-[10px] font-normal text-muted-foreground">
          {marginPct.toFixed(1)}% of contract
        </div>
      ) : null}
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
      <p className="text-sm text-muted-foreground">
        No budget lines yet. Import or add cost codes to your budget, then allocate risk to see the
        At Risk column go live.
      </p>
    );
  }

  return (
    <div className="space-y-3">
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
          baseline plus approved change-order cost; At Risk and Contingency come straight from your
          IOR risk holds. Hover any column for what it means.
        </p>
      </div>
      <TooltipProvider delayDuration={150}>
        {/* overflow-x-clip (not -auto) keeps the rounded corners without creating a
            scroll container, so the sticky header can pin to the viewport as the
            page scrolls. */}
        <div className="overflow-x-clip rounded-lg border border-hairline bg-card">
          <Table>
            <TableHeader className="sticky top-0 z-10">
              <TableRow className="border-b border-hairline bg-surface text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                <TableHead className="w-[90px]">Cost code</TableHead>
                <TableHead>Description</TableHead>
                <HelpHead
                  label="Contract value"
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
                  label="At Risk"
                  help="Your E-Holds (exposure holds) allocated to this cost code — live from the IOR risk register."
                  className="text-right"
                />
                <HelpHead
                  label="Contingency"
                  help="Your C-Holds (contingency holds) allocated to this cost code — live from the IOR risk register."
                  className="text-right"
                />
                <HelpHead
                  label="Projected cost"
                  help="Actuals + Open — everything you've spent plus everything committed. The projected final cost of this line."
                  className="text-right"
                />
                <HelpHead
                  label="Over / under budget"
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
              {ledger.rows.map((row) => (
                <TableRow key={row.costBucketId ?? `general-${row.costCode}`}>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {row.costCode || "—"}
                  </TableCell>
                  <TableCell className="font-medium">{row.description}</TableCell>
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
                      const sub = row.costBucketId ? subCostByBucket?.get(row.costBucketId) : null;
                      // Actuals is cash paid; show the earned value alongside when the
                      // sub has produced more work than it's been paid for, so the gap
                      // (work done, not yet paid) is visible.
                      return sub && (sub.earned ?? 0) > sub.paid ? (
                        <div className="text-[10px] font-normal text-muted-foreground">
                          {fmtUSD(sub.earned ?? 0)} earned
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
              ))}
            </TableBody>
            <TableFooter>
              <TableRow className="bg-surface font-semibold">
                <TableCell />
                <TableCell>{ledger.totals.description}</TableCell>
                <TableCell className="text-right tabular">
                  {ledger.totals.contractValue !== 0 ? (
                    <>
                      {fmtUSD(ledger.totals.contractValue)}
                      {ledger.totals.changeOrderContract !== 0 ? (
                        <div className="text-[10px] font-normal text-muted-foreground">
                          incl. {fmtUSD(ledger.totals.changeOrderContract)} CO
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="text-right tabular">
                  {fmtUSD(ledger.totals.budget)}
                  {ledger.totals.changeOrderBudget !== 0 ? (
                    <div className="text-[10px] font-normal text-muted-foreground">
                      incl. {fmtUSD(ledger.totals.changeOrderBudget)} CO
                    </div>
                  ) : null}
                </TableCell>
                <TableCell className="text-right tabular">
                  {fmtUSD(ledger.totals.actuals)}
                </TableCell>
                <TableCell className="text-right tabular">{fmtUSD(ledger.totals.open)}</TableCell>
                <TableCell className="text-right tabular text-warning">
                  {fmtUSD(ledger.totals.atRisk)}
                </TableCell>
                <TableCell className="text-right tabular text-accent">
                  {fmtUSD(ledger.totals.contingency)}
                </TableCell>
                <TableCell className="text-right tabular">{fmtUSD(ledger.totals.eac)}</TableCell>
                <TableCell className="text-right">
                  <OverUnder value={ledger.totals.overUnder} />
                </TableCell>
                <TableCell className="text-right">
                  <MarginCell margin={ledger.totals.margin} marginPct={ledger.totals.marginPct} />
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
            — the margin total covers priced lines only. Enter each line's contract value (what the
            owner pays) in the budget grid below to complete the picture.
          </p>
        ) : null}
      </TooltipProvider>
    </div>
  );
}
