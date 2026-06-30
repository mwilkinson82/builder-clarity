import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import type { PipelineOpportunityRow, PipelineStage } from "@/lib/pipeline.functions";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { OpportunityCard } from "./OpportunityCard";
import { STAGE_LABELS, STAGE_ORDER, STAGE_PILL_CLASS } from "./pipeline-ui";

type PipelineKanbanProps = {
  opportunities: PipelineOpportunityRow[];
  onOpen: (id: string) => void;
  onStageChange: (id: string, stage: PipelineStage) => void;
};

export function PipelineKanban({ opportunities, onOpen, onStageChange }: PipelineKanbanProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<PipelineStage | null>(null);
  const [collapsed, setCollapsed] = useState<Record<PipelineStage, boolean>>({
    lead: false,
    qualifying: false,
    estimating: false,
    bid_submitted: false,
    negotiating: false,
    won: false,
    lost: false,
    no_bid: false,
  });
  const byStage = useMemo(() => {
    const grouped = new Map<PipelineStage, PipelineOpportunityRow[]>();
    STAGE_ORDER.forEach((stage) => grouped.set(stage, []));
    opportunities.forEach((opportunity) => {
      grouped.get(opportunity.stage)?.push(opportunity);
    });
    return grouped;
  }, [opportunities]);

  return (
    <div className="overflow-x-auto pb-2">
      <div className="grid min-w-[1800px] grid-cols-8 gap-4">
        {STAGE_ORDER.map((stage) => {
          const items = byStage.get(stage) ?? [];
          const isCollapsed = collapsed[stage];
          const isOver = overStage === stage;
          return (
            <section
              key={stage}
              onDragOver={(event) => {
                event.preventDefault();
                setOverStage(stage);
              }}
              onDragLeave={() => setOverStage(null)}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData("text/plain") || draggingId;
                setOverStage(null);
                setDraggingId(null);
                setCollapsed((current) => ({ ...current, [stage]: false }));
                if (id) onStageChange(id, stage);
              }}
              className={cn(
                "min-h-[320px] rounded-lg border border-hairline bg-card p-3 shadow-card transition",
                isOver && "border-accent/50 bg-accent/5",
              )}
            >
              <div className="mb-3 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div
                    className={cn(
                      "inline-flex max-w-full items-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
                      STAGE_PILL_CLASS[stage],
                    )}
                  >
                    <span className="truncate">{STAGE_LABELS[stage]}</span>
                  </div>
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {items.length} {items.length === 1 ? "deal" : "deals"}
                  </div>
                </div>
                {["won", "lost", "no_bid"].includes(stage) && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() =>
                      setCollapsed((current) => ({ ...current, [stage]: !isCollapsed }))
                    }
                    title={isCollapsed ? "Expand stage" : "Collapse stage"}
                  >
                    {isCollapsed ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" />
                    )}
                  </Button>
                )}
              </div>
              {isCollapsed ? (
                <div className="rounded-md border border-dashed border-hairline p-3 text-center text-xs text-muted-foreground">
                  Click the arrow to show deals
                </div>
              ) : (
                <div className="space-y-2">
                  {items.length === 0 && (
                    <div className="rounded-md border border-dashed border-hairline p-3 text-center text-xs text-muted-foreground">
                      Drop here
                    </div>
                  )}
                  {items.map((opportunity) => (
                    <OpportunityCard
                      key={opportunity.id}
                      opportunity={opportunity}
                      onOpen={onOpen}
                      onDragStart={setDraggingId}
                      onDragEnd={() => {
                        setDraggingId(null);
                        setOverStage(null);
                      }}
                    />
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
