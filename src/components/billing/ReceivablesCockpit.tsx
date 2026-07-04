// The receivables cockpit (GETTINGPAID1 Task 0/2): the biller's working
// view. Open invoices with the number that runs her day (days until due /
// DAYS OVERDUE), aging buckets that filter the list, the sent -> viewed ->
// paid status chain, collections cues with a plain-text activity log, the
// payment activity feed, and approved change orders carried with their own
// billed percent.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Eye,
  Mail,
  PhoneCall,
  ReceiptText,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { fmtUSDCents } from "@/lib/billing-format";
import { billingDocumentLabel } from "@/lib/billing-labels";
import {
  appendInvoiceCollectionsNote,
  getReceivablesCockpit,
  type CockpitChangeOrder,
  type ReceivableInvoiceRow,
} from "@/lib/receivables.functions";
import {
  agingBucketTotals,
  collectionsFlag,
  daysOverdue,
  daysUntilDue,
  receivableAgingBucket,
  type ReceivableAgingBucket,
} from "@/lib/receivables";

export const BILLING_FEED_SEEN_KEY = "overwatch.billing.feed-seen-at";

function markFeedSeen(latestPaidAtIso: string | null) {
  if (!latestPaidAtIso) return;
  try {
    const current = window.localStorage.getItem(BILLING_FEED_SEEN_KEY) ?? "";
    if (latestPaidAtIso > current) {
      window.localStorage.setItem(BILLING_FEED_SEEN_KEY, latestPaidAtIso);
    }
  } catch {
    // Private mode: the unread badge simply stays conservative.
  }
}

const shortDate = (value: string | null) => {
  if (!value) return "-";
  const date = value.includes("T") ? new Date(value) : new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
};

function paymentMethodLabel(method: string, processor: string) {
  if (processor === "stripe") {
    if (method === "stripe_checkout" || method === "card") return "card";
    if (method === "ach" || method === "ach_debit") return "bank debit";
    return "Stripe";
  }
  return method || "manual";
}

// The number that runs the biller's day.
function DueCountdown({ dueDate, today }: { dueDate: string | null; today: string }) {
  const remaining = daysUntilDue(dueDate, today);
  if (remaining === null) {
    return <span className="text-sm text-muted-foreground">No due date</span>;
  }
  if (remaining < 0) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-danger/40 bg-danger/10 px-2.5 py-1 text-sm font-bold uppercase tracking-wide text-danger">
        <AlertTriangle className="h-3.5 w-3.5" />
        {Math.abs(remaining)} day{Math.abs(remaining) === 1 ? "" : "s"} overdue
      </span>
    );
  }
  if (remaining === 0) {
    return (
      <span className="rounded-md border border-warning/40 bg-warning/10 px-2.5 py-1 text-sm font-semibold text-warning">
        Due today
      </span>
    );
  }
  return (
    <span className="text-sm font-medium tabular text-foreground">
      Due in {remaining} day{remaining === 1 ? "" : "s"}
    </span>
  );
}

// Sent (when, to whom) -> viewed (portal open) -> paid (when, how, reference).
function StatusChain({ invoice }: { invoice: ReceivableInvoiceRow }) {
  const parts: Array<{ icon: React.ReactNode; label: string; tone?: string }> = [];
  if (invoice.sent_at) {
    const recipients = invoice.sent_recipients.length
      ? ` to ${invoice.sent_recipients.join(", ")}`
      : invoice.client_recipients.length
        ? ` to ${invoice.client_recipients.join(", ")}`
        : "";
    parts.push({
      icon: <Mail className="h-3 w-3" />,
      label: `Sent ${shortDate(invoice.sent_at)}${recipients}`,
    });
  } else {
    parts.push({ icon: <Mail className="h-3 w-3" />, label: "Not sent yet" });
  }
  if (invoice.first_viewed_at) {
    parts.push({
      icon: <Eye className="h-3 w-3" />,
      label: `Viewed ${shortDate(invoice.last_viewed_at ?? invoice.first_viewed_at)}${
        invoice.view_count > 1 ? ` (${invoice.view_count}x)` : ""
      }`,
      tone: "text-success",
    });
  }
  if (invoice.paid_at || invoice.last_payment) {
    const payment = invoice.last_payment;
    parts.push({
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: payment
        ? `Paid ${shortDate(payment.paid_at)} · ${paymentMethodLabel(payment.method, payment.processor)}${payment.reference ? ` · ${payment.reference}` : ""}`
        : `Paid ${shortDate(invoice.paid_at)}`,
      tone: "text-success",
    });
  } else if (invoice.paid_amount > 0) {
    parts.push({
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: `Partially paid ${fmtUSDCents(invoice.paid_amount)}`,
    });
  }
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
      {parts.map((part, index) => (
        <span key={index} className={`inline-flex items-center gap-1 ${part.tone ?? ""}`}>
          {part.icon}
          {part.label}
        </span>
      ))}
    </div>
  );
}

