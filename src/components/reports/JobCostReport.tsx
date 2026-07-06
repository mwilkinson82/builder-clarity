// The Job Cost report — budget vs actual by cost code, per job. The "where is
// the money going on this job" view that pairs with the WIP schedule. It reuses
// computeBudgetLedger (the exact engine behind the project Budget tab), so the
// report can never disagree with the project screen. Values are dollars.
import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { JobCostProject, JobCostSummary } from "@/lib/billing.functions";
import type { BudgetLedgerRow } from "@/lib/budget-ledger";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import { fmtPct } from "@/lib/format";
import { ColHead } from "@/components/reports/ColHead";
import { csvCell, downloadText, money2 } from "@/components/reports/reportFormat";

interface JobCostReportProps {
  projects: JobCostProject[];
  totals: JobCostSummary["totals"];
  companyName: string;
  generatedOn: string;
}

function percentUsed(row: BudgetLedgerRow): number | null {
  return row.budget > 0 ? (row.eac / row.budget) * 100 : null;
}

function buildCsv(project: JobCostProject): string {
  const header = [
    "Cost code",
    "Description",
    "Budget",
    "Actual cost",
    "Committed (open)",
    "Projected cost",
    "Over/(under) budget",
    "At risk",
    "Contingency",
    "% of budget used",
  ];
  const line = (row: BudgetLedgerRow, isTotal = false): string => {
    const pct = percentUsed(row);
    return [
      csvCell(isTotal ? "TOTAL" : row.costCode),
      csvCell(isTotal ? "" : row.description),
      money2(row.budget),
      money2(row.actuals),
      money2(row.open),
      money2(row.eac),
      money2(row.overUnder),
      money2(row.atRisk),
      money2(row.contingency),
      pct == null ? "" : pct.toFixed(1),
    ].join(",");
  };
  return [
    header.map(csvCell).join(","),
    ...project.ledger.rows.map((row) => line(row)),
    line(project.ledger.totals, true),
  ].join("\n");
}

// Over/(under) budget: positive = under budget (favorable, kept in default
// ink); negative = over budget (the position to watch, amber). Mirrors the
// WIP report's convention that amber marks the number to look at.
function OverUnderBudgetCell({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) {
    return <span className="text-muted-foreground">On budget</span>;
  }
  const under = value > 0;
  return (
    <span className={under ? "text-foreground" : "text-warning"}>
      {fmtUSD(Math.abs(value))}
      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {under ? "under" : "over"}
      </span>
    </span>
  );
}

function PercentUsedCell({ row }: { row: BudgetLedgerRow }) {
  const pct = percentUsed(row);
  if (pct == null) {
    return <span className="text-muted-foreground">no budget</span>;
  }
  return <span className={pct > 100 ? "text-warning" : "text-foreground"}>{fmtPct(pct)}</span>;
}

