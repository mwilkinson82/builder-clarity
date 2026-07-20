import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { BarChart3 } from "lucide-react";

import { PortfolioTopBar } from "@/components/layout/PortfolioTopBar";
import { Button } from "@/components/ui/button";
import {
  listPortfolioBilling,
  listPortfolioBillingHistory,
  listPortfolioChangeOrders,
  listPortfolioJobCost,
} from "@/lib/billing.functions";
import { getCompanyWorkspaceContext } from "@/lib/team.functions";
import { WipReport } from "@/components/reports/WipReport";
import { JobCostReport } from "@/components/reports/JobCostReport";
import { BillingHistoryReport } from "@/components/reports/BillingHistoryReport";
import { RetainageChangeOrderReport } from "@/components/reports/RetainageChangeOrderReport";
import { PortfolioProductionReport } from "@/components/reports/PortfolioProductionReport";
import { PortfolioProductionBenchmarks } from "@/components/reports/PortfolioProductionBenchmarks";
import { listPortfolioProduction } from "@/lib/portfolio-production.functions";

export const Route = createFileRoute("/_authenticated/reports")({
  ssr: false,
  head: () => ({ meta: [{ title: "Reports — Overwatch" }] }),
  component: ReportsPage,
});

type ReportKey =
  "production" | "production-benchmarks" | "wip" | "job-cost" | "billing-history" | "retainage-co";

// The standard accounting reports a builder expects from Procore / Sage /
// Buildertrend. WIP and job cost are live; the rest are listed so the surface
// reads as a real reports hub, not a one-off — each is built on the same live
// billing data as it lands.
const REPORTS: { key: ReportKey; label: string; blurb: string; ready: boolean }[] = [
  {
    key: "production",
    label: "Production intelligence",
    blurb: "Portfolio pace, trends, and project ranking",
    ready: true,
  },
  {
    key: "production-benchmarks",
    label: "Production benchmarks",
    blurb: "Field evidence for estimating and buyout",
    ready: true,
  },
  { key: "wip", label: "WIP schedule", blurb: "Contract vs cost vs billing", ready: true },
  { key: "job-cost", label: "Job cost", blurb: "Budget vs actual by cost code", ready: true },
  {
    key: "billing-history",
    label: "Billing history",
    blurb: "Every requisition, by project",
    ready: true,
  },
  {
    key: "retainage-co",
    label: "Retainage & change orders",
    blurb: "Held retainage + CO log",
    ready: true,
  },
];

