// AI credit balance + purchase flow (mechanical split out of useAiAssist.ts
// during AITAKEOFF5 — zero behavior change, the hook was over the repo's
// 800-line bar). Owns the credit-summary query, the Stripe checkout hop for
// credit packs, and the returning-from-checkout refresh.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getCreditSummary, type CreditSummary } from "@/lib/credits/credits.functions";

export function useAiCredits(open: boolean) {
  const queryClient = useQueryClient();
  const getCreditSummaryFn = useServerFn(getCreditSummary);
  const [isPurchasing, setIsPurchasing] = useState(false);

  const creditSummaryQuery = useQuery({
    queryKey: ["credit-summary"],
    queryFn: async () => (await getCreditSummaryFn()) as CreditSummary,
    enabled: open,
    staleTime: 30_000,
  });
  const creditSummary = creditSummaryQuery.data ?? null;
  const refreshCredits = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ["credit-summary"] }),
    [queryClient],
  );

  const purchasePack = useCallback(async (packId: string) => {
    setIsPurchasing(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) throw new Error("Sign in again before buying credits.");
      const response = await fetch("/api/stripe/checkout/credits", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          packId,
          successPath: `${window.location.pathname}?credits=success`,
          cancelPath: `${window.location.pathname}?credits=cancelled`,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        checkoutUrl?: string;
        error?: string;
      };
      if (!response.ok || !payload.checkoutUrl) {
        throw new Error(payload.error || "Checkout could not start. Try again.");
      }
      window.location.href = payload.checkoutUrl;
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Checkout could not start.");
      setIsPurchasing(false);
    }
  }, []);

  // Returning from Stripe with ?credits=success refreshes the balance.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    if (params.get("credits") === "success") {
      refreshCredits();
      toast.success("Credit purchase complete — your balance updates as soon as Stripe confirms.");
      params.delete("credits");
      const next = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${next ? `?${next}` : ""}`);
    }
  }, [refreshCredits]);

  return {
    creditSummary,
    creditSummaryLoading: creditSummaryQuery.isLoading,
    refreshCredits,
    purchasePack,
    isPurchasing,
  };
}
