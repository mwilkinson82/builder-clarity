// Collections tab — "get paid": open A/R stats, the oldest-first worklist,
// the dark aging panel with the 30-day cash-in figure, and the full
// receivables cockpit (drill-down worklist, collections log, CO section,
// payment feed) below a muted divider.
//
// Honest deviations from the mock, per spec:
// - "Avg A/R age" replaces the mock's DSO tile — true bill->cash DSO is not
//   derivable from current data, so we show an open-A/R-weighted age instead.
// - No "Send reminder" / "Send all reminders" buttons — no send path exists.
import { Link } from "@tanstack/react-router";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import { billingDocumentLabel } from "@/lib/billing-labels";
import { daysOverdue, daysUntilDue, invoiceOpenBalanceCents } from "@/lib/receivables";
import type { ReceivableInvoiceRow } from "@/lib/receivables.functions";
import type { PortfolioBillingProject } from "@/lib/billing.functions";
import { ReceivablesCockpit } from "@/components/billing/ReceivablesCockpit";
import { MONO_LABEL, overdueTotal, type PortfolioBillingTotals } from "./portfolio-billing-shared";
import { StatTile } from "./PortfolioStatTiles";

const WORKLIST_CAP = 8;

// On-dark literals for the aging panel (documented in the reskin handoff mock;
// they only ever render on --dark-panel, so they are not themable tokens).
const DARK_BAR_COLORS = ["#4C8055", "#B7AE9E", "#C69A3C", "#B5432E"];
const DARK_VALUE_TINTS = ["#8FB89A", "", "#E6C877", "#EF9A88"];

