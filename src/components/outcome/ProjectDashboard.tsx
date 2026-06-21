import { AlertTriangle, CalendarClock, CircleDollarSign, ClipboardList } from "lucide-react";
import { fmtPct, fmtUSD } from "@/lib/format";
import type { ExposureRow, ProjectRow } from "@/lib/projects.functions";
import type { Rollup, Warning } from "@/lib/ior";

function weighted(e: ExposureRow) {
  return e.dollar_exposure * (e.probability / 100);
}

function isLiveRisk(e: ExposureRow) {
  return e.status === "active" || e.status === "escalated";
}

function formatDate(d?: string | null) {
  if (!d) return "Not set";
  const [year, month, day] = d.split("-").map(Number);
  if (!year || !month || !day) return "Not set";
  return new Date(year, month - 1, day).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function scheduleReliability(slipWeeks: number, linkedRiskCount: number) {
  const slip = Math.max(0, slipWeeks);
  const score = Math.max(0, Math.min(100, 100 - slip * 8 - linkedRiskCount * 5));
  if (slip >= 4 || score < 65) return { label: "Slipped", score, tone: "danger" as const };
  if (slip > 0 || linkedRiskCount > 0) return { label: "Watch", score, tone: "warning" as const };
  return { label: "On plan", score, tone: "success" as const };
}

function toneClass(tone: "success" | "warning" | "danger") {
  if (tone === "success") return "border-success/30 bg-success/10 text-success";
  if (tone === "warning") return "border-warning/40 bg-warning/10 text-warning";
  return "border-danger/40 bg-danger/10 text-danger";
}

export function ProjectDashboard({
  project,
  exposures,
  rollup,
  warnings,
  scheduleRiskCount,
}: {
  project: ProjectRow;
  exposures: ExposureRow[];
  rollup: Rollup;
  warnings: Warning[];
  scheduleRiskCount: number;
}) {
  const live = exposures.filter(isLiveRisk);
  const activeRisk = live.reduce((sum, exposure) => sum + weighted(exposure), 0);
  const scheduleLinkedExposures = live.filter((exposure) =>
    exposure.category === "schedule_compression" ||
    exposure.category === "procurement" ||
    exposure.category === "owner_decision",
  ).length;
  const linkedScheduleCount = scheduleRiskCount + scheduleLinkedExposures;
  const schedule = scheduleReliability(project.schedule_variance_weeks, linkedScheduleCount);
  const topRisk = live.reduce<ExposureRow | null>((current, exposure) => {
    if (!current) return exposure;
    return weighted(exposure) > weighted(current) ? exposure : current;
  }, null);
  const nextIssue = warnings[0]?.title ?? topRisk?.title ?? "No urgent item logged";

  return (
    <section className="rounded-lg border border-hairline bg-card shadow-card" aria-label="Project dashboard">
      <div className="border-b border-hairline p-6 lg:p-7">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              <span className="inline-block h-px w-7 bg-accent" />
              Project Dashboard
            </div>
            <h2 className="mt-2 font-serif text-4xl leading-tight text-foreground">
              Start with schedule, then price the risk.
            </h2>
          </div>
          <div className="rounded-md border border-hairline bg-surface px-4 py-3 text-sm">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Current question
            </div>
            <div className="mt-1 max-w-md text-foreground">{nextIssue}</div>
          </div>
        </div>
      </div>

      <div className="grid gap-px bg-hairline lg:grid-cols-[1.2fr_0.8fr]">
        <div className="bg-card p-6 lg:p-7">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              Schedule Posture
            </div>
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClass(schedule.tone)}`}>
              {schedule.label} - {Math.round(schedule.score)}%
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-4">
            <DashboardMetric label="Baseline" value={formatDate(project.baseline_completion_date)} />
            <DashboardMetric label="Forecast" value={formatDate(project.forecast_completion_date)} tone={schedule.tone === "danger" ? "danger" : undefined} />
            <DashboardMetric
              label="Variance"
              value={project.schedule_variance_weeks > 0 ? `+${project.schedule_variance_weeks} wk` : "No slip"}
              tone={project.schedule_variance_weeks > 0 ? "danger" : "success"}
            />
            <DashboardMetric label="Schedule risks" value={String(linkedScheduleCount)} tone={linkedScheduleCount > 0 ? "warning" : "success"} />
          </div>
        </div>

        <div className="bg-surface-elevated p-6 lg:p-7">
          <div className="mb-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <CircleDollarSign className="h-3.5 w-3.5" />
            Outcome Now
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <DashboardMetric label="Plan GP" value={fmtPct(rollup.originalGPpct)} />
            <DashboardMetric label="Indicated GP" value={fmtPct(rollup.indicatedGPpct)} tone={rollup.gpAtRisk > 0 ? "danger" : "success"} />
            <DashboardMetric label="GP at risk" value={fmtUSD(rollup.gpAtRisk)} tone={rollup.gpAtRisk > 0 ? "danger" : "success"} />
            <DashboardMetric label="Risk allocated" value={fmtUSD(activeRisk)} tone={activeRisk > 0 ? "warning" : "success"} />
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px bg-hairline md:grid-cols-6">
        {[
          ["1", "Schedule"],
          ["2", "Risk Tally"],
          ["3", "SOV / Billing"],
          ["4", "Cost Buckets"],
          ["5", "Change Orders"],
          ["6", "IOR Report"],
        ].map(([step, label]) => (
          <div key={label} className="flex items-center gap-3 bg-card px-4 py-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full border border-hairline bg-surface text-[11px] font-semibold text-muted-foreground">
              {step}
            </span>
            <span className="text-sm font-medium text-foreground">{label}</span>
          </div>
        ))}
      </div>

      <div className="flex items-start gap-2 border-t border-hairline bg-surface px-6 py-4 text-sm text-muted-foreground">
        <ClipboardList className="mt-0.5 h-4 w-4 shrink-0 text-accent" />
        <span>
          {topRisk
            ? `Largest live exposure: ${topRisk.title} at ${fmtUSD(weighted(topRisk))}.`
            : "No live exposure is currently logged."}
        </span>
        {warnings.length > 0 && <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />}
      </div>
    </section>
  );
}

function DashboardMetric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "warning" | "danger";
}) {
  const toneText =
    tone === "danger" ? "text-danger" :
    tone === "warning" ? "text-warning" :
    tone === "success" ? "text-success" :
    "text-foreground";

  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`mt-1 text-lg font-medium tabular leading-tight ${toneText}`}>{value}</div>
    </div>
  );
}
