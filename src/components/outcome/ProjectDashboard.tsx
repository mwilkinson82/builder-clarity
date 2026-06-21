import { AlertTriangle, CalendarClock, CircleDollarSign, ShieldAlert } from "lucide-react";
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
  lastReviewForecast,
}: {
  project: ProjectRow;
  exposures: ExposureRow[];
  rollup: Rollup;
  warnings: Warning[];
  scheduleRiskCount: number;
  lastReviewForecast?: string | null;
}) {
  const live = exposures.filter(isLiveRisk);
  const activeRisk = live.reduce((sum, exposure) => sum + weighted(exposure), 0);
  const topExposures = [...live].sort((a, b) => weighted(b) - weighted(a)).slice(0, 5);
  const scheduleLinkedExposures = live.filter(
    (exposure) =>
      exposure.category === "schedule_compression" ||
      exposure.category === "procurement" ||
      exposure.category === "owner_decision",
  ).length;
  const linkedScheduleCount = scheduleRiskCount + scheduleLinkedExposures;
  const schedule = scheduleReliability(project.schedule_variance_weeks, linkedScheduleCount);
  const scheduleMovementSinceLastUpdate = weeksBetween(
    lastReviewForecast,
    project.forecast_completion_date,
  );
  const topRisk = topExposures[0] ?? null;
  const currentQuestion = warnings[0]?.title ?? topRisk?.title ?? "No urgent item logged";
  const financialBars = [
    { label: "Original Contract", value: rollup.originalContract, tone: "neutral" as const },
    { label: "Approved COs", value: rollup.approvedCOContract, tone: "blue" as const },
    { label: "Pending (wtd)", value: rollup.weightedPendingCOContract, tone: "blue" as const },
    { label: "Forecasted Final", value: rollup.forecastedFinalContract, tone: "gold" as const },
    { label: "Forecasted Cost", value: rollup.forecastedFinalCost, tone: "cost" as const },
    { label: "Exposure Holds", value: rollup.exposureHolds, tone: "danger" as const },
    { label: "C-Hold", value: rollup.contingencyHold, tone: "danger" as const },
    { label: "Indicated GP", value: rollup.indicatedGP, tone: "success" as const },
  ];

  return (
    <section className="space-y-5" aria-label="Financial dashboard">
      <div className="rounded-lg border border-hairline bg-card shadow-card">
        <div className="border-b border-hairline p-6 lg:p-7">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                <span className="inline-block h-px w-7 bg-accent" />
                Financial Dashboard
              </div>
              <h2 className="mt-2 font-serif text-4xl leading-tight text-foreground">
                What is this project indicating right now?
              </h2>
            </div>
            <div className="rounded-md border border-hairline bg-surface px-4 py-3 text-sm">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Current question
              </div>
              <div className="mt-1 max-w-md text-foreground">{currentQuestion}</div>
            </div>
          </div>
        </div>

        <div className="grid gap-px bg-hairline md:grid-cols-3 xl:grid-cols-6">
          <KpiCell
            label="Original GP"
            value={fmtUSD(rollup.originalGP)}
            detail={fmtPct(rollup.originalGPpct)}
          />
          <KpiCell label="GP at risk" value={fmtUSD(rollup.gpAtRisk)} tone="danger" featured />
          <KpiCell
            label="Indicated GP"
            value={fmtUSD(rollup.indicatedGP)}
            detail={fmtPct(rollup.indicatedGPpct)}
            tone="warning"
          />
          <KpiCell label="E-Hold" value={fmtUSD(rollup.exposureHolds)} detail="Specific risks" />
          <KpiCell label="C-Hold" value={fmtUSD(rollup.contingencyHold)} detail="Uncertainty" />
          <KpiCell
            label="Schedule"
            value={
              project.schedule_variance_weeks > 0
                ? `+${project.schedule_variance_weeks} wk`
                : "On plan"
            }
            detail="vs baseline"
            tone={project.schedule_variance_weeks > 0 ? "danger" : "success"}
          />
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.36fr]">
        <div className="rounded-lg border border-hairline bg-card p-6 shadow-card lg:p-7">
          <div className="mb-5 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <CircleDollarSign className="h-3.5 w-3.5" />
            Financial Outcome
          </div>
          <div className="grid min-h-[250px] grid-cols-4 items-end gap-4 md:grid-cols-8">
            {financialBars.map((bar) => (
              <FinancialBar
                key={bar.label}
                label={bar.label}
                value={bar.value}
                max={rollup.forecastedFinalContract}
                tone={bar.tone}
              />
            ))}
          </div>
          <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <DashboardMetric
              label="Forecasted final contract"
              value={fmtUSD(rollup.forecastedFinalContract)}
            />
            <DashboardMetric
              label="Forecasted final cost"
              value={fmtUSD(rollup.forecastedFinalCost)}
            />
            <DashboardMetric
              label="Forecasted GP before holds"
              value={fmtUSD(rollup.forecastedGPBeforeHolds)}
            />
            <DashboardMetric
              label="Risk allocated"
              value={fmtUSD(activeRisk)}
              tone={activeRisk > 0 ? "warning" : "success"}
            />
          </div>
        </div>

        <div className="rounded-lg border border-hairline bg-card p-6 shadow-card lg:p-7">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              <CalendarClock className="h-3.5 w-3.5" />
              Schedule Signal
            </div>
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClass(schedule.tone)}`}
            >
              {schedule.label} - {Math.round(schedule.score)}%
            </span>
          </div>
          <div className="grid gap-3">
            <DashboardMetric
              label="Baseline"
              value={formatDate(project.baseline_completion_date)}
            />
            <DashboardMetric
              label="Forecast"
              value={formatDate(project.forecast_completion_date)}
              tone={schedule.tone === "danger" ? "danger" : undefined}
            />
            <DashboardMetric
              label="Variance"
              value={
                project.schedule_variance_weeks > 0
                  ? `+${project.schedule_variance_weeks} wk`
                  : "No slip"
              }
              tone={project.schedule_variance_weeks > 0 ? "danger" : "success"}
            />
            <DashboardMetric
              label="Since last IOR"
              value={formatScheduleMovement(scheduleMovementSinceLastUpdate)}
              tone={
                scheduleMovementSinceLastUpdate == null
                  ? undefined
                  : scheduleMovementSinceLastUpdate > 0
                    ? "danger"
                    : scheduleMovementSinceLastUpdate < 0
                      ? "success"
                      : undefined
              }
            />
            <DashboardMetric
              label="Schedule risks"
              value={String(linkedScheduleCount)}
              tone={linkedScheduleCount > 0 ? "warning" : "success"}
            />
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_0.36fr]">
        <div className="rounded-lg border border-hairline bg-card p-6 shadow-card lg:p-7">
          <div className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            <ShieldAlert className="h-3.5 w-3.5" />
            Top Exposures
          </div>
          {topExposures.length === 0 ? (
            <p className="text-sm text-muted-foreground">No live exposures are currently logged.</p>
          ) : (
            <div className="overflow-hidden rounded-md border border-hairline">
              <table className="w-full text-sm">
                <thead className="bg-surface text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">Exposure</th>
                    <th className="px-3 py-2 text-left">Treatment</th>
                    <th className="px-3 py-2 text-right">$ exposure</th>
                    <th className="px-3 py-2 text-right">Prob.</th>
                    <th className="px-3 py-2 text-right">Likely $</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {topExposures.map((e) => (
                    <tr key={e.id}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{e.title}</div>
                        <div className="mt-0.5 max-w-xl text-xs text-muted-foreground">
                          {e.description}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-accent capitalize">{e.response_path}</td>
                      <td className="px-3 py-2 text-right tabular">{fmtUSD(e.dollar_exposure)}</td>
                      <td className="px-3 py-2 text-right tabular text-muted-foreground">
                        {e.probability}%
                      </td>
                      <td className="px-3 py-2 text-right tabular font-medium">
                        {fmtUSD(weighted(e))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="rounded-lg border border-hairline bg-card p-6 shadow-card lg:p-7">
          <div className="mb-5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            IOR Reading
          </div>
          <div className="rounded-md border border-accent/50 bg-accent/10 px-4 py-4">
            <div className="text-sm font-medium text-foreground">Indicated gross profit</div>
            <div className="mt-2 font-serif text-4xl tabular leading-none text-accent">
              {fmtUSD(rollup.indicatedGP)}
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {fmtPct(rollup.indicatedGPpct)} against forecasted final contract.
            </div>
          </div>
          <p className="mt-4 font-serif text-xl leading-snug text-foreground">
            This project began as a <span className="tabular">{fmtPct(rollup.originalGPpct)}</span>{" "}
            GP job. It is now indicating{" "}
            <span className="tabular text-accent">{fmtPct(rollup.indicatedGPpct)}</span>, with{" "}
            <span className="tabular text-danger">{fmtUSD(rollup.gpAtRisk)}</span> of expected
            profit at risk.
          </p>
          {warnings.length > 0 && (
            <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <div>
                <div className="font-medium text-foreground">{warnings[0].title}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">{warnings[0].detail}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function weeksBetween(previous?: string | null, current?: string | null) {
  if (!previous || !current) return null;
  const prev = new Date(`${previous}T00:00:00`);
  const next = new Date(`${current}T00:00:00`);
  if (Number.isNaN(prev.getTime()) || Number.isNaN(next.getTime())) return null;
  return Math.round((next.getTime() - prev.getTime()) / 604800000);
}

function formatScheduleMovement(value: number | null) {
  if (value == null) return "No prior IOR";
  if (value > 0) return `+${value} wk`;
  if (value < 0) return `${value} wk`;
  return "No movement";
}

function KpiCell({
  label,
  value,
  detail,
  tone,
  featured,
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: "success" | "warning" | "danger";
  featured?: boolean;
}) {
  const toneText =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : tone === "success"
          ? "text-success"
          : "text-foreground";

  return (
    <div className={featured ? "bg-danger/10 p-4 ring-1 ring-inset ring-danger/35" : "bg-card p-4"}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-3 font-serif tabular leading-none ${featured ? "text-3xl" : "text-2xl"} ${toneText}`}
      >
        {value}
      </div>
      <div className="mt-2 min-h-4 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function FinancialBar({
  label,
  value,
  max,
  tone,
}: {
  label: string;
  value: number;
  max: number;
  tone: "neutral" | "blue" | "gold" | "cost" | "danger" | "success";
}) {
  const ratio = max > 0 ? Math.max(3, Math.min(100, (Math.abs(value) / max) * 100)) : 0;
  const color =
    tone === "gold"
      ? "bg-warning"
      : tone === "cost"
        ? "bg-danger/60"
        : tone === "danger"
          ? "bg-danger"
          : tone === "success"
            ? "bg-success"
            : tone === "blue"
              ? "bg-primary/60"
              : "bg-muted-foreground/40";

  return (
    <div className="flex h-full min-h-[230px] flex-col justify-end">
      <div className="flex flex-1 items-end">
        <div className={`w-full rounded-t-sm ${color}`} style={{ height: `${ratio}%` }} />
      </div>
      <div className="mt-3 min-h-[54px]">
        <div className="text-xs leading-tight text-muted-foreground">{label}</div>
        <div className="mt-1 text-sm tabular text-foreground">
          {tone === "cost" || tone === "danger" ? `(${fmtUSD(value)})` : fmtUSD(value)}
        </div>
      </div>
    </div>
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
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : tone === "success"
          ? "text-success"
          : "text-foreground";

  return (
    <div className="flex min-h-[70px] flex-col justify-between rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase leading-[1.25] tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-2 text-lg font-medium tabular leading-none ${toneText}`}>{value}</div>
    </div>
  );
}
