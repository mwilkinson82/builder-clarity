import { useState } from "react";
import { Button } from "@/components/ui/button";
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

function weeksBetween(previous?: string | null, current?: string | null) {
  if (!previous || !current) return null;
  const prev = new Date(`${previous}T00:00:00`);
  const next = new Date(`${current}T00:00:00`);
  if (Number.isNaN(prev.getTime()) || Number.isNaN(next.getTime())) return null;
  return Math.round((next.getTime() - prev.getTime()) / 604800000);
}

/** Days between forecast and baseline completion. Positive = forecasting ahead
 *  (earlier than) the baseline; negative = behind. Null when either date is unset. */
function daysAheadOfBaseline(baseline?: string | null, forecast?: string | null) {
  if (!baseline || !forecast) return null;
  const base = new Date(`${baseline}T00:00:00`);
  const fore = new Date(`${forecast}T00:00:00`);
  if (Number.isNaN(base.getTime()) || Number.isNaN(fore.getTime())) return null;
  return Math.round((base.getTime() - fore.getTime()) / 86400000);
}

function formatScheduleMovement(value: number | null) {
  if (value == null) return "No prior IOR";
  if (value > 0) return `+${value} wk since last update`;
  if (value < 0) return `−${Math.abs(value)} wk since last update`;
  return "No movement since last update";
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
  onReviewChangeOrders,
  onAddReserve,
  onOpenSchedule,
}: {
  project: ProjectRow;
  exposures: ExposureRow[];
  rollup: Rollup;
  warnings: Warning[];
  scheduleRiskCount: number;
  lastReviewForecast?: string | null;
  scheduleMovementSinceLastUpdate?: number | null;
  onOpenExposure?: (exposureId: string) => void;
  onReviewChangeOrders?: () => void;
  onAddReserve?: () => void;
  onOpenSchedule?: () => void;
}) {
  const [logoFailed, setLogoFailed] = useState(false);

  const remainingRisks = exposures.filter(hasRemainingRisk);
  const topExposures = [...remainingRisks].sort((a, b) => remaining(b) - remaining(a)).slice(0, 5);
  const scheduleLinkedExposures = remainingRisks.filter(
    (exposure) =>
      exposure.category === "schedule_compression" ||
      exposure.category === "procurement" ||
      exposure.category === "owner_decision",
  ).length;
  const linkedScheduleCount = scheduleRiskCount + scheduleLinkedExposures;
  const scheduleMovement =
    scheduleMovementSinceLastUpdate ??
    weeksBetween(lastReviewForecast, project.forecast_completion_date);
  const exposureTotals = topExposures.reduce(
    (totals, exposure) => ({
      gross: totals.gross + exposure.dollar_exposure,
      likely: totals.likely + likely(exposure),
      released: totals.released + released(exposure),
      remaining: totals.remaining + remaining(exposure),
    }),
    { gross: 0, likely: 0, released: 0, remaining: 0 },
  );
  const needsAttention = warnings.length > 0 || rollup.gpAtRisk > 0;
  // "GP at risk" is signed GP minus the GP now forecast after holds
  // (originalGP − indicatedGP). Positive → forecasting BELOW the signed deal, so
  // that profit is genuinely at risk. Negative → forecasting ABOVE it, which is
  // upside, not risk. Present it sign-aware everywhere.
  const gpDelta = rollup.gpAtRisk;
  const gpUpside = gpDelta < 0;
  const gpDeltaValue = fmtUSD(Math.abs(gpDelta));
  const attentionClause = warnings[0]?.title ?? "reserve coverage needs attention";

  const scheduleDays = daysAheadOfBaseline(
    project.baseline_completion_date,
    project.forecast_completion_date,
  );

  const bridgeLabelClass = "font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground";

  return (
    <section aria-label="Financial dashboard">
      {/* 1 · Verdict block */}
      <div className="grid items-end gap-8 lg:grid-cols-[1fr_300px] lg:gap-12">
        <div className="min-w-0">
          <h1 className="max-w-[24ch] font-serif text-3xl font-normal leading-[1.18] [text-wrap:balance] lg:text-4xl">
            {gpUpside ? (
              <>
                Gross profit is <span className="text-success">{gpDeltaValue} above signed</span>
                {needsAttention ? <> &mdash; but {attentionClause}</> : null}.
              </>
            ) : gpDelta > 0 ? (
              <>
                Gross profit is <span className="text-danger">{gpDeltaValue} below signed</span>
                {/* Below signed, the warning is the reason, not a contrast — and
                    never fabricate a clause when there is no warning. */}
                {warnings.length > 0 ? <> &mdash; and {warnings[0].title}</> : null}.
              </>
            ) : (
              <>
                Gross profit is holding at the signed {fmtPct(rollup.originalGPpct)}
                {needsAttention ? <> &mdash; but {attentionClause}</> : null}.
              </>
            )}
          </h1>
          <p className="mt-3 max-w-[64ch] text-[14.5px] leading-relaxed text-muted-foreground">
            Indicating{" "}
            <b className="font-semibold tabular text-foreground">{fmtPct(rollup.indicatedGPpct)}</b>{" "}
            against the {fmtPct(rollup.originalGPpct)} signed.
          </p>

          {needsAttention && (
            <div className="mt-3 flex max-w-[64ch] items-start gap-2.5">
              <span className="mt-0.5 flex-none whitespace-nowrap rounded-full border border-warning/35 bg-warning/10 px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-warning">
                Needs attention
              </span>
              <div className="min-w-0">
                <p className="text-[13.5px] leading-[1.55] text-muted-foreground">
                  {warnings.length > 0 ? (
                    <>
                      <b className="font-semibold text-foreground">{warnings[0].title}:</b>{" "}
                      {warnings[0].detail}
                    </>
                  ) : (
                    <>
                      <b className="font-semibold text-foreground">GP at risk:</b> {gpDeltaValue} of
                      the {fmtUSD(rollup.originalGP)} signed gross profit is now forecast below the
                      signed deal.
                    </>
                  )}
                </p>
                {warnings.length > 1 && (
                  <div className="mt-1.5 space-y-1">
                    {warnings.slice(1).map((warning) => (
                      <p key={warning.id} className="text-xs leading-relaxed text-muted-foreground">
                        <b className="font-medium text-foreground">{warning.title}:</b>{" "}
                        {warning.detail}
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {(onAddReserve || onReviewChangeOrders) && (
            <div className="mt-[18px] flex flex-wrap gap-2.5">
              {onAddReserve && (
                <Button variant="signal" size="sm" onClick={onAddReserve}>
                  Add E-Hold reserve
                </Button>
              )}
              {onReviewChangeOrders && (
                <Button variant="outline" size="sm" onClick={onReviewChangeOrders}>
                  Review change orders
                </Button>
              )}
            </div>
          )}
        </div>

        {/* Tenant watermark */}
        <div className="flex flex-col items-center justify-end gap-2.5 pb-2.5">
          {project.organization_logo_url && !logoFailed && (
            <img
              src={project.organization_logo_url}
              alt={`${project.organization_name || "Company"} logo`}
              className="block h-auto w-full max-w-[230px] opacity-35 grayscale-[35%]"
              onError={() => setLogoFailed(true)}
            />
          )}
          {project.organization_name && (
            <div className="text-center font-mono text-[9.5px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
              {project.organization_name}
            </div>
          )}
        </div>
      </div>

      {/* 2 · Forecast bridge */}
      <div className="eyebrow mt-9">How the forecast is built</div>
      <div className="mt-3.5 grid items-stretch gap-4 md:grid-cols-[1fr_1fr_1.1fr]">
        <div className="rounded-xl border border-hairline bg-card p-4 lg:px-5">
          <div className={bridgeLabelClass}>01 · Forecast</div>
          <div className="mt-2">
            <BridgeRow label="Forecast contract" value={fmtUSD(rollup.forecastedFinalContract)} />
            <BridgeRow label="− Forecast cost" value={fmtUSD(rollup.forecastedFinalCost)} />
            <BridgeRow
              label="GP before holds"
              value={fmtUSD(rollup.forecastedGPBeforeHolds)}
              strong
            />
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-card p-4 lg:px-5">
          <div className={bridgeLabelClass}>02 · Holds</div>
          <div className="mt-2">
            <BridgeRow label="GP before holds" value={fmtUSD(rollup.forecastedGPBeforeHolds)} />
            <BridgeRow
              label="− E-Hold · specific"
              value={fmtUSD(rollup.exposureHolds)}
              valueClassName={rollup.exposureHolds > 0 ? "text-danger" : "text-muted-foreground"}
            />
            <BridgeRow
              label="− C-Hold · uncertainty"
              value={fmtUSD(rollup.contingencyHold)}
              valueClassName="text-muted-foreground"
            />
          </div>
        </div>

        {/* On-dark tints inside the dark result card use the documented
            dark-panel exception (THEMING.md): fixed on-dark green/red hex. */}
        <div className="flex flex-col rounded-xl bg-dark-panel p-4 text-dark-panel-foreground lg:px-5">
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-dark-panel-foreground/60">
            03 · The result
          </div>
          <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-serif text-[32px] leading-none tabular">
              {fmtUSD(rollup.indicatedGP)}
            </span>
            <span className="text-[12.5px] text-dark-panel-foreground/60">
              Indicated GP · {fmtPct(rollup.indicatedGPpct)}
            </span>
          </div>
          <div className="mt-auto flex items-baseline justify-between gap-3 border-t border-dark-panel-foreground/20 pt-2.5">
            <span className="text-[12.5px] text-dark-panel-foreground/60">
              − Signed GP {fmtUSD(rollup.originalGP)} · {fmtPct(rollup.originalGPpct)}
            </span>
            <span
              className={`font-serif text-[19px] tabular ${
                gpUpside ? "text-[#7FB08A]" : gpDelta > 0 ? "text-[#E08A76]" : ""
              }`}
            >
              {gpUpside ? `+${gpDeltaValue}` : gpDelta > 0 ? `−${gpDeltaValue}` : gpDeltaValue}
            </span>
          </div>
        </div>
      </div>
      <div className="mt-2.5 text-[11.5px] text-muted-foreground">
        Figures are rounded once at source, so every step reconciles to the dollar.
      </div>

      {/* 3 · Schedule + top exposures */}
      <div className="mt-[18px] grid items-start gap-[18px] md:grid-cols-2">
        <div className="rounded-xl border border-hairline bg-card px-5 py-[18px] lg:px-[22px]">
          <div className="text-[13px] font-semibold text-foreground">Schedule</div>
          <p className="mt-2.5 font-serif text-[19px] leading-[1.45] text-foreground">
            {scheduleDays != null && scheduleDays > 0 ? (
              <>
                Forecasting{" "}
                <b className="border-b border-success/35 font-normal text-success">
                  {scheduleDays} {scheduleDays === 1 ? "day" : "days"} ahead
                </b>{" "}
                of baseline.
              </>
            ) : scheduleDays != null && scheduleDays < 0 ? (
              <>
                Forecasting{" "}
                <b className="border-b border-danger/35 font-normal text-danger">
                  {Math.abs(scheduleDays)} {Math.abs(scheduleDays) === 1 ? "day" : "days"} behind
                </b>{" "}
                baseline.
              </>
            ) : scheduleDays === 0 && (scheduleMovement ?? 0) > 0 ? (
              <>
                Tracking{" "}
                <b className="border-b border-warning/35 font-normal text-warning">
                  on the baseline plan
                </b>
                .
              </>
            ) : (
              <>Tracking on the baseline plan.</>
            )}
          </p>
          <div className="mt-3 flex flex-wrap items-start gap-x-5 gap-y-2 text-[12.5px] text-muted-foreground">
            <span className="w-[116px]">
              Forecast
              <br />
              {formatDate(project.forecast_completion_date)}
            </span>
            <span className="w-[109px]">
              Baseline
              <br />
              {formatDate(project.baseline_completion_date)}
            </span>
            <span>{formatScheduleMovement(scheduleMovement)}</span>
            <span>
              {linkedScheduleCount} {linkedScheduleCount === 1 ? "risk" : "risks"}
            </span>
            {onOpenSchedule && (
              <button
                type="button"
                onClick={onOpenSchedule}
                className="ml-auto cursor-pointer whitespace-nowrap text-[12.5px] font-semibold text-foreground hover:underline"
              >
                Schedule →
              </button>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-hairline bg-card px-5 py-1.5 lg:px-[22px]">
          <div className="flex items-center gap-2.5 border-b border-hairline py-3">
            <span className="text-[13px] font-semibold text-foreground">Top exposures</span>
            <span className="ml-auto text-xs tabular text-muted-foreground">
              {fmtUSD(exposureTotals.likely)} likely · {fmtUSD(exposureTotals.released)} released
            </span>
          </div>
          {topExposures.length === 0 ? (
            <p className="py-4 text-sm text-muted-foreground">
              No live exposures are currently logged.
            </p>
          ) : (
            topExposures.map((exposure, index) => (
              <button
                key={exposure.id}
                type="button"
                onClick={() => onOpenExposure?.(exposure.id)}
                aria-label={`Open risk tally item ${exposure.title}`}
                className={`-mx-2.5 flex w-[calc(100%+1.25rem)] cursor-pointer items-center gap-3 rounded-lg px-2.5 py-[11px] text-left transition-colors hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                  index < topExposures.length - 1 ? "border-b border-hairline" : ""
                }`}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold text-foreground">
                    {exposure.title}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {CATEGORY_LABELS[exposure.category]} · {RESPONSE_LABELS[exposure.response_path]}{" "}
                    · {exposure.owner || "Unassigned"}
                  </span>
                </span>
                <span className="ml-auto flex-none font-serif text-[17px] tabular text-foreground">
                  {fmtUSD(remaining(exposure))}
                </span>
                <span className="flex-none text-muted-foreground" aria-hidden="true">
                  ›
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 4 · Bottom stats row */}
      <div className="mt-6 flex flex-wrap items-end gap-x-[30px] gap-y-4 border-t border-hairline pt-4">
        <div className="flex-none">
          <div className="whitespace-nowrap text-[11.5px] text-muted-foreground">Job #</div>
          <div className="mt-1 whitespace-nowrap text-sm font-semibold text-foreground">
            {project.job_number || "—"}
          </div>
        </div>
        <div className="flex-none">
          <div className="whitespace-nowrap text-[11.5px] text-muted-foreground">Client</div>
          <div className="mt-1 whitespace-nowrap text-sm font-semibold text-foreground">
            {project.client || "—"}
          </div>
        </div>
        <div className="flex-none">
          <div className="whitespace-nowrap text-[11.5px] text-muted-foreground">
            Project manager
          </div>
          <div className="mt-1 whitespace-nowrap text-sm font-semibold text-foreground">
            {project.project_manager || "—"}
          </div>
        </div>
        <div className="ml-auto flex-none">
          <div className="whitespace-nowrap text-[11.5px] text-muted-foreground">
            Original contract
          </div>
          <div className="mt-[3px] whitespace-nowrap font-serif text-[17px] tabular text-foreground">
            {fmtUSD(project.original_contract)}
          </div>
        </div>
        <div className="flex-none">
          <div className="whitespace-nowrap text-[11.5px] text-muted-foreground">
            Contract incl. approved COs
          </div>
          <div className="mt-[3px] whitespace-nowrap font-serif text-[17px] tabular text-foreground">
            {fmtUSD(rollup.originalContract + rollup.approvedCOContract)}
            {rollup.approvedCOContract > 0 && (
              <span className="ml-1.5 font-sans text-[11.5px] text-success">
                +{fmtUSD(rollup.approvedCOContract)}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function BridgeRow({
  label,
  value,
  strong,
  valueClassName,
}: {
  label: string;
  value: string;
  strong?: boolean;
  valueClassName?: string;
}) {
  return (
    <div
      className={
        strong
          ? "flex items-baseline justify-between gap-3 border-t-2 border-foreground py-2.5"
          : "flex items-baseline justify-between gap-3 border-t border-hairline py-[9px]"
      }
    >
      <span
        className={
          strong ? "text-[12.5px] font-bold text-foreground" : "text-[12.5px] text-muted-foreground"
        }
      >
        {label}
      </span>
      <span
        className={`font-serif tabular ${strong ? "text-[19px]" : "text-[17px]"} ${
          valueClassName ?? "text-foreground"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
