import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { listPortfolioBilling, type PortfolioBillingProject } from "@/lib/billing.functions";
import { fmtPct, fmtUSD } from "@/lib/format";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  Clock3,
  ReceiptText,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/billing")({
  ssr: false,
  head: () => ({ meta: [{ title: "Billing — Overwatch" }] }),
  component: BillingPortfolioPage,
});

function BillingPortfolioPage() {
  const listBilling = useServerFn(listPortfolioBilling);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["portfolio-billing"],
    queryFn: () => listBilling(),
  });
  const projects = useMemo(() => data?.projects ?? [], [data?.projects]);
  const totals = data?.totals;
  const sortedProjects = useMemo(
    () =>
      [...projects].sort(
        (a, b) =>
          Math.abs(b.total_over_under) - Math.abs(a.total_over_under) ||
          b.open_receivable - a.open_receivable ||
          a.project_name.localeCompare(b.project_name),
      ),
    [projects],
  );
  const billingCalendarProjects = useMemo(
    () =>
      [...projects]
        .filter((project) => project.next_billing_date)
        .sort((a, b) => String(a.next_billing_date).localeCompare(String(b.next_billing_date)))
        .slice(0, 8),
    [projects],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-hairline bg-surface-elevated">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between px-6 py-6 lg:px-10">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              Overwatch
            </div>
            <h1 className="mt-1 font-serif text-3xl text-foreground">Billing</h1>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild size="sm" variant="outline">
              <Link to="/">Portfolio</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-6 px-6 py-10 lg:px-10">
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
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
              <BillingSummaryTile
                icon={<BriefcaseBusiness className="h-4 w-4" />}
                label="Projects"
                value={String(totals.project_count)}
                sub={`${fmtUSD(totals.total_contract)} contract`}
              />
              <BillingSummaryTile
                icon={<ReceiptText className="h-4 w-4" />}
                label="Open A/R"
                value={fmtUSD(totals.open_receivable)}
                sub={`${fmtUSD(totals.retainage_held)} retainage held`}
              />
              <BillingSummaryTile
                icon={<Banknote className="h-4 w-4" />}
                label="Cash 30 days"
                value={fmtUSD(totals.cash_collected_30_days)}
                sub={`${fmtUSD(totals.cash_position)} cash less cost`}
              />
              <BillingSummaryTile
                icon={
                  totals.total_over_under >= 0 ? (
                    <ArrowUpRight className="h-4 w-4" />
                  ) : (
                    <ArrowDownRight className="h-4 w-4" />
                  )
                }
                label="Net over / under"
                value={fmtUSD(totals.total_over_under)}
                sub={`${fmtUSD(totals.total_earned)} earned`}
                tone={totals.total_over_under > 0 ? "warning" : "success"}
              />
              <BillingSummaryTile
                icon={<Clock3 className="h-4 w-4" />}
                label="90+ A/R"
                value={fmtUSD(totals.aging.days_90)}
                sub={`${fmtUSD(totals.aging.days_60)} at 60 days`}
                tone={totals.aging.days_90 > 0 ? "danger" : "neutral"}
              />
              <BillingSummaryTile
                icon={<Banknote className="h-4 w-4" />}
                label="Est. GP"
                value={fmtUSD(totals.estimated_gross_profit)}
                sub={fmtPct(totals.gross_profit_pct)}
              />
            </div>

            <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
              <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    WIP schedule
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Earned revenue, billing position, cost, retainage, and cash by project.
                  </p>
                </div>
                <div className="text-sm tabular text-muted-foreground">
                  Current A/R {fmtUSD(totals.aging.current)} · 30 days{" "}
                  {fmtUSD(totals.aging.days_30)} · 60 days {fmtUSD(totals.aging.days_60)}
                </div>
              </div>
              <div className="space-y-3">
                {sortedProjects.length === 0 ? (
                  <div className="rounded-md border border-hairline bg-surface px-3 py-8 text-center text-sm text-muted-foreground">
                    No active projects are available for billing yet.
                  </div>
                ) : (
                  sortedProjects.map((project) => (
                    <BillingProjectCard key={project.project_id} project={project} />
                  ))
                )}
              </div>
            </section>

            <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
              <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
                <div className="mb-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    A/R aging
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Outstanding invoice balance by aging bucket across the portfolio.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <BillingSummaryTile
                    icon={<ReceiptText className="h-4 w-4" />}
                    label="Current"
                    value={fmtUSD(totals.aging.current)}
                    sub="Not yet past due"
                  />
                  <BillingSummaryTile
                    icon={<Clock3 className="h-4 w-4" />}
                    label="30 days"
                    value={fmtUSD(totals.aging.days_30)}
                    sub="Recently past due"
                    tone={totals.aging.days_30 > 0 ? "warning" : "neutral"}
                  />
                  <BillingSummaryTile
                    icon={<Clock3 className="h-4 w-4" />}
                    label="60 days"
                    value={fmtUSD(totals.aging.days_60)}
                    sub="Collection attention"
                    tone={totals.aging.days_60 > 0 ? "warning" : "neutral"}
                  />
                  <BillingSummaryTile
                    icon={<Clock3 className="h-4 w-4" />}
                    label="90+ days"
                    value={fmtUSD(totals.aging.days_90)}
                    sub="Escalate before next cycle"
                    tone={totals.aging.days_90 > 0 ? "danger" : "neutral"}
                  />
                </div>
              </section>

              <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
                <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Billing calendar
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Upcoming project billing dates from project settings.
                    </p>
                  </div>
                  <CalendarDays className="h-4 w-4 text-muted-foreground" />
                </div>
                {billingCalendarProjects.length === 0 ? (
                  <div className="rounded-md border border-hairline bg-surface px-3 py-8 text-center text-sm text-muted-foreground">
                    No next billing dates are set yet.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {billingCalendarProjects.map((project) => (
                      <div
                        key={project.project_id}
                        className="rounded-md border border-hairline bg-surface p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <Button
                              asChild
                              variant="link"
                              className="h-auto justify-start p-0 text-left font-medium"
                            >
                              <Link
                                to="/projects/$projectId"
                                params={{ projectId: project.project_id }}
                              >
                                {project.project_name}
                              </Link>
                            </Button>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {[project.job_number, project.client].filter(Boolean).join(" · ") ||
                                "No client set"}
                            </div>
                          </div>
                          <div className="rounded-md border border-hairline bg-card px-3 py-2 text-sm tabular">
                            {shortDate(project.next_billing_date)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function BillingProjectCard({ project }: { project: PortfolioBillingProject }) {
  const overUnderTone =
    project.total_over_under > 0
      ? "text-warning"
      : project.total_over_under < 0
        ? "text-success"
        : "";
  const oldestAr = project.aging.days_90 || project.aging.days_60 || project.aging.days_30;
  const agingLabel = project.aging.days_90
    ? "90+"
    : project.aging.days_60
      ? "60"
      : project.aging.days_30
        ? "30"
        : project.aging.current
          ? "Current"
          : "Clear";

  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <Button asChild variant="link" className="h-auto justify-start p-0 text-left font-medium">
            <Link to="/projects/$projectId" params={{ projectId: project.project_id }}>
              {project.project_name}
            </Link>
          </Button>
          <div className="mt-1 text-xs text-muted-foreground">
            {[project.job_number, project.client].filter(Boolean).join(" · ") || "No client set"}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            PM {project.project_manager || "Unassigned"} · Next bill{" "}
            {shortDate(project.next_billing_date)}
          </div>
        </div>
        <div
          className={`rounded-md border px-3 py-2 text-sm font-medium tabular ${
            project.total_over_under > 0
              ? "border-warning/30 bg-warning/10 text-warning"
              : project.total_over_under < 0
                ? "border-success/30 bg-success/10 text-success"
                : "border-hairline bg-card text-muted-foreground"
          }`}
        >
          {project.total_over_under > 0
            ? "Overbilled"
            : project.total_over_under < 0
              ? "Underbilled"
              : "Current"}{" "}
          {fmtUSD(Math.abs(project.total_over_under))}
        </div>
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
        <PortfolioDetail label="Contract" value={fmtUSD(project.total_contract)} />
        <PortfolioDetail label="Earned" value={fmtUSD(project.total_earned)} />
        <PortfolioDetail label="Billed" value={fmtUSD(project.total_billed)} />
        <PortfolioDetail
          label="Over / under"
          value={fmtUSD(project.total_over_under)}
          valueClassName={overUnderTone}
        />
        <PortfolioDetail label="Open A/R" value={fmtUSD(project.open_receivable)} />
        <PortfolioDetail label="Retainage" value={fmtUSD(project.total_retainage_net)} />
        <PortfolioDetail label="Cost" value={fmtUSD(project.total_cost)} />
        <PortfolioDetail
          label="Est. GP"
          value={`${fmtUSD(project.estimated_gross_profit)} · ${fmtPct(project.gross_profit_pct)}`}
        />
      </div>

      <div className="mt-3 rounded-md border border-hairline bg-card px-3 py-2 text-xs text-muted-foreground">
        Oldest A/R: <span className="font-medium tabular text-foreground">{fmtUSD(oldestAr)}</span>{" "}
        · {agingLabel} · {project.open_invoice_count} open of {project.invoice_count} invoices
      </div>
    </div>
  );
}

function PortfolioDetail({
  label,
  value,
  valueClassName = "",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-md border border-hairline bg-card px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-sm font-medium tabular text-foreground ${valueClassName}`}>
        {value}
      </div>
    </div>
  );
}

function BillingSummaryTile({
  icon,
  label,
  value,
  sub,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-muted-foreground";
  return (
    <div className="rounded-lg border border-hairline bg-card p-4 shadow-card">
      <div
        className={`flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] ${toneClass}`}
      >
        {icon}
        {label}
      </div>
      <div className="mt-3 text-2xl font-medium tabular text-foreground">{value}</div>
      <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

function shortDate(value: string | null) {
  if (!value) return "Not set";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
