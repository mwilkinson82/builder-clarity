import { describe, expect, it } from "vitest";
import { DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS, methodAvailability } from "@/lib/payments-domain";
import { stripeConnectionForMode, stripeModePersistencePatch } from "@/lib/stripe-mode";

describe("Stripe live/test account isolation", () => {
  it("never falls back to a sandbox account when live mode is selected", () => {
    const selected = stripeConnectionForMode({
      stripe_mode: "live",
      stripe_connect_account_id: "acct_legacy_test",
      stripe_connect_status: "active",
      payment_processor_ready: true,
      stripe_connect_account_id_test: "acct_test",
      stripe_connect_status_test: "active",
      stripe_connect_account_id_live: "",
      stripe_connect_status_live: "not_connected",
    });

    expect(selected).toEqual({
      mode: "live",
      accountId: "",
      connectStatus: "not_connected",
      ready: false,
    });
  });

  it("preserves the legacy sandbox fallback during the migration window", () => {
    expect(
      stripeConnectionForMode({
        stripe_mode: "test",
        stripe_connect_account_id: "acct_legacy_test",
        stripe_connect_status: "active",
        payment_processor_ready: true,
      }),
    ).toEqual({
      mode: "test",
      accountId: "acct_legacy_test",
      connectStatus: "active",
      ready: true,
    });
  });

  it("uses only the requested mode's id and status", () => {
    const row = {
      stripe_mode: "test",
      stripe_connect_account_id_test: "acct_test",
      stripe_connect_status_test: "active",
      stripe_connect_account_id_live: "acct_live",
      stripe_connect_status_live: "pending",
    };

    expect(stripeConnectionForMode(row, "test").ready).toBe(true);
    expect(stripeConnectionForMode(row, "live")).toMatchObject({
      mode: "live",
      accountId: "acct_live",
      connectStatus: "pending",
      ready: false,
    });
  });

  it("persists account updates into the matching mode columns", () => {
    expect(stripeModePersistencePatch("live", "acct_live", "active")).toEqual({
      stripe_connect_account_id_live: "acct_live",
      stripe_connect_status_live: "active",
    });
  });
});

describe("Stripe payment ceiling", () => {
  const enabled = {
    direct_bank: true,
    card: true,
    ach_debit: true,
    allow_stripe_over_threshold: true,
  };

  it("cannot be bypassed by an invoice threshold override", () => {
    const result = methodAvailability({
      enabled,
      invoiceTotalCents: DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS + 1,
      thresholdCents: 1_000,
      platformLimitCents: DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS,
      stripeReady: true,
      hasPaymentProfile: true,
    });

    expect(result.card).toMatchObject({ available: false, reason: "platform_limit" });
    expect(result.ach_debit).toMatchObject({ available: false, reason: "platform_limit" });
    expect(result.direct_bank.available).toBe(true);
    expect(result.stripeBlockedByPlatformLimit).toBe(true);
  });

  it("allows a payment exactly at the ceiling", () => {
    const result = methodAvailability({
      enabled,
      invoiceTotalCents: DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS,
      thresholdCents: 1_000,
      platformLimitCents: DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS,
      stripeReady: true,
      hasPaymentProfile: true,
    });

    expect(result.card.available).toBe(true);
    expect(result.ach_debit.available).toBe(true);
    expect(result.stripeBlockedByPlatformLimit).toBe(false);
  });
});
