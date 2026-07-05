// Editor for one billing application (pay app) row: number/invoice labels,
// billing period, dates, contract & CO amounts, amount billed, retainage,
// status, and notes — with derived ledger readouts. Extracted verbatim from
// the project route during the PROJECTDECOMP1 split.
import { ReceiptText, Trash2 } from "lucide-react";

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
import type { BillingDraft } from "@/lib/billing-local-store";
import type { BillingApplicationRow, BillingInvoiceRow } from "@/lib/projects.functions";

import { EditableText, LedgerDetail } from "./billing-editor-atoms";

export function BillingApplicationRowEditor({
  app,
  linkedInvoice,
  onPatch,
  onCreateInvoice,
  onDelete,
}: {
  app: BillingApplicationRow;
  linkedInvoice?: BillingInvoiceRow;
  onPatch: (patch: Partial<BillingApplicationRow>) => void;
  onCreateInvoice: () => void;
  onDelete: () => void;
}) {
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

  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Application</Label>
            <EditableText
              value={appLabel}
              onCommit={(application_number) =>
                onPatch({ application_number: normalizeBillingNumberLabel(application_number) })
              }
            />
            <EditableText
              value={app.billing_period}
              placeholder="Billing period"
              small
              onCommit={(billing_period) => onPatch({ billing_period })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Invoice #</Label>
            <EditableText
              value={invoiceLabel}
              placeholder="Invoice #"
              onCommit={(invoice_number) =>
                onPatch({ invoice_number: normalizeBillingNumberLabel(invoice_number) })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={app.status}
              onValueChange={(status) =>
                onPatch({ status: status as BillingApplicationRow["status"] })
              }
            >
              <SelectTrigger className="h-8 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="draft">Draft</SelectItem>
                <SelectItem value="submitted">Submitted</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="paid">Paid</SelectItem>
                <SelectItem value="rejected">Rejected</SelectItem>
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
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <div className="space-y-1.5">
          <Label>Submitted</Label>
          <Input
            type="date"
            value={app.submitted_date ?? ""}
            onChange={(e) => onPatch({ submitted_date: e.target.value || null })}
            className="h-8 w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Due</Label>
          <Input
            type="date"
            value={app.due_date ?? ""}
            onChange={(e) => onPatch({ due_date: e.target.value || null })}
            className="h-8 w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Contract</Label>
          <MoneyInput
            value={app.contract_amount}
            onValueChange={(contract_amount) => onPatch({ contract_amount })}
            align="right"
            className="h-8 w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Approved COs</Label>
          <MoneyInput
            value={app.change_order_amount}
            onValueChange={(change_order_amount) => onPatch({ change_order_amount })}
            align="right"
            className="h-8 w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Application amount</Label>
          <MoneyInput
            value={app.amount_billed}
            onValueChange={(amount_billed) => onPatch({ amount_billed })}
            align="right"
            className="h-8 w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Payments received</Label>
          <MoneyInput
            value={app.paid_to_date}
            onValueChange={(paid_to_date) => onPatch({ paid_to_date })}
            align="right"
            className="h-8 w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Retainage held</Label>
          <MoneyInput
            value={app.retainage}
            onValueChange={(retainage) => onPatch({ retainage })}
            align="right"
            className="h-8 w-full"
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
