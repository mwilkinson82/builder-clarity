import { Activity, CalendarClock, Gauge, Percent, Trophy } from "lucide-react";
import type { ReactNode } from "react";
import { fmtPct, fmtUSD } from "@/lib/format";
import type { PipelineOpportunityRow } from "@/lib/pipeline.functions";
import { ACTIVE_STAGES } from "./pipeline-ui";

type PipelineMetricsProps = {
  opportunities: PipelineOpportunityRow[];
};

export function PipelineMetrics({ opportunities }: PipelineMetricsProps) {
  const active = opportunities.filter(
    (opportunity) => ACTIVE_STAGES.includes(opportunity.stage) && !opportunity.archived,
  );
  const weightedPipeline = active.reduce(
    (total, opportunity) =>
      total + opportunity.estimated_contract * (opportunity.probability / 100),
    0,
  );
  const avgGp =
    active.length === 0
      ? 0
      : active.reduce((total, opportunity) => total + opportunity.estimated_gp_pct, 0) /
        active.length;
  const dueThisWeek = active.filter((opportunity) => {
    const days = opportunity.days_until_bid_due;
    return days !== null && days >= 0 && days <= 7;
  }).length;
  const ninetyDaysAgo = Date.now() - 90 * 86400000;
  const recentDecisions = opportunities.filter((opportunity) => {
    if (!["won", "lost"].includes(opportunity.stage)) return false;
    const value = opportunity.decision_date ?? opportunity.converted_at ?? opportunity.updated_at;
    const date = new Date(value).getTime();
    return Number.isFinite(date) && date >= ninetyDaysAgo;
  });
  const wins = recentDecisions.filter((opportunity) => opportunity.stage === "won").length;
  const winRate = recentDecisions.length === 0 ? 0 : (wins / recentDecisions.length) * 100;

  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(160px,1fr))]">
      <MetricCard
        icon={<Activity className="h-3.5 w-3.5" />}
        label="Active opportunities"
        value={String(active.length)}
      />
      <MetricCard
        icon={<Gauge className="h-3.5 w-3.5" />}
        label="Weighted pursuits"
        value={fmtUSD(weightedPipeline)}
      />
      <MetricCard icon={<Percent className="h-3.5 w-3.5" />} label="Avg GP" value={fmtPct(avgGp)} />
      <MetricCard
        icon={<CalendarClock className="h-3.5 w-3.5" />}
        label="Bids due 7d"
        value={String(dueThisWeek)}
        tone={dueThisWeek > 0 ? "warning" : "success"}
      />
      <MetricCard
        icon={<Trophy className="h-3.5 w-3.5" />}
        label="Win rate 90d"
        value={fmtPct(winRate)}
      />
    </div>
  );
}

function MetricCard({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "warning" | "success";
}) {
  const toneClass =
    tone === "success" ? "text-success" : tone === "warning" ? "text-warning" : "text-foreground";
  return (
    <div className="rounded-lg border border-hairline bg-card p-4 shadow-card">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</div>
    </div>
  );
}
