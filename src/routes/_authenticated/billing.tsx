import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { listPortfolioBilling, type PortfolioBillingProject } from "@/lib/billing.functions";
import { fmtPct, fmtUSD } from "@/lib/format";
import {
  ArrowDownRight,
  ArrowUpRight,
  Banknote,
  BriefcaseBusiness,
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
  const projects = data?.projects ?? [];
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
              <div className="overflow-x-auto rounded-md border border-hairline">
                <Table className="min-w-[1500px]">
                  <TableHeader>
                    <TableRow className="bg-surface text-[10px] uppercase tracking-[0.12em]">
                      <TableHead>Project</TableHead>
                      <TableHead>PM</TableHead>
                      <TableHead className="text-right">Contract</TableHead>
                      <TableHead className="text-right">Earned</TableHead>
                      <TableHead className="text-right">Billed</TableHead>
                      <TableHead className="text-right">Over / under</TableHead>
                      <TableHead className="text-right">Open A/R</TableHead>
                      <TableHead className="text-right">Retainage</TableHead>
                      <TableHead className="text-right">Cost</TableHead>
                      <TableHead className="text-right">Est. GP</TableHead>
                      <TableHead className="text-right">Aging</TableHead>
                      <TableHead>Next bill</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedProjects.length === 0 ? (
                      <TableRow>
                        <TableCell
                          colSpan={12}
                          className="py-9 text-center text-sm text-muted-foreground"
                        >
                          No active projects are available for billing yet.
                        </TableCell>
                      </TableRow>
                    ) : (
                      sortedProjects.map((project) => (
                        <BillingProjectRow key={project.project_id} project={project} />
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}

function BillingProjectRow({ project }: { project: PortfolioBillingProject }) {
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
    <TableRow>
      <TableCell>
        <Button asChild variant="link" className="h-auto justify-start p-0 text-left font-medium">
          <Link to="/projects/$projectId" params={{ projectId: project.project_id }}>
            {project.project_name}
          </Link>
        </Button>
        <div className="text-xs text-muted-foreground">
          {[project.job_number, project.client].filter(Boolean).join(" · ") || "No client set"}
        </div>
      </TableCell>
      <TableCell className="text-muted-foreground">
        {project.project_manager || "Unassigned"}
      </TableCell>
      <TableCell className="text-right tabular">{fmtUSD(project.total_contract)}</TableCell>
      <TableCell className="text-right tabular">{fmtUSD(project.total_earned)}</TableCell>
      <TableCell className="text-right tabular">{fmtUSD(project.total_billed)}</TableCell>
      <TableCell className={`text-right tabular ${overUnderTone}`}>
        {fmtUSD(project.total_over_under)}
      </TableCell>
      <TableCell className="text-right tabular">{fmtUSD(project.open_receivable)}</TableCell>
      <TableCell className="text-right tabular">{fmtUSD(project.total_retainage_net)}</TableCell>
      <TableCell className="text-right tabular">{fmtUSD(project.total_cost)}</TableCell>
      <TableCell className="text-right tabular">
        {fmtUSD(project.estimated_gross_profit)}
        <div className="text-[11px] text-muted-foreground">{fmtPct(project.gross_profit_pct)}</div>
      </TableCell>
      <TableCell className="text-right tabular">
        {fmtUSD(oldestAr)}
        <div className="text-[11px] text-muted-foreground">{agingLabel}</div>
      </TableCell>
      <TableCell className="whitespace-nowrap text-muted-foreground">
        {shortDate(project.next_billing_date)}
      </TableCell>
    </TableRow>
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
