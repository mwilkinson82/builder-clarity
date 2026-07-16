import { MailCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { SurfaceMessage } from "./FollowUpStudioParts";
import { crmActionError, useCrmActionSuite } from "./useCrmActionSuite";

export function DeliveryHistoryPanel() {
  const query = useCrmActionSuite();
  if (query.isLoading) return <SurfaceMessage>Loading delivery history…</SurfaceMessage>;
  if (query.isError) {
    return <SurfaceMessage tone="danger">{crmActionError(query.error)}</SurfaceMessage>;
  }
  if (!query.data?.enabled) {
    return (
      <SurfaceMessage>
        Delivery history will activate with the CRM action-suite migration.
      </SurfaceMessage>
    );
  }
  const deliveries = query.data.outboundMessages.slice(0, 8);
  if (deliveries.length === 0) return null;
  return (
    <div className="rounded-xl border border-hairline bg-surface shadow-card">
      <div className="flex items-center gap-2 border-b border-hairline px-4 py-3">
        <MailCheck className="h-4 w-4 text-clay" />
        <div className="font-semibold text-foreground">Recent delivery</div>
      </div>
      <div className="divide-y divide-hairline">
        {deliveries.map((delivery) => (
          <div
            key={delivery.id}
            className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_auto] sm:items-center"
          >
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-foreground">
                {delivery.subject}
              </div>
              <div className="truncate text-xs text-muted-foreground">
                {delivery.recipient_email}
              </div>
              {delivery.status === "failed" && delivery.error_message && (
                <div className="mt-1 text-xs text-danger">{delivery.error_message}</div>
              )}
            </div>
            <div
              className={cn(
                "font-mono text-[9px] font-bold uppercase tracking-[0.1em]",
                delivery.status === "sent" && "text-success",
                delivery.status === "pending" && "text-warning",
                delivery.status === "failed" && "text-danger",
              )}
            >
              {delivery.status} · {formatTimestamp(delivery.sent_at ?? delivery.created_at)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
