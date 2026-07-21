// Cash forecast tab — 13 weeks of expected cash in, the cash-relevant stat
// tiles, projects ranked by cash impact, and the billing calendar the
// forecast reads from.
//
// Honest deviation from the mock, per spec: the mock shows a net
// inflow-vs-outflow forecast. No payables timeline exists in the data, so
// this chart is INFLOW ONLY (open invoices by due date + scheduled billings)
// and the caption says so — we do not fabricate a net figure.
import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import { fmtPct } from "@/lib/format";
import { daysUntilDue, invoiceOpenBalanceCents } from "@/lib/receivables";
import type { ReceivableInvoiceRow } from "@/lib/receivables.functions";
import type { PortfolioBillingProject } from "@/lib/billing.functions";
import {
  gpTone,
  MONO_LABEL,
  overdueTotal,
  projectUnbilled,
  shortDate,
  type PortfolioBillingTotals,
} from "./portfolio-billing-shared";
import { MoneyCell, StatTile } from "./PortfolioStatTiles";

const WEEKS = 13;

// On-dark literal for the good-tinted sub inside the dark panel (documented
// in the reskin handoff mock; renders only on --dark-panel).
const DARK_GOOD_TINT = "#8FB89A";

// Week bucket from a date: overdue/past dates land in the current week
// (index 0); dates beyond the 13-week horizon are excluded.
function weekIndex(dateValue: string | null, today: string): number | null {
  const remaining = daysUntilDue(dateValue, today);
  if (remaining === null) return null;
  const index = remaining < 0 ? 0 : Math.floor(remaining / 7);
  return index < WEEKS ? index : null;
}

export function CashForecastTab({
  totals,
  projects,
  openInvoices,
  cockpitLoading,
  cockpitError,
  onCockpitRetry,
  today,
}: {
  totals: PortfolioBillingTotals;
  projects: PortfolioBillingProject[];
  openInvoices: ReceivableInvoiceRow[];
  cockpitLoading: boolean;
  cockpitError: string | null;
  onCockpitRetry: () => void;
  today: string;
}) {
  // Weekly inflow buckets: (a) open invoices by due date (cents-summed, then
  // dollars), (b) each project's unbilled amount in its next-billing week.
  const weeklyInflow = useMemo(() => {
    const invoiceCents = Array.from({ length: WEEKS }, () => 0);
    for (const invoice of openInvoices) {
      const index = weekIndex(invoice.due_date, today);
      if (index === null) continue;
      invoiceCents[index] += invoiceOpenBalanceCents(invoice);
    }
    const weeks = invoiceCents.map((cents) => cents / 100);
    for (const project of projects) {
      const unbilled = projectUnbilled(project);
      if (unbilled <= 0) continue;
      const index = weekIndex(project.next_billing_date, today);
      if (index === null) continue;
      weeks[index] += unbilled;
    }
    return weeks;
  }, [openInvoices, projects, today]);
  const totalInflow = weeklyInflow.reduce((sum, week) => sum + week, 0);
  const maxWeek = Math.max(...weeklyInflow);

  const overdue = overdueTotal(totals.aging);
  const cashImpactProjects = useMemo(
    () =>
      [...projects].sort(
        (a, b) =>
          b.open_receivable - a.open_receivable || a.project_name.localeCompare(b.project_name),
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

  // Open invoices are one of the two financial inputs to this forecast. Do
  // not render a plausible-looking partial total while that dependency is
  // loading or failed; a forecast must either be complete or say that it is
  // unavailable.
  if (cockpitLoading) {
    return (
      <div className="rounded-xl border border-hairline bg-card p-6 text-sm text-muted-foreground">
        Loading the complete cash forecast...
      </div>
    );
  }
  if (cockpitError) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/10 p-6">
        <div className="text-sm font-medium text-danger">Cash forecast did not load</div>
        <p className="mt-1 text-sm text-muted-foreground">{cockpitError}</p>
        <Button size="sm" variant="outline" className="mt-4" onClick={onCockpitRetry}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-[1.3fr_1fr]">
        {/* The 13-week dark panel. */}
        <section className="rounded-xl bg-dark-panel p-5 text-dark-panel-foreground lg:p-6">
          <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-dark-panel-foreground/60">
            13-week expected cash in
          </div>
          <div className="mt-2 flex flex-wrap items-baseline gap-x-3.5 gap-y-1">
            <span className="font-serif text-[34px] leading-none tabular text-dark-panel-foreground">
              ≈ {fmtUSD(totalInflow)}
            </span>
            <span className="text-[12.5px]" style={{ color: DARK_GOOD_TINT }}>
              expected in over 13 weeks
            </span>
          </div>
          <div className="mt-4 flex h-[90px] items-end gap-1.5">
            {weeklyInflow.map((amount, index) => {
              const heightPct =
                amount > 0 && maxWeek > 0 ? Math.max(4, (amount / maxWeek) * 100) : 0;
              return (
                <div
                  key={index}
                  className={`flex-1 rounded-t-[3px] ${
                    index === 0 ? "bg-accent" : "bg-dark-panel-foreground/20"
                  }`}
                  style={{ height: `${heightPct}%` }}
                  title={`Week ${index + 1}: ${fmtUSD(amount)}`}
                />
              );
            })}
          </div>
          <div className="mt-2.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-dark-panel-foreground/50">
            Open invoices by due date + scheduled billings · outflows not yet tracked
          </div>
        </section>

        <div className="flex flex-col gap-3">
          <StatTile
            label="Portfolio GP"
            value={fmtUSD(totals.estimated_gross_profit)}
            sub={`${fmtPct(totals.gross_profit_pct)} blended`}
            tone="good"
          />
          <StatTile
            label="A/R + retainage"
            value={fmtUSD(totals.open_receivable + totals.retainage_held)}
            sub={`${fmtUSD(totals.retainage_held)} retainage · future cash`}
          />
          <StatTile
            label="Overdue to chase"
            value={fmtUSD(overdue)}
            sub="collections"
            tone="crit"
          />
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-hairline bg-card">
        <div className="border-b border-hairline bg-secondary px-4 py-3.5">
          <div className={`${MONO_LABEL} text-muted-foreground`}>Projects · by cash impact</div>
        </div>
        {cashImpactProjects.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            No active projects are available for billing yet.
          </div>
        ) : (
          cashImpactProjects.map((project) => (
            <CashImpactRow key={project.project_id} project={project} />
          ))
        )}
      </section>

      {/* The schedule the forecast reads from — the mock omits it, but
          dropping it loses information. */}
      <section className="rounded-xl border border-hairline bg-card p-5">
        <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className={`${MONO_LABEL} text-muted-foreground`}>Billing calendar</div>
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
                        search={{ tab: "billing" }}
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
  );
}

