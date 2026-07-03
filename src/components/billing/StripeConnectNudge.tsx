import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CreditCard, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getPaymentMethodContext } from "@/lib/payments.functions";

const DISMISS_KEY = "overwatch.billing.stripe-connect-nudge-dismissed";

function readDismissed() {
  try {
    return window.localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Dismissible nudge on the billing dashboard while no Stripe account is
 * connected: verification takes time, so connecting early means card and
 * bank-debit payments are ready before they're needed. Direct bank transfer
 * works regardless — this is encouragement, never a requirement.
 */
export function StripeConnectNudge() {
  const loadContext = useServerFn(getPaymentMethodContext);
  const [dismissed, setDismissed] = useState(readDismissed);
  const { data } = useQuery({
    queryKey: ["payment-method-context", "company"],
    queryFn: () => loadContext({ data: {} }),
    enabled: !dismissed,
    staleTime: 5 * 60 * 1000,
  });

  if (dismissed || !data || data.stripeReady || data.stripeAccountId) return null;

  return (
    <div
      data-testid="stripe-connect-nudge"
      className="flex items-start justify-between gap-4 rounded-lg border border-hairline bg-card p-4 shadow-card"
    >
      <div className="flex items-start gap-3">
        <CreditCard className="mt-0.5 h-4 w-4 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Connect Stripe before you need it</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Stripe verifies new businesses, and that takes time. Connect early so card and bank
            debit are ready when a client wants them — your direct bank details keep working either
            way.
          </p>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link to="/team">Open Getting paid settings</Link>
          </Button>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        aria-label="Dismiss Stripe reminder"
        onClick={() => {
          try {
            window.localStorage.setItem(DISMISS_KEY, "1");
          } catch {
            // localStorage unavailable (private mode) - dismiss for this visit only
          }
          setDismissed(true);
        }}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
