// AI credit pack checkout (AITAKEOFF1 Task 0).
// One-time payment on the PLATFORM Stripe account — this is Overwatch
// revenue, never a connected-account charge. Reuses the existing platform
// checkout path (same helpers, same webhook) with mode "payment" instead of
// "subscription"; the webhook credits the ledger idempotently on
// checkout.session.completed with metadata.kind === "credit_pack".

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  appendStripeForm,
  getAppOrigin,
  jsonError,
  jsonOk,
  readServerEnv,
  requireAuthedStripeContext,
  requireManageSettings,
  stripePost,
  type StripeCheckoutSession,
} from "@/lib/stripe.server";
import { creditPacksFromEnv, findCreditPack } from "@/lib/credits/credits-domain";
import {
  creditPackLineItemFields,
  creditPackStripeMode,
  liveCreditPackPriceId,
} from "@/lib/credits/credit-pack-checkout";

const creditCheckoutInput = z.object({
  packId: z.string().max(100),
  successPath: z.string().max(500).optional(),
  cancelPath: z.string().max(500).optional(),
});

function normalizedInternalPath(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  if (!value.startsWith("/")) return fallback;
  if (value.startsWith("//")) return fallback;
  return value;
}

export const Route = createFileRoute("/api/stripe/checkout/credits")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = creditCheckoutInput.parse(await request.json());
          const context = await requireAuthedStripeContext(request);

          // Purchases always target the buyer's own workspace. Because this is
          // a company charge, the same company-management permission used by
          // subscription checkout is required before opening Stripe.
          const { data: organizationId, error: orgError } = await context.authed.rpc(
            "ensure_current_user_account",
          );
          if (orgError) throw new Error(orgError.message);
          if (!organizationId) {
            throw new Error("No Overwatch company workspace is available for this user.");
          }
          await requireManageSettings(context, String(organizationId));

          const packs = creditPacksFromEnv(process.env.CREDIT_PACKS_JSON);
          const pack = findCreditPack(packs, body.packId);
          if (!pack) throw new Error("That credit pack is no longer available.");

          const origin = getAppOrigin(request);
          const successUrl = new URL(
            normalizedInternalPath(body.successPath, "/estimates?credits=success"),
            origin,
          );
          const cancelUrl = new URL(
            normalizedInternalPath(body.cancelPath, "/estimates?credits=cancelled"),
            origin,
          );

          const form = new URLSearchParams();
          appendStripeForm(form, "mode", "payment");
          appendStripeForm(form, "client_reference_id", String(organizationId));
          appendStripeForm(form, "success_url", successUrl.toString());
          appendStripeForm(form, "cancel_url", cancelUrl.toString());
          // Cards only: credits should land the moment checkout completes,
          // never wait on async bank settlement.
          appendStripeForm(form, "payment_method_types[0]", "card");
          // Credit packs are OverWatch revenue, independent of the contractor's
          // connected-account sandbox/live setting. Production uses the
          // permanent live catalog Price; explicit test mode keeps inline test
          // pricing so local/sandbox QA never needs a duplicate test product.
          const stripeMode = creditPackStripeMode(
            readServerEnv("OVERWATCH_CREDIT_PACK_MODE") ||
              readServerEnv("OVERWATCH_SUBSCRIPTION_MODE"),
          );
          const livePriceId = liveCreditPackPriceId({
            packId: pack.id,
            override: readServerEnv("OVERWATCH_AI_CREDIT_PACK_PRICE_ID"),
          });
          const lineItemFields = creditPackLineItemFields({ pack, mode: stripeMode, livePriceId });
          for (const [key, value] of Object.entries(lineItemFields)) {
            appendStripeForm(form, key, value);
          }
          appendStripeForm(form, "metadata[kind]", "credit_pack");
          appendStripeForm(form, "metadata[organization_id]", String(organizationId));
          appendStripeForm(form, "metadata[user_id]", context.user.id);
          appendStripeForm(form, "metadata[pack_id]", pack.id);
          appendStripeForm(form, "metadata[credits]", pack.credits);
          appendStripeForm(form, "customer_email", context.user.email);

          const session = await stripePost<StripeCheckoutSession>(
            "checkout/sessions",
            form,
            `credit-pack-checkout:${organizationId}:${pack.id}:${crypto.randomUUID()}`,
            undefined, // no Stripe-Account header: PLATFORM account
            stripeMode,
          );

          return jsonOk({
            sessionId: session.id,
            checkoutUrl: session.url ?? "",
            organizationId: String(organizationId),
            packId: pack.id,
            credits: pack.credits,
          });
        } catch (error) {
          return jsonError(error);
        }
      },
    },
  },
});
