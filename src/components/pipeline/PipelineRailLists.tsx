import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";
import { fmtUSD } from "@/lib/format";
import type { PipelineNextActionRow, PipelineOpportunityRow } from "@/lib/pipeline.functions";
import { cn } from "@/lib/utils";
import { ACTIVE_STAGES, actionDuePill, bidChip, STAGE_LABELS } from "./pipeline-ui";

type PipelineRailListsProps = {
  opportunities: PipelineOpportunityRow[];
  openActions: PipelineNextActionRow[];
  onOpen: (id: string) => void;
};

// The three glance list cards down the left of the CRM header grid. Every row is
// derived from opportunity/next-action fields already on the client — no new
// server data. Rows open the underlying opportunity when one is available.
export function PipelineRailLists({ opportunities, openActions, onOpen }: PipelineRailListsProps) {
  const active = opportunities.filter(
    (opportunity) => ACTIVE_STAGES.includes(opportunity.stage) && !opportunity.archived,
  );

  const bidsDue = active
    .filter((opportunity) => {
      const days = opportunity.days_until_bid_due;
      return days !== null && days >= 0 && days <= 7;
    })
    .sort((a, b) => (a.days_until_bid_due ?? 0) - (b.days_until_bid_due ?? 0))
    .slice(0, 5);

  const nextActions = openActions.slice(0, 5);

  const recentlyWon = opportunities
    .filter((opportunity) => opportunity.stage === "won" && !opportunity.archived)
    .sort((a, b) => wonSortKey(b) - wonSortKey(a))
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-3.5">
      <RailCard title="Bids due this week" tone="danger">
        {bidsDue.length === 0 ? (
          <EmptyRow text="No bids due in the next 7 days." />
        ) : (
          bidsDue.map((opportunity) => {
            const chip = bidChip(opportunity);
            return (
              <RailRow
                key={opportunity.id}
                dotTone={chip.tone}
                title={opportunity.name}
                sub={`${STAGE_LABELS[opportunity.stage]} · ${opportunity.assigned_to || "Unassigned"}`}
                value={fmtUSD(opportunity.estimated_contract)}
                pill={{ label: chip.label, tone: chip.tone }}
                onClick={() => onOpen(opportunity.id)}
              />
            );
          })
        )}
      </RailCard>

      <RailCard title="Next actions">
        {nextActions.length === 0 ? (
          <EmptyRow text="No open CRM actions." />
        ) : (
          nextActions.map((action) => {
            const pill = actionDuePill(action.due_date);
            return (
              <RailRow
                key={action.id}
                dotTone={pill.tone}
                title={action.title}
                sub={action.owner_name || action.contact_name || "Unassigned"}
                pill={{ label: pill.label, tone: pill.tone }}
                onClick={
                  action.opportunity_id ? () => onOpen(action.opportunity_id as string) : undefined
                }
              />
            );
          })
        )}
      </RailCard>

      <RailCard title="Recently won">
        {recentlyWon.length === 0 ? (
          <EmptyRow text="No recent wins yet." />
        ) : (
          recentlyWon.map((opportunity) => (
            <RailRow
              key={opportunity.id}
              dotTone="text-success"
              title={opportunity.name}
              sub={opportunity.account_name || opportunity.client || "No client"}
              value={fmtUSD(opportunity.estimated_contract)}
              pill={{
                label: opportunity.converted_project_id ? "Converted" : "Won",
                tone: "text-success",
              }}
              onClick={() => onOpen(opportunity.id)}
            />
          ))
        )}
      </RailCard>
    </div>
  );
}

function wonSortKey(opportunity: PipelineOpportunityRow): number {
  const value = opportunity.decision_date ?? opportunity.converted_at ?? opportunity.updated_at;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function RailCard({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-surface px-5 pb-2",
        tone === "danger" ? "border-danger/35" : "border-hairline",
      )}
    >
      <div
        className={cn(
          "pb-1 pt-4 font-mono text-[8.5px] font-bold uppercase tracking-[0.12em]",
          tone === "danger" ? "text-danger" : "text-muted-foreground",
        )}
      >
        {title}
      </div>
      {children}
    </section>
  );
}

function RailRow({
  dotTone,
  title,
  sub,
  value,
  pill,
  onClick,
}: {
  dotTone: string;
  title: string;
  sub: string;
  value?: string;
  pill: { label: string; tone: string };
  onClick?: () => void;
}) {
  const interactive = Boolean(onClick);
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      className={cn(
        "flex w-full items-center gap-3 border-t border-hairline py-3 text-left",
        interactive
          ? "cursor-pointer transition-colors hover:bg-secondary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          : "cursor-default",
      )}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", toneDot(dotTone))} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block truncate text-[11.5px] text-muted-foreground">{sub}</span>
      </span>
      {value ? (
        <span className="shrink-0 whitespace-nowrap font-serif text-base text-foreground">
          {value}
        </span>
      ) : null}
      <span
        className={cn(
          "shrink-0 whitespace-nowrap rounded-md border border-current px-2 py-[3px] font-mono text-[9px] font-bold tracking-[0.04em]",
          pill.tone,
        )}
      >
        {pill.label}
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

function toneDot(tone: string): string {
  if (tone.includes("danger")) return "bg-danger";
  if (tone.includes("warning")) return "bg-warning";
  if (tone.includes("clay")) return "bg-clay";
  if (tone.includes("success")) return "bg-success";
  return "bg-muted-foreground/40";
}

function EmptyRow({ text }: { text: string }) {
  return (
    <div className="border-t border-hairline py-3 text-[12px] text-muted-foreground">{text}</div>
  );
}
