import { ArrowUpRight } from "lucide-react";
import { fmtPct, fmtUSD } from "@/lib/format";
import type { PipelineOpportunityRow } from "@/lib/pipeline.functions";
import { cn } from "@/lib/utils";
import { bidChip, gpToneClass, initials } from "./pipeline-ui";

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
  const chip = bidChip(opportunity);
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
      title="Drag to move, click to open"
      className="w-full cursor-grab rounded-xl border border-hairline bg-surface px-4 pb-3.5 pt-2.5 text-left shadow-sm transition hover:border-clay/40 active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Centered drag-pill (the house grab affordance) */}
      <div className="mb-2 flex justify-center">
        <span aria-hidden="true" className="h-1 w-6 rounded-full bg-hairline" />
      </div>

      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug text-foreground">
            {opportunity.name}
          </div>
          <div className="mt-0.5 truncate text-xs text-muted-foreground">
            {opportunity.account_name || opportunity.client || "No account yet"}
          </div>
        </div>
        {opportunity.converted_project_id && (
          <ArrowUpRight className="h-4 w-4 shrink-0 text-success" />
        )}
      </div>

      <div className="mt-2.5 flex items-baseline gap-2.5">
        <span className="font-serif text-[19px] leading-none text-foreground">
          {fmtUSD(opportunity.estimated_contract)}
        </span>
        <span className={cn("text-[11.5px] font-bold", gpToneClass(opportunity.estimated_gp_pct))}>
          {fmtPct(opportunity.estimated_gp_pct)} GP
        </span>
      </div>

      <div className="mt-2.5 flex items-center gap-2 border-t border-hairline pt-2.5">
        <span
          title={opportunity.assigned_to || "Unassigned"}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-[9px] font-bold text-muted-foreground"
        >
          {initials(opportunity.assigned_to)}
        </span>
        <span className={cn("text-[11px] font-semibold", chip.tone)}>{chip.label}</span>
        <span className="ml-auto font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          {opportunity.probability}%
        </span>
      </div>
    </button>
  );
}
