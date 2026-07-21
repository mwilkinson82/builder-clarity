// Portfolio Billing v2 — the three-tab notebook: Collections (get paid),
// Billing position (unbilled & over/under), Cash forecast (13-week inflow).
// Every figure binds live query data (listPortfolioBilling +
// getReceivablesCockpit); the tabs supersede the old single-scroll summary
// tiles and WIP-schedule card list, carrying every figure they showed.
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PortfolioTopBar } from "@/components/layout/PortfolioTopBar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { listPortfolioBilling } from "@/lib/billing.functions";
import { getReceivablesCockpit } from "@/lib/receivables.functions";
import { daysOverdue } from "@/lib/receivables";
import { StripeConnectNudge } from "@/components/billing/StripeConnectNudge";
import { CollectionsTab } from "@/components/billing/portfolio/CollectionsTab";
import { BillingPositionTab } from "@/components/billing/portfolio/BillingPositionTab";
import { CashForecastTab } from "@/components/billing/portfolio/CashForecastTab";
import { getCompanyWorkspaceContext } from "@/lib/team.functions";

export const Route = createFileRoute("/_authenticated/billing")({
  ssr: false,
  head: () => ({ meta: [{ title: "Billing — Overwatch" }] }),
  component: BillingPortfolioPage,
});

const NOTEBOOK_TABS = [
  { value: "collections", title: "Collections", sub: "Get paid · A/R & worklist" },
  { value: "position", title: "Billing position", sub: "Unbilled & over/under" },
  { value: "forecast", title: "Cash forecast", sub: "13-week inflow vs out" },
] as const;

function BillingPortfolioPage() {
  const listBilling = useServerFn(listPortfolioBilling);
  const loadCockpit = useServerFn(getReceivablesCockpit);
  const loadCompanyContext = useServerFn(getCompanyWorkspaceContext);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio-billing"],
    queryFn: () => listBilling(),
  });
  // Same key/fn as the company-mode ReceivablesCockpit inside the Collections
  // tab, so react-query dedupes this into one fetch.
  const cockpitQuery = useQuery({
    queryKey: ["receivables-cockpit", "company"],
    queryFn: () => loadCockpit({ data: {} }),
  });
  const { data: companyContext } = useQuery({
    queryKey: ["company-workspace-context"],
    queryFn: () => loadCompanyContext(),
  });
  const projects = useMemo(() => data?.projects ?? [], [data?.projects]);
  const totals = data?.totals;
  const companyName = companyContext?.name || "Company";
  // Stable "today" for the render pass; day math is calendar-date based.
  const [today] = useState(() => new Date().toISOString());
  // Open invoices, oldest first — the collections worklist order (same sort
  // as the cockpit's working list).
  const openInvoices = useMemo(
    () =>
      (cockpitQuery.data?.invoices ?? [])
        .filter((invoice) => invoice.status !== "draft" && invoice.open_balance > 0)
        .sort(
          (a, b) =>
            daysOverdue(b.due_date, today) - daysOverdue(a.due_date, today) ||
            b.open_balance - a.open_balance,
        ),
    [cockpitQuery.data?.invoices, today],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <PortfolioTopBar active="billing" />
      <header className="border-b border-hairline bg-surface-elevated">
        <div className="mx-auto max-w-[1500px] px-6 py-6 lg:px-10">
          <div>
            <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
              {companyName} · Portfolio
            </div>
            <h1 className="mt-1.5 font-serif text-3xl text-foreground">Portfolio Billing</h1>
            <p className="mt-1 max-w-[64ch] text-[13.5px] text-muted-foreground">
              Cash owed, revenue to capture, and the forecast — across every active job.
            </p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 px-6 py-8 lg:px-10">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading billing command center...</p>
        ) : error ? (
          <div className="rounded-lg border border-danger/30 bg-danger/10 p-5">
            <div className="text-sm font-medium text-danger">Billing did not load</div>
            <p className="mt-1 text-sm text-muted-foreground">
              {error instanceof Error ? error.message : "Check the billing schema and try again."}
            </p>
            <Button size="sm" variant="outline" className="mt-4" onClick={() => refetch()}>
              Retry
            </Button>
          </div>
        ) : totals ? (
          <>
            <StripeConnectNudge />
            <Tabs defaultValue="collections">
              {/* Folder-tab notebook per the v2 mock: active tab opens into
                  the bordered panel below it. */}
              <TabsList className="flex h-auto w-full items-stretch justify-start gap-2 rounded-none border-b border-hairline bg-transparent p-0">
                {NOTEBOOK_TABS.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="-mb-px flex-col items-start rounded-b-none rounded-t-[11px] border border-hairline bg-secondary px-4 py-3 text-left shadow-none data-[state=inactive]:mt-1.5 data-[state=inactive]:opacity-85 data-[state=active]:border-b-background data-[state=active]:bg-background data-[state=active]:shadow-none sm:px-5"
                  >
                    <span className="text-[13.5px] font-semibold leading-tight">{tab.title}</span>
                    <span className="mt-0.5 text-[10.5px] font-normal text-muted-foreground">
                      {tab.sub}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
              <div className="rounded-b-xl border border-t-0 border-hairline bg-background p-4 sm:p-6">
                <TabsContent value="collections" className="mt-0">
                  <CollectionsTab
                    totals={totals}
                    projects={projects}
                    openInvoices={openInvoices}
                    cockpitLoading={cockpitQuery.isLoading}
                    cockpitError={Boolean(cockpitQuery.error)}
                    today={today}
                  />
                </TabsContent>
                <TabsContent value="position" className="mt-0">
                  <BillingPositionTab totals={totals} projects={projects} today={today} />
                </TabsContent>
                <TabsContent value="forecast" className="mt-0">
                  <CashForecastTab
                    totals={totals}
                    projects={projects}
                    openInvoices={openInvoices}
                    cockpitLoading={cockpitQuery.isLoading}
                    cockpitError={
                      cockpitQuery.error instanceof Error
                        ? cockpitQuery.error.message
                        : cockpitQuery.error
                          ? "Open invoices did not load."
                          : null
                    }
                    onCockpitRetry={() => void cockpitQuery.refetch()}
                    today={today}
                  />
                </TabsContent>
              </div>
            </Tabs>
          </>
        ) : null}
      </main>
    </div>
  );
}
