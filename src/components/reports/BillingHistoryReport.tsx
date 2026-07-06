// The Billing history report — every requisition (pay application) on a job, in
// order: what was billed, retainage held, the running billed-to-date, and where
// payment stands. Reads the same billing_applications the project billing
// workspace does, so the history can never disagree with the project screen.
// Values are dollars.
import { useMemo, useState } from "react";
import { Download, Printer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import type {
  BillingHistoryEntry,
  BillingHistoryProject,
  BillingHistorySummary,
} from "@/lib/billing.functions";
import { fmtUSDCents as fmtUSD, formatBillingDate } from "@/lib/billing-format";
import { ColHead } from "@/components/reports/ColHead";
import { csvCell, downloadText, money2 } from "@/components/reports/reportFormat";

interface BillingHistoryReportProps {
  projects: BillingHistoryProject[];
  totals: BillingHistorySummary["totals"];
  companyName: string;
  generatedOn: string;
}

function statusLabel(status: string): string {
  if (!status) return "Draft";
  return status.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function statusToneClass(status: string): string {
  const s = status.toLowerCase();
  // Keep chip text in legible ink — the accent-*foreground* token is a pale
  // on-accent color that washes out on a light accent tint. The tinted
  // background carries the state; the text stays readable.
  if (s === "paid") return "bg-success/10 text-success";
  if (s === "approved" || s === "submitted") return "bg-accent/15 text-foreground";
  if (s === "void" || s === "rejected") return "bg-danger/10 text-danger";
  return "bg-muted text-muted-foreground";
}

function outputLabel(format: string): string {
  return format === "aia_g702" ? "AIA G702/G703" : "Invoice";
}

function buildCsv(project: BillingHistoryProject): string {
  const header = [
    "Application #",
    "Invoice #",
    "Format",
    "Submitted",
    "Billing period",
    "Billed this application",
    "Retainage held",
    "Billed to date",
    "Paid to date",
    "Status",
  ];
  const line = (entry: BillingHistoryEntry): string =>
    [
      csvCell(entry.application_number || ""),
      csvCell(entry.invoice_number || ""),
      csvCell(outputLabel(entry.output_format)),
      csvCell(entry.submitted_date || ""),
      csvCell(entry.billing_period || ""),
      money2(entry.amount_billed),
      money2(entry.retainage),
      money2(entry.billed_to_date),
      money2(entry.paid_to_date),
      csvCell(statusLabel(entry.status)),
    ].join(",");
  const totalsRow = [
    "TOTAL",
    "",
    "",
    "",
    "",
    money2(project.total_billed),
    money2(project.total_retainage),
    money2(project.total_billed),
    money2(project.total_paid),
    "",
  ].join(",");
  return [header.map(csvCell).join(","), ...project.entries.map(line), totalsRow].join("\n");
}

export function BillingHistoryReport({
  projects,
  totals,
  companyName,
  generatedOn,
}: BillingHistoryReportProps) {
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
    downloadText(
      `billing-history-${jobTag}-${stamp}.csv`,
      buildCsv(active),
      "text/csv;charset=utf-8",
    );
  };

  const entries = active?.entries ?? [];

  return (
    <TooltipProvider delayDuration={150}>
      <section className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl text-foreground">Billing history</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Every requisition billed on the job, in order — what you billed each period, retainage
              held, the running billed-to-date, and where payment stands. Matches the project's
              billing workspace exactly.
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
            <label htmlFor="billing-history-project" className="text-sm text-muted-foreground">
              Job
            </label>
            <select
              id="billing-history-project"
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
              {totals.project_count} job{totals.project_count === 1 ? "" : "s"} billed ·{" "}
              {totals.application_count} requisition{totals.application_count === 1 ? "" : "s"} ·
              billed to date {fmtUSD(totals.total_billed)}, paid {fmtUSD(totals.total_paid)}
            </span>
          </div>
        ) : null}

        {/* Print-only banner. */}
        <div className="constructline-wip-print-head hidden">
          <div className="text-lg font-semibold">{companyName}</div>
          <div className="text-sm">
            Billing history
            {active
              ? ` · ${active.project_name}${active.job_number ? ` (Job ${active.job_number})` : ""}`
              : ""}{" "}
            · Generated {generatedOn}
          </div>
        </div>

        {!active ? (
          <div className="rounded-lg border border-hairline bg-surface p-8 text-center text-sm text-muted-foreground">
            No billing yet across the portfolio. Once a job has a pay application, its history
            appears here.
          </div>
        ) : (
          <div className="constructline-wip-scroll overflow-x-auto rounded-lg border border-hairline bg-surface">
            <table className="constructline-wip-table w-full min-w-[1000px] border-collapse text-sm">
              <thead className="border-b border-hairline bg-surface-elevated">
                <tr>
                  <ColHead align="left">Application</ColHead>
                  <ColHead align="left">Submitted</ColHead>
                  <ColHead help="What you billed on this requisition (this period).">
                    Billed this app
                  </ColHead>
                  <ColHead help="Retainage withheld on this requisition.">Retainage held</ColHead>
                  <ColHead help="Cumulative billed through this requisition — the running total to date.">
                    Billed to date
                  </ColHead>
                  <ColHead help="Payments received against this requisition so far.">
                    Paid to date
                  </ColHead>
                  <ColHead align="left">Status</ColHead>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry, index) => (
                  <tr key={entry.id} className="border-b border-hairline/70 last:border-0">
                    <td className="px-3 py-2.5 text-left">
                      <div className="font-medium text-foreground">
                        {entry.application_number
                          ? `Application ${entry.application_number}`
                          : `Requisition ${index + 1}`}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        {[
                          entry.invoice_number ? `Invoice ${entry.invoice_number}` : null,
                          outputLabel(entry.output_format),
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-left">
                      <div className="text-foreground">
                        {formatBillingDate(entry.submitted_date)}
                      </div>
                      {entry.billing_period ? (
                        <div className="text-[11px] text-muted-foreground">
                          {entry.billing_period}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(entry.amount_billed)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {entry.retainage > 0 ? (
                        fmtUSD(entry.retainage)
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(entry.billed_to_date)}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">
                      {fmtUSD(entry.paid_to_date)}
                    </td>
                    <td className="px-3 py-2.5 text-left">
                      <span
                        className={`inline-flex rounded-sm px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${statusToneClass(
                          entry.status,
                        )}`}
                      >
                        {statusLabel(entry.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-hairline bg-surface-elevated font-semibold">
                  <td className="px-3 py-2.5 text-left text-foreground" colSpan={2}>
                    Job total
                    <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                      {entries.length} requisition{entries.length === 1 ? "" : "s"}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {fmtUSD(active.total_billed)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {fmtUSD(active.total_retainage)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {fmtUSD(active.total_billed)}
                  </td>
                  <td className="px-3 py-2.5 text-right tabular-nums">
                    {fmtUSD(active.total_paid)}
                  </td>
                  <td className="px-3 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        <p className="text-[11px] text-muted-foreground">
          Billed to date is the running sum of what you've billed through each requisition.
          Retainage held is what the owner is withholding until closeout.
        </p>
      </section>
    </TooltipProvider>
  );
}
