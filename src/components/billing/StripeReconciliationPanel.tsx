import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, SearchCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtUSDCents } from "@/lib/billing-format";
import {
  listUnmatchedStripePayments,
  recordUnmatchedStripePayment,
  type ReconcileInvoiceOption,
  type UnmatchedStripePayment,
} from "@/lib/payments.functions";

function paymentMethodLabel(type: string) {
  if (type === "us_bank_account") return "Bank debit (ACH)";
  if (type === "card") return "Card";
  return type ? type.replace(/_/g, " ") : "Stripe";
}

function paymentDateLabel(iso: string) {
  if (!iso) return "No date";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "No date";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

type SweepResult = Awaited<ReturnType<typeof listUnmatchedStripePayments>>;

export function eligibleReconcileInvoices(
  payment: Pick<UnmatchedStripePayment, "netAppliedAmountCents">,
  invoices: ReconcileInvoiceOption[],
) {
  return invoices.filter(
    (invoice) => payment.netAppliedAmountCents <= Math.round(invoice.openBalance * 100),
  );
}

export function StripeReconciliationPanel() {
  const runSweep = useServerFn(listUnmatchedStripePayments);
  const recordPayment = useServerFn(recordUnmatchedStripePayment);
  const [sweep, setSweep] = useState<SweepResult | null>(null);
  const [invoiceByPayment, setInvoiceByPayment] = useState<Record<string, string>>({});
  const [bookedIds, setBookedIds] = useState<Set<string>>(new Set());

  const sweepMutation = useMutation({
    mutationFn: async () => runSweep(),
    onSuccess: (result) => {
      setSweep(result);
      setBookedIds(new Set());
      setInvoiceByPayment({});
    },
    onError: (error) =>
      toast.error("Stripe check did not run", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  const recordMutation = useMutation({
    mutationFn: async (payment: UnmatchedStripePayment) => {
      const invoiceId = invoiceByPayment[payment.stripeChargeId];
      if (!invoiceId) throw new Error("Pick the invoice this payment belongs to first.");
      return recordPayment({
        data: {
          invoiceId,
          stripeChargeId: payment.stripeChargeId,
        },
      });
    },
    onSuccess: (result, payment) => {
      setBookedIds((current) => new Set(current).add(payment.stripeChargeId));
      toast.success(
        result.refundedGrossCents ? "Payment and refund recovered" : "Payment recorded",
        {
          description: result.refundedGrossCents
            ? "The original receipt, linked refund evidence, invoice, and A/R were committed together."
            : "The invoice, ledger, and A/R now include this Stripe payment.",
        },
      );
    },
    onError: (error) =>
      toast.error("Payment did not record", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  const unmatched = sweep?.ready ? sweep.payments : [];
  const openInvoices: ReconcileInvoiceOption[] = sweep?.ready ? sweep.openInvoices : [];

  return (
    <div className="rounded-lg border border-hairline bg-surface p-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium">
            <SearchCheck className="h-4 w-4" /> Payment reconciliation
          </div>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Check settled Stripe payments against recorded invoice payments and flag anything that
            never reached A/R.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={sweepMutation.isPending}
          onClick={() => sweepMutation.mutate()}
        >
          {sweepMutation.isPending ? "Checking Stripe…" : "Check for unmatched payments"}
        </Button>
      </div>

      {sweep && !sweep.ready ? (
        <div className="mt-3 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          {sweep.reason}
        </div>
      ) : null}

      {sweep?.ready ? (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-muted-foreground">
            Checked {sweep.checkedCount} settled payment{sweep.checkedCount === 1 ? "" : "s"} ·{" "}
            {unmatched.length === 0
              ? "all are recorded against an invoice."
              : `${unmatched.length} need attention.`}
          </p>
          {sweep.partiallyRefundedCount > 0 || sweep.fullyRefundedCount > 0 ? (
            <div className="rounded-md border border-hairline bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
              Refund-aware recovery is active: {sweep.partiallyRefundedCount} partial and{" "}
              {sweep.fullyRefundedCount} full refund
              {sweep.fullyRefundedCount === 1 ? "" : "s"} were checked with their original receipts.
            </div>
          ) : null}
          {unmatched.map((payment) => {
            const booked = bookedIds.has(payment.stripeChargeId);
            const eligibleInvoices = eligibleReconcileInvoices(payment, openInvoices);
            const recording =
              recordMutation.isPending &&
              recordMutation.variables?.stripeChargeId === payment.stripeChargeId;
            return (
              <div
                key={payment.stripeChargeId}
                className={`rounded-md border p-3 ${
                  booked ? "border-success/30 bg-success/5" : "border-warning/30 bg-warning/5"
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="min-w-0">
                    <div className="text-sm font-medium tabular">
                      {payment.refundedGrossCents > 0
                        ? `${fmtUSDCents(payment.amount)} original · ${fmtUSDCents(
                            payment.refundedGrossCents / 100,
                          )} refunded · ${fmtUSDCents(payment.netAppliedAmountCents / 100)} net A/R`
                        : fmtUSDCents(payment.amount)}{" "}
                      · {paymentMethodLabel(payment.paymentMethodType)} ·{" "}
                      {paymentDateLabel(payment.paidAtIso)}
                    </div>
                    <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                      {payment.stripePaymentIntentId || payment.stripeChargeId}
                    </div>
                  </div>
                  {booked ? (
                    <div className="flex items-center gap-1.5 text-sm font-medium text-success">
                      <CheckCircle2 className="h-4 w-4" /> Recorded
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Select
                        value={invoiceByPayment[payment.stripeChargeId] ?? ""}
                        onValueChange={(invoiceId) =>
                          setInvoiceByPayment((current) => ({
                            ...current,
                            [payment.stripeChargeId]: invoiceId,
                          }))
                        }
                      >
                        <SelectTrigger className="h-9 sm:w-[320px]">
                          <SelectValue placeholder="Record to invoice…" />
                        </SelectTrigger>
                        <SelectContent>
                          {eligibleInvoices.length === 0 ? (
                            <SelectItem value="none" disabled>
                              No invoice has enough open balance
                            </SelectItem>
                          ) : (
                            eligibleInvoices.map((invoice) => (
                              <SelectItem key={invoice.id} value={invoice.id}>
                                {invoice.projectName} · {invoice.label} ·{" "}
                                {fmtUSDCents(invoice.openBalance)} open
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                      <Button
                        type="button"
                        size="sm"
                        disabled={recording || !invoiceByPayment[payment.stripeChargeId]}
                        onClick={() => recordMutation.mutate(payment)}
                      >
                        {recording
                          ? "Recording…"
                          : payment.refundedGrossCents > 0
                            ? "Recover receipt + refund"
                            : "Record payment"}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
