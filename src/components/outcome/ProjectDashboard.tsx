import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  ChevronRight,
  CircleDollarSign,
  Gauge,
  ShieldAlert,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import { fmtPct, fmtUSD } from "@/lib/format";
import type { ExposureRow, ProjectRow } from "@/lib/projects.functions";
import {
  releasedExposureValue,
  remainingExposureValue,
  weightedExposureValue,
  type Rollup,
  type Warning,
} from "@/lib/ior";

const CATEGORY_LABELS: Record<ExposureRow["category"], string> = {
  owner_decision: "Owner decision",
  design_drift: "Design drift",
  trade_performance: "Trade performance",
  procurement: "Procurement",
  schedule_compression: "Schedule compression",
  allowance_overrun: "Allowance overrun",
  field_change: "Field change",
  closeout_punch: "Closeout / punch",
  other: "Other",
};

const RESPONSE_LABELS: Record<ExposureRow["response_path"], string> = {
  eliminate: "Eliminate",
  recover: "Recover",
  offset: "Offset",
  accept: "Accept",
};

function remaining(e: ExposureRow) {
  return remainingExposureValue(e);
}

function likely(e: ExposureRow) {
  return weightedExposureValue(e);
}

function released(e: ExposureRow) {
  return releasedExposureValue(e);
}

