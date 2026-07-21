import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { fmtPct, fmtUSD } from "@/lib/format";
import type { ExposureRow, ProjectRow } from "@/lib/projects.functions";
import { remainingExposureValue, type Rollup, type Warning } from "@/lib/ior";

// Plain-English expansions for the finance shorthand on this dashboard. These
// mirror the glossary on the Support page verbatim so a term reads the same
// wherever a contractor meets it. Shown on hover via <GlossaryTerm> below.
const GLOSSARY_HELP = {
  gp: "GP = gross profit: what's left after job costs — the contract value minus what the work actually costs you to build.",
  signedGp:
    "The gross profit you agreed to on the signed deal — the current contract (with approved change orders) minus its budgeted cost.",
  co: "CO = change order: an approved change to a signed contract's scope and price, added after the original deal.",
  eHold:
    "E-Hold = exposure hold: money reserved against a specific, identified risk — a delayed package, an overrun allowance.",
  cHold:
    "C-Hold = contingency hold: money reserved for the general uncertainty left in scope you haven't bought out yet.",
  indicatedGp:
    "Indicated GP: the gross profit currently forecast after subtracting all holds — your best current read on where profit lands.",
} as const;

// A term whose plain-English meaning is one hover away. Dotted underline signals
// "there's help here" without shouting; inherits the surrounding text color so it
// works on both the dark bridge panel and the light cards.
function GlossaryTerm({ help, children }: { help: string; children: ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="cursor-help underline decoration-dotted underline-offset-2">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs font-normal normal-case tracking-normal">
        {help}
      </TooltipContent>
    </Tooltip>
  );
}

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
  const totalHolds = rollup.exposureHolds + rollup.contingencyHold;
  const approvedCOMargin = rollup.approvedCOContract - rollup.approvedCOCost;
  const baseCostVariance = rollup.baseProjectedCost - project.original_cost_budget;
  const weightedPendingCOMargin = rollup.weightedPendingCOContract - rollup.weightedPendingCOCost;
  // The dashboard compares like with like: the current signed deal includes
  // approved CO revenue and cost. Pending COs remain a separate weighted forecast.
  const gpDelta = rollup.currentSignedGP - rollup.indicatedGP;
  const gpUpside = gpDelta < 0;
  const needsAttention = warnings.length > 0 || gpDelta > 0;
  const gpDeltaValue = fmtUSD(Math.abs(gpDelta));
  const attentionClause = warnings[0]?.title ?? "reserve coverage needs attention";

  const scheduleDays = daysAheadOfBaseline(
    project.baseline_completion_date,
    project.forecast_completion_date,
  );

  const bridgeLabelClass = "font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground";

  return (
    <TooltipProvider delayDuration={150}>
      <section aria-label="Financial dashboard">
        {/* 1 · Verdict block */}
        <div className="grid items-end gap-8 lg:grid-cols-[1fr_300px] lg:gap-12">
          <div className="min-w-0">
            <h1 className="max-w-[24ch] font-serif text-3xl font-normal leading-[1.18] [text-wrap:balance] lg:text-4xl">
              {gpUpside ? (
                <>
                  Gross profit is{" "}
                  <span className="text-success">{gpDeltaValue} above current signed</span>
                  {needsAttention ? <> &mdash; but {attentionClause}</> : null}.
                </>
              ) : gpDelta > 0 ? (
                <>
                  Gross profit is{" "}
                  <span className="text-danger">{gpDeltaValue} below current signed</span>
                  {/* Below signed, the warning is the reason, not a contrast — and
                    never fabricate a clause when there is no warning. */}
                  {warnings.length > 0 ? <> &mdash; and {warnings[0].title}</> : null}.
                </>
              ) : (
                <>
                  Gross profit is holding at the current signed {fmtPct(rollup.currentSignedGPpct)}
                  {needsAttention ? <> &mdash; but {attentionClause}</> : null}.
                </>
              )}
            </h1>
            <p className="mt-3 max-w-[64ch] text-[14.5px] leading-relaxed text-muted-foreground">
              Indicating{" "}
              <b className="font-semibold tabular text-foreground">
                {fmtPct(rollup.indicatedGPpct)}
              </b>{" "}
              against the current signed {fmtPct(rollup.currentSignedGPpct)}.
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
                        <b className="font-semibold text-foreground">GP at risk:</b> {gpDeltaValue}{" "}
                        of the {fmtUSD(rollup.currentSignedGP)} current signed gross profit is now
                        forecast below the signed deal.
                      </>
                    )}
                  </p>
                  {warnings.length > 1 && (
                    <div className="mt-1.5 space-y-1">
                      {warnings.slice(1).map((warning) => (
                        <p
                          key={warning.id}
                          className="text-xs leading-relaxed text-muted-foreground"
                        >
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
        <div className="mt-3.5 grid items-stretch gap-4 md:grid-cols-2">
          <div className="rounded-xl bg-dark-panel p-4 text-dark-panel-foreground md:col-span-2 lg:px-5 lg:py-[18px]">
            <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-dark-panel-foreground/60">
              <GlossaryTerm help={GLOSSARY_HELP.gp}>GP</GlossaryTerm> recovery bridge
            </div>
            <p className="mt-1.5 max-w-[78ch] text-[12.5px] leading-relaxed text-dark-panel-foreground/60">
              Start with the gross profit committed in the IOR, then track forecast movement and
              holds to the profit currently indicated.
            </p>

            <div className="mt-4 grid gap-4 md:grid-cols-3 md:gap-0">
              <div className="min-w-0 md:pr-5">
                <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-dark-panel-foreground/60">
                  <GlossaryTerm help={GLOSSARY_HELP.signedGp}>Signed GP target</GlossaryTerm>
                </div>
                <div className="mt-1.5">
                  <BridgeRow label="Original planned GP" value={fmtUSD(rollup.originalGP)} dark />
                  <BridgeRow
                    label={
                      <>
                        {approvedCOMargin >= 0 ? "+ Approved " : "− Approved "}
                        <GlossaryTerm help={GLOSSARY_HELP.co}>CO</GlossaryTerm>
                        {approvedCOMargin >= 0 ? " margin" : " margin erosion"}
                      </>
                    }
                    value={fmtUSD(approvedCOMargin, { sign: true })}
                    dark
                  />
                  <BridgeRow
                    label="Current signed GP target"
                    value={fmtUSD(rollup.currentSignedGP)}
                    dark
                    strong
                  />
                </div>
                <p className="mt-1.5 text-[11px] leading-relaxed text-dark-panel-foreground/50">
                  <span className="block">
                    {fmtUSD(rollup.originalContract)} original contract −{" "}
                    {fmtUSD(project.original_cost_budget)} original build cost
                  </span>
                  <span className="block">
                    {fmtUSD(rollup.currentSignedContract)} current signed contract ·{" "}
                    {fmtPct(rollup.currentSignedGPpct)} planned margin
                  </span>
                </p>
              </div>

              <div className="min-w-0 border-t border-dark-panel-foreground/20 pt-4 md:border-l md:border-t-0 md:px-5 md:pt-0">
                <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-dark-panel-foreground/60">
                  Forecast movement
                </div>
                <div className="mt-1.5">
                  <BridgeRow
                    label={
                      baseCostVariance >= 0
                        ? "− Base cost forecast growth"
                        : "+ Base cost forecast savings"
                    }
                    value={fmtUSD(-baseCostVariance, { sign: true })}
                    dark
                  />
                  <BridgeRow
                    label={
                      weightedPendingCOMargin >= 0
                        ? "+ Pending CO margin · weighted"
                        : "− Pending CO margin · weighted"
                    }
                    value={fmtUSD(weightedPendingCOMargin, { sign: true })}
                    dark
                  />
                  <BridgeRow
                    label="GP before holds"
                    value={fmtUSD(rollup.forecastedGPBeforeHolds)}
                    dark
                    strong
                  />
                </div>
              </div>

              <div className="flex min-w-0 flex-col border-t border-dark-panel-foreground/20 pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
                <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-dark-panel-foreground/60">
                  Holds and result
                </div>
                <div className="mt-1.5">
                  <BridgeRow
                    label={
                      <>
                        − <GlossaryTerm help={GLOSSARY_HELP.eHold}>E-Hold</GlossaryTerm> · specific
                      </>
                    }
                    value={fmtUSD(-rollup.exposureHolds)}
                    dark
                  />
                  <BridgeRow
                    label={
                      <>
                        − <GlossaryTerm help={GLOSSARY_HELP.cHold}>C-Hold</GlossaryTerm> ·
                        uncertainty
                      </>
                    }
                    value={fmtUSD(-rollup.contingencyHold)}
                    dark
                  />
                </div>
                <div className="mt-2.5 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="font-serif text-[32px] leading-none tabular">
                    {fmtUSD(rollup.indicatedGP)}
                  </span>
                  <span className="text-[12.5px] text-dark-panel-foreground/60">
                    <GlossaryTerm help={GLOSSARY_HELP.indicatedGp}>Indicated GP</GlossaryTerm> ·{" "}
                    {fmtPct(rollup.indicatedGPpct)}
                  </span>
                </div>
                <div className="mt-3 flex items-baseline justify-between gap-3 border-t border-dark-panel-foreground/20 pt-2.5">
                  <span className="text-[12.5px] text-dark-panel-foreground/60">
                    Gap to signed GP target
                  </span>
                  <span className="whitespace-nowrap font-serif text-[19px] tabular text-dark-panel-foreground">
                    {gpUpside
                      ? fmtUSD(Math.abs(gpDelta), { sign: true })
                      : gpDelta > 0
                        ? fmtUSD(-gpDelta)
                        : fmtUSD(gpDelta)}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-hairline bg-card p-4 lg:px-5">
            <div className={bridgeLabelClass}>01 · Revenue forecast</div>
            <div className="mt-2">
              <BridgeRow label="Original contract" value={fmtUSD(rollup.originalContract)} />
              <BridgeRow label="+ Approved COs" value={fmtUSD(rollup.approvedCOContract)} />
              <BridgeRow
                label="Current signed contract"
                value={fmtUSD(rollup.currentSignedContract)}
                strong
              />
              <BridgeRow
                label="+ Pending COs · weighted"
                value={fmtUSD(rollup.weightedPendingCOContract)}
              />
              <BridgeRow
                label="Risk-adjusted forecast contract"
                value={fmtUSD(rollup.forecastedFinalContract)}
                strong
              />
            </div>
          </div>

          <div className="rounded-xl border border-hairline bg-card p-4 lg:px-5">
            <div className={bridgeLabelClass}>02 · Cost forecast</div>
            <div className="mt-2">
              <BridgeRow label="Original build cost" value={fmtUSD(project.original_cost_budget)} />
              <BridgeRow
                label={baseCostVariance >= 0 ? "+ Forecast cost growth" : "− Forecast cost savings"}
                value={fmtUSD(Math.abs(baseCostVariance))}
              />
              <BridgeRow label="Base projected cost" value={fmtUSD(rollup.baseProjectedCost)} />
              <BridgeRow label="+ Approved CO costs" value={fmtUSD(rollup.approvedCOCost)} />
              <BridgeRow
                label="+ Pending CO costs · weighted"
                value={fmtUSD(rollup.weightedPendingCOCost)}
              />
              <BridgeRow
                label="Risk-adjusted forecast cost"
                value={fmtUSD(rollup.forecastedFinalCost)}
                strong
              />
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
                {fmtUSD(totalHolds)} total holds · top {topExposures.length} shown
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
                      {CATEGORY_LABELS[exposure.category]} ·{" "}
                      {RESPONSE_LABELS[exposure.response_path]} · {exposure.owner || "Unassigned"}
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
    </TooltipProvider>
  );
}

function BridgeRow({
  label,
  value,
  strong,
  dark,
  valueClassName,
}: {
  label: ReactNode;
  value: string;
  strong?: boolean;
  dark?: boolean;
  valueClassName?: string;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-3 py-[9px] ${
        strong
          ? dark
            ? "border-t-2 border-dark-panel-foreground"
            : "border-t-2 border-foreground"
          : dark
            ? "border-t border-dark-panel-foreground/20"
            : "border-t border-hairline"
      }`}
    >
      <span
        className={`text-[12.5px] ${strong ? "font-bold" : ""} ${
          dark
            ? strong
              ? "text-dark-panel-foreground"
              : "text-dark-panel-foreground/60"
            : strong
              ? "text-foreground"
              : "text-muted-foreground"
        }`}
      >
        {label}
      </span>
      <span
        className={`font-serif tabular ${strong ? "text-[19px]" : "text-[17px]"} ${
          valueClassName ?? (dark ? "text-dark-panel-foreground" : "text-foreground")
        }`}
      >
        {value}
      </span>
    </div>
  );
}
