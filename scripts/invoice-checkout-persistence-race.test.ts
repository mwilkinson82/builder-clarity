import { describe, expect, it, vi } from "vitest";
import {
  invoiceCheckoutAttemptKey,
  persistInvoiceCheckoutOrExpire,
  persistedPendingCheckout,
  type InvoiceCheckoutState,
} from "@/lib/invoice-checkout-persistence";

const issuedInvoice: InvoiceCheckoutState = {
  id: "11111111-1111-4111-8111-111111111111",
  status: "sent",
  updated_at: "2026-07-20T01:00:00.000Z",
  online_payment_status: "not_enabled",
  stripe_checkout_session_id: "",
  payment_url: "",
};

describe("invoice checkout post-create persistence race", () => {
  it("expires the new external session when the invoice command loses the race", async () => {
    const expire = vi.fn(async () => undefined);

    await expect(
      persistInvoiceCheckoutOrExpire({
        persist: async () => ({ error: { message: "A different checkout is pending." } }),
        expire,
      }),
    ).rejects.toThrow("A different checkout is pending.");

    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("also expires after an ambiguous persistence transport failure", async () => {
    const expire = vi.fn(async () => undefined);

    await expect(
      persistInvoiceCheckoutOrExpire({
        persist: async () => {
          throw new Error("database response was lost");
        },
        expire,
      }),
    ).rejects.toThrow("database response was lost");

    expect(expire).toHaveBeenCalledTimes(1);
  });

  it("keeps the committed session when the first database response is lost", async () => {
    const expire = vi.fn(async () => undefined);
    let committed = false;
    const persist = vi.fn(async () => {
      if (!committed) {
        committed = true;
        throw new Error("database response was lost after commit");
      }
      return { error: null };
    });

    await persistInvoiceCheckoutOrExpire({ persist, expire });

    expect(persist).toHaveBeenCalledTimes(2);
    expect(expire).not.toHaveBeenCalled();
  });

  it("reconciles a matching committed session before cleanup", async () => {
    const expire = vi.fn(async () => undefined);

    await persistInvoiceCheckoutOrExpire({
      persist: async () => {
        throw new Error("database responses unavailable");
      },
      confirmPersisted: async () => true,
      expire,
    });

    expect(expire).not.toHaveBeenCalled();
  });

  it("reports cleanup failure while preserving the authoritative command error", async () => {
    const cleanupError = new Error("Stripe expiry failed");
    const onExpirationFailure = vi.fn();

    await expect(
      persistInvoiceCheckoutOrExpire({
        persist: async () => ({ error: { message: "Invoice was voided." } }),
        expire: async () => {
          throw cleanupError;
        },
        onExpirationFailure,
      }),
    ).rejects.toThrow("Invoice was voided.");

    expect(onExpirationFailure).toHaveBeenCalledWith(cleanupError);
  });

  it("leaves a successfully persisted Checkout session open", async () => {
    const expire = vi.fn(async () => undefined);

    await persistInvoiceCheckoutOrExpire({
      persist: async () => ({ error: null }),
      expire,
    });

    expect(expire).not.toHaveBeenCalled();
  });
});

describe("invoice checkout retry identity", () => {
  it("returns the already-persisted pending URL for a client retry", () => {
    expect(
      persistedPendingCheckout({
        ...issuedInvoice,
        online_payment_status: "pending",
        stripe_checkout_session_id: "cs_authoritative",
        payment_url: "https://checkout.stripe.com/c/pay/cs_authoritative",
      }),
    ).toEqual({
      sessionId: "cs_authoritative",
      checkoutUrl: "https://checkout.stripe.com/c/pay/cs_authoritative",
    });

    expect(
      persistedPendingCheckout({
        ...issuedInvoice,
        online_payment_status: "expired",
        stripe_checkout_session_id: "cs_expired",
        payment_url: "https://checkout.stripe.com/c/pay/cs_expired",
      }),
    ).toBeNull();
  });

  it("reuses one Stripe attempt after response loss but creates a new attempt after expiry", () => {
    const stripeSessions = new Map<string, string>();
    const createSession = (key: string) => {
      const existing = stripeSessions.get(key);
      if (existing) return existing;
      const created = `cs_${stripeSessions.size + 1}`;
      stripeSessions.set(key, created);
      return created;
    };
    const keyFor = (invoice: InvoiceCheckoutState) =>
      invoiceCheckoutAttemptKey({
        invoice,
        stripeMode: "test",
        openBalanceCents: 125_000,
        paymentMethods: ["card", "ach_debit"],
        surchargeCents: 0,
      });

    const firstKey = keyFor(issuedInvoice);
    expect(createSession(firstKey)).toBe("cs_1");
    expect(createSession(keyFor({ ...issuedInvoice }))).toBe("cs_1");

    // Portal views, collection touches, or other ordinary invoice updates can
    // change the generic row version while the first HTTP response is lost.
    // They are not a new processor attempt and must keep Stripe idempotent.
    const unrelatedUpdateKey = keyFor({
      ...issuedInvoice,
      status: "overdue",
      updated_at: "2026-07-20T01:30:00.000Z",
    });
    expect(unrelatedUpdateKey).toBe(firstKey);
    expect(createSession(unrelatedUpdateKey)).toBe("cs_1");

    const expiredKey = keyFor({
      ...issuedInvoice,
      online_payment_status: "expired",
      stripe_checkout_session_id: "cs_1",
      payment_link_sent_at: "2026-07-20T01:00:05.000Z",
      updated_at: "2026-07-20T02:00:00.000Z",
    });
    expect(expiredKey).not.toBe(firstKey);
    expect(createSession(expiredKey)).toBe("cs_2");
  });
});
