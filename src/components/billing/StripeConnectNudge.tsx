import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link } from "@tanstack/react-router";
import { CreditCard, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getPaymentMethodContext } from "@/lib/payments.functions";

const DISMISS_KEY = "overwatch.billing.stripe-live-connect-nudge-dismissed-v2";

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

  if (dismissed || !data || data.stripeMode === "live") return null;

  const sandboxOnly = Boolean(data.testStripeAccountId) && !data.liveStripeAccountId;
  const livePending = Boolean(data.liveStripeAccountId) && !data.liveStripeReady;

  return (
    <div
      data-testid="stripe-connect-nudge"
      className="relative rounded-lg border border-hairline bg-card p-4 shadow-card"
    >
      <div className="flex min-w-0 items-start gap-3 pr-10">
        <CreditCard className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {sandboxOnly
              ? "Move Stripe out of sandbox"
              : livePending
                ? "Finish live Stripe verification"
                : "Set up live Stripe before you need it"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {sandboxOnly
              ? "The existing sandbox account cannot receive real client payments and does not carry into live mode. Complete one live setup for this company; direct bank details keep working while Stripe verifies it."
              : livePending
                ? "This company's live connected account still needs information before real invoice payments can be activated."
                : "Stripe verifies each company before it can receive real card and bank-debit payments. Set it up early; direct bank details keep working either way."}
          </p>
          <Button
            asChild
            size="sm"
            variant="outline"
            className="mt-3 h-auto max-w-full justify-start whitespace-normal py-2 text-left leading-snug"
          >
            <Link to="/team">Open Getting paid settings</Link>
          </Button>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="absolute right-2 top-2 h-8 w-8 p-0"
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
