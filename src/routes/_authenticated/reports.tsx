import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarChart3, ReceiptText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { listPortfolioBilling } from "@/lib/billing.functions";
import { getCompanyWorkspaceContext } from "@/lib/team.functions";
import { WipReport } from "@/components/reports/WipReport";

export const Route = createFileRoute("/_authenticated/reports")({
  ssr: false,
  head: () => ({ meta: [{ title: "Reports — Overwatch" }] }),
  component: ReportsPage,
});

// The standard accounting reports a builder expects from Procore / Sage /
// Buildertrend. The WIP schedule ships first; the rest of the suite is listed
// so the surface reads as a real reports hub, not a one-off — each is built on
// the same live billing data as it lands.
const REPORTS = [
  { key: "wip", label: "WIP schedule", blurb: "Contract vs cost vs billing", ready: true },
  { key: "job-cost", label: "Job cost", blurb: "Budget vs actual by cost code", ready: false },
  {
    key: "billing-history",
    label: "Billing history",
    blurb: "Every requisition, by project",
    ready: false,
  },
  {
    key: "retainage-co",
    label: "Retainage & change orders",
    blurb: "Held retainage + CO log",
    ready: false,
  },
] as const;

function ReportsPage() {
  const listBilling = useServerFn(listPortfolioBilling);
  const loadCompanyContext = useServerFn(getCompanyWorkspaceContext);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio-billing"],
    queryFn: () => listBilling(),
  });
  const { data: companyContext } = useQuery({
    queryKey: ["company-workspace-context"],
    queryFn: () => loadCompanyContext(),
  });
  const projects = useMemo(() => data?.projects ?? [], [data?.projects]);
  const totals = data?.totals;
  const companyName = companyContext?.name || "Company";
  const generatedOn = useMemo(
    () =>
      new Date().toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
      }),
    [],
  );

  return (
    <div className="constructline-reports-page min-h-screen bg-background text-foreground">
      <header className="border-b border-hairline bg-surface-elevated" data-print-hide>
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-6 py-6 lg:px-10">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              {companyName}
            </div>
            <h1 className="mt-1 font-serif text-3xl text-foreground">Reports</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Standard accounting reports across your portfolio — filterable, printable, and export
              to CSV.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline" className="gap-1.5">
              <Link to="/billing">
                <ReceiptText className="h-3.5 w-3.5" /> Billing
              </Link>
            </Button>
            <Button asChild size="sm" variant="outline">
              <Link to="/">Portfolio</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] gap-8 px-6 py-10 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:px-10">
        {/* Report rail — WIP is live; the rest of the suite is listed so the
            hub reads as complete-in-progress, not vaporware. */}
        <nav className="mb-6 lg:mb-0" data-print-hide aria-label="Reports">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Reports
          </div>
          <ul className="mt-3 space-y-1">
            {REPORTS.map((report) => (
              <li key={report.key}>
                <div
                  className={`rounded-md border px-3 py-2.5 ${
                    report.ready
                      ? "border-accent/40 bg-accent/10"
                      : "border-hairline bg-surface/60 opacity-70"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
                      <BarChart3 className="h-3.5 w-3.5 text-muted-foreground" />
                      {report.label}
                    </span>
                    {report.ready ? null : (
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Soon
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 pl-5 text-[11px] text-muted-foreground">
                    {report.blurb}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </nav>

        <div>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading reports...</p>
          ) : error ? (
            <div className="rounded-lg border border-danger/30 bg-danger/10 p-5">
              <div className="text-sm font-medium text-danger">Reports did not load</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Check the billing schema and try again."}
              </p>
              <Button size="sm" variant="outline" className="mt-4" onClick={() => refetch()}>
                Retry
              </Button>
            </div>
          ) : totals ? (
            <WipReport
              projects={projects}
              totals={totals}
              companyName={companyName}
              generatedOn={generatedOn}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}
