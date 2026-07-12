import { useMemo, useState } from "react";
import type { PipelineOpportunityRow, PipelineStage } from "@/lib/pipeline.functions";
import { cn } from "@/lib/utils";
import { OpportunityCard } from "./OpportunityCard";
import { KANBAN_COLUMNS, STAGE_LABELS, STAGE_ORDER, stageHeadingClass } from "./pipeline-ui";

type PipelineKanbanProps = {
  opportunities: PipelineOpportunityRow[];
  onOpen: (id: string) => void;
  onStageChange: (id: string, stage: PipelineStage) => void;
};

export function PipelineKanban({ opportunities, onOpen, onStageChange }: PipelineKanbanProps) {
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [overStage, setOverStage] = useState<PipelineStage | null>(null);

  const byStage = useMemo(() => {
    const grouped = new Map<PipelineStage, PipelineOpportunityRow[]>();
    STAGE_ORDER.forEach((stage) => grouped.set(stage, []));
    opportunities.forEach((opportunity) => {
      grouped.get(opportunity.stage)?.push(opportunity);
    });
    return grouped;
  }, [opportunities]);

  const dropProps = (stage: PipelineStage) => ({
    onDragOver: (event: React.DragEvent) => {
      event.preventDefault();
      setOverStage(stage);
    },
    onDragLeave: () => setOverStage((current) => (current === stage ? null : current)),
    onDrop: (event: React.DragEvent) => {
      event.preventDefault();
      const id = event.dataTransfer.getData("text/plain") || draggingId;
      setOverStage(null);
      setDraggingId(null);
      if (id) onStageChange(id, stage);
    },
  });

  const renderCards = (items: PipelineOpportunityRow[]) =>
    items.map((opportunity) => (
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
    ));

  return (
    <div className="overflow-x-auto pb-2">
      <div className="flex gap-3.5">
        {KANBAN_COLUMNS.map((column) => {
          if (column.kind === "single") {
            const stage = column.stage;
            const items = byStage.get(stage) ?? [];
            return (
              <section
                key={stage}
                {...dropProps(stage)}
                className={cn(
                  "flex w-[236px] shrink-0 flex-col gap-2.5 rounded-[13px] bg-secondary p-3 transition",
                  overStage === stage && "ring-2 ring-clay/40",
                )}
              >
                <ColumnHeading
                  className={stageHeadingClass(stage)}
                  label={STAGE_LABELS[stage]}
                  count={items.length}
                />
                {items.length === 0 ? <DropHint /> : renderCards(items)}
              </section>
            );
          }

          // Merged Lost / No-bid: one header + combined count, but a labelled
          // drop zone per stage so a dropped card keeps its true stage (a no-bid
          // card is never silently relabelled "lost").
          const stageItems = column.stages.map((stage) => byStage.get(stage) ?? []);
          const total = stageItems.reduce((sum, items) => sum + items.length, 0);
          return (
            <section
              key={column.label}
              className="flex w-[236px] shrink-0 flex-col gap-2.5 rounded-[13px] bg-secondary p-3"
            >
              <ColumnHeading className="text-danger" label={column.label} count={total} />
              {column.stages.map((stage, index) => {
                const items = stageItems[index];
                return (
                  <div
                    key={stage}
                    {...dropProps(stage)}
                    className={cn(
                      "flex flex-col gap-2.5 rounded-lg transition",
                      overStage === stage && "ring-2 ring-clay/40",
                    )}
                  >
                    <div className="px-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      {STAGE_LABELS[stage]}
                    </div>
                    {items.length === 0 ? <DropHint /> : renderCards(items)}
                  </div>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}

function ColumnHeading({
  className,
  label,
  count,
}: {
  className: string;
  label: string;
  count: number;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-0.5">
      <span className={cn("truncate text-xs font-bold", className)}>{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
    </div>
  );
}

function DropHint() {
  return (
    <div className="rounded-md border border-dashed border-hairline p-3 text-center text-[11px] text-muted-foreground">
      Drop here
    </div>
  );
}
