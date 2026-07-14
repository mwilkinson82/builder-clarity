import { Landmark } from "lucide-react";

import { dollarsToCents, methodAvailability, resolveEnabledMethods } from "@/lib/payments-domain";
import type { PaymentMethodContext } from "@/lib/payments.functions";
import { fmtUSD } from "@/lib/format";

interface InvoicePaymentMethodTogglesProps {
  /** The invoice's enabled_payment_methods jsonb ({} = inherit defaults). */
  value: Record<string, boolean>;
  /** Invoice total in dollars, for the Stripe amount guardrail. */
  invoiceTotal: number;
  context: PaymentMethodContext | undefined;
  onChange: (next: Record<string, boolean>) => void;
  disabled?: boolean;
}

/**
 * Per-invoice payment method toggles: what the client sees on this invoice.
 * Direct bank transfer needs the company payment profile; Card and Bank debit
 * need a ready Stripe account and sit behind the company's amount guardrail
 * unless deliberately overridden for this invoice.
 */
export function InvoicePaymentMethodToggles({
  value,
  invoiceTotal,
  context,
  onChange,
  disabled,
}: InvoicePaymentMethodTogglesProps) {
  const enabled = resolveEnabledMethods(value, context?.defaultPaymentMethods ?? null);
  const availability = methodAvailability({
    hasPaymentProfile: Boolean(context?.hasPaymentProfile),
    stripeReady: Boolean(context?.stripeReady),
    enabled,
    invoiceTotalCents: dollarsToCents(invoiceTotal),
    thresholdCents: context?.stripeAmountThresholdCents ?? 0,
    platformLimitCents: context?.stripePaymentLimitCents,
  });

  const setKey = (key: string, next: boolean) =>
    onChange({
      direct_bank: enabled.direct_bank,
      card: enabled.card,
      ach_debit: enabled.ach_debit,
      allow_stripe_over_threshold: enabled.allow_stripe_over_threshold,
      [key]: next,
    });

  const stripeBlockedNote =
    availability.card.reason === "stripe_not_ready" ||
    availability.ach_debit.reason === "stripe_not_ready"
      ? "Connect Stripe to enable"
      : "";

  return (
    <div className="space-y-2 rounded-md border border-hairline bg-surface px-3 py-2.5">
      <div className="text-sm font-medium">How can the client pay this invoice?</div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled.direct_bank}
          disabled={disabled || !context?.hasPaymentProfile}
          onChange={(event) => setKey("direct_bank", event.target.checked)}
        />
        Direct bank transfer (your wire/ACH details print on the invoice)
        {!context?.hasPaymentProfile && (
          <span className="text-xs text-muted-foreground">
            — add bank details in Your Company → Getting paid
          </span>
        )}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled.card}
          disabled={disabled || !context?.stripeReady}
          onChange={(event) => setKey("card", event.target.checked)}
        />
        Card
        {stripeBlockedNote && !context?.stripeReady && (
          <span className="text-xs text-muted-foreground">— {stripeBlockedNote}</span>
        )}
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled.ach_debit}
          disabled={disabled || !context?.stripeReady}
          onChange={(event) => setKey("ach_debit", event.target.checked)}
        />
        Bank debit (ACH)
        {stripeBlockedNote && !context?.stripeReady && (
          <span className="text-xs text-muted-foreground">— {stripeBlockedNote}</span>
        )}
      </label>
      {availability.stripeBlockedByPlatformLimit ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <div className="flex items-center gap-1.5 font-medium">
            <Landmark className="h-3.5 w-3.5" />
            Card & bank debit are unavailable on this invoice
          </div>
          <p className="mt-1">
            The amount is above OverWatch's current online-payment ceiling of{" "}
            {fmtUSD((context?.stripePaymentLimitCents ?? 0) / 100)}. This ceiling cannot be
            overridden on an invoice; use direct bank transfer or request an increase under Your
            Company → Getting paid.
          </p>
        </div>
      ) : availability.stripeHiddenByThreshold ? (
        <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <div className="flex items-center gap-1.5 font-medium">
            <Landmark className="h-3.5 w-3.5" />
            Card & bank debit are hidden on this invoice
          </div>
          <p className="mt-1">
            This invoice is over the company limit of{" "}
            {fmtUSD((context?.stripeAmountThresholdCents ?? 0) / 100)} for online payments, so the
            client sees only your direct bank details. Money this size belongs on the wire rail —
            override below only if you accept the processing exposure.
          </p>
          <label className="mt-2 flex items-center gap-2">
            <input
              type="checkbox"
              checked={enabled.allow_stripe_over_threshold}
              disabled={disabled}
              onChange={(event) => setKey("allow_stripe_over_threshold", event.target.checked)}
            />
            Offer card & bank debit on this invoice anyway
          </label>
        </div>
      ) : null}
    </div>
  );
}