export function CollectionsTab({
  totals,
  projects,
  openInvoices,
  cockpitLoading,
  cockpitError,
  today,
}: {
  totals: PortfolioBillingTotals;
  projects: PortfolioBillingProject[];
  openInvoices: ReceivableInvoiceRow[];
  cockpitLoading: boolean;
  cockpitError: boolean;
  today: string;
}) {
  const overdue = overdueTotal(totals.aging);
  const overduePct =
    totals.open_receivable > 0 ? Math.round((overdue / totals.open_receivable) * 100) : 0;
  const jobsWithAr = projects.filter((project) => project.open_receivable > 0).length;
  // Weighted open-A/R age: bucket midpoints (15/45/75/105 days) weighted by
  // bucket balance. An estimate by construction — the label says so.
  const avgArAgeDays =
    totals.open_receivable > 0
      ? Math.round(
          (totals.aging.current * 15 +
            totals.aging.days_30 * 45 +
            totals.aging.days_60 * 75 +
            totals.aging.days_90 * 105) /
            totals.open_receivable,
        )
      : 0;
  // Cash-in forecast: open invoices due inside 30 days plus everything
  // already overdue. Summed in integer cents (invoiceOpenBalanceCents).
  const cashIn30dCents = openInvoices.reduce((sum, invoice) => {
    const remaining = daysUntilDue(invoice.due_date, today);
    if (remaining === null || remaining > 30) return sum;
    return sum + invoiceOpenBalanceCents(invoice);
  }, 0);

  const agingBuckets = [
    { label: "Current", amount: totals.aging.current },
    { label: "30 days", amount: totals.aging.days_30 },
    { label: "60 days", amount: totals.aging.days_60 },
    { label: "90+ days", amount: totals.aging.days_90 },
  ];
  const agingTotal = agingBuckets.reduce((sum, bucket) => sum + bucket.amount, 0);

  const worklist = openInvoices.slice(0, WORKLIST_CAP);
  const worklistOverflow = openInvoices.length - worklist.length;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
        <StatTile
          label="Open A/R"
          value={fmtUSD(totals.open_receivable)}
          sub={`across ${jobsWithAr} job${jobsWithAr === 1 ? "" : "s"}`}
        />
        <StatTile
          label="Overdue"
          value={fmtUSD(overdue)}
          sub={`${overduePct}% of A/R`}
          tone="crit"
        />
        <StatTile
          label="90+ days"
          value={fmtUSD(totals.aging.days_90)}
          sub={totals.aging.days_90 > 0 ? "escalate now" : ""}
          tone="crit"
        />
        <StatTile
          label="Collected · 30d"
          value={fmtUSD(totals.cash_collected_30_days)}
          sub={`${fmtUSD(totals.cash_position)} cash less cost`}
          tone="good"
        />
        <StatTile label="Avg A/R age" value={`${avgArAgeDays} days`} sub="open A/R weighted" />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-[1.5fr_1fr]">
        {/* Collections worklist — oldest first, capped; the full list lives in
            the cockpit below. */}
        <section className="rounded-xl border border-hairline bg-card p-5">
          <div className="flex items-center gap-2.5">
            <div className={`${MONO_LABEL} text-muted-foreground`}>Collections worklist</div>
            <span className="text-[11px] text-muted-foreground">oldest first</span>
          </div>
          <div className="mt-2">
            {cockpitLoading ? (
              <div className="border-t border-hairline py-8 text-center text-sm text-muted-foreground">
                Loading open invoices...
              </div>
            ) : cockpitError ? (
              <div className="border-t border-hairline py-8 text-center text-sm text-muted-foreground">
                Open invoices did not load. Retry from the worklist detail below.
              </div>
            ) : worklist.length === 0 ? (
              <div className="border-t border-hairline py-8 text-center text-sm text-muted-foreground">
                No open invoices. Everything billed is collected.
              </div>
            ) : (
              <>
                {worklist.map((invoice) => (
                  <WorklistRow key={invoice.id} invoice={invoice} today={today} />
                ))}
                {worklistOverflow > 0 ? (
                  <div className="border-t border-hairline pt-3 text-[11.5px] text-muted-foreground">
                    +{worklistOverflow} more — open a project to work the rest
                  </div>
                ) : null}
              </>
            )}
          </div>
        </section>

        {/* A/R aging — the dark panel. */}
        <section className="rounded-xl bg-dark-panel p-5 text-dark-panel-foreground">
          <div
            className={`font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-dark-panel-foreground/60`}
          >
            A/R aging
          </div>
          {agingTotal <= 0 ? (
            <div className="mt-4 text-sm text-dark-panel-foreground/60">No open receivables</div>
          ) : (
            <>
              <div className="mt-3.5 flex h-3 gap-px overflow-hidden rounded-md">
                {agingBuckets.map((bucket, index) =>
                  bucket.amount > 0 ? (
                    <div
                      key={bucket.label}
                      // Proportional widths via flex-grow; the 2% floor keeps a
                      // nonzero bucket visible.
                      style={{
                        flexGrow: Math.max(bucket.amount, agingTotal * 0.02),
                        backgroundColor: DARK_BAR_COLORS[index],
                      }}
                    />
                  ) : null,
                )}
              </div>
              <div className="mt-3.5 flex flex-col gap-2.5">
                {agingBuckets.map((bucket, index) => (
                  <div
                    key={bucket.label}
                    className="flex items-center justify-between text-[12.5px] text-dark-panel-foreground/60"
                  >
                    <span>{bucket.label}</span>
                    <span
                      className="font-serif text-sm tabular text-dark-panel-foreground"
                      style={
                        DARK_VALUE_TINTS[index] ? { color: DARK_VALUE_TINTS[index] } : undefined
                      }
                    >
                      {fmtUSD(bucket.amount)}
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
          <div className="mt-4 border-t border-dark-panel-foreground/15 pt-3.5 text-[11.5px] text-dark-panel-foreground/60">
            Cash-in forecast · next 30d
            {cockpitLoading ? (
              <div className="mt-1 text-sm text-dark-panel-foreground/60">Loading invoices...</div>
            ) : cockpitError ? (
              <div className="mt-1 text-sm text-dark-panel-foreground/60">
                Unavailable until open invoices load
              </div>
            ) : (
              <div className="mt-1 font-serif text-[22px] tabular text-dark-panel-foreground">
                ≈ {fmtUSD(cashIn30dCents / 100)}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* The cockpit carries the drill-down worklist, collections log, CO
          section, and payment feed — the mock doesn't depict them, but the
          app must not lose them. */}
      <div className="flex items-center gap-3 pt-2">
        <div className="h-px flex-1 bg-hairline" />
        <span className={`${MONO_LABEL} text-muted-foreground`}>
          Worklist detail &amp; payment activity
        </span>
        <div className="h-px flex-1 bg-hairline" />
      </div>
      <ReceivablesCockpit />
    </div>
  );
}

function WorklistRow({ invoice, today }: { invoice: ReceivableInvoiceRow; today: string }) {
  const overdueDays = daysOverdue(invoice.due_date, today);
  const ageTone =
    overdueDays >= 90
      ? "text-danger"
      : overdueDays >= 30
        ? "text-warning"
        : "text-muted-foreground";
  return (
    <div className="grid items-center gap-x-3 gap-y-1 border-t border-hairline py-3 sm:grid-cols-[1.4fr_100px_90px_80px_auto]">
      <div className="min-w-0">
        <div className="truncate text-[13px] font-semibold text-foreground">
          {invoice.project_name}
        </div>
        <div className="text-[11px] text-muted-foreground">
          {billingDocumentLabel(invoice.invoice_number, invoice.title, "Invoice")}
        </div>
      </div>
      <span className="font-serif text-[15px] tabular sm:text-right">
        {fmtUSD(invoice.open_balance)}
      </span>
      <span className={`font-mono text-[10px] font-bold tabular sm:text-right ${ageTone}`}>
        {overdueDays} days
      </span>
      <span className="sm:text-right">
        {overdueDays >= 90 ? (
          <span className="rounded-[5px] border border-danger/40 px-1.5 py-0.5 text-[9px] font-bold text-danger">
            Escalate
          </span>
        ) : null}
      </span>
      <Link
        to="/projects/$projectId"
        params={{ projectId: invoice.project_id }}
        search={{ tab: "billing" }}
        className="justify-self-start rounded-lg border border-hairline px-2.5 py-1.5 text-center text-[11.5px] font-semibold text-foreground transition hover:border-foreground sm:justify-self-end"
      >
        Open project →
      </Link>
    </div>
  );
}