function CollectionsLog({
  invoice,
  onAppend,
  appending,
}: {
  invoice: ReceivableInvoiceRow;
  onAppend: (note: string) => void;
  appending: boolean;
}) {
  const [note, setNote] = useState("");
  const entries = invoice.collections_log.split("\n").filter(Boolean);
  const submit = () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    onAppend(trimmed);
    setNote("");
  };
  return (
    <div className="mt-2 rounded-md border border-hairline bg-card p-2.5">
      <div className="flex gap-2">
        <Input
          value={note}
          placeholder="Log collection activity (called, promised payment, ...)"
          className="h-8 text-xs"
          onChange={(event) => setNote(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") submit();
          }}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8"
          disabled={appending || !note.trim()}
          onClick={submit}
        >
          {appending ? "Logging..." : "Log"}
        </Button>
      </div>
      {entries.length > 0 ? (
        <div className="mt-2 space-y-1 text-[11px] text-muted-foreground">
          {entries.slice(0, 5).map((entry, index) => (
            <div key={index}>{entry}</div>
          ))}
          {entries.length > 5 ? <div>… {entries.length - 5} earlier entries</div> : null}
        </div>
      ) : null}
    </div>
  );
}

function ChangeOrderSection({ changeOrders }: { changeOrders: CockpitChangeOrder[] }) {
  if (changeOrders.length === 0) return null;
  return (
    <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Approved change orders in billing
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Each approved change order bills through the SOV lines it is allocated to and carries that
        line's completed percent.
      </p>
      <div className="mt-3 space-y-2">
        {changeOrders.map((co) => (
          <div key={co.id} className="rounded-md border border-hairline bg-surface p-3">
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <div className="text-sm font-medium text-foreground">
                  {co.number} · {co.project_name}
                </div>
                {co.description ? (
                  <div className="mt-0.5 truncate text-xs text-muted-foreground">
                    {co.description}
                  </div>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular text-muted-foreground">
                <span>Value {fmtUSDCents(co.value)}</span>
                <span>Billed {fmtUSDCents(co.billed)}</span>
                <span>Remaining {fmtUSDCents(co.remaining)}</span>
              </div>
            </div>
            {co.unallocated ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-xs text-warning">
                <span>
                  {co.number} approved {fmtUSDCents(co.value)} — allocate{" "}
                  {fmtUSDCents(Math.max(0, co.value - co.allocated))} to a cost code to bill it.
                </span>
                <Button asChild size="sm" variant="outline" className="h-7 text-xs">
                  <Link
                    to="/projects/$projectId"
                    params={{ projectId: co.project_id }}
                    search={{ tab: "change-orders" }}
                  >
                    Allocate
                  </Link>
                </Button>
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

export function ReceivablesCockpit({
  projectId,
  showProjectColumn = true,
}: {
  projectId?: string;
  showProjectColumn?: boolean;
}) {
  const queryClient = useQueryClient();
  const loadCockpit = useServerFn(getReceivablesCockpit);
  const appendNote = useServerFn(appendInvoiceCollectionsNote);
  const cockpitQuery = useQuery({
    queryKey: ["receivables-cockpit", projectId ?? "company"],
    queryFn: () => loadCockpit({ data: projectId ? { projectId } : {} }),
  });
  const [bucketFilter, setBucketFilter] = useState<ReceivableAgingBucket | "all">("all");
  const [openLogInvoiceId, setOpenLogInvoiceId] = useState<string | null>(null);
  const [appendingInvoiceId, setAppendingInvoiceId] = useState<string | null>(null);

  const noteMutation = useMutation({
    mutationFn: (input: { invoiceId: string; note: string }) => appendNote({ data: input }),
    onMutate: (input) => setAppendingInvoiceId(input.invoiceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["receivables-cockpit"] });
      toast.success("Collection note logged");
    },
    onError: (error) => {
      toast.error("Note did not save", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    },
    onSettled: () => setAppendingInvoiceId(null),
  });

  // Stable "today" for the render pass; day math is calendar-date based.
  const [today] = useState(() => new Date().toISOString());
  const data = cockpitQuery.data;
  const openInvoices = useMemo(
    () =>
      (data?.invoices ?? [])
        .filter((invoice) => invoice.status !== "draft" && invoice.open_balance > 0)
        .sort(
          (a, b) =>
            daysOverdue(b.due_date, today) - daysOverdue(a.due_date, today) ||
            b.open_balance - a.open_balance,
        ),
    [data?.invoices, today],
  );
  const buckets = useMemo(() => agingBucketTotals(openInvoices, today), [openInvoices, today]);
  const filteredInvoices =
    bucketFilter === "all"
      ? openInvoices
      : openInvoices.filter(
          (invoice) => receivableAgingBucket(daysOverdue(invoice.due_date, today)) === bucketFilter,
        );
  const feed = data?.feed ?? [];
  // Opening the cockpit consumes the unread badge: everything up to the
  // newest feed entry counts as seen.
  const latestFeedIso = feed.length > 0 ? feed[0].paid_at : null;
  useEffect(() => markFeedSeen(latestFeedIso), [latestFeedIso]);

  if (cockpitQuery.isLoading) {
    return (
      <div className="rounded-lg border border-hairline bg-card p-5 text-sm text-muted-foreground shadow-card">
        Loading receivables...
      </div>
    );
  }
  if (cockpitQuery.error || !data) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/10 p-5 text-sm text-danger">
        Receivables did not load.{" "}
        {cockpitQuery.error instanceof Error ? cockpitQuery.error.message : "Try again."}
      </div>
    );
  }

  const totalOpen = buckets.reduce((sum, bucket) => sum + bucket.openBalance, 0);

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Receivables
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Every open invoice, aged. Click a bucket to filter; the collections flag appears{" "}
              {data.collectionsOverdueDays} days past due.
            </p>
          </div>
          <div className="text-sm tabular text-muted-foreground">
            Open {fmtUSDCents(totalOpen)} across {openInvoices.length} invoice
            {openInvoices.length === 1 ? "" : "s"}
          </div>
        </div>

        {/* Aging buckets: summary cards that filter the list. */}
        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-6">
          <button
            type="button"
            onClick={() => setBucketFilter("all")}
            className={`rounded-md border px-3 py-2 text-left transition ${
              bucketFilter === "all"
                ? "border-foreground bg-foreground text-background"
                : "border-hairline bg-surface hover:border-foreground"
            }`}
          >
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">
              All open
            </div>
            <div className="mt-1 text-sm font-semibold tabular">{fmtUSDCents(totalOpen)}</div>
          </button>
          {buckets.map((bucket) => {
            const active = bucketFilter === bucket.bucket;
            const overdueTone =
              bucket.bucket !== "current" && bucket.openBalance > 0 && !active
                ? bucket.bucket === "days_90_plus" || bucket.bucket === "days_61_90"
                  ? "text-danger"
                  : "text-warning"
                : "";
            return (
              <button
                key={bucket.bucket}
                type="button"
                onClick={() => setBucketFilter(active ? "all" : bucket.bucket)}
                className={`rounded-md border px-3 py-2 text-left transition ${
                  active
                    ? "border-foreground bg-foreground text-background"
                    : "border-hairline bg-surface hover:border-foreground"
                }`}
              >
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] opacity-70">
                  {bucket.label}
                </div>
                <div className={`mt-1 text-sm font-semibold tabular ${overdueTone}`}>
                  {fmtUSDCents(bucket.openBalance)}
                </div>
                <div className="text-[10px] opacity-70">
                  {bucket.count} invoice{bucket.count === 1 ? "" : "s"}
                </div>
              </button>
            );
          })}
        </div>

        {/* The working list. */}
        <div className="mt-4 space-y-2">
          {filteredInvoices.length === 0 ? (
            <div className="rounded-md border border-hairline bg-surface px-3 py-8 text-center text-sm text-muted-foreground">
              {openInvoices.length === 0
                ? "No open invoices. Everything billed is collected."
                : "No open invoices in this aging bucket."}
            </div>
          ) : (
            filteredInvoices.map((invoice) => {
              const overdue = daysOverdue(invoice.due_date, today);
              const flagCollections = collectionsFlag(overdue, data.collectionsOverdueDays);
              const logOpen = openLogInvoiceId === invoice.id;
              return (
                <div
                  key={invoice.id}
                  className={`rounded-md border p-3 ${
                    flagCollections ? "border-danger/30 bg-danger/5" : "border-hairline bg-surface"
                  }`}
                >
                  <div className="flex flex-col gap-2 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to="/projects/$projectId"
                          params={{ projectId: invoice.project_id }}
                          search={{ tab: "billing" }}
                          className="text-sm font-medium text-foreground hover:underline"
                        >
                          {billingDocumentLabel(invoice.invoice_number, invoice.title, "Invoice")}
                        </Link>
                        {showProjectColumn ? (
                          <span className="text-xs text-muted-foreground">
                            {invoice.project_name}
                          </span>
                        ) : null}
                        {flagCollections ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-danger/40 bg-danger/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-danger">
                            <PhoneCall className="h-3 w-3" /> Start collections
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1.5">
                        <StatusChain invoice={invoice} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 xl:justify-end">
                      <div className="text-xs tabular text-muted-foreground">
                        <span className="text-foreground">{fmtUSDCents(invoice.total_due)}</span>{" "}
                        billed · {fmtUSDCents(invoice.paid_amount)} paid ·{" "}
                        <span className="font-semibold text-foreground">
                          {fmtUSDCents(invoice.open_balance)} open
                        </span>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Due {shortDate(invoice.due_date)}
                      </div>
                      <DueCountdown dueDate={invoice.due_date} today={today} />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={() => setOpenLogInvoiceId(logOpen ? null : invoice.id)}
                      >
                        {logOpen
                          ? "Hide log"
                          : invoice.collections_log
                            ? "Collections log"
                            : "Log activity"}
                      </Button>
                    </div>
                  </div>
                  {logOpen ? (
                    <CollectionsLog
                      invoice={invoice}
                      appending={appendingInvoiceId === invoice.id}
                      onAppend={(note) => noteMutation.mutate({ invoiceId: invoice.id, note })}
                    />
                  ) : null}
                </div>
              );
            })
          )}
        </div>
        {!data.trackingReady ? (
          <p className="mt-3 text-xs text-warning">
            Send/view tracking and collections notes activate once the Getting Paid database
            migration is applied.
          </p>
        ) : null}
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
        <ChangeOrderSection changeOrders={data.changeOrders} />
        <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <Banknote className="h-4 w-4" />
            Payment activity
          </div>
          {feed.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            <div className="mt-3 space-y-2">
              {feed.slice(0, 12).map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-2 rounded-md border border-hairline bg-surface px-3 py-2 text-sm"
                >
                  <ReceiptText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <span className="font-medium tabular text-foreground">
                      {fmtUSDCents(entry.amount)}
                    </span>{" "}
                    {entry.status === "refunded" ? "refunded on" : "received on"}{" "}
                    <span className="font-medium">{entry.invoice_label}</span> ·{" "}
                    {paymentMethodLabel(entry.method, entry.processor)} · {shortDate(entry.paid_at)}
                    {showProjectColumn ? (
                      <span className="text-muted-foreground"> · {entry.project_name}</span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
