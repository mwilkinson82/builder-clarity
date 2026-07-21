// Editor for one billing application (pay app) row: number/invoice labels,
// billing period, dates, contract & CO amounts, amount billed, retainage,
// status, and notes — with derived ledger readouts. Extracted verbatim from
// the project route during the PROJECTDECOMP1 split.
import { ReceiptText, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
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
import {
  billingEventLabel,
  fmtUSDCents,
  invoiceStatusLabel,
  payAppAgingStatus,
} from "@/lib/billing-format";
import { billingDocumentLabel, normalizeBillingNumberLabel } from "@/lib/billing-labels";
import { formatShortDateTime } from "@/lib/format";
import { centsToDollars, dollarsToCents } from "@/lib/payments-domain";
import type { BillingApplicationRow, BillingInvoiceRow } from "@/lib/projects.functions";

import { EditableText, LedgerDetail } from "./billing-editor-atoms";

const billingStatusLabel: Record<BillingApplicationRow["status"], string> = {
  draft: "Draft",
  submitted: "Submitted",
  rejected: "Rejected",
  partial: "Partial · from payments",
  paid: "Paid · from payments",
};

const billingStatusTransitions: Record<
  BillingApplicationRow["status"],
  BillingApplicationRow["status"][]
> = {
  draft: ["draft", "submitted"],
  submitted: ["submitted", "rejected"],
  rejected: ["rejected", "draft"],
  partial: ["partial"],
  paid: ["paid"],
};

type EditableFinancialField =
  "contract_amount" | "change_order_amount" | "amount_billed" | "retainage";

type EditableFinancialValues = Pick<BillingApplicationRow, EditableFinancialField>;
type BillingApplicationPatchResult = void | boolean | Promise<void | boolean>;

export function BillingApplicationRowEditor({
  app,
  linkedInvoice,
  onPatch,
  onCreateInvoice,
  onDelete,
}: {
  app: BillingApplicationRow;
  linkedInvoice?: BillingInvoiceRow;
  onPatch: (patch: Partial<BillingApplicationRow>) => BillingApplicationPatchResult;
  onCreateInvoice: () => void;
  onDelete: () => void;
}) {
  const contractAmount = app.contract_amount;
  const changeOrderAmount = app.change_order_amount;
  const amountBilled = app.amount_billed;
  const retainage = app.retainage;
  const [financialDraft, setFinancialDraft] = useState<EditableFinancialValues>(() => ({
    contract_amount: contractAmount,
    change_order_amount: changeOrderAmount,
    amount_billed: amountBilled,
    retainage,
  }));
  const financialDraftRef = useRef(financialDraft);
  const committedFinancialsRef = useRef(financialDraft);
  // State drives the disabled presentation; the ref closes the same-tick race
  // between blur events before React has rendered that state.
  const financialCommitPendingRef = useRef(false);
  const [financialCommitPending, setFinancialCommitPending] = useState(false);

  useEffect(() => {
    const nextValues = {
      contract_amount: contractAmount,
      change_order_amount: changeOrderAmount,
      amount_billed: amountBilled,
      retainage,
    };
    financialDraftRef.current = nextValues;
    committedFinancialsRef.current = nextValues;
    setFinancialDraft(nextValues);
  }, [amountBilled, changeOrderAmount, contractAmount, retainage]);

  const stageFinancialValue = (field: EditableFinancialField, value: number) => {
    const nextValues = { ...financialDraftRef.current, [field]: value };
    financialDraftRef.current = nextValues;
    setFinancialDraft(nextValues);
  };

  const commitFinancialValue = async (field: EditableFinancialField) => {
    const nextValue = financialDraftRef.current[field];
    if (financialCommitPendingRef.current || nextValue === committedFinancialsRef.current[field]) {
      return;
    }

    financialCommitPendingRef.current = true;
    setFinancialCommitPending(true);
    try {
      const result = await onPatch({ [field]: nextValue });
      // A parent returning false is an expected, already-reported command
      // failure. Undefined preserves compatibility with synchronous callbacks.
      if (result !== false) {
        committedFinancialsRef.current = {
          ...committedFinancialsRef.current,
          [field]: nextValue,
        };
      }
    } catch {
      // The parent command normally converts failures to false after showing
      // the server error. Keep this defensive catch so an alternate caller
      // cannot create an unhandled rejection. The staged value remains intact
      // and the same focus/blur gesture can retry it.
    } finally {
      financialCommitPendingRef.current = false;
      setFinancialCommitPending(false);
    }
  };

  const openReceivable = centsToDollars(
    Math.max(
      0,
      dollarsToCents(app.amount_billed) -
        dollarsToCents(app.paid_to_date) -
        dollarsToCents(app.retainage),
    ),
  );
  const events = app.status_events.slice(0, 3);
  const appLabel = billingDocumentLabel(app.application_number, app.invoice_number);
  const invoiceLabel = normalizeBillingNumberLabel(app.invoice_number);
  const aging = payAppAgingStatus(app, openReceivable);
  const canEditFinancials = app.status === "draft" || app.status === "rejected";
  const canDelete = app.status === "draft";
  const canTransitionStatus =
    app.status === "draft" || app.status === "submitted" || app.status === "rejected";
  const financialFieldsReadOnly = !canEditFinancials || financialCommitPending;
  const lockedHistoryNote =
    app.status === "submitted"
      ? "Submitted billing history is locked. Reject it before correcting header or financial details."
      : app.status === "partial" || app.status === "paid"
        ? "Certified billing and payment history is locked."
        : "";
  const lockedInputClass = financialFieldsReadOnly ? "bg-muted/40 text-muted-foreground" : "";

  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Application</Label>
            {canEditFinancials ? (
              <>
                <EditableText
                  value={appLabel}
                  onCommit={(application_number) =>
                    onPatch({
                      application_number: normalizeBillingNumberLabel(application_number),
                    })
                  }
                />
                <EditableText
                  value={app.billing_period}
                  placeholder="Billing period"
                  small
                  onCommit={(billing_period) => onPatch({ billing_period })}
                />
              </>
            ) : (
              <>
                <Input
                  aria-label="Application number"
                  value={appLabel}
                  readOnly
                  className="h-8 w-full min-w-0 bg-muted/40 text-muted-foreground"
                />
                <Input
                  aria-label="Billing period"
                  value={app.billing_period}
                  placeholder="Billing period"
                  readOnly
                  className="mt-1 h-8 w-full min-w-0 bg-muted/40 text-xs text-muted-foreground"
                />
              </>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Invoice #</Label>
            {canEditFinancials ? (
              <EditableText
                value={invoiceLabel}
                placeholder="Invoice #"
                onCommit={(invoice_number) =>
                  onPatch({ invoice_number: normalizeBillingNumberLabel(invoice_number) })
                }
              />
            ) : (
              <Input
                aria-label="Invoice number"
                value={invoiceLabel}
                placeholder="Invoice #"
                readOnly
                className="h-8 w-full min-w-0 bg-muted/40 text-muted-foreground"
              />
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={app.status}
              onValueChange={(status) =>
                onPatch({ status: status as BillingApplicationRow["status"] })
              }
              disabled={!canTransitionStatus || financialCommitPending}
            >
              <SelectTrigger aria-label="Billing application status" className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {billingStatusTransitions[app.status].map((status) => (
                  <SelectItem key={status} value={status}>
                    {billingStatusLabel[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {linkedInvoice ? (
            <div className="flex min-h-9 items-center rounded-md border border-hairline bg-card px-2.5 text-xs text-muted-foreground">
              <ReceiptText className="mr-1.5 h-3.5 w-3.5" />
              {billingDocumentLabel(
                linkedInvoice.invoice_number,
                linkedInvoice.title,
                "Invoice",
              )} · {invoiceStatusLabel(linkedInvoice.status)}
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={onCreateInvoice}>
              <ReceiptText className="h-3.5 w-3.5" />
              Create invoice
            </Button>
          )}
          {canDelete && (
            <Button
              aria-label="Delete billing application"
              size="icon"
              variant="ghost"
              className="h-9 w-9"
              onClick={onDelete}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>
      {lockedHistoryNote && (
        <p role="note" className="mt-3 text-xs font-medium text-muted-foreground">
          {lockedHistoryNote}
        </p>
      )}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <div className="space-y-1.5">
          <Label>Submitted</Label>
          <Input
            aria-label="Submitted date"
            type="date"
            value={app.submitted_date ?? ""}
            readOnly={financialFieldsReadOnly}
            onChange={(e) => {
              if (canEditFinancials) onPatch({ submitted_date: e.target.value || null });
            }}
            className={`h-8 w-full ${lockedInputClass}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Due</Label>
          <Input
            aria-label="Due date"
            type="date"
            value={app.due_date ?? ""}
            readOnly={financialFieldsReadOnly}
            onChange={(e) => {
              if (canEditFinancials) onPatch({ due_date: e.target.value || null });
            }}
            className={`h-8 w-full ${lockedInputClass}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Contract</Label>
          <MoneyInput
            aria-label="Contract amount"
            value={financialDraft.contract_amount}
            readOnly={financialFieldsReadOnly}
            onValueChange={(contract_amount) => {
              if (canEditFinancials) stageFinancialValue("contract_amount", contract_amount);
            }}
            onBlur={() => void commitFinancialValue("contract_amount")}
            align="right"
            className={`h-8 w-full ${lockedInputClass}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Approved COs</Label>
          <MoneyInput
            aria-label="Approved change order amount"
            value={financialDraft.change_order_amount}
            readOnly={financialFieldsReadOnly}
            onValueChange={(change_order_amount) => {
              if (canEditFinancials)
                stageFinancialValue("change_order_amount", change_order_amount);
            }}
            onBlur={() => void commitFinancialValue("change_order_amount")}
            allowNegative
            align="right"
            className={`h-8 w-full ${lockedInputClass}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Application amount</Label>
          <MoneyInput
            aria-label="Application amount"
            value={financialDraft.amount_billed}
            readOnly={financialFieldsReadOnly}
            onValueChange={(amount_billed) => {
              if (canEditFinancials) stageFinancialValue("amount_billed", amount_billed);
            }}
            onBlur={() => void commitFinancialValue("amount_billed")}
            align="right"
            className={`h-8 w-full ${lockedInputClass}`}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Payments received</Label>
          <div className="flex h-8 items-center justify-end rounded-md border border-hairline bg-card px-3 text-sm font-medium tabular">
            {fmtUSDCents(app.paid_to_date)}
          </div>
          <p className="text-right text-[11px] text-muted-foreground">From invoice payments</p>
        </div>
        <div className="space-y-1.5">
          <Label>Retainage held</Label>
          <MoneyInput
            aria-label="Retainage held"
            value={financialDraft.retainage}
            readOnly={financialFieldsReadOnly}
            onValueChange={(retainage) => {
              if (canEditFinancials) stageFinancialValue("retainage", retainage);
            }}
            onBlur={() => void commitFinancialValue("retainage")}
            align="right"
            className={`h-8 w-full ${lockedInputClass}`}
          />
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <LedgerDetail label="Open A/R" value={fmtUSDCents(openReceivable)} />
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
      </div>
      {events.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {events.map((event) => (
            <span
              key={event.id}
              className="inline-flex items-center gap-2 rounded-md border border-hairline bg-card px-2.5 py-1"
            >
              <span className="font-medium text-foreground">{billingEventLabel(event)}</span>
              <span>{formatShortDateTime(event.created_at)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
