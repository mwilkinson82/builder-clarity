import { Copy, CreditCard, ExternalLink, Hourglass, Landmark } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { ClientInvoicePaymentOptions } from "@/lib/client-portal.functions";
import type { PendingPaymentLockState } from "@/lib/payments-domain";

function pendingLockStartedLabel(startedAtIso: string | null) {
  if (!startedAtIso) return "";
  const date = new Date(startedAtIso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function RemittanceLine({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(`${label} copied`);
    } catch {
      toast.error("Could not copy — select the text instead.");
    }
  };
  return (
    <div className="flex items-center justify-between gap-3 border-b border-hairline py-2 text-sm last:border-b-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 text-right font-medium tabular">
        {value}
        <button
          type="button"
          aria-label={`Copy ${label}`}
          className="text-muted-foreground hover:text-foreground"
          onClick={copy}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      </span>
    </div>
  );
}

interface HowToPayBlockProps {
  options: ClientInvoicePaymentOptions | undefined;
  openBalance: number;
  /** Pre-generated Stripe link (legacy flow) used when no live options exist. */
  legacyPaymentUrl: string;
  onPayOnline: (method: "card" | "ach_debit") => void;
  payPending: boolean;
  /**
   * A Stripe payment for this invoice is in flight (checkout session created
   * and neither resolved nor expired). Pay buttons are replaced so a second
   * payment can never be collected against the same invoice.
   */
  pendingLock?: PendingPaymentLockState;
}

/**
 * The client-facing "How to pay" block. Direct bank transfer is the
 * first-class rail: full remittance details, formatted like they belong on a
 * requisition. Stripe buttons appear only for methods the contractor enabled
 * and that clear the amount guardrail.
 */
export function HowToPayBlock({
  options,
  openBalance,
  legacyPaymentUrl,
  onPayOnline,
  payPending,
  pendingLock,
}: HowToPayBlockProps) {
  if (openBalance <= 0) return null;

  const locked = Boolean(pendingLock?.locked);
  const remittance = options?.remittance ?? null;
  const showCard = Boolean(options?.card) && !locked;
  const showAch = Boolean(options?.achDebit) && !locked;
  const showLegacyLink = !options && Boolean(legacyPaymentUrl) && !locked;

  if (!remittance && !showCard && !showAch && !showLegacyLink && !locked) return null;
  const lockStartedLabel = pendingLockStartedLabel(pendingLock?.startedAtIso ?? null);

  return (
    <div data-testid="how-to-pay" className="mt-5 rounded-md border border-hairline bg-surface p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        How to pay
      </div>

      {locked ? (
        <div
          data-testid="payment-processing-lock"
          className="mt-3 rounded-md border border-warning/30 bg-warning/10 p-4"
        >
          <div className="flex items-center gap-2 text-sm font-medium text-warning">
            <Hourglass className="h-4 w-4" />
            Payment processing{lockStartedLabel ? ` — started ${lockStartedLabel}` : ""}
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            A payment for this invoice is already on its way (bank debits can take a few business
            days to settle). To avoid paying twice, online payment reopens if it fails or expires.
          </p>
        </div>
      ) : null}

      {remittance && !locked ? (
        <div className="mt-3 rounded-md border border-hairline bg-card p-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Landmark className="h-4 w-4" />
            Direct bank transfer
          </div>
          <div className="mt-3">
            <RemittanceLine label="Bank" value={remittance.bankName} />
            <RemittanceLine label="Routing number" value={remittance.routingNumber} />
            <RemittanceLine label="Account number" value={remittance.accountNumber} />
            <RemittanceLine label="Payment reference" value={remittance.memo} />
          </div>
          {remittance.wireInstructions ? (
            <div className="mt-3 rounded-md bg-muted/20 p-3 text-sm text-muted-foreground whitespace-pre-wrap">
              {remittance.wireInstructions}
            </div>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            Include the payment reference so your payment is applied to this invoice.
          </p>
        </div>
      ) : null}

      {showCard || showAch ? (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {showCard ? (
            <Button
              type="button"
              className="gap-1.5"
              disabled={payPending}
              onClick={() => onPayOnline("card")}
            >
              <CreditCard className="h-3.5 w-3.5" />
              {payPending ? "Opening…" : "Pay by card"}
            </Button>
          ) : null}
          {showAch ? (
            <Button
              type="button"
              variant={showCard ? "outline" : "default"}
              className="gap-1.5"
              disabled={payPending}
              onClick={() => onPayOnline("ach_debit")}
            >
              <Landmark className="h-3.5 w-3.5" />
              {payPending ? "Opening…" : "Pay by bank debit (ACH)"}
            </Button>
          ) : null}
          <span className="text-xs text-muted-foreground">
            Secure checkout by Stripe. A receipt is emailed after payment.
          </span>
        </div>
      ) : null}

      {showLegacyLink ? (
        <Button asChild className="mt-3 gap-1.5">
          <a href={legacyPaymentUrl} target="_blank" rel="noreferrer">
            <CreditCard className="h-3.5 w-3.5" />
            Pay invoice online
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      ) : null}
    </div>
  );
}