function hasRemainingRisk(e: ExposureRow) {
  return remainingExposureValue(e) > 0;
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
  scheduleMovementSinceLastUpdate,
  onOpenExposure,
}: {
  project: ProjectRow;
  exposures: ExposureRow[];
  rollup: Rollup;
  warnings: Warning[];
  scheduleRiskCount: number;
  lastReviewForecast?: string | null;
  scheduleMovementSinceLastUpdate?: number | null;
  onOpenExposure?: (exposureId: string) => void;
}) {
  const remainingRisks = exposures.filter(hasRemainingRisk);
  const activeRisk = remainingRisks.reduce((sum, exposure) => sum + remaining(exposure), 0);
  const topExposures = [...remainingRisks].sort((a, b) => remaining(b) - remaining(a)).slice(0, 5);
  const scheduleLinkedExposures = remainingRisks.filter(
    (exposure) =>
      exposure.category === "schedule_compression" ||
      exposure.category === "procurement" ||
      exposure.category === "owner_decision",
  ).length;
  const linkedScheduleCount = scheduleRiskCount + scheduleLinkedExposures;
  const schedule = scheduleReliability(project.schedule_variance_weeks, linkedScheduleCount);
  const scheduleMovement =
    scheduleMovementSinceLastUpdate ??
    weeksBetween(lastReviewForecast, project.forecast_completion_date);
  const topRisk = topExposures[0] ?? null;
  const currentQuestion = warnings[0]?.title ?? topRisk?.title ?? "No urgent item logged";
  const exposureTotals = topExposures.reduce(
    (totals, exposure) => ({
      gross: totals.gross + exposure.dollar_exposure,
      likely: totals.likely + likely(exposure),
      released: totals.released + released(exposure),
      remaining: totals.remaining + remaining(exposure),
    }),
    { gross: 0, likely: 0, released: 0, remaining: 0 },
  );
  const outcomeRows = [
    { label: "Original GP", value: rollup.originalGP, tone: "success" as const },
    {
      label: "Forecast GP before holds",
      value: rollup.forecastedGPBeforeHolds,
      tone: "neutral" as const,
    },
    { label: "Less E-Hold", value: -rollup.exposureHolds, tone: "danger" as const },
    { label: "Less C-Hold", value: -rollup.contingencyHold, tone: "danger" as const },
    { label: "Indicated GP", value: rollup.indicatedGP, tone: "accent" as const, emphasized: true },
  ];
  const bridgeMax = Math.max(1, ...outcomeRows.map((row) => Math.abs(row.value)));
  const needsAttention = warnings.length > 0 || rollup.gpAtRisk > 0;
  const riskPosture = needsAttention ? "Management attention required" : "No active pressure";

  return (
    <section className="space-y-5" aria-label="Financial dashboard">
      <div className="overflow-hidden rounded-lg border border-hairline bg-card shadow-card">
        <div className="grid gap-px bg-hairline lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
          <div className="min-w-0 bg-card p-5 lg:p-7">
            {(project.organization_name || project.organization_logo_url) && (
              <div className="mb-5 flex max-w-lg items-center gap-3">
                {project.organization_logo_url && (
                  <img
                    src={project.organization_logo_url}
                    alt={`${project.organization_name || "Company"} logo`}
                    className="h-9 w-9 shrink-0 rounded-sm object-contain"
                  />
                )}
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Company
                  </div>
                  <div className="truncate text-sm font-medium text-foreground">
                    {project.organization_name || "Overwatch company"}
                  </div>
                </div>
              </div>
            )}
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              <span className="inline-block h-px w-7 bg-accent" />
              Financial Dashboard
            </div>
            <h2 className="mt-2 font-serif text-4xl leading-tight text-foreground lg:text-5xl">
              What is this project indicating right now?
            </h2>
            <div className="mt-5 flex items-start gap-3 rounded-md border border-hairline bg-surface px-4 py-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-success/10 text-success">
                <Gauge className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Current question
                </div>
                <div className="mt-1 text-sm font-medium leading-snug text-foreground">
                  {currentQuestion}
                </div>
              </div>
            </div>
          </div>

          <div className="min-w-0 bg-surface-elevated p-5 lg:p-7">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  IOR reading
                </div>
                <div className="mt-2 font-serif text-5xl tabular leading-none text-accent">
                  {fmtPct(rollup.indicatedGPpct)}
                </div>
              </div>
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                  needsAttention
                    ? "border-danger/35 bg-danger/10 text-danger"
                    : "border-success/30 bg-success/10 text-success"
                }`}
              >
                {needsAttention ? "At risk" : "Aligned"}
              </span>
            </div>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              {riskPosture}. Indicated gross profit is{" "}
              <span className="font-medium tabular text-foreground">
                {fmtUSD(rollup.indicatedGP)}
              </span>
              , with{" "}
              <span className="font-medium tabular text-danger">{fmtUSD(rollup.gpAtRisk)}</span> of
              original expected profit at risk.
            </p>
            {warnings.length > 0 && (
              <div className="mt-4 flex items-start gap-2 rounded-md border border-warning/30 bg-warning/10 px-3 py-3 text-sm">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                <div className="min-w-0">
                  <div className="font-medium text-foreground">{warnings[0].title}</div>
                  <div className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
                    {warnings[0].detail}
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="grid gap-px bg-hairline md:grid-cols-3 xl:grid-cols-6">
          <KpiCell
            icon={CircleDollarSign}
            label="Original GP"
            value={fmtUSD(rollup.originalGP)}
            detail={fmtPct(rollup.originalGPpct)}
          />
          <KpiCell
            icon={TrendingDown}
            label="GP at risk"
            value={fmtUSD(rollup.gpAtRisk)}
            tone="danger"
            featured
          />
          <KpiCell
            icon={Gauge}
            label="Indicated GP"
            value={fmtUSD(rollup.indicatedGP)}
            detail={fmtPct(rollup.indicatedGPpct)}
            tone="warning"
          />
          <KpiCell
            icon={ShieldAlert}
            label="E-Hold"
            value={fmtUSD(rollup.exposureHolds)}
            detail="Specific risks"
          />
          <KpiCell
            icon={ShieldAlert}
            label="C-Hold"
            value={fmtUSD(rollup.contingencyHold)}
            detail="Uncertainty"
          />
          <KpiCell
            icon={CalendarClock}
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

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.08fr)_minmax(320px,0.62fr)]">
        <div className="rounded-lg border border-hairline bg-card p-5 shadow-card lg:p-7">
          <PanelTitle icon={CircleDollarSign} label="Financial Outcome" />
          <div className="mt-5 grid gap-3">
            {outcomeRows.map((row) => (
              <OutcomeBridgeRow
                key={row.label}
                label={row.label}
                value={row.value}
                max={bridgeMax}
                tone={row.tone}
                emphasized={row.emphasized}
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

        <div className="grid gap-5">
          <div className="rounded-lg border border-hairline bg-card p-5 shadow-card lg:p-6">
            <div className="mb-5 flex items-start justify-between gap-3">
              <PanelTitle icon={CalendarClock} label="Schedule Signal" />
              <span
                className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClass(schedule.tone)}`}
              >
                {schedule.label} - {Math.round(schedule.score)}%
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
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
                label="Since last update"
                value={formatScheduleMovement(scheduleMovement)}
                tone={
                  scheduleMovement == null
                    ? undefined
                    : scheduleMovement > 0
                      ? "danger"
                      : scheduleMovement < 0
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

          <div className="rounded-lg border border-hairline bg-card p-5 shadow-card lg:p-6">
            <PanelTitle icon={ShieldAlert} label="IOR Reading" />
            <p className="mt-4 font-serif text-2xl leading-snug text-foreground">
              This project began as a{" "}
              <span className="tabular">{fmtPct(rollup.originalGPpct)}</span> GP job. It is now
              indicating{" "}
              <span className="tabular text-accent">{fmtPct(rollup.indicatedGPpct)}</span>.
            </p>
            <div className="mt-4 grid gap-2">
              <ReadingLine label="Original GP" value={fmtUSD(rollup.originalGP)} />
              <ReadingLine label="Indicated GP" value={fmtUSD(rollup.indicatedGP)} tone="accent" />
              <ReadingLine label="GP at risk" value={fmtUSD(rollup.gpAtRisk)} tone="danger" />
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-hairline bg-card p-5 shadow-card lg:p-7">
        <div className="flex flex-col gap-4 border-b border-hairline pb-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <PanelTitle icon={ShieldAlert} label="Top Exposures" />
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              These are the largest remaining items from the Risk Tally. Select any row to jump to
              the item and open its detail record.
            </p>
          </div>
          {topExposures.length > 0 && (
            <div className="grid w-full grid-cols-2 gap-2 sm:max-w-md sm:grid-cols-4">
              <ExposureTotal label="Gross" value={fmtUSD(exposureTotals.gross)} />
              <ExposureTotal label="Likely" value={fmtUSD(exposureTotals.likely)} />
              <ExposureTotal label="Released" value={fmtUSD(exposureTotals.released)} />
              <ExposureTotal
                label="Remaining"
                value={fmtUSD(exposureTotals.remaining)}
                tone="danger"
              />
            </div>
          )}
        </div>

        {topExposures.length === 0 ? (
          <p className="pt-5 text-sm text-muted-foreground">
            No live exposures are currently logged.
          </p>
        ) : (
          <div className="mt-4 overflow-hidden rounded-md border border-hairline">
            <div className="hidden grid-cols-[44px_minmax(0,1.35fr)_minmax(150px,0.62fr)_minmax(120px,0.5fr)_minmax(104px,0.43fr)_minmax(104px,0.43fr)_minmax(104px,0.43fr)_minmax(104px,0.43fr)_32px] gap-3 border-b border-hairline bg-surface px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground xl:grid">
              <div>#</div>
              <div>Risk item</div>
              <div>Treatment</div>
              <div>Category</div>
              <div className="text-right">Gross</div>
              <div className="text-right">Likely</div>
              <div className="text-right">Released</div>
              <div className="text-right">Remaining</div>
              <div />
            </div>
            <div className="divide-y divide-hairline">
              {topExposures.map((exposure, index) => (
                <ExposureDrilldownRow
                  key={exposure.id}
                  exposure={exposure}
                  index={index}
                  onOpen={onOpenExposure}
                />
              ))}
            </div>
          </div>
        )}
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
  icon: Icon,
  label,
  value,
  detail,
  tone,
  featured,
}: {
  icon: LucideIcon;
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
    <div
      className={[
        "min-w-0 bg-card p-4",
        featured ? "bg-danger/10 ring-1 ring-inset ring-danger/35" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${toneText}`} />
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {label}
        </div>
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

function PanelTitle({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
      <Icon className="h-3.5 w-3.5" />
      {label}
    </div>
  );
}

function OutcomeBridgeRow({
  label,
  value,
  max,
  tone,
  emphasized,
}: {
  label: string;
  value: number;
  max: number;
  tone: "neutral" | "danger" | "success" | "accent";
  emphasized?: boolean;
}) {
  const ratio = max > 0 ? Math.max(6, Math.min(100, (Math.abs(value) / max) * 100)) : 0;
  const color =
    tone === "danger"
      ? "bg-danger"
      : tone === "success"
        ? "bg-success"
        : tone === "accent"
          ? "bg-accent"
          : "bg-muted-foreground/40";
  const valueClass =
    tone === "danger"
      ? "text-danger"
      : tone === "success"
        ? "text-success"
        : tone === "accent"
          ? "text-accent"
          : "text-foreground";

  return (
    <div
      className={[
        "grid gap-3 rounded-md border border-hairline bg-surface px-3 py-3 sm:grid-cols-[190px_minmax(0,1fr)_150px] sm:items-center",
        emphasized ? "border-accent/40 bg-accent/10" : "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <div className="text-sm font-medium text-foreground">{label}</div>
      <div className="h-2 overflow-hidden rounded-full bg-card">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${ratio}%` }} />
      </div>
      <div className={`text-right text-sm font-semibold tabular ${valueClass}`}>
        {value < 0 ? `-${fmtUSD(Math.abs(value))}` : fmtUSD(value)}
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

function ReadingLine({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "accent" | "danger";
}) {
  const toneText = tone === "danger" ? "text-danger" : tone === "accent" ? "text-accent" : "";
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2 last:border-b-0 last:pb-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`text-sm font-semibold tabular text-foreground ${toneText}`}>{value}</span>
    </div>
  );
}