function ReportsPage() {
  const [activeReport, setActiveReport] = useState<ReportKey>("production");
  const listBilling = useServerFn(listPortfolioBilling);
  const listJobCost = useServerFn(listPortfolioJobCost);
  const listBillingHistory = useServerFn(listPortfolioBillingHistory);
  const listChangeOrders = useServerFn(listPortfolioChangeOrders);
  const listProduction = useServerFn(listPortfolioProduction);
  const loadCompanyContext = useServerFn(getCompanyWorkspaceContext);

  const billingQuery = useQuery({
    queryKey: ["portfolio-billing"],
    queryFn: () => listBilling(),
    // The retainage & change-order report reuses the WIP engine's net retainage,
    // so it needs the billing data too.
    enabled: activeReport === "wip" || activeReport === "retainage-co",
  });
  const jobCostQuery = useQuery({
    queryKey: ["portfolio-job-cost"],
    queryFn: () => listJobCost(),
    enabled: activeReport === "job-cost",
  });
  const historyQuery = useQuery({
    queryKey: ["portfolio-billing-history"],
    queryFn: () => listBillingHistory(),
    enabled: activeReport === "billing-history",
  });
  const changeOrderQuery = useQuery({
    queryKey: ["portfolio-change-orders"],
    queryFn: () => listChangeOrders(),
    enabled: activeReport === "retainage-co",
  });
  const productionQuery = useQuery({
    queryKey: ["portfolio-production"],
    queryFn: () => listProduction(),
    enabled: activeReport === "production" || activeReport === "production-benchmarks",
  });
  const { data: companyContext } = useQuery({
    queryKey: ["company-workspace-context"],
    queryFn: () => loadCompanyContext(),
  });

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

  const activeQuery =
    activeReport === "production" || activeReport === "production-benchmarks"
      ? productionQuery
      : activeReport === "job-cost"
        ? jobCostQuery
        : activeReport === "billing-history"
          ? historyQuery
          : activeReport === "retainage-co"
            ? changeOrderQuery
            : billingQuery;

  // Retainage & change orders is a joined report. Treat both queries as one
  // dependency boundary so a successful CO read can never mask a failed
  // retainage read and silently substitute $0.
  const activeReportLoading =
    activeReport === "retainage-co"
      ? changeOrderQuery.isLoading || billingQuery.isLoading
      : activeQuery.isLoading;
  const activeReportError =
    activeReport === "retainage-co"
      ? changeOrderQuery.error || billingQuery.error
      : activeQuery.error;
  const retryActiveReport = () => {
    if (activeReport === "retainage-co") {
      void Promise.all([changeOrderQuery.refetch(), billingQuery.refetch()]);
      return;
    }
    void activeQuery.refetch();
  };

  // net retainage per project, reused from the WIP/billing engine so the
  // retainage report never disagrees with the WIP report.
  const retainageByProject = useMemo(() => {
    const map: Record<string, number> = {};
    for (const project of billingQuery.data?.projects ?? []) {
      map[project.project_id] = project.total_retainage_net;
    }
    return map;
  }, [billingQuery.data?.projects]);

  return (
    <div className="constructline-reports-page min-h-screen bg-background text-foreground">
      <div data-print-hide>
        <PortfolioTopBar active="reports" />
      </div>
      <header className="border-b border-hairline bg-surface-elevated" data-print-hide>
        <div className="mx-auto max-w-[1500px] px-6 py-6 lg:px-10">
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
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] gap-8 px-6 py-10 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:px-10">
        {/* Report rail — live reports are selectable; the rest are listed so the
            hub reads as complete-in-progress, not vaporware. */}
        <nav className="mb-6 lg:mb-0" data-print-hide aria-label="Reports">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Reports
          </div>
          <ul className="mt-3 space-y-1">
            {REPORTS.map((report) => {
              const isActive = report.ready && report.key === activeReport;
              const inner = (
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
              );
              return (
                <li key={report.key}>
                  {report.ready ? (
                    <button
                      type="button"
                      onClick={() => setActiveReport(report.key)}
                      aria-current={isActive ? "page" : undefined}
                      className={`w-full rounded-md border px-3 py-2.5 text-left transition ${
                        isActive
                          ? "border-accent/50 bg-accent/10"
                          : "border-hairline bg-surface/60 hover:border-accent/30 hover:bg-accent/5"
                      }`}
                    >
                      {inner}
                      <div className="mt-0.5 pl-5 text-[11px] text-muted-foreground">
                        {report.blurb}
                      </div>
                    </button>
                  ) : (
                    <div className="rounded-md border border-hairline bg-surface/60 px-3 py-2.5 opacity-70">
                      {inner}
                      <div className="mt-0.5 pl-5 text-[11px] text-muted-foreground">
                        {report.blurb}
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div>
          {activeReportLoading ? (
            <p className="text-sm text-muted-foreground">Loading report...</p>
          ) : activeReportError ? (
            <div className="rounded-lg border border-danger/30 bg-danger/10 p-5">
              <div className="text-sm font-medium text-danger">Report did not load</div>
              <p className="mt-1 text-sm text-muted-foreground">
                {activeReportError instanceof Error
                  ? activeReportError.message
                  : "Check the billing schema and try again."}
              </p>
              <Button size="sm" variant="outline" className="mt-4" onClick={retryActiveReport}>
                Retry
              </Button>
            </div>
          ) : activeReport === "production" ? (
            productionQuery.data ? (
              <PortfolioProductionReport
                projects={productionQuery.data.projects}
                rows={productionQuery.data.rows}
                loading={productionQuery.isLoading}
              />
            ) : null
          ) : activeReport === "production-benchmarks" ? (
            productionQuery.data ? (
              <PortfolioProductionBenchmarks
                projects={productionQuery.data.projects}
                rows={productionQuery.data.rows}
                loading={productionQuery.isLoading}
              />
            ) : null
          ) : activeReport === "job-cost" ? (
            jobCostQuery.data ? (
              <JobCostReport
                projects={jobCostQuery.data.projects}
                totals={jobCostQuery.data.totals}
                companyName={companyName}
                generatedOn={generatedOn}
              />
            ) : null
          ) : activeReport === "billing-history" ? (
            historyQuery.data ? (
              <BillingHistoryReport
                projects={historyQuery.data.projects}
                totals={historyQuery.data.totals}
                companyName={companyName}
                generatedOn={generatedOn}
              />
            ) : null
          ) : activeReport === "retainage-co" ? (
            changeOrderQuery.data && billingQuery.data ? (
              <RetainageChangeOrderReport
                projects={changeOrderQuery.data.projects}
                totals={changeOrderQuery.data.totals}
                retainageByProject={retainageByProject}
                portfolioRetainage={billingQuery.data.totals.retainage_held}
                companyName={companyName}
                generatedOn={generatedOn}
              />
            ) : null
          ) : billingQuery.data?.totals ? (
            <WipReport
              projects={billingQuery.data.projects}
              totals={billingQuery.data.totals}
              companyName={companyName}
              generatedOn={generatedOn}
            />
          ) : null}
        </div>
      </main>
    </div>
  );
}
