import { ArrowUpRight, CalendarClock, GripVertical } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import type { PipelineOpportunityRow } from "@/lib/pipeline.functions";
import { cn } from "@/lib/utils";
import { bidUrgencyClass, initials, shortDate } from "./pipeline-ui";

type OpportunityCardProps = {
  opportunity: PipelineOpportunityRow;
  onOpen: (id: string) => void;
  onDragStart?: (id: string) => void;
  onDragEnd?: () => void;
};

export function OpportunityCard({
  opportunity,
  onOpen,
  onDragStart,
  onDragEnd,
}: OpportunityCardProps) {
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData("text/plain", opportunity.id);
        onDragStart?.(opportunity.id);
      }}
      onDragEnd={onDragEnd}
      onClick={() => onOpen(opportunity.id)}
      className="w-full rounded-lg border border-hairline bg-background p-3 text-left shadow-sm transition hover:border-accent/40 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex items-start gap-2">
        <GripVertical className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{opportunity.name}</div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {opportunity.account_name || opportunity.client || "No account yet"}
          </div>
        </div>
        {opportunity.converted_project_id && (
          <ArrowUpRight className="h-4 w-4 shrink-0 text-success" />
        )}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <span className="text-sm font-semibold tabular-nums text-foreground">
          {fmtUSD(opportunity.estimated_contract)}
        </span>
        <span className="rounded-full border border-hairline bg-card px-2 py-0.5 text-[10px] font-semibold tabular-nums text-muted-foreground">
          {opportunity.probability}%
        </span>
      </div>
      {(opportunity.primary_contact_name || opportunity.next_action_title) && (
        <div className="mt-3 rounded-md border border-hairline bg-card px-2.5 py-2">
          {opportunity.primary_contact_name && (
            <div className="truncate text-[11px] font-medium text-foreground">
              {opportunity.primary_contact_name}
              {opportunity.primary_contact_email ? ` · ${opportunity.primary_contact_email}` : ""}
            </div>
          )}
          {opportunity.next_action_title && (
            <div className="mt-1 truncate text-[11px] text-muted-foreground">
              Next: {opportunity.next_action_title}
            </div>
          )}
        </div>
      )}
      <div className="mt-3 flex items-center justify-between gap-2 text-[11px]">
        <span className={cn("inline-flex items-center gap-1", bidUrgencyClass(opportunity))}>
          <CalendarClock className="h-3.5 w-3.5" />
          {opportunity.next_action_due_date
            ? `Action ${shortDate(opportunity.next_action_due_date)}`
            : shortDate(opportunity.bid_due_date)}
        </span>
        <span
          title={opportunity.assigned_to || "Unassigned"}
          className="inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-muted px-1.5 text-[10px] font-semibold text-muted-foreground"
        >
          {initials(opportunity.assigned_to)}
        </span>
      </div>
    </button>
  );
}
