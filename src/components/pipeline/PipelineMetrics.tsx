import { fmtPct, fmtUSD } from "@/lib/format";
import {
  ACTIVE_STAGES,
  ACTIVE_STAGE_SHORT_LABELS,
  type PipelineMetricsSummary,
} from "./pipeline-ui";

type PipelineGlanceCardProps = {
  metrics: PipelineMetricsSummary;
};

const MONO_LABEL =
  "font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground";

// "Pipeline at a glance" — the right column of the CRM header grid. This
// consolidates the old PipelineMetrics stat cards: every metric they showed
// (active count, weighted pursuits, avg GP, bids due 7d, win rate 90d) lives
// here, recomposed as a clay-tinted hero + per-stage tiles + hairline stat rows,
// plus total pursuit value.
export function PipelineGlanceCard({ metrics }: PipelineGlanceCardProps) {
  return (
    <section className="rounded-xl border border-hairline bg-surface p-5 shadow-card">
      <div className="eyebrow">Pipeline at a glance</div>

      <div className="mt-3 rounded-xl border border-clay/25 bg-clay/[0.08] p-5">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <div className="font-serif text-[44px] leading-none text-clay">
              {metrics.activeCount}
            </div>
            <div className="mt-1.5 text-sm font-semibold text-foreground">Active opportunities</div>
          </div>
          <div className="text-right">
            <div className={MONO_LABEL}>Weighted pipeline</div>
            <div className="mt-1 font-serif text-[26px] leading-none text-foreground">
              {fmtUSD(metrics.weighted)}
            </div>
          </div>
        </div>
        <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
          Stage probability weights priced opportunities. Unpriced work stays visible in the count
          without being presented as zero-value revenue or zero-margin work.
        </p>
      </div>

      <div className="mt-3.5 flex gap-1.5">
        {ACTIVE_STAGES.map((stage) => (
          <StageTile
            key={stage}
            label={ACTIVE_STAGE_SHORT_LABELS[stage]}
            count={metrics.stageCounts[stage] ?? 0}
          />
        ))}
      </div>

      <StatRow
        label="Total pursuit value"
        value={fmtUSD(metrics.totalPursuit)}
        tone="text-foreground"
      />
      <StatRow label="Win rate · 90d" value={fmtPct(metrics.winRate)} tone="text-success" />
      <StatRow
        label="Pricing coverage"
        value={`${metrics.pricedCount}/${metrics.activeCount}`}
        tone={metrics.pricedCount === metrics.activeCount ? "text-success" : "text-warning"}
      />
      <StatRow
        label="Portfolio GP · margin-ready"
        value={metrics.marginReadyCount > 0 ? fmtPct(metrics.avgGp) : "Pending"}
        tone="text-foreground"
      />
      <StatRow
        label="Weighted GP · margin-ready"
        value={metrics.marginReadyCount > 0 ? fmtUSD(metrics.weightedGp) : "Pending"}
        tone="text-foreground"
      />
      <StatRow
        label="Bids due · 7d"
        value={String(metrics.dueThisWeek)}
        tone={metrics.dueThisWeek > 0 ? "text-warning" : "text-success"}
      />
    </section>
  );
}

function StageTile({ label, count }: { label: string; count: number }) {
  return (
    <div className="flex-1 rounded-lg border border-hairline bg-surface px-1 py-2 text-center">
      <div className="font-serif text-lg leading-none text-foreground">{count}</div>
      <div className={`mt-1.5 ${MONO_LABEL}`}>{label}</div>
    </div>
  );
}

function StatRow({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-t border-hairline py-3">
      <span className="text-[13px] text-muted-foreground">{label}</span>
      <span className={`font-serif text-lg leading-none tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}
