import { describe, expect, it } from "vitest";
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
