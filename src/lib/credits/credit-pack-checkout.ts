import type { CreditPack } from "@/lib/credits/credits-domain";

export type CreditPackStripeMode = "test" | "live";

// Price IDs are public catalog identifiers, not secrets. The environment
// override lets us rotate the live Price without a code change; the checked-in
// default binds the launch SKU created in the OverWatch live Stripe account.
export const DEFAULT_LIVE_CREDIT_PACK_PRICE_IDS: Readonly<Record<string, string>> = {
  pack_100: "price_1TtJmrJGLltOYaiieUrp4fSn",
};

export function creditPackStripeMode(value: string | undefined | null): CreditPackStripeMode {
  return value?.trim().toLowerCase() === "test" ? "test" : "live";
}

export function liveCreditPackPriceId(input: {
  packId: string;
  override?: string | null;
  defaults?: Readonly<Record<string, string>>;
}) {
  const override = input.override?.trim() ?? "";
  const candidate =
    override || (input.defaults ?? DEFAULT_LIVE_CREDIT_PACK_PRICE_IDS)[input.packId];
  return candidate && /^price_[A-Za-z0-9]+$/.test(candidate) ? candidate : "";
}

export function creditPackLineItemFields(input: {
  pack: CreditPack;
  mode: CreditPackStripeMode;
  livePriceId?: string;
}): Record<string, string | number> {
  if (input.mode === "live") {
    if (!input.livePriceId) {
      throw new Error("The live AI credit pack does not have a Stripe Price configured.");
    }
    return {
      "line_items[0][price]": input.livePriceId,
      "line_items[0][quantity]": 1,
    };
  }

  return {
    "line_items[0][quantity]": 1,
    "line_items[0][price_data][currency]": "usd",
    "line_items[0][price_data][unit_amount]": input.pack.amountCents,
    "line_items[0][price_data][product_data][name]": `OverWatch AI credits — ${input.pack.label}`,
  };
}
