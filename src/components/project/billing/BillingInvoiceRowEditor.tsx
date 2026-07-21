// Editor for one client invoice row: number/title, dates, amounts, retainage,
// client visibility + online-payment method toggles, remittance, and the
// record-payment dialog. Extracted verbatim from the project route during the
// PROJECTDECOMP1 split.
import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Download, Mail, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { DialogHeaderV2 } from "@/components/ui/dialog-header-v2";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { InvoicePaymentMethodToggles } from "@/components/billing/InvoicePaymentMethodToggles";
import {
  fmtUSDCents,
  formatBillingDate,
  invoiceAgingStatus,
  invoiceStatusLabel,
} from "@/lib/billing-format";
import { billingDocumentLabel, normalizeBillingNumberLabel } from "@/lib/billing-labels";
import { formatShortDateTime } from "@/lib/format";
import { downloadPdfBytes } from "@/lib/ior-pdf";
import { generateInvoicePdf } from "@/lib/invoice-pdf";
import {
  getInvoiceRemittance,
  getPaymentMethodContext,
  type PaymentMethodContext,
} from "@/lib/payments.functions";
import {
  centsToDollars,
  dollarsToCents,
  invoiceTotalDueDollars,
  isOverRecording,
  methodAvailability,
  pendingPaymentLock,
  resolveEnabledMethods,
  sumDollarsToCents,
} from "@/lib/payments-domain";
import type { InvoiceDraft, PaymentDraft } from "@/lib/billing-local-store";
import type { ProjectClientAccessRow } from "@/lib/client-portal.functions";
import type {
  BillingApplicationRow,
  BillingInvoiceRow,
  ProjectRow,
} from "@/lib/projects.functions";

import { EditableText, LedgerDetail } from "./billing-editor-atoms";

function newPaymentOperationKey(invoiceId: string) {
  const operationId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `manual:${invoiceId}:${operationId}`;
}

function newInvoiceOperationKey(invoiceId: string, action: string) {
  const operationId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `invoice:${invoiceId}:${action}:${operationId}`;
}

type InvoicePatchOptions = {
  idempotencyKey?: string;
  reason?: string;
};

