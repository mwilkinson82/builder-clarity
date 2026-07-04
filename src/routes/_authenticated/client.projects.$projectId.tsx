import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  CreditCard,
  Download,
  Eye,
  ExternalLink,
  FileText,
  LogOut,
  MessageSquare,
  ReceiptText,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  getClientPortalProject,
  recordClientChangeOrderDecision,
  type ChangeOrderApprovalRow,
  type ClientPortalBillingApplication,
  type ClientPortalChangeOrder,
  type ClientPortalDailyReport,
  type ClientPortalDailyReportAttachment,
} from "@/lib/client-portal.functions";
import type { ClientInvoicePaymentOptions } from "@/lib/client-portal.functions";
import { HowToPayBlock } from "@/components/billing/HowToPayBlock";
import type { BillingInvoiceRow } from "@/lib/projects.functions";
import { downloadPdfBytes, generateDailyReportPacketPdf } from "@/lib/daily-report-packet-pdf";
import { billingDocumentLabel, normalizeBillingNumberLabel } from "@/lib/billing-labels";
import { fmtUSDCents } from "@/lib/billing-format";
import { fmtUSD } from "@/lib/format";
import {
  centsToDollars,
  dollarsToCents,
  pendingPaymentLock,
  sumDollarsToCents,
} from "@/lib/payments-domain";
import { expireInvoiceCheckout } from "@/lib/payments.functions";

const DAILY_REPORT_BUCKET = "daily-reports";

const clientDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const safeFileName = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

export const Route = createFileRoute("/_authenticated/client/projects/$projectId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Client Portal — Overwatch" },
      {
        name: "description",
        content: "Review project change orders shared through Overwatch.",
      },
    ],
  }),
  component: ClientProjectPage,
});

function statusClass(status: ClientPortalChangeOrder["client_status"]) {
  if (status === "approved") return "border-success/40 bg-success/10 text-success";
  if (status === "rejected") return "border-danger/40 bg-danger/10 text-danger";
  if (status === "sent") return "border-warning/40 bg-warning/10 text-warning";
  return "border-hairline bg-muted/30 text-muted-foreground";
}

function latestApproval(
  approvals: ChangeOrderApprovalRow[],
  changeOrderId: string,
): ChangeOrderApprovalRow | undefined {
  return approvals.find((approval) => approval.change_order_id === changeOrderId);
}

function formatClientDate(value: string) {
  const date = value.includes("T") ? new Date(value) : new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value || "No date";
  return clientDateFormatter.format(date);
}

function ClientProjectPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loadProject = useServerFn(getClientPortalProject);
  const recordDecision = useServerFn(recordClientChangeOrderDecision);
  const [notesByCo, setNotesByCo] = useState<Record<string, string>>({});
  const [exportingDailyPacket, setExportingDailyPacket] = useState(false);
  const [selectedInvoiceId, setSelectedInvoiceId] = useState<string | null>(null);
  const [checkoutPendingId, setCheckoutPendingId] = useState<string | null>(null);

  const projectQuery = useQuery({
    queryKey: ["client-portal-project", projectId],
    queryFn: () => loadProject({ data: { projectId } }),
  });

  const expireCheckout = useServerFn(expireInvoiceCheckout);
  // Returning from an abandoned Stripe Checkout: expire the open session so
  // the pending-payment lock clears now instead of holding the pay buttons
  // for the session's 24h lifetime. Stripe refuses to expire a completed
  // session, so a payment that actually went through is never unlocked here.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("payment") !== "cancelled") return;
    const invoiceId = params.get("invoice");
    params.delete("payment");
    params.delete("invoice");
    const remaining = params.toString();
    window.history.replaceState(
      null,
      "",
      `${window.location.pathname}${remaining ? `?${remaining}` : ""}`,
    );
    if (!invoiceId) return;
    expireCheckout({ data: { invoiceId } })
      .catch(() => null)
      .finally(() => {
        queryClient.invalidateQueries({ queryKey: ["client-portal-project", projectId] });
      });
    // Runs once per portal visit; the params are consumed above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const decisionMutation = useMutation({
    mutationFn: (input: {
      changeOrderId: string;
      decision: "approved" | "rejected" | "comment";
      notes: string;
    }) => recordDecision({ data: input }),
    onSuccess: async (_, input) => {
      setNotesByCo((current) => ({ ...current, [input.changeOrderId]: "" }));
      await queryClient.invalidateQueries({ queryKey: ["client-portal-project", projectId] });
      toast.success(
        input.decision === "approved"
          ? "Change order approved"
          : input.decision === "rejected"
            ? "Change order rejected"
            : "Comment saved",
      );
    },
    onError: (err) =>
      toast.error("Response did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      }),
  });

  const totals = useMemo(() => {
    const changeOrders = projectQuery.data?.changeOrders ?? [];
    const dailyReports = projectQuery.data?.dailyReports ?? [];
    const billingApplications = projectQuery.data?.billingApplications ?? [];
    const billingInvoices = projectQuery.data?.billingInvoices ?? [];
    // Billing totals sum in integer cents so the client never sees a
    // float-drifted number (cents-exact derivation, BILLINGBATCH1).
    const totalBilledCents = sumDollarsToCents(
      billingApplications.map((app: ClientPortalBillingApplication) => app.amount_billed),
    );
    const paidToDateCents = sumDollarsToCents(
      billingApplications.map((app: ClientPortalBillingApplication) => app.paid_to_date),
    );
    const retainageCents = sumDollarsToCents(
      billingApplications.map((app: ClientPortalBillingApplication) => app.retainage),
    );
    const invoiceDueCents = sumDollarsToCents(
      billingInvoices.map((invoice: BillingInvoiceRow) => invoice.total_due),
    );
    const invoicePaidCents = sumDollarsToCents(
      billingInvoices.map((invoice: BillingInvoiceRow) => invoice.paid_amount),
    );
    const totalBilled = centsToDollars(totalBilledCents);
    const paidToDate = centsToDollars(paidToDateCents);
    const retainage = centsToDollars(retainageCents);
    const invoiceDue = centsToDollars(invoiceDueCents);
    const invoicePaid = centsToDollars(invoicePaidCents);
    return {
      visible: changeOrders.length,
      amount: changeOrders.reduce(
        (total: number, co: ClientPortalChangeOrder) => total + co.contract_amount,
        0,
      ),
      approved: changeOrders.filter(
        (co: ClientPortalChangeOrder) => co.client_status === "approved",
      ).length,
      dailyReports: dailyReports.length,
      payApps: billingApplications.length,
      invoices: billingInvoices.length,
      totalBilled,
      paidToDate,
      retainage,
      openReceivable: centsToDollars(
        Math.max(0, totalBilledCents - paidToDateCents - retainageCents),
      ),
      invoiceDue,
      invoicePaid,
      invoiceOpen: centsToDollars(Math.max(0, invoiceDueCents - invoicePaidCents)),
    };
  }, [
    projectQuery.data?.billingApplications,
    projectQuery.data?.billingInvoices,
    projectQuery.data?.changeOrders,
    projectQuery.data?.dailyReports,
  ]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const openDailyAttachment = async (attachment: ClientPortalDailyReportAttachment) => {
    const { data, error } = await supabase.storage
      .from(DAILY_REPORT_BUCKET)
      .createSignedUrl(attachment.path, 600);
    if (error || !data?.signedUrl) {
      toast.error("Attachment could not open", {
        description: error?.message ?? "Try again.",
      });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const downloadDailyReportPacket = async () => {
    const data = projectQuery.data;
    if (!data || data.dailyReports.length === 0) {
      toast.error("No daily reports to download");
      return;
    }

    setExportingDailyPacket(true);
    try {
      const pdfBytes = await generateDailyReportPacketPdf({
        project: data.project,
        reports: data.dailyReports,
        title: "Client Daily Report Packet",
      });
      const projectName = safeFileName(data.project.name || "overwatch-project");
      downloadPdfBytes(pdfBytes, `${projectName}-daily-report-packet.pdf`);
      toast.success("Daily report packet downloaded");
    } catch (err) {
      toast.error("Daily report packet did not download", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setExportingDailyPacket(false);
    }
  };

  if (projectQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background px-6 py-10 text-foreground">
        <div className="mx-auto max-w-5xl">
          <div className="h-8 w-56 rounded bg-muted" />
          <div className="mt-6 h-44 rounded-lg bg-muted/60" />
        </div>
      </div>
    );
  }

  if (projectQuery.error || !projectQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="max-w-md rounded-lg border border-danger/30 bg-danger/10 p-6">
          <h1 className="font-serif text-3xl">Client portal unavailable</h1>
          <p className="mt-2 text-sm text-danger">
            {projectQuery.error instanceof Error
              ? projectQuery.error.message
              : "This project is not available for client review."}
          </p>
          <Button className="mt-5" variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  const {
    project,
    changeOrders,
    approvals,
    billingApplications,
    billingInvoices,
    invoicePaymentOptions,
    dailyReports,
    portalPermissions,
  } = projectQuery.data;
  const canViewChangeOrders = portalPermissions?.canViewChangeOrders ?? true;
  const canViewDailyReports = portalPermissions?.canViewDailyReports ?? true;
  const canViewBilling = portalPermissions?.canViewBilling ?? false;
  const selectedInvoice =
    billingInvoices.find((invoice: BillingInvoiceRow) => invoice.id === selectedInvoiceId) ??
    billingInvoices[0] ??
    null;
  const selectedInvoicePayApp = selectedInvoice?.billing_application_id
    ? billingApplications.find(
        (app: ClientPortalBillingApplication) => app.id === selectedInvoice.billing_application_id,
      )
    : undefined;
  const selectedInvoicePaymentOptions = selectedInvoice
    ? (invoicePaymentOptions ?? []).find(
        (options: ClientInvoicePaymentOptions) => options.invoiceId === selectedInvoice.id,
      )
    : undefined;

  const startInvoiceCheckout = async (invoiceId: string, method: "card" | "ach_debit") => {
    setCheckoutPendingId(invoiceId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in again before paying online.");
      const response = await fetch("/api/stripe/checkout/invoice", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          invoiceId,
          method,
          successPath: `/client/projects/${project.id}?payment=success`,
          cancelPath: `/client/projects/${project.id}?payment=cancelled&invoice=${invoiceId}`,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        checkoutUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.ok || !payload.checkoutUrl) {
        throw new Error(payload.error || "Online payment did not open.");
      }
      window.location.assign(payload.checkoutUrl);
    } catch (error) {
      toast.error("Online payment did not open", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setCheckoutPendingId(null);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-hairline bg-surface-elevated">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Overwatch Client Portal
              </div>
              <h1 className="mt-2 font-serif text-4xl leading-tight">{project.name}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Review change orders and daily reports shared by the project team. Your approval or
                rejection is recorded immediately.
              </p>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={signOut}>
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </Button>
          </div>
          <dl className="mt-6 grid gap-3 md:grid-cols-6">
            <ClientMetric label="Client" value={project.client || "Project client"} />
            <ClientMetric label="Job #" value={project.job_number || "Not listed"} />
            <ClientMetric label="Change orders" value={String(totals.visible)} />
            <ClientMetric label="Shared CO value" value={fmtUSD(totals.amount)} />
            <ClientMetric
              label="Invoices"
              value={canViewBilling ? String(totals.invoices || totals.payApps) : "Off"}
            />
            <ClientMetric
              label="Daily reports"
              value={canViewDailyReports ? String(totals.dailyReports) : "Off"}
            />
          </dl>
        </div>
      </header>

      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-6 py-8">
        <section className="order-2 rounded-lg border border-hairline bg-card p-6 shadow-card">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-serif text-3xl">Change orders for client response</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {totals.approved} approved of {totals.visible} shared change orders.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {!canViewChangeOrders ? (
              <div className="rounded-md border border-hairline bg-muted/20 p-6 text-sm text-muted-foreground">
                Change orders are not enabled for this client seat yet.
              </div>
            ) : changeOrders.length === 0 ? (
              <div className="rounded-md border border-hairline bg-muted/20 p-6 text-sm text-muted-foreground">
                No change orders are currently awaiting your review.
              </div>
            ) : (
              changeOrders.map((co: ClientPortalChangeOrder) => {
                const approval = latestApproval(approvals, co.id);
                const note = notesByCo[co.id] ?? "";
                return (
                  <article
                    key={co.id}
                    className="rounded-md border border-hairline bg-background p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-serif text-2xl">{co.number || "Change order"}</h3>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${statusClass(co.client_status)}`}
                          >
                            {co.client_status.replace("_", " ")}
                          </span>
                        </div>
                        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                          {co.description}
                        </p>
                      </div>
                      <div className="rounded-md border border-hairline bg-muted/30 p-3 text-right">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Contract impact
                        </div>
                        <div className="mt-1 font-serif text-3xl">{fmtUSD(co.contract_amount)}</div>
                      </div>
                    </div>

                    {co.notes && (
                      <div className="mt-4 rounded-md border border-hairline bg-muted/20 p-3 text-sm">
                        {co.notes}
                      </div>
                    )}

                    {approval && (
                      <div className="mt-4 rounded-md border border-hairline bg-muted/20 p-3 text-sm">
                        <div className="flex items-center gap-2 font-medium capitalize">
                          {approval.decision === "approved" ? (
                            <CheckCircle2 className="h-4 w-4 text-success" />
                          ) : approval.decision === "rejected" ? (
                            <XCircle className="h-4 w-4 text-danger" />
                          ) : (
                            <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          )}
                          Latest response: {approval.decision}
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {approval.notes || "No note was included."}
                        </p>
                      </div>
                    )}

                    <div className="mt-5 space-y-3">
                      <Textarea
                        value={note}
                        placeholder="Optional client note, rejection reason, or approval context."
                        onChange={(event) =>
                          setNotesByCo((current) => ({
                            ...current,
                            [co.id]: event.target.value,
                          }))
                        }
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-1.5"
                          disabled={decisionMutation.isPending}
                          onClick={() =>
                            decisionMutation.mutate({
                              changeOrderId: co.id,
                              decision: "comment",
                              notes: note,
                            })
                          }
                        >
                          <MessageSquare className="h-3.5 w-3.5" /> Save comment
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-1.5 border-danger/40 text-danger hover:bg-danger/10"
                          disabled={decisionMutation.isPending}
                          onClick={() =>
                            decisionMutation.mutate({
                              changeOrderId: co.id,
                              decision: "rejected",
                              notes: note,
                            })
                          }
                        >
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </Button>
                        <Button
                          type="button"
                          className="gap-1.5"
                          disabled={decisionMutation.isPending}
                          onClick={() =>
                            decisionMutation.mutate({
                              changeOrderId: co.id,
                              decision: "approved",
                              notes: note,
                            })
                          }
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <section className="order-1 rounded-lg border border-hairline bg-card p-6 shadow-card">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-serif text-3xl">Billing shared with client</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Pay application status, payment posture, retainage, and open balance.
              </p>
            </div>
          </div>

          <div className="mt-6">
            {!canViewBilling ? (
              <div className="rounded-md border border-hairline bg-muted/20 p-6 text-sm text-muted-foreground">
                Billing is not enabled for this client seat yet.
              </div>
            ) : billingApplications.length === 0 && billingInvoices.length === 0 ? (
              <div className="rounded-md border border-hairline bg-muted/20 p-6 text-sm text-muted-foreground">
                No billing records are currently shared with you.
              </div>
            ) : (
              <div className="space-y-5">
                <dl className="grid gap-3 md:grid-cols-4">
                  <ClientMetric
                    label={billingInvoices.length > 0 ? "Invoice total" : "Billed to date"}
                    value={fmtUSDCents(
                      billingInvoices.length > 0 ? totals.invoiceDue : totals.totalBilled,
                    )}
                  />
                  <ClientMetric
                    label="Paid to date"
                    value={fmtUSDCents(
                      billingInvoices.length > 0 ? totals.invoicePaid : totals.paidToDate,
                    )}
                  />
                  <ClientMetric label="Retainage" value={fmtUSDCents(totals.retainage)} />
                  <ClientMetric
                    label="Open balance"
                    value={fmtUSDCents(
                      billingInvoices.length > 0 ? totals.invoiceOpen : totals.openReceivable,
                    )}
                  />
                </dl>
                {billingInvoices.length > 0 ? (
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <div className="space-y-3">
                      <div>
                        <h3 className="font-serif text-2xl">Invoices ready for review</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Select an invoice to review backup and payment options.
                        </p>
                      </div>
                      {billingInvoices.map((invoice: BillingInvoiceRow) => (
                        <ClientInvoiceReviewCard
                          key={invoice.id}
                          invoice={invoice}
                          linkedPayApp={billingApplications.find(
                            (app: ClientPortalBillingApplication) =>
                              app.id === invoice.billing_application_id,
                          )}
                          selected={selectedInvoice?.id === invoice.id}
                          onSelect={() => setSelectedInvoiceId(invoice.id)}
                        />
                      ))}
                    </div>
                    {selectedInvoice ? (
                      <ClientInvoiceBackupPanel
                        invoice={selectedInvoice}
                        linkedPayApp={selectedInvoicePayApp}
                        paymentOptions={selectedInvoicePaymentOptions}
                        payPending={checkoutPendingId === selectedInvoice.id}
                        onPayOnline={(method) => startInvoiceCheckout(selectedInvoice.id, method)}
                      />
                    ) : null}
                  </div>
                ) : null}
                {billingApplications.length > 0 ? (
                  <div className="space-y-3">
                    <div>
                      <h3 className="font-serif text-2xl">Pay applications</h3>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Submitted pay applications tied to the invoice backup.
                      </p>
                    </div>
                    <div className="grid gap-3 md:grid-cols-2">
                      {billingApplications.map((app: ClientPortalBillingApplication) => (
                        <ClientPayApplicationCard key={app.id} app={app} />
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        </section>

        <section className="order-3 rounded-lg border border-hairline bg-card p-6 shadow-card">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-serif text-3xl">Daily reports shared with client</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Field updates marked client-visible by the project team.
              </p>
            </div>
            {canViewDailyReports && dailyReports.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={exportingDailyPacket}
                onClick={downloadDailyReportPacket}
              >
                <Download className="h-3.5 w-3.5" />
                {exportingDailyPacket ? "Preparing..." : "Download packet"}
              </Button>
            )}
          </div>

          <div className="mt-6 space-y-3">
            {!canViewDailyReports ? (
              <div className="rounded-md border border-hairline bg-muted/20 p-6 text-sm text-muted-foreground">
                Daily reports are not enabled for this client seat yet.
              </div>
            ) : dailyReports.length === 0 ? (
              <div className="rounded-md border border-hairline bg-muted/20 p-6 text-sm text-muted-foreground">
                No daily reports are currently shared with you.
              </div>
            ) : (
              dailyReports.map((report: ClientPortalDailyReport) => (
                <DailyReportCard
                  key={report.id}
                  report={report}
                  onOpenAttachment={openDailyAttachment}
                />
              ))
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function ClientMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-card p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate font-serif text-2xl">{value}</dd>
    </div>
  );
}

function clientStatusLabel(value: string) {
  return value.replace(/_/g, " ");
}

function formatOptionalClientDate(value?: string | null) {
  return value ? formatClientDate(value) : "Not set";
}

function invoiceOpenBalance(invoice: BillingInvoiceRow) {
  return centsToDollars(
    Math.max(0, dollarsToCents(invoice.total_due) - dollarsToCents(invoice.paid_amount)),
  );
}

function payAppOpenBalance(app: ClientPortalBillingApplication) {
  return centsToDollars(
    Math.max(
      0,
      dollarsToCents(app.amount_billed) -
        dollarsToCents(app.paid_to_date) -
        dollarsToCents(app.retainage),
    ),
  );
}

function fmtCents(value: number) {
  return fmtUSDCents(value / 100);
}

function ClientInvoiceReviewCard({
  invoice,
  linkedPayApp,
  selected,
  onSelect,
}: {
  invoice: BillingInvoiceRow;
  linkedPayApp?: ClientPortalBillingApplication;
  selected: boolean;
  onSelect: () => void;
}) {
  const open = invoiceOpenBalance(invoice);
  const latestPayment = invoice.payment_events[0];
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-md border p-4 text-left transition ${
        selected
          ? "border-foreground bg-foreground text-background shadow-card"
          : "border-hairline bg-background hover:border-foreground hover:bg-surface"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ReceiptText className="h-4 w-4 shrink-0" />
            <div className="font-medium">
              {billingDocumentLabel(invoice.invoice_number, invoice.title, "Invoice")}
            </div>
          </div>
          <div
            className={`mt-1 text-xs ${selected ? "text-background/75" : "text-muted-foreground"}`}
          >
            {linkedPayApp
              ? billingDocumentLabel(
                  linkedPayApp.application_number,
                  linkedPayApp.invoice_number,
                  "Pay application",
                )
              : normalizeBillingNumberLabel(invoice.title) || "Direct invoice"}
          </div>
        </div>
        <span
          className={`inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${
            selected ? "border-background/30 bg-background/10" : "border-hairline bg-muted/20"
          }`}
        >
          {clientStatusLabel(invoice.status)}
        </span>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        <div>
          <div
            className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${selected ? "text-background/65" : "text-muted-foreground"}`}
          >
            Due
          </div>
          <div className="mt-1 text-sm tabular">{fmtUSDCents(invoice.total_due)}</div>
        </div>
        <div>
          <div
            className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${selected ? "text-background/65" : "text-muted-foreground"}`}
          >
            Open
          </div>
          <div className="mt-1 text-sm font-medium tabular">{fmtUSDCents(open)}</div>
        </div>
        <div>
          <div
            className={`text-[10px] font-semibold uppercase tracking-[0.14em] ${selected ? "text-background/65" : "text-muted-foreground"}`}
          >
            Due date
          </div>
          <div className="mt-1 text-sm">{formatOptionalClientDate(invoice.due_date)}</div>
        </div>
      </div>
      <div
        className={`mt-3 flex items-center gap-1.5 text-xs ${selected ? "text-background/75" : "text-muted-foreground"}`}
      >
        <Eye className="h-3.5 w-3.5" />
        Review invoice backup
        {latestPayment ? ` · Last payment ${formatClientDate(latestPayment.paid_at)}` : ""}
      </div>
    </button>
  );
}

function ClientInvoiceBackupPanel({
  invoice,
  linkedPayApp,
  paymentOptions,
  payPending,
  onPayOnline,
}: {
  invoice: BillingInvoiceRow;
  linkedPayApp?: ClientPortalBillingApplication;
  paymentOptions?: ClientInvoicePaymentOptions;
  payPending?: boolean;
  onPayOnline?: (method: "card" | "ach_debit") => void;
}) {
  const open = invoiceOpenBalance(invoice);
  const hasAnyPayOption = Boolean(
    paymentOptions && (paymentOptions.remittance || paymentOptions.card || paymentOptions.achDebit),
  );
  const legacyPaymentUrl =
    invoice.payment_enabled && invoice.payment_url ? invoice.payment_url : "";
  // A Stripe payment in flight locks every pay affordance for this invoice
  // (the $708K double-collection class): HowToPayBlock shows the processing
  // notice instead of buttons until the session resolves or expires.
  const pendingLock = pendingPaymentLock({
    onlinePaymentStatus: invoice.online_payment_status,
    checkoutSessionId: invoice.stripe_checkout_session_id,
    paymentLinkSentAtIso: invoice.payment_link_sent_at,
    openBalanceCents: dollarsToCents(open),
    nowIso: new Date().toISOString(),
  });
  return (
    <article className="rounded-md border border-hairline bg-background p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Invoice backup
          </div>
          <h3 className="mt-1 font-serif text-3xl">
            {billingDocumentLabel(invoice.invoice_number, invoice.title, "Invoice")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Review the invoice, linked pay application, and continuation detail before paying.
          </p>
        </div>
        {open <= 0 ? (
          <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
            This invoice has no open balance.
          </div>
        ) : !hasAnyPayOption && !legacyPaymentUrl && !pendingLock.locked ? (
          <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
            Payment instructions are on their way. The project team can share bank details or enable
            online payment.
          </div>
        ) : null}
      </div>

      <dl className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <ClientMetric label="Invoice total" value={fmtUSDCents(invoice.total_due)} />
        <ClientMetric label="Paid" value={fmtUSDCents(invoice.paid_amount)} />
        <ClientMetric label="Open" value={fmtUSDCents(open)} />
        <ClientMetric label="Status" value={clientStatusLabel(invoice.status)} />
      </dl>

      <HowToPayBlock
        options={paymentOptions}
        openBalance={open}
        legacyPaymentUrl={legacyPaymentUrl}
        onPayOnline={(method) => onPayOnline?.(method)}
        payPending={Boolean(payPending)}
        pendingLock={pendingLock}
      />

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-md border border-hairline bg-muted/20 p-3 text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Issued / due
          </div>
          <div className="mt-1 text-foreground">
            Issued {formatOptionalClientDate(invoice.issue_date)} · Due{" "}
            {formatOptionalClientDate(invoice.due_date)}
          </div>
        </div>
        <div className="rounded-md border border-hairline bg-muted/20 p-3 text-sm">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Source
          </div>
          <div className="mt-1 text-foreground">
            {linkedPayApp
              ? billingDocumentLabel(
                  linkedPayApp.application_number,
                  linkedPayApp.invoice_number,
                  "Pay application",
                )
              : "Direct invoice"}
          </div>
        </div>
      </div>

      {linkedPayApp ? (
        <div className="mt-5 rounded-md border border-hairline bg-surface p-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Pay app backup
              </div>
              <div className="mt-1 font-medium text-foreground">
                {billingDocumentLabel(
                  linkedPayApp.application_number,
                  linkedPayApp.invoice_number,
                  "Pay application",
                )}
              </div>
              <div className="mt-1 text-sm text-muted-foreground">
                {linkedPayApp.billing_period || "Current billing cycle"}
              </div>
            </div>
            <span className="rounded-md border border-hairline bg-card px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em]">
              {clientStatusLabel(linkedPayApp.status)}
            </span>
          </div>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <ClientMetric label="Billed" value={fmtUSDCents(linkedPayApp.amount_billed)} />
            <ClientMetric label="Paid" value={fmtUSDCents(linkedPayApp.paid_to_date)} />
            <ClientMetric label="Retainage" value={fmtUSDCents(linkedPayApp.retainage)} />
            <ClientMetric label="Open" value={fmtUSDCents(payAppOpenBalance(linkedPayApp))} />
          </dl>
          <div className="mt-4 text-sm text-muted-foreground">
            Submitted {formatOptionalClientDate(linkedPayApp.submitted_date)} · Due{" "}
            {formatOptionalClientDate(linkedPayApp.due_date)}
          </div>

          {linkedPayApp.line_items.length > 0 ? (
            <div className="mt-4 space-y-2">
              <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Continuation detail
              </div>
              {linkedPayApp.line_items.map((line) => (
                <div
                  key={line.id}
                  className="rounded-md border border-hairline bg-card p-3 text-sm"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">
                        {[line.cost_code, line.description].filter(Boolean).join(" · ") ||
                          "Billing line"}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {line.billing_percent_complete.toFixed(1)}% complete · Retainage{" "}
                        {line.retainage_pct.toFixed(1)}%
                      </div>
                    </div>
                    <div className="text-right text-sm font-medium tabular">
                      {fmtCents(line.total_completed_and_stored_cents)}
                    </div>
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                    <ClientMiniMetric
                      label="Scheduled"
                      value={fmtCents(line.scheduled_value_cents)}
                    />
                    <ClientMiniMetric
                      label="This period"
                      value={fmtCents(line.work_completed_this_period_cents)}
                    />
                    <ClientMiniMetric
                      label="Stored"
                      value={fmtCents(line.materials_stored_to_date_cents)}
                    />
                    <ClientMiniMetric
                      label="Balance"
                      value={fmtCents(line.balance_to_finish_cents)}
                    />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="mt-4 rounded-md border border-hairline bg-card p-3 text-sm text-muted-foreground">
              Continuation line detail has not been generated for this pay application yet.
            </div>
          )}
        </div>
      ) : null}
    </article>
  );
}

function ClientMiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-muted/20 px-2.5 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium tabular text-foreground">{value}</div>
    </div>
  );
}

function ClientPayApplicationCard({ app }: { app: ClientPortalBillingApplication }) {
  const latestEvent = app.status_events[0];
  return (
    <article className="rounded-md border border-hairline bg-background p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="font-medium text-foreground">
            {billingDocumentLabel(app.application_number, app.invoice_number, "Pay application")}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {app.billing_period || "Current billing cycle"}
          </div>
        </div>
        <span className="rounded-md border border-hairline bg-muted/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em]">
          {clientStatusLabel(app.status)}
        </span>
      </div>
      <dl className="mt-4 grid gap-2 sm:grid-cols-2">
        <ClientMiniMetric label="Billed" value={fmtUSDCents(app.amount_billed)} />
        <ClientMiniMetric label="Open" value={fmtUSDCents(payAppOpenBalance(app))} />
        <ClientMiniMetric label="Retainage" value={fmtUSDCents(app.retainage)} />
        <ClientMiniMetric label="Due" value={formatOptionalClientDate(app.due_date)} />
      </dl>
      {latestEvent ? (
        <div className="mt-3 text-xs text-muted-foreground">
          Updated {formatClientDate(latestEvent.created_at)}
        </div>
      ) : null}
    </article>
  );
}

function DailyReportCard({
  report,
  onOpenAttachment,
}: {
  report: ClientPortalDailyReport;
  onOpenAttachment: (attachment: ClientPortalDailyReportAttachment) => void;
}) {
  const visibleNotes = [
    ["Work performed", report.work_performed],
    ["Manpower", report.manpower],
    ["Delays / blockers", report.delays],
    ["Safety", report.safety_notes],
    ["Visitors", report.visitors],
    ["Quality", report.quality_notes],
  ].filter(([, value]) => value);

  return (
    <article className="rounded-md border border-hairline bg-background p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="font-serif text-2xl">{formatClientDate(report.report_date)}</h3>
          <div className="mt-1 text-sm text-muted-foreground">
            {[report.author, report.weather, `${report.crew_count} crew`]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        {report.attachments.length > 0 && (
          <div className="flex flex-wrap justify-start gap-2 md:justify-end">
            {report.attachments.map((attachment) => (
              <Button
                key={attachment.path}
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => onOpenAttachment(attachment)}
              >
                <FileText className="h-3.5 w-3.5" />
                <span className="max-w-[180px] truncate">{attachment.name}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            ))}
          </div>
        )}
      </div>

      {visibleNotes.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {visibleNotes.map(([label, value]) => (
            <div key={label} className="rounded-md border border-hairline bg-muted/20 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {label}
              </div>
              <p className="mt-1 text-sm text-foreground">{value}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          This report was shared without additional field notes.
        </p>
      )}
    </article>
  );
}
