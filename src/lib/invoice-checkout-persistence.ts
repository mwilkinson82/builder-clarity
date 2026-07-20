type CommandError = { message: string } | null;

type PersistInvoiceCheckoutInput = {
  persist: () => Promise<{ error: CommandError }>;
  confirmPersisted?: () => Promise<boolean>;
  expire: () => Promise<unknown>;
  onExpirationFailure?: (error: unknown) => void;
};

export type InvoiceCheckoutState = {
  id: string;
  status: string;
  updated_at: string;
  online_payment_status?: string | null;
  stripe_checkout_session_id?: string | null;
  payment_url?: string | null;
  payment_link_sent_at?: string | null;
};

export type PersistedPendingCheckout = {
  sessionId: string;
  checkoutUrl: string;
};

export function persistedPendingCheckout(
  invoice: InvoiceCheckoutState,
): PersistedPendingCheckout | null {
  const sessionId = invoice.stripe_checkout_session_id?.trim() ?? "";
  const checkoutUrl = invoice.payment_url?.trim() ?? "";
  if (invoice.online_payment_status !== "pending" || !sessionId || !checkoutUrl) return null;
  return { sessionId, checkoutUrl };
}

type InvoiceCheckoutAttemptKeyInput = {
  invoice: InvoiceCheckoutState;
  stripeMode: string;
  openBalanceCents: number;
  paymentMethods: readonly string[];
  surchargeCents: number;
};

/**
 * Stripe idempotency is scoped to one authoritative processor generation.
 * Generic invoice updated_at/status are deliberately excluded: portal views,
 * collection notes, and other unrelated invoice activity must not create a
 * second Checkout after response loss. Expired/failed processor state retains
 * the prior session evidence and produces the next generation.
 */
export function invoiceCheckoutAttemptKey({
  invoice,
  stripeMode,
  openBalanceCents,
  paymentMethods,
  surchargeCents,
}: InvoiceCheckoutAttemptKeyInput): string {
  return [
    "invoice-checkout",
    invoice.id,
    stripeMode,
    openBalanceCents,
    paymentMethods.join("+"),
    surchargeCents,
    invoice.online_payment_status ?? "not_enabled",
    invoice.stripe_checkout_session_id?.trim() || "no-session",
    invoice.payment_link_sent_at ?? "no-link-timestamp",
  ].join(":");
}

/**
 * Stripe creates the externally payable session before Postgres can attach it
 * to the invoice. If the authoritative command loses a race (void, payment,
 * or another checkout), close the new session before surfacing the database
 * error so an untracked payable URL is not left active.
 */
export async function persistInvoiceCheckoutOrExpire({
  persist,
  confirmPersisted,
  expire,
  onExpirationFailure,
}: PersistInvoiceCheckoutInput): Promise<void> {
  let persistenceError: unknown = null;
  // Retrying the exact command closes the common "commit succeeded, response
  // was lost" window. The route intentionally supplies a retry-stable payload
  // (including a null sent-at timestamp), so the second call deduplicates.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await persist();
      if (!result.error) return;
      persistenceError = new Error(result.error.message);
    } catch (error) {
      persistenceError = error;
    }
  }

  // When both command responses are ambiguous, reconcile the authoritative
  // row before closing the external session. A committed Checkout must never
  // be expired merely because its database response was lost.
  if (confirmPersisted) {
    try {
      if (await confirmPersisted()) return;
    } catch {
      // If reconciliation is unavailable, preserve the session. A later retry
      // uses the same Stripe idempotency key and can finish persistence safely.
      throw persistenceError;
    }
  }

  try {
    await expire();
  } catch (error) {
    onExpirationFailure?.(error);
  }
  throw persistenceError;
}