export function JobCostReport({ projects, totals, companyName, generatedOn }: JobCostReportProps) {
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.project_name.localeCompare(b.project_name)),
    [projects],
  );
  const [selectedId, setSelectedId] = useState<string>(() => sortedProjects[0]?.project_id ?? "");
  const active =
    sortedProjects.find((project) => project.project_id === selectedId) ?? sortedProjects[0];

  const handleCsv = () => {
    if (!active) return;
    const stamp = generatedOn.replace(/[^0-9]/g, "").slice(0, 8) || "current";
    const jobTag = (active.job_number || active.project_name).replace(/[^a-zA-Z0-9]+/g, "-");
    downloadText(`job-cost-${jobTag}-${stamp}.csv`, buildCsv(active), "text/csv;charset=utf-8");
  };

  const rows = active?.ledger.rows ?? [];
  const ledgerTotals = active?.ledger.totals;

  return (
    <TooltipProvider delayDuration={150}>
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl text-foreground">Job cost report</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Budget vs actual for every cost code on the job — actual cost, what's still committed,
              the projected cost at completion, and where you stand against budget. Matches the
              project's Budget tab exactly.
            </p>
          </div>
          <div className="flex items-center gap-2" data-print-hide>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={handleCsv}
              disabled={!active}
            >
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print / Save PDF
            </Button>
          </div>
        </div>

        {/* Job picker — cost codes belong to a job, so the report is scoped to
            one job at a time. */}
        {sortedProjects.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2" data-print-hide>
            <label htmlFor="job-cost-project" className="text-sm text-muted-foreground">
              Job
            </label>
            <select
              id="job-cost-project"
              value={active?.project_id ?? ""}
              onChange={(event) => setSelectedId(event.target.value)}
              className="min-w-[240px] rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground shadow-sm focus:outline-none focus:ring-2 focus:ring-accent/40"
            >
              {sortedProjects.map((project) => (
                <option key={project.project_id} value={project.project_id}>
                  {project.project_name}
                  {project.job_number ? ` — Job ${project.job_number}` : ""}
                </option>
              ))}
            </select>
            <span className="text-[11px] text-muted-foreground">
              {sortedProjects.length} active job{sortedProjects.length === 1 ? "" : "s"} · portfolio
              budget {fmtUSD(totals.budget)}, projected {fmtUSD(totals.eac)}
            </span>
          </div>
        ) : null}

        {/* Print-only banner. */}
        <div className="constructline-wip-print-head hidden">
          <div className="text-lg font-semibold">{companyName}</div>
          <div className="text-sm">
            Job cost report
            {active
              ? ` · ${active.project_name}${active.job_number ? ` (Job ${active.job_number})` : ""}`
              : ""}{" "}
            · Generated {generatedOn}
          </div>
        </div>

        {!active ? (
          <div className="rounded-lg border border-hairline bg-surface p-8 text-center text-sm text-muted-foreground">
            No active jobs to report yet. Once a project has a budget, its cost codes appear here.
          </div>
        ) : rows.length === 0 ? (
          <div className="rounded-lg border border-hairline bg-surface p-8 text-center text-sm text-muted-foreground">
            {active.project_name} has no cost codes with a budget yet. Set budgets on the project's
            Budget tab and they'll appear here.
          </div>
        ) : (
          <div className="constructline-wip-scroll overflow-x-auto rounded-lg border border-hairline bg-surface">
            <table className="constructline-wip-table w-full min-w-[1080px] border-collapse text-sm">
              <thead className="border-b border-hairline bg-surface-elevated">
                <tr>
                  <ColHead align="left">Cost code</ColHead>
                  <ColHead help="The budgeted cost for this code — original budget plus any approved change-order cost.">
                    Budget
                  </ColHead>
                  <ColHead help="Cost actually booked against this code to date.">
                    Actual cost
                  </ColHead>
                  <ColHead help="Committed but not yet paid — the forecast cost still to come on this code.">
                    Committed
                  </ColHead>
                  <ColHead help="Projected cost at completion — actual cost plus what's still committed.">
                    Projected cost
                  </ColHead>
                  <ColHead help="Budget minus projected cost. Under = you expect to finish below budget; over = you expect to exceed it.">
                    Over/(under) budget
                  </ColHead>
                  <ColHead help="Open IOR exposure tied to this code (E-holds) — cost that may land but isn't committed yet.">
                    At risk
                  </ColHead>
                  <ColHead help="Contingency earmarked against this code (C-holds).">
                    Contingency
                  </ColHead>
                  <ColHead help="Projected cost ÷ budget. Above 100% means the projection exceeds budget.">
                    % used
                  </ColHead>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, index) => (
                  <tr
                    key={row.costBucketId ?? `general-${index}`}
                    className="border-b border-hairline/70 last:border-0"
                  >
                    <td className="px-3 py-2.5 text-left">
                      <div className="font-medium text-foreground">
                        {row.costCode || row.description}
                      </div>
                      {row.costCode ? (
                        <div className="text-[11px] text-muted-foreground">{row.description}</div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(row.budget)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(row.actuals)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(row.open)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(row.eac)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <OverUnderBudgetCell value={row.overUnder} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {row.atRisk > 0 ? (
                        fmtUSD(row.atRisk)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {row.contingency > 0 ? (
                        fmtUSD(row.contingency)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <PercentUsedCell row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
              {ledgerTotals ? (
                <tfoot>
                  <tr className="border-t-2 border-hairline bg-surface-elevated font-semibold">
                    <td className="px-3 py-2.5 text-left text-foreground">
                      Job total
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                        {rows.length} cost code{rows.length === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(ledgerTotals.budget)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(ledgerTotals.actuals)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(ledgerTotals.open)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(ledgerTotals.eac)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <OverUnderBudgetCell value={ledgerTotals.overUnder} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {ledgerTotals.atRisk > 0 ? fmtUSD(ledgerTotals.atRisk) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {ledgerTotals.contingency > 0 ? fmtUSD(ledgerTotals.contingency) : "—"}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <PercentUsedCell row={ledgerTotals} />
                    </td>
                  </tr>
                </tfoot>
              ) : null}
            </table>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Projected cost = actual cost + committed. Over/(under) budget = budget − projected. At
          risk and contingency are live IOR exposures, shown for awareness — they are not added into
          the projected cost.
        </p>
      </section>
    </TooltipProvider>
  );
}
