import { describe, expect, it } from "vitest";
import {
  creditPackLineItemFields,
  creditPackStripeMode,
  DEFAULT_LIVE_CREDIT_PACK_PRICE_IDS,
  liveCreditPackPriceId,
} from "@/lib/credits/credit-pack-checkout";
import { DEFAULT_CREDIT_PACKS } from "@/lib/credits/credits-domain";
import { DEFAULT_STRIPE_PAYMENT_LIMIT_CENTS, methodAvailability } from "@/lib/payments-domain";
import { stripeConnectionForMode, stripeModePersistencePatch } from "@/lib/stripe-mode";
import { stripeConnectDetails } from "@/lib/stripe-connect-status";

describe("Stripe connected-account readiness", () => {
  it("distinguishes Stripe review from approval", () => {
    expect(
      stripeConnectDetails({
        id: "acct_live",
        details_submitted: true,
        requirements: { pending_verification: ["company.tax_id"] },
      }),
    ).toMatchObject({ readiness: "under_review", status: "pending", ready: false });
  });

  it("surfaces required work and the connected business name", () => {
    expect(
      stripeConnectDetails({
        id: "acct_live",
        settings: { dashboard: { display_name: "Athena Software" } },
        requirements: { currently_due: ["external_account", "business_profile.url"] },
      }),
    ).toMatchObject({
      businessName: "Athena Software",
      readiness: "action_required",
      currentlyDueCount: 2,
    });
  });

  it("marks charges and payouts as ready only when both are enabled", () => {
    expect(
      stripeConnectDetails({
        id: "acct_live",
        charges_enabled: true,
        payouts_enabled: true,
        details_submitted: true,
      }),
    ).toMatchObject({ readiness: "ready", status: "active", ready: true });
  });
});

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

describe("OverWatch AI credit-pack checkout", () => {
  const pack = DEFAULT_CREDIT_PACKS[0];

  it("defaults platform revenue to live mode but supports explicit sandbox QA", () => {
    expect(creditPackStripeMode(undefined)).toBe("live");
    expect(creditPackStripeMode("live")).toBe("live");
    expect(creditPackStripeMode("test")).toBe("test");
  });

  it("binds the launch pack to the reusable OverWatch live Price", () => {
    const priceId = liveCreditPackPriceId({ packId: pack.id });
    expect(priceId).toBe(DEFAULT_LIVE_CREDIT_PACK_PRICE_IDS.pack_100);
    expect(priceId).toBe("price_1TtJmrJGLltOYaiieUrp4fSn");

    const fields = creditPackLineItemFields({ pack, mode: "live", livePriceId: priceId });
    expect(fields).toEqual({
      "line_items[0][price]": "price_1TtJmrJGLltOYaiieUrp4fSn",
      "line_items[0][quantity]": 1,
    });
    expect(Object.keys(fields).some((key) => key.includes("price_data"))).toBe(false);
  });

  it("keeps inline pricing only for explicit test-mode checkout", () => {
    expect(creditPackLineItemFields({ pack, mode: "test" })).toMatchObject({
      "line_items[0][price_data][currency]": "usd",
      "line_items[0][price_data][unit_amount]": 2500,
      "line_items[0][quantity]": 1,
    });
  });

  it("accepts a valid rotation override and rejects malformed Price IDs", () => {
    expect(liveCreditPackPriceId({ packId: pack.id, override: "price_rotated123" })).toBe(
      "price_rotated123",
    );
    expect(liveCreditPackPriceId({ packId: pack.id, override: "prod_wrong_kind" })).toBe("");
    expect(liveCreditPackPriceId({ packId: "unknown" })).toBe("");
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
