// The Work-in-Progress (WIP) schedule — the report a lender, bonding agent, or
// CFO asks for first. One row per active project: contract, cost, percent
// complete, earned revenue, billed, and the over/under-billing that is the
// whole point of a WIP. Numbers come straight from listPortfolioBilling (the
// same figures the Billing portfolio shows), so this report can never disagree
// with the billing surface. Money is already in dollars here.
import { useMemo } from "react";
import { Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { PortfolioBillingProject, PortfolioBillingSummary } from "@/lib/billing.functions";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import { fmtPct } from "@/lib/format";
import { ColHead } from "@/components/reports/ColHead";
import { csvCell, downloadText, money2 } from "@/components/reports/reportFormat";

interface WipReportProps {
  projects: PortfolioBillingProject[];
  totals: PortfolioBillingSummary["totals"];
  companyName: string;
  generatedOn: string;
}

// A single derived WIP row — every figure a reader needs without cross-checking
// another screen. Kept flat so the CSV and the table read from one shape.
interface WipRow {
  id: string;
  name: string;
  jobNumber: string;
  manager: string;
  contract: number;
  estCost: number;
  costToDate: number;
  percentComplete: number; // 0..100
  earned: number;
  billed: number;
  overUnder: number; // billed − earned; + overbilled, − underbilled
  backlog: number; // contract − billed
  estGrossProfit: number;
  partial: boolean; // earned covers only some cost codes
}

function toWipRow(project: PortfolioBillingProject): WipRow {
  const estCost = project.total_cost + project.total_cost_to_complete;
  const percentComplete =
    project.total_contract > 0 ? (project.total_earned / project.total_contract) * 100 : 0;
  return {
    id: project.project_id,
    name: project.project_name,
    jobNumber: project.job_number,
    manager: project.project_manager,
    contract: project.total_contract,
    estCost,
    costToDate: project.total_cost,
    percentComplete,
    earned: project.total_earned,
    billed: project.total_billed,
    overUnder: project.total_over_under,
    backlog: project.total_contract - project.total_billed,
    estGrossProfit: project.estimated_gross_profit,
    partial: project.assessed_bucket_count < project.bucket_count,
  };
}

function buildCsv(rows: WipRow[], totals: PortfolioBillingSummary["totals"]): string {
  const header = [
    "Project",
    "Job #",
    "Project manager",
    "Contract",
    "Estimated cost",
    "Cost to date",
    "% complete",
    "Earned revenue",
    "Billed to date",
    "Over/(under) billed",
    "Backlog to bill",
    "Est. gross profit",
    "Earned coverage",
  ];
  const body = rows.map((row) =>
    [
      csvCell(row.name),
      csvCell(row.jobNumber || ""),
      csvCell(row.manager || ""),
      money2(row.contract),
      money2(row.estCost),
      money2(row.costToDate),
      row.percentComplete.toFixed(1),
      money2(row.earned),
      money2(row.billed),
      money2(row.overUnder),
      money2(row.backlog),
      money2(row.estGrossProfit),
      row.partial ? "Partial" : "Complete",
    ].join(","),
  );
  const totalPct =
    totals.total_contract > 0 ? (totals.total_earned / totals.total_contract) * 100 : 0;
  const totalsRow = [
    "TOTAL",
    "",
    "",
    money2(totals.total_contract),
    money2(totals.total_cost + totalsCostToComplete(totals)),
    money2(totals.total_cost),
    totalPct.toFixed(1),
    money2(totals.total_earned),
    money2(totals.total_billed),
    money2(totals.total_over_under),
    money2(totals.total_contract - totals.total_billed),
    money2(totals.estimated_gross_profit),
    "",
  ].join(",");
  return [header.map(csvCell).join(","), ...body, totalsRow].join("\n");
}

// The portfolio totals object does not carry cost-to-complete directly; recover
// it from the identity  est_gross_profit = contract − (cost + cost_to_complete).
function totalsCostToComplete(totals: PortfolioBillingSummary["totals"]): number {
  return totals.total_contract - totals.estimated_gross_profit - totals.total_cost;
}

// Over/(under) billed reads as a signed money figure with a plain-English tag,
// so no reader has to remember which sign means what.
function OverUnderCell({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) {
    return <span className="text-muted-foreground">In balance</span>;
  }
  const over = value > 0;
  // Overbilled draws the eye (billed ahead of earned — a borrowed position), so
  // it's amber. Underbilled is a normal asset position; keep it in the legible
  // default ink and let the "under" tag carry the meaning.
  return (
    <span className={over ? "text-warning" : "text-foreground"}>
      {fmtUSD(Math.abs(value))}
      <span className="ml-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        {over ? "over" : "under"}
      </span>
    </span>
  );
}

export function WipReport({ projects, totals, companyName, generatedOn }: WipReportProps) {
  const rows = useMemo(
    () => projects.map(toWipRow).sort((a, b) => a.name.localeCompare(b.name)),
    [projects],
  );
  const anyPartial = rows.some((row) => row.partial);
  const totalPercent =
    totals.total_contract > 0 ? (totals.total_earned / totals.total_contract) * 100 : 0;
  const totalEstCost = totals.total_cost + totalsCostToComplete(totals);
  const totalBacklog = totals.total_contract - totals.total_billed;

  const handleCsv = () => {
    const stamp = generatedOn.replace(/[^0-9]/g, "").slice(0, 8) || "current";
    downloadText(`wip-schedule-${stamp}.csv`, buildCsv(rows, totals), "text/csv;charset=utf-8");
  };

  return (
    <TooltipProvider delayDuration={150}>
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3" data-print-hide="false">
          <div>
            <h2 className="font-serif text-2xl text-foreground">Work-in-progress schedule</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Every active project's contract, cost, and billing position — including the
              over/under-billing a lender or bonding agent looks for first. Figures match the
              billing portfolio exactly.
            </p>
          </div>
          <div className="flex items-center gap-2" data-print-hide>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={handleCsv}>
              <Download className="h-3.5 w-3.5" /> Export CSV
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => window.print()}>
              <Printer className="h-3.5 w-3.5" /> Print / Save PDF
            </Button>
          </div>
        </div>

        {/* Print-only banner: identifies the report on paper where the app
            chrome is hidden. */}
        <div className="constructline-wip-print-head hidden">
          <div className="text-lg font-semibold">{companyName}</div>
          <div className="text-sm">Work-in-progress schedule · Generated {generatedOn}</div>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-hairline bg-surface p-8 text-center text-sm text-muted-foreground">
            No active projects to report yet. Once a project has a budget and billing, it appears on
            the WIP schedule.
          </div>
        ) : (
          <div className="constructline-wip-scroll overflow-x-auto rounded-lg border border-hairline bg-surface">
            <table className="constructline-wip-table w-full min-w-[1080px] border-collapse text-sm">
              <thead className="border-b border-hairline bg-surface-elevated">
                <tr>
                  <ColHead align="left">Project</ColHead>
                  <ColHead help="The revised contract value — original contract plus approved change orders.">
                    Contract
                  </ColHead>
                  <ColHead help="Actual cost booked against the job to date.">Cost to date</ColHead>
                  <ColHead help="Earned revenue ÷ contract. How far along the job is, weighted by dollars.">
                    % complete
                  </ColHead>
                  <ColHead help="Contract you've genuinely earned so far (percent complete × contract, assessed per cost code).">
                    Earned revenue
                  </ColHead>
                  <ColHead help="What you've actually invoiced the owner to date.">
                    Billed to date
                  </ColHead>
                  <ColHead help="Billed minus earned. Overbilled = you've invoiced ahead of the work; underbilled = you've earned more than you've billed.">
                    Over/(under) billed
                  </ColHead>
                  <ColHead help="Contract still left to bill (contract minus billed to date).">
                    Backlog to bill
                  </ColHead>
                  <ColHead help="Contract minus estimated total cost — the profit you expect if the job finishes on your current estimate.">
                    Est. gross profit
                  </ColHead>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-hairline/70 last:border-0">
                    <td className="px-3 py-2.5 text-left">
                      <div className="font-medium text-foreground">{row.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {[row.jobNumber ? `Job ${row.jobNumber}` : null, row.manager || null]
                          .filter(Boolean)
                          .join(" · ") || "—"}
                        {row.partial ? (
                          <span className="ml-1.5 rounded-sm bg-warning/10 px-1 py-0.5 text-[9px] font-medium uppercase tracking-wide text-warning">
                            partial*
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(row.contract)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(row.costToDate)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtPct(row.percentComplete)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(row.earned)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(row.billed)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      <OverUnderCell value={row.overUnder} />
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(row.backlog)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(row.estGrossProfit)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-hairline bg-surface-elevated font-semibold">
                  <td className="px-3 py-2.5 text-left text-foreground">
                    Portfolio total
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                      {rows.length} project{rows.length === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {fmtUSD(totals.total_contract)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {fmtUSD(totals.total_cost)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtPct(totalPercent)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {fmtUSD(totals.total_earned)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {fmtUSD(totals.total_billed)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    <OverUnderCell value={totals.total_over_under} />
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{fmtUSD(totalBacklog)}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {fmtUSD(totals.estimated_gross_profit)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          {anyPartial ? (
            <>
              <span className="font-medium text-warning">partial*</span> — earned revenue on these
              jobs covers only the cost codes that have a percent-complete assessment; the rest are
              excluded rather than guessed. Total estimated cost portfolio-wide:{" "}
              {fmtUSD(totalEstCost)}.
            </>
          ) : (
            <>Total estimated cost portfolio-wide: {fmtUSD(totalEstCost)}.</>
          )}
        </p>
      </section>
    </TooltipProvider>
  );
}