function ExposureTotal({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-right">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div
        className={`mt-1 text-sm font-semibold tabular ${
          tone === "danger" ? "text-danger" : "text-foreground"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function ExposureDrilldownRow({
  exposure,
  index,
  onOpen,
}: {
  exposure: ExposureRow;
  index: number;
  onOpen?: (exposureId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen?.(exposure.id)}
      className="grid w-full cursor-pointer gap-3 bg-card px-3 py-4 text-left transition-colors hover:bg-surface/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring xl:grid-cols-[44px_minmax(0,1.35fr)_minmax(150px,0.62fr)_minmax(120px,0.5fr)_minmax(104px,0.43fr)_minmax(104px,0.43fr)_minmax(104px,0.43fr)_minmax(104px,0.43fr)_32px] xl:items-center"
      aria-label={`Open risk tally item ${exposure.title}`}
    >
      <div className="hidden text-xs tabular text-muted-foreground xl:block">{index + 1}</div>
      <div className="min-w-0">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-semibold leading-snug text-foreground">{exposure.title}</span>
          {index === 0 && (
            <span className="rounded-full border border-danger/30 bg-danger/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-danger">
              Largest
            </span>
          )}
        </div>
        {exposure.description && (
          <div className="mt-1 line-clamp-2 text-sm leading-snug text-muted-foreground">
            {exposure.description}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2 xl:block">
        <span className="rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-xs font-semibold text-accent">
          {RESPONSE_LABELS[exposure.response_path]}
        </span>
        <span className="text-xs text-muted-foreground xl:mt-1 xl:block">
          {exposure.owner || "Unassigned"}
        </span>
      </div>
      <div className="text-xs text-muted-foreground">{CATEGORY_LABELS[exposure.category]}</div>
      <ExposureAmount label="Gross" value={fmtUSD(exposure.dollar_exposure)} />
      <ExposureAmount label="Likely" value={fmtUSD(likely(exposure))} />
      <ExposureAmount label="Released" value={fmtUSD(released(exposure))} tone="success" />
      <ExposureAmount label="Remaining" value={fmtUSD(remaining(exposure))} tone="danger" strong />
      <div className="hidden justify-self-end text-muted-foreground xl:block">
        {onOpen ? <ChevronRight className="h-4 w-4" /> : null}
      </div>
      <div className="flex items-center gap-1 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground xl:hidden">
        Open in Risk Tally
        <ArrowRight className="h-3.5 w-3.5" />
      </div>
    </button>
  );
}

function ExposureAmount({
  label,
  value,
  tone,
  strong,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
  strong?: boolean;
}) {
  const toneText =
    tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-foreground";
  return (
    <div className="grid grid-cols-[92px_1fr] items-baseline gap-2 tabular xl:block xl:text-right">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground xl:hidden">
        {label}
      </div>
      <div className={`${strong ? "font-semibold" : "font-medium"} ${toneText}`}>{value}</div>
    </div>
  );
}