// The worst true fact about a project's cash, in one muted phrase.
function cashNote(project: PortfolioBillingProject) {
  const overdueLate = project.aging.days_60 + project.aging.days_90;
  if (overdueLate > 0) return `Overdue ${fmtUSD(overdueLate)}`;
  if (project.total_over_under < 0) {
    return `Underbilled ${fmtUSD(Math.abs(project.total_over_under))}`;
  }
  if (project.total_retainage_net > 0) return `Retainage ${fmtUSD(project.total_retainage_net)}`;
  return "Healthy";
}

function CashImpactRow({ project }: { project: PortfolioBillingProject }) {
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.project_id }}
      search={{ tab: "billing" }}
      className="grid items-center gap-x-3.5 gap-y-2 border-t border-hairline px-4 py-3.5 transition first:border-t-0 hover:bg-secondary/50 md:grid-cols-[1.4fr_0.8fr_0.8fr_1.4fr_auto]"
    >
      <div className="min-w-0">
        <div className="truncate text-[13.5px] font-semibold text-foreground">
          {project.project_name}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {project.job_number ? `Job ${project.job_number}` : "No job number"}
        </div>
      </div>
      <MoneyCell
        label="Open A/R"
        value={fmtUSD(project.open_receivable)}
        valueClassName="text-[15px]"
      />
      <MoneyCell
        label="GP"
        value={fmtPct(project.gross_profit_pct)}
        valueClassName={`text-[15px] ${gpTone(project.gross_profit_pct)}`}
      />
      <div className="text-xs text-muted-foreground">{cashNote(project)}</div>
      <span className="text-[11.5px] font-semibold text-clay md:justify-self-end">Deep dive →</span>
    </Link>
  );
}
