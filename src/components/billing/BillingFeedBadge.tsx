// Unread badge for the billing nav (GETTINGPAID1 Task 0): payments that
// landed since the biller last opened the receivables cockpit. In-app only
// by design — email notifications belong to the future notifications module.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { getBillingFeedPulse } from "@/lib/receivables.functions";
import { BILLING_FEED_SEEN_KEY } from "@/components/billing/ReceivablesCockpit";

function feedSeenAt(): string | undefined {
  try {
    return window.localStorage.getItem(BILLING_FEED_SEEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function BillingFeedBadge() {
  const loadPulse = useServerFn(getBillingFeedPulse);
  const pulseQuery = useQuery({
    queryKey: ["billing-feed-pulse"],
    queryFn: () => loadPulse({ data: { sinceIso: feedSeenAt() } }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
  });
  const unseen = pulseQuery.data?.unseenCount ?? 0;
  if (unseen <= 0) return null;
  return (
    <span
      data-testid="billing-feed-badge"
      className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-none text-white"
      aria-label={`${unseen} new payment${unseen === 1 ? "" : "s"}`}
    >
      {unseen > 9 ? "9+" : unseen}
    </span>
  );
}
