// The Retainage & change orders report — per job: the original → approved →
// revised contract roll-up (so contract growth is auditable), the net retainage
// the owner is holding, and the full change-order log with contract and cost
// impact. Change-order and contract figures come from listPortfolioChangeOrders;
// net retainage is reused from the same WIP/billing engine the WIP report uses,
// so the two reports never disagree. Values are dollars.
import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  ChangeOrderEntry,
  ChangeOrderProject,
  ChangeOrderReportSummary,
} from "@/lib/billing.functions";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import { ColHead } from "@/components/reports/ColHead";
import { csvCell, downloadText, money2 } from "@/components/reports/reportFormat";

interface RetainageChangeOrderReportProps {
  projects: ChangeOrderProject[];
  totals: ChangeOrderReportSummary["totals"];
  // project_id -> net retainage held, from listPortfolioBilling (WIP engine).
  retainageByProject: Record<string, number>;
  portfolioRetainage: number;
  companyName: string;
  generatedOn: string;
}

function humanizeType(coType: string): string {
  if (!coType) return "";
  return coType.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusToneClass(status: string): string {
  const s = status.toLowerCase();
  if (s === "approved") return "bg-success/10 text-success";
  if (s === "denied") return "bg-danger/10 text-danger";
  // Pending: legible ink on an accent tint (the accent-foreground token is a
  // pale on-accent color that washes out on a light tint).
  return "bg-accent/15 text-foreground";
}

function buildCsv(project: ChangeOrderProject, retainageHeld: number): string {
  const header = ["CO #", "Description", "Type", "Contract impact", "Cost impact", "Status"];
  const body = project.change_orders.map((co) =>
    [
      csvCell(co.number || ""),
      csvCell(co.description || ""),
      csvCell(humanizeType(co.co_type)),
      money2(co.contract_amount),
      money2(co.cost_amount),
      csvCell(co.status),
    ].join(","),
  );
  const summary = [
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Original contract",
    money2(project.original_contract),
    "",
    "Approved change orders",
    money2(project.approved_contract),
    "",
    "Revised contract",
    money2(project.revised_contract),
    "",
    "Pending change orders",
    money2(project.pending_contract),
    "",
    "Net retainage held",
    money2(retainageHeld),
  ];
  return [
    header.map(csvCell).join(","),
    ...body,
    "",
    // Contract roll-up written as label,value pairs on trailing lines.
    summary.map(csvCell).join(","),
  ].join("\n");
}

function SummaryCard({
  label,
  value,
  sub,
  emphasis,
}: {
  label: string;
  value: string;
  sub?: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border px-4 py-3 ${
        emphasis ? "border-accent/40 bg-accent/5" : "border-hairline bg-surface"
      }`}
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-semibold tabular-nums text-foreground">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-muted-foreground">{sub}</div> : null}
    </div>
  );
}

function ImpactCell({ value }: { value: number }) {
  if (Math.abs(value) < 0.005) return <span className="text-muted-foreground">—</span>;
  // Deductive change orders (credits back to the owner) read in the warning
  // tone; additive ones stay in default ink.
  return (
    <span className={value < 0 ? "text-warning" : "text-foreground"}>
      {fmtUSD(value, { sign: true })}
    </span>
  );
}

export function RetainageChangeOrderReport({
  projects,
  totals,
  retainageByProject,
  portfolioRetainage,
  companyName,
  generatedOn,
}: RetainageChangeOrderReportProps) {
  const sortedProjects = useMemo(
    () => [...projects].sort((a, b) => a.project_name.localeCompare(b.project_name)),
    [projects],
  );
  const [selectedId, setSelectedId] = useState<string>(() => sortedProjects[0]?.project_id ?? "");
  const active =
    sortedProjects.find((project) => project.project_id === selectedId) ?? sortedProjects[0];
  const retainageHeld = active ? (retainageByProject[active.project_id] ?? 0) : 0;

  const handleCsv = () => {
    if (!active) return;
    const stamp = generatedOn.replace(/[^0-9]/g, "").slice(0, 8) || "current";
    const jobTag = (active.job_number || active.project_name).replace(/[^a-zA-Z0-9]+/g, "-");
    downloadText(
      `change-orders-${jobTag}-${stamp}.csv`,
      buildCsv(active, retainageHeld),
      "text/csv;charset=utf-8",
    );
  };

  const changeOrders: ChangeOrderEntry[] = active?.change_orders ?? [];

  return (
    <TooltipProvider delayDuration={150}>
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl text-foreground">Retainage &amp; change orders</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              How the contract has grown from original to revised, the retainage the owner is
              holding, and every change order with its contract and cost impact. Contract and
              retainage figures match the project's billing exactly.
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

        {sortedProjects.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2" data-print-hide>
            <label htmlFor="change-order-project" className="text-sm text-muted-foreground">
              Job
            </label>
            <select
              id="change-order-project"
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
              {totals.project_count} job{totals.project_count === 1 ? "" : "s"} with change orders ·
              approved {fmtUSD(totals.approved_contract)} · net retainage held{" "}
              {fmtUSD(portfolioRetainage)} (portfolio)
            </span>
          </div>
        ) : null}

        {/* Print-only banner. */}
        <div className="constructline-wip-print-head hidden">
          <div className="text-lg font-semibold">{companyName}</div>
          <div className="text-sm">
            Retainage &amp; change orders
            {active
              ? ` · ${active.project_name}${active.job_number ? ` (Job ${active.job_number})` : ""}`
              : ""}{" "}
            · Generated {generatedOn}
          </div>
        </div>

        {!active ? (
          <div className="rounded-lg border border-hairline bg-surface p-8 text-center text-sm text-muted-foreground">
            No change orders across the portfolio yet. Once a job has a change order, it appears
            here.
          </div>
        ) : (
          <>
            {/* Contract roll-up: original → approved → revised, plus retainage. */}
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <SummaryCard label="Original contract" value={fmtUSD(active.original_contract)} />
              <SummaryCard
                label="Approved change orders"
                value={fmtUSD(active.approved_contract, { sign: true })}
                sub={
                  active.pending_contract > 0
                    ? `${fmtUSD(active.pending_contract)} pending`
                    : undefined
                }
              />
              <SummaryCard
                label="Revised contract"
                value={fmtUSD(active.revised_contract)}
                sub="Original + approved"
                emphasis
              />
              <SummaryCard
                label="Net retainage held"
                value={fmtUSD(retainageHeld)}
                sub="Owner is withholding"
              />
            </div>

            <div className="constructline-wip-scroll overflow-x-auto rounded-lg border border-hairline bg-surface">
              <table className="constructline-wip-table w-full min-w-[900px] border-collapse text-sm">
                <thead className="border-b border-hairline bg-surface-elevated">
                  <tr>
                    <ColHead align="left">Change order</ColHead>
                    <ColHead align="left">Description</ColHead>
                    <ColHead help="How much this change order adds to (or deducts from) the contract you bill the owner.">
                      Contract impact
                    </ColHead>
                    <ColHead help="The expected cost of the work in this change order.">
                      Cost impact
                    </ColHead>
                    <ColHead align="left">Status</ColHead>
                  </tr>
                </thead>
                <tbody>
                  {changeOrders.map((co, index) => (
                    <tr key={co.id || index} className="border-b border-hairline/70 last:border-0">
                      <td className="px-3 py-2.5 text-left">
                        <div className="font-medium text-foreground">
                          {co.number ? `CO ${co.number}` : `Change order ${index + 1}`}
                        </div>
                        {co.co_type ? (
                          <div className="text-[11px] text-muted-foreground">
                            {humanizeType(co.co_type)}
                          </div>
                        ) : null}
                      </td>
                      <td className="max-w-[360px] px-3 py-2.5 text-left text-foreground">
                        {co.description || <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <ImpactCell value={co.contract_amount} />
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        <ImpactCell value={co.cost_amount} />
                      </td>
                      <td className="px-3 py-2.5 text-left">
                        <span
                          className={`inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusToneClass(
                            co.status,
                          )}`}
                        >
                          {co.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-hairline bg-surface-elevated font-semibold">
                    <td className="px-3 py-2.5 text-left text-foreground" colSpan={2}>
                      Approved total
                      <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                        {changeOrders.length} change order{changeOrders.length === 1 ? "" : "s"}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(active.approved_contract, { sign: true })}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums" />
                    <td className="px-3 py-2.5" />
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}

        <p className="text-[11px] text-muted-foreground">
          Only approved change orders move the revised contract; pending ones are shown for
          awareness. Net retainage held is what the owner is withholding until closeout, from the
          same billing figures as the WIP report.
        </p>
      </section>
    </TooltipProvider>
  );
}