export function BillingInvoiceRowEditor({
  project,
  invoice,
  linkedPayApp,
  invoiceRecipients,
  invoiceRecipientsLoading,
  invoiceRecipientsError,
  savingPayment,
  paymentMethodContext,
  onPatch,
  onDelete,
  onRecordPayment,
  onReconcile,
  reconciling,
}: {
  project: ProjectRow;
  invoice: BillingInvoiceRow;
  linkedPayApp?: BillingApplicationRow;
  invoiceRecipients: ProjectClientAccessRow[];
  invoiceRecipientsLoading?: boolean;
  invoiceRecipientsError?: string;
  savingPayment?: boolean;
  paymentMethodContext?: PaymentMethodContext;
  onPatch: (patch: Partial<BillingInvoiceRow>, options?: InvoicePatchOptions) => Promise<boolean>;
  onDelete: () => void;
  onRecordPayment: (input: PaymentDraft) => Promise<void>;
  onReconcile: () => void;
  reconciling?: boolean;
}) {
  const fetchInvoiceRemittance = useServerFn(getInvoiceRemittance);
  const openBalance = centsToDollars(
    Math.max(0, dollarsToCents(invoice.total_due) - dollarsToCents(invoice.paid_amount)),
  );
  const aging = invoiceAgingStatus(invoice, openBalance);
  const invoiceLabel = billingDocumentLabel(invoice.invoice_number, invoice.title, "Invoice");
  const invoiceTitle = normalizeBillingNumberLabel(invoice.title);
  const sourceLabel = linkedPayApp
    ? billingDocumentLabel(linkedPayApp.application_number, linkedPayApp.invoice_number)
    : "Direct invoice";
  // Readiness comes from the live Stripe Connect status plus this invoice's
  // method toggles — never from stored per-invoice payment links.
  const onlinePayAvailability = paymentMethodContext
    ? methodAvailability({
        hasPaymentProfile: paymentMethodContext.hasPaymentProfile,
        stripeReady: paymentMethodContext.stripeReady,
        enabled: resolveEnabledMethods(
          invoice.enabled_payment_methods,
          paymentMethodContext.defaultPaymentMethods,
        ),
        invoiceTotalCents: dollarsToCents(invoice.total_due),
        thresholdCents: paymentMethodContext.stripeAmountThresholdCents,
        platformLimitCents: paymentMethodContext.stripePaymentLimitCents,
      })
    : null;
  const onlinePayAvailable = Boolean(
    onlinePayAvailability &&
    (onlinePayAvailability.card.available || onlinePayAvailability.ach_debit.available),
  );
  // Same pending state the client sees: while a Stripe payment is in flight,
  // this invoice must read as "processing", not as collectible.
  const pendingLock = pendingPaymentLock({
    onlinePaymentStatus: invoice.online_payment_status,
    checkoutSessionId: invoice.stripe_checkout_session_id,
    paymentLinkSentAtIso: invoice.payment_link_sent_at,
    openBalanceCents: dollarsToCents(openBalance),
    nowIso: new Date().toISOString(),
  });
  const paymentReadiness =
    invoice.status === "void"
      ? { label: "Void invoice", className: "border-hairline bg-surface text-muted-foreground" }
      : openBalance <= 0
        ? { label: "No open balance", className: "border-success/30 bg-success/10 text-success" }
        : pendingLock.locked
          ? {
              label: `Payment processing — started ${formatBillingDate(pendingLock.startedAtIso?.slice(0, 10))}`,
              className: "border-warning/30 bg-warning/10 text-warning",
            }
          : !invoice.client_visible
            ? {
                label: "Hidden from client",
                className: "border-hairline bg-surface text-muted-foreground",
              }
            : onlinePayAvailable
              ? {
                  label: "Client can pay online",
                  className: "border-success/30 bg-success/10 text-success",
                }
              : {
                  label: "Manual/email only",
                  className: "border-warning/30 bg-warning/10 text-warning",
                };
  const today = new Date().toISOString().slice(0, 10);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentError, setPaymentError] = useState("");
  const [sendOpen, setSendOpen] = useState(false);
  const [invoiceAction, setInvoiceAction] = useState<"pdf" | "email" | null>(null);
  const [totalDueDraft, setTotalDueDraft] = useState(invoice.total_due);
  const [savingTotalDue, setSavingTotalDue] = useState(false);
  const committedTotalDueRef = useRef(invoice.total_due);
  const totalDueOperationKeyRef = useRef<string | null>(null);
  const emailOperationKeyRef = useRef<string | null>(null);
  const voidOperationKeyRef = useRef<string | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>(() => ({
    invoiceId: invoice.id,
    idempotency_key: newPaymentOperationKey(invoice.id),
    amount: openBalance,
    processor_fee: 0,
    overwatch_fee: 0,
    paid_at: today,
    payment_method: "check",
    processor: "manual",
    processor_payment_id: "",
    reference: "",
    notes: "",
  }));
  const netPayout = centsToDollars(
    Math.max(
      0,
      dollarsToCents(paymentDraft.amount) -
        dollarsToCents(paymentDraft.processor_fee) -
        dollarsToCents(paymentDraft.overwatch_fee),
    ),
  );
  const overRecording = isOverRecording(
    dollarsToCents(openBalance),
    dollarsToCents(paymentDraft.amount),
  );
  const sendBlockingMessage =
    invoice.status === "void"
      ? "Void invoices cannot be sent to clients."
      : invoiceRecipientsError
        ? `Client billing recipients did not load: ${invoiceRecipientsError}`
        : invoiceRecipients.length === 0
          ? "No client seats have Billing On. Open Client Portal, grant a client seat, and turn Billing On."
          : "";
  const historyLocked =
    invoice.status !== "draft" ||
    invoice.client_visible ||
    invoice.sent_at !== null ||
    invoice.paid_amount !== 0;
  const canDeleteDraft =
    invoice.status === "draft" &&
    !invoice.client_visible &&
    invoice.sent_at === null &&
    invoice.paid_amount === 0 &&
    invoice.online_payment_status === "not_enabled";
  const canVoid =
    ["sent", "viewed", "overdue"].includes(invoice.status) &&
    invoice.paid_amount === 0 &&
    !pendingLock.locked;

  useEffect(() => {
    if (invoice.total_due !== committedTotalDueRef.current) {
      committedTotalDueRef.current = invoice.total_due;
      totalDueOperationKeyRef.current = null;
      setTotalDueDraft(invoice.total_due);
    }
  }, [invoice.total_due]);

  const commitTotalDue = async () => {
    if (historyLocked || savingTotalDue || totalDueDraft === committedTotalDueRef.current) return;
    const idempotencyKey =
      totalDueOperationKeyRef.current ?? newInvoiceOperationKey(invoice.id, "total-due");
    totalDueOperationKeyRef.current = idempotencyKey;
    setSavingTotalDue(true);
    try {
      const committed = await onPatch({ total_due: totalDueDraft }, { idempotencyKey });
      if (committed) {
        committedTotalDueRef.current = totalDueDraft;
        totalDueOperationKeyRef.current = null;
      }
    } finally {
      setSavingTotalDue(false);
    }
  };

  const openPaymentDialog = () => {
    setPaymentError("");
    setPaymentDraft({
      invoiceId: invoice.id,
      idempotency_key: newPaymentOperationKey(invoice.id),
      amount: openBalance,
      processor_fee: 0,
      overwatch_fee: 0,
      paid_at: today,
      payment_method: "check",
      processor: "manual",
      processor_payment_id: "",
      reference: "",
      notes: "",
    });
    setPaymentOpen(true);
  };

  const savePayment = async () => {
    setPaymentError("");
    if (overRecording) {
      setPaymentError("Payment amount cannot exceed the invoice's remaining balance.");
      return;
    }
    try {
      await onRecordPayment(paymentDraft);
      setPaymentOpen(false);
    } catch (error) {
      setPaymentError(error instanceof Error ? error.message : "Payment did not save.");
    }
  };

  const downloadInvoice = async () => {
    setInvoiceAction("pdf");
    try {
      // Remittance fetch is best-effort: no bank details (or no read access)
      // just means the PDF omits the direct-bank block.
      const remittance = await fetchInvoiceRemittance({
        data: { invoiceId: invoice.id },
      }).catch(() => null);
      const bytes = await generateInvoicePdf({ project, invoice, linkedPayApp, remittance });
      downloadPdfBytes(bytes, invoiceFilename(project, invoice));
      toast.success("Invoice PDF downloaded");
    } catch (error) {
      toast.error("Invoice PDF did not generate", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setInvoiceAction(null);
    }
  };

  const emailInvoice = async () => {
    setInvoiceAction("email");
    try {
      if (invoice.status === "void") {
        throw new Error("Void invoices cannot be sent to clients.");
      }
      if (invoiceRecipientsError) {
        throw new Error(`Client billing recipients did not load: ${invoiceRecipientsError}`);
      }
      if (invoiceRecipients.length === 0) {
        throw new Error(
          "No client seats have Billing On. Open Client Portal, grant a client seat, and turn Billing On.",
        );
      }

      const operationKey =
        emailOperationKeyRef.current ?? newInvoiceOperationKey(invoice.id, "send");
      emailOperationKeyRef.current = operationKey;
      const recipientEmails = invoiceRecipients.map((recipient) => recipient.email);
      const transitioned = await onPatch(
        {
          client_visible: true,
          status: "sent",
          sent_recipients: recipientEmails,
        },
        {
          idempotencyKey: operationKey,
          reason: "Invoice delivery requested from the billing workspace.",
        },
      );
      if (!transitioned) {
        throw new Error("Invoice delivery state did not save. No email was queued.");
      }

      const sentInvoice: BillingInvoiceRow = {
        ...invoice,
        client_visible: true,
        status: invoice.status === "draft" ? "sent" : invoice.status,
        sent_recipients: recipientEmails,
      };

      const results = await Promise.allSettled(
        invoiceRecipients.map((recipient) =>
          enqueueInvoiceEmail({
            project,
            invoice: sentInvoice,
            linkedPayApp,
            recipientEmail: recipient.email,
            operationKey,
          }),
        ),
      );
      const sentCount = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (sentCount === 0) {
        throw failed?.reason instanceof Error
          ? failed.reason
          : new Error("No invoice emails were queued.");
      }

      if (!failed) emailOperationKeyRef.current = null;
      setSendOpen(false);

      toast.success("Invoice email queued", {
        description:
          sentCount === 1
            ? `Sent to ${invoiceRecipients[0].email}.`
            : `Sent to ${sentCount} client billing recipients.`,
      });
      if (failed) {
        toast.warning("Some invoice emails did not queue", {
          description:
            failed.reason instanceof Error
              ? failed.reason.message
              : "Check client recipients and send again if needed.",
        });
      }
    } catch (error) {
      toast.error("Invoice email did not queue", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setInvoiceAction(null);
    }
  };

  const voidInvoice = async () => {
    const reason = window.prompt(
      "Why is this invoice being voided? This preserves the invoice as financial history.",
    );
    if (!reason || reason.trim().length < 3) return;
    const idempotencyKey =
      voidOperationKeyRef.current ?? newInvoiceOperationKey(invoice.id, "void");
    voidOperationKeyRef.current = idempotencyKey;
    const committed = await onPatch({ status: "void" }, { idempotencyKey, reason: reason.trim() });
    if (committed) voidOperationKeyRef.current = null;
  };

  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      {/* Fields on top, the action bar as its own full-width row below — the
          two never compete for horizontal space, so the dates never get
          crushed against the buttons at the project shell's panel width. */}
      <div className="flex flex-col gap-4">
        <div className="grid min-w-0 gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(160px,0.8fr)_minmax(260px,0.9fr)]">
          <div className="space-y-1.5">
            <Label>Invoice</Label>
            {historyLocked ? (
              <>
                <div className="flex h-8 items-center rounded-md border border-hairline bg-muted/20 px-3 text-sm text-foreground">
                  {invoiceLabel}
                </div>
                <div className="mt-1 flex h-8 items-center rounded-md border border-hairline bg-muted/20 px-3 text-xs text-muted-foreground">
                  {invoiceTitle || "No title"}
                </div>
              </>
            ) : (
              <>
                <EditableText
                  value={invoiceLabel}
                  placeholder="Invoice #"
                  onCommit={(invoice_number) =>
                    onPatch({ invoice_number: normalizeBillingNumberLabel(invoice_number) })
                  }
                />
                <EditableText
                  value={invoiceTitle}
                  placeholder="Invoice title"
                  small
                  onCommit={(title) => onPatch({ title: normalizeBillingNumberLabel(title) })}
                />
              </>
            )}
            {invoice.notes ? (
              <div className="mt-1 text-xs text-muted-foreground">{invoice.notes}</div>
            ) : null}
          </div>
          <div>
            <Label>Source</Label>
            <div className="mt-2 text-sm text-foreground">{sourceLabel}</div>
            {linkedPayApp?.billing_period ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {linkedPayApp.billing_period}
              </div>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor={`invoice-issued-${invoice.id}`}>Issued</Label>
              <Input
                id={`invoice-issued-${invoice.id}`}
                type="date"
                value={invoice.issue_date ?? ""}
                onChange={(e) => void onPatch({ issue_date: e.target.value || null })}
                disabled={historyLocked}
                className="h-8 w-full min-w-[8.5rem]"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`invoice-due-${invoice.id}`}>Due</Label>
              <Input
                id={`invoice-due-${invoice.id}`}
                type="date"
                value={invoice.due_date ?? ""}
                onChange={(e) => void onPatch({ due_date: e.target.value || null })}
                disabled={historyLocked}
                className="h-8 w-full min-w-[8.5rem]"
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-hairline pt-3">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={downloadInvoice}
            disabled={invoiceAction === "pdf"}
          >
            <Download className="h-3.5 w-3.5" />
            {invoiceAction === "pdf" ? "PDF..." : "PDF"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={() => setSendOpen(true)}
            disabled={
              invoice.status === "void" || invoiceAction === "email" || invoiceRecipientsLoading
            }
          >
            <Mail className="h-3.5 w-3.5" />
            Send
          </Button>
          <Dialog open={sendOpen} onOpenChange={setSendOpen}>
            <DialogContent className="sm:max-w-xl">
              <DialogHeaderV2
                eyebrow="Invoice"
                title="Send invoice"
                description="Confirm the client billing recipients before queuing the invoice email."
              />
              <div className="space-y-4 py-2">
                <div className="rounded-md border border-hairline bg-surface p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Invoice
                  </div>
                  <div className="mt-1 font-medium text-foreground">{invoiceLabel}</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <LedgerDetail label="Open" value={fmtUSDCents(openBalance)} />
                    <LedgerDetail label="Due" value={formatBillingDate(invoice.due_date)} />
                    <LedgerDetail
                      label="Client"
                      value={invoice.client_visible ? "Visible" : "Hidden"}
                    />
                  </div>
                </div>

                <div className="rounded-md border border-hairline bg-card p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Recipients
                  </div>
                  {invoiceRecipientsLoading ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Loading billing recipients...
                    </p>
                  ) : invoiceRecipients.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {invoiceRecipients.map((recipient) => (
                        <div
                          key={recipient.id}
                          className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm"
                        >
                          <div className="font-medium text-foreground">{recipient.email}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            Billing On · {recipient.status}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No billing recipients are available for this project yet.
                    </p>
                  )}
                </div>

                <InvoicePaymentMethodToggles
                  value={invoice.enabled_payment_methods}
                  invoiceTotal={invoice.total_due}
                  context={paymentMethodContext}
                  onChange={(enabled_payment_methods) => void onPatch({ enabled_payment_methods })}
                />

                <div className="rounded-md border border-hairline bg-surface p-4 text-sm text-muted-foreground">
                  Confirming will queue the invoice email and mark the invoice visible to the
                  client. It will not enable online payment unless Stripe Connect is already
                  configured for the company.
                </div>

                {sendBlockingMessage ? (
                  <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                    {sendBlockingMessage}
                  </div>
                ) : null}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setSendOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={emailInvoice}
                  disabled={Boolean(sendBlockingMessage) || invoiceAction === "email"}
                >
                  {invoiceAction === "email" ? "Sending..." : "Send invoice"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog
            open={paymentOpen}
            onOpenChange={(open) => {
              if (!savingPayment) setPaymentOpen(open);
            }}
          >
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-8"
                onClick={openPaymentDialog}
                disabled={
                  savingPayment ||
                  pendingLock.locked ||
                  invoice.status === "draft" ||
                  invoice.status === "void" ||
                  openBalance <= 0
                }
                title={
                  pendingLock.locked
                    ? "A Stripe checkout is pending. Resolve it before recording another payment."
                    : invoice.status === "draft"
                      ? "Send the invoice before recording payment."
                      : undefined
                }
              >
                Record payment
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeaderV2
                eyebrow="Payment"
                title="Record payment"
                description="Enter received funds, fees, and reconciliation details for this invoice."
              />
              <div className="grid gap-4 py-2">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`payment-amount-${invoice.id}`}>Amount</Label>
                    <MoneyInput
                      id={`payment-amount-${invoice.id}`}
                      value={paymentDraft.amount}
                      onValueChange={(amount) => setPaymentDraft({ ...paymentDraft, amount })}
                      align="right"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`payment-processor-fee-${invoice.id}`}>Processor fee</Label>
                    <MoneyInput
                      id={`payment-processor-fee-${invoice.id}`}
                      value={paymentDraft.processor_fee}
                      onValueChange={(processor_fee) =>
                        setPaymentDraft({ ...paymentDraft, processor_fee })
                      }
                      align="right"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`payment-overwatch-fee-${invoice.id}`}>Overwatch fee</Label>
                    <MoneyInput
                      id={`payment-overwatch-fee-${invoice.id}`}
                      value={paymentDraft.overwatch_fee}
                      onValueChange={(overwatch_fee) =>
                        setPaymentDraft({ ...paymentDraft, overwatch_fee })
                      }
                      align="right"
                    />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor={`payment-paid-at-${invoice.id}`}>Paid date</Label>
                    <Input
                      id={`payment-paid-at-${invoice.id}`}
                      type="date"
                      value={paymentDraft.paid_at}
                      onChange={(e) =>
                        setPaymentDraft({ ...paymentDraft, paid_at: e.target.value || today })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`payment-method-${invoice.id}`}>Method</Label>
                    <Select
                      value={paymentDraft.payment_method}
                      onValueChange={(payment_method) =>
                        setPaymentDraft({ ...paymentDraft, payment_method })
                      }
                    >
                      <SelectTrigger id={`payment-method-${invoice.id}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="wire">Wire</SelectItem>
                        <SelectItem value="ach">ACH</SelectItem>
                        <SelectItem value="check">Check</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`payment-reference-${invoice.id}`}>Reference</Label>
                    <Input
                      id={`payment-reference-${invoice.id}`}
                      value={paymentDraft.reference}
                      placeholder="Check #, wire confirmation, ACH trace"
                      onChange={(e) =>
                        setPaymentDraft({
                          ...paymentDraft,
                          reference: e.target.value,
                          processor_payment_id: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                {overRecording ? (
                  <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                    This records {fmtUSDCents(paymentDraft.amount)} against a remaining balance of{" "}
                    {fmtUSDCents(openBalance)}. Reduce the payment to the remaining balance;
                    overpayments require a separate unapplied-credit workflow and cannot be posted
                    to this invoice.
                  </div>
                ) : null}
                {paymentError ? (
                  <div
                    role="alert"
                    className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    {paymentError} Your entries are still here. Retry when ready.
                  </div>
                ) : null}
                <div className="rounded-md border border-hairline bg-surface p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Net after recorded fees
                  </div>
                  <div className="mt-1 text-2xl font-medium tabular">{fmtUSDCents(netPayout)}</div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={`payment-notes-${invoice.id}`}>Notes</Label>
                  <Textarea
                    id={`payment-notes-${invoice.id}`}
                    rows={3}
                    value={paymentDraft.notes}
                    placeholder="Payment source, reconciliation note, or partial-payment context."
                    onChange={(e) => setPaymentDraft({ ...paymentDraft, notes: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setPaymentOpen(false)}
                  disabled={savingPayment}
                >
                  Cancel
                </Button>
                <Button
                  onClick={savePayment}
                  disabled={savingPayment || paymentDraft.amount <= 0 || overRecording}
                >
                  {savingPayment ? "Saving..." : "Save payment"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {/* Recompute paid/status from the payment ledger — the honest
              correction path when an invoice drifted from its payments
              (e.g. a refund processed before refund reversal shipped). */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={reconciling}
            onClick={onReconcile}
          >
            {reconciling ? "Reconciling..." : "Reconcile payments"}
          </Button>
          {canVoid ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-8"
              onClick={() => void voidInvoice()}
            >
              Void invoice
            </Button>
          ) : null}
          {canDeleteDraft ? (
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8"
              title="Delete unsent draft"
              onClick={() => {
                if (window.confirm("Delete this unsent invoice draft?")) onDelete();
              }}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">
        <div className="space-y-1.5">
          <Label htmlFor={`invoice-total-due-${invoice.id}`}>Total due</Label>
          <MoneyInput
            id={`invoice-total-due-${invoice.id}`}
            value={totalDueDraft}
            onValueChange={setTotalDueDraft}
            onBlur={() => void commitTotalDue()}
            disabled={historyLocked || savingTotalDue}
            align="right"
            className="h-8 w-full"
          />
          <div className="text-right text-xs text-muted-foreground">
            Subtotal {fmtUSDCents(invoice.subtotal)}
          </div>
        </div>
        <LedgerDetail label="Paid" value={fmtUSDCents(invoice.paid_amount)} />
        <LedgerDetail label="Open" value={fmtUSDCents(openBalance)} />
        <LedgerDetail
          label="A/R aging"
          value={
            <span>
              {aging.label}
              <span className="mt-0.5 block text-[11px] font-normal text-current/75">
                {aging.detail}
              </span>
            </span>
          }
          className={aging.className}
        />
        <LedgerDetail label="Status" value={invoiceStatusLabel(invoice.status)} />
        <div className="space-y-1.5">
          <Label>Client</Label>
          <Button
            type="button"
            size="sm"
            variant={invoice.client_visible ? "default" : "outline"}
            className="h-8 w-full justify-start"
            disabled
            title="Client visibility follows the audited Send and Void lifecycle."
          >
            {invoice.client_visible ? "Visible" : "Hidden"}
          </Button>
        </div>
        <div
          className={`rounded-md border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] ${paymentReadiness.className}`}
        >
          {paymentReadiness.label}
        </div>
      </div>

      {invoice.payment_events.length > 0 ? (
        <div className="mt-3 text-[11px] text-muted-foreground">
          Last payment {fmtUSDCents(invoice.payment_events[0].amount)} ·{" "}
          {formatShortDateTime(invoice.payment_events[0].paid_at)}
        </div>
      ) : null}
    </div>
  );
}

function invoiceFilename(project: ProjectRow, invoice: BillingInvoiceRow) {
  const projectPart = (project.job_number || project.name || "project")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  const invoicePart = billingDocumentLabel(invoice.invoice_number, invoice.title, "invoice")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return `Overwatch-Invoice-${projectPart || "project"}-${invoicePart || "invoice"}.pdf`;
}

function invoicePortalUrl(projectId: string) {
  if (typeof window === "undefined") return `/client/projects/${projectId}`;
  return `${window.location.origin}/client/projects/${projectId}`;
}

async function enqueueInvoiceEmail(input: {
  project: ProjectRow;
  invoice: BillingInvoiceRow;
  linkedPayApp?: BillingApplicationRow;
  recipientEmail: string;
  operationKey: string;
}) {
  const { project, invoice, linkedPayApp, recipientEmail, operationKey } = input;
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    throw new Error("Your session expired. Sign in again before sending invoice email.");
  }

  const openBalance = centsToDollars(
    Math.max(0, dollarsToCents(invoice.total_due) - dollarsToCents(invoice.paid_amount)),
  );
  const response = await fetch("/lovable/email/transactional/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      templateName: "invoice-notification",
      recipientEmail,
      idempotencyKey: `${operationKey}:${recipientEmail.toLowerCase()}`,
      templateData: {
        projectName: project.name,
        clientName: project.client,
        jobNumber: project.job_number,
        invoiceNumber: billingDocumentLabel(invoice.invoice_number, invoice.title, "Invoice"),
        invoiceTitle: normalizeBillingNumberLabel(
          invoice.title || linkedPayApp?.application_number || "",
        ),
        invoiceStatus: invoiceStatusLabel(invoice.status),
        totalDue: fmtUSDCents(invoice.total_due),
        paidAmount: fmtUSDCents(invoice.paid_amount),
        openBalance: fmtUSDCents(openBalance),
        dueDate: invoice.due_date,
        portalUrl: invoicePortalUrl(project.id),
        // Stored checkout links are a pre-Phase-1 vestige (Stripe sessions
        // expire within a day); the client pays through the portal, which
        // creates a fresh session from the live connect status and toggles.
        paymentUrl: "",
        notes:
          invoice.notes ||
          linkedPayApp?.notes ||
          "This invoice is available in the Overwatch client portal.",
      },
    }),
  });

  let result: Record<string, unknown> = {};
  try {
    result = (await response.json()) as Record<string, unknown>;
  } catch {
    result = {};
  }
  if (!response.ok || result.success === false) {
    const errorMessage =
      typeof result.error === "string"
        ? result.error
        : typeof result.reason === "string"
          ? result.reason
          : "The email service did not accept the invoice notification.";
    throw new Error(errorMessage);
  }
}
