import { useEffect, useState } from "react";
import { AlertTriangle, CalendarClock, CircleDollarSign, FileSpreadsheet, ListChecks, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExposuresTable, type ExposureDraft } from "@/components/outcome/ExposuresTable";
import { ImportSOVSheet } from "@/components/outcome/ImportSOVSheet";
import { fmtPct, fmtUSD } from "@/lib/format";
import type { ExposureCategory, ResponsePath, Rollup, Warning } from "@/lib/ior";
import type { BucketRow, ExposureRow, ProjectRow } from "@/lib/projects.functions";

const CATEGORY_LABELS: Record<ExposureCategory, string> = {
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

const RESPONSE_LABELS: Record<ResponsePath, string> = {
  eliminate: "Eliminate",
  recover: "Recover",
  offset: "Offset",
  accept: "Accept",
};

function weighted(e: ExposureRow) {
  return e.dollar_exposure * (e.probability / 100);
}

function isLiveRisk(e: ExposureRow) {
  return e.status === "active" || e.status === "escalated";
}

function isClosedRisk(e: ExposureRow) {
  return e.status === "recovered" || e.status === "eliminated" || e.status === "released";
}

function scheduleReliability(project: ProjectRow, liveScheduleRisks: number) {
  const slipWeeks = Math.max(0, project.schedule_variance_weeks);
  const score = Math.max(0, Math.min(100, 100 - slipWeeks * 8 - liveScheduleRisks * 6));
  if (slipWeeks >= 4 || score < 65) return { label: "Slipped", score, tone: "danger" as const };
  if (slipWeeks > 0 || liveScheduleRisks > 0) return { label: "Watch", score, tone: "warning" as const };
  return { label: "On plan", score, tone: "success" as const };
}

function toneClass(tone: "success" | "warning" | "danger") {
  if (tone === "success") return "border-success/30 bg-success/10 text-success";
  if (tone === "warning") return "border-warning/40 bg-warning/10 text-warning";
  return "border-danger/40 bg-danger/10 text-danger";
}

function formatDate(d?: string | null) {
  if (!d) return "Not set";
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function compactPct(value: number) {
  return `${Math.round(value)}%`;
}

export function RiskAllocationWorkbench({
  project,
  exposures,
  buckets,
  rollup,
  guidance,
  warnings,
  onCreateExposure,
  onUpdateExposure,
  onDeleteExposure,
  onUpdateProject,
  projectUpdatePending,
  onImportBuckets,
  importPending,
}: {
  project: ProjectRow;
  exposures: ExposureRow[];
  buckets: BucketRow[];
  rollup: Rollup;
  guidance: { ePct: number; cPct: number; eTarget: number; cTarget: number };
  warnings: Warning[];
  onCreateExposure: (d: ExposureDraft) => void;
  onUpdateExposure: (id: string, patch: Partial<ExposureDraft>) => void;
  onDeleteExposure: (id: string) => void;
  onUpdateProject: (patch: Partial<ProjectRow>) => void;
  projectUpdatePending?: boolean;
  onImportBuckets: (
    rows: { bucket: string; original_budget: number; actual_to_date: number; ftc: number; sort_order: number }[],
    mode: "replace" | "append",
  ) => void;
  importPending?: boolean;
}) {
  const live = exposures.filter(isLiveRisk);
  const closed = exposures.filter(isClosedRisk);
  const activeRisk = live.reduce((s, e) => s + weighted(e), 0);
  const restoredRisk = closed.reduce((s, e) => s + weighted(e), 0);
  const acceptedRisk = live
    .filter((e) => e.response_path === "accept")
    .reduce((s, e) => s + weighted(e), 0);
  const scheduleRiskCount = live.filter((e) =>
    e.category === "schedule_compression" ||
    e.category === "procurement" ||
    e.category === "owner_decision",
  ).length;
  const schedule = scheduleReliability(project, scheduleRiskCount);
  const bucketTotal = buckets.reduce((s, b) => s + b.actual_to_date + b.ftc, 0);

  const treatmentRows = (Object.keys(RESPONSE_LABELS) as ResponsePath[]).map((path) => {
    const matching = live.filter((e) => e.response_path === path);
    return {
      path,
      total: matching.reduce((s, e) => s + weighted(e), 0),
      count: matching.length,
    };
  });

  const topRisk = [...live].sort((a, b) => weighted(b) - weighted(a))[0] ?? null;

  return (
    <section className="space-y-5" aria-label="Risk allocation workbench">
      <div className="rounded-lg border border-hairline bg-card shadow-card">
        <div className="grid gap-px bg-hairline lg:grid-cols-[1.15fr_0.85fr]">
          <div className="bg-card p-6 lg:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  <span className="inline-block h-px w-7 bg-danger" />
                  Risk Allocation
                </div>
                <h2 className="mt-2 font-serif text-4xl leading-tight text-foreground">
                  Running risk ledger
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  Identify the risk, put a dollar value on it, choose the treatment path, and keep the indicated GP honest as the job changes.
                </p>
              </div>
              <div className="grid min-w-[240px] grid-cols-2 gap-2">
                <MetricTile label="Live allocated risk" value={fmtUSD(activeRisk)} tone="danger" />
                <MetricTile label="Restored/closed" value={fmtUSD(restoredRisk)} tone="success" />
                <MetricTile label="Exposure Hold" value={fmtUSD(rollup.exposureHolds)} />
                <MetricTile label="Contingency Hold" value={fmtUSD(rollup.contingencyHold)} />
              </div>
            </div>

            <div className="mt-6 grid gap-3 md:grid-cols-4">
              {treatmentRows.map((row) => (
                <TreatmentCard key={row.path} label={RESPONSE_LABELS[row.path]} total={row.total} count={row.count} />
              ))}
            </div>
          </div>

          <div className="bg-surface-elevated p-6 lg:p-8">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
              <CircleDollarSign className="h-3.5 w-3.5" />
              GP Impact
            </div>
            <div className="mt-5 space-y-3">
              <BridgeRow label="Forecasted GP before holds" value={rollup.forecastedGPBeforeHolds} />
              <BridgeRow label="Less Exposure Hold" value={-rollup.exposureHolds} danger />
              <BridgeRow label="Less Contingency Hold" value={-rollup.contingencyHold} danger />
              <div className="rounded-md border border-accent/50 bg-accent/10 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">Indicated GP</span>
                  <span className="font-serif text-3xl tabular text-accent">{fmtUSD(rollup.indicatedGP)}</span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {fmtPct(rollup.indicatedGPpct)} vs original {fmtPct(rollup.originalGPpct)}
                </div>
              </div>
            </div>
            <div className="mt-4 rounded-md border border-hairline bg-card px-4 py-3">
              <div className="flex items-start gap-2">
                <TrendingDown className="mt-0.5 h-4 w-4 text-danger" />
                <div>
                  <div className="text-sm font-medium text-foreground">{fmtUSD(rollup.gpAtRisk)} original GP at risk</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {acceptedRisk > 0
                      ? `${fmtUSD(acceptedRisk)} is currently being accepted instead of eliminated, recovered, or offset.`
                      : "No live risk is currently marked as accepted."}
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr]">
        <div className="space-y-5">
          <SovStartPanel
            bucketCount={buckets.length}
            bucketTotal={bucketTotal}
            originalCostBudget={project.original_cost_budget}
            onImportBuckets={onImportBuckets}
            importPending={importPending}
          />
          <ScheduleCheckPanel
            project={project}
            schedule={schedule}
            scheduleRiskCount={scheduleRiskCount}
            onUpdateProject={onUpdateProject}
            pending={projectUpdatePending}
          />
          <HoldGuide
            eTarget={guidance.eTarget}
            cTarget={guidance.cTarget}
            ePct={guidance.ePct}
            cPct={guidance.cPct}
            eActual={rollup.exposureHolds}
            cActual={rollup.contingencyHold}
          />
        </div>

        <div id="risk-ledger" className="rounded-lg border border-hairline bg-card p-5 shadow-card">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-serif text-3xl text-foreground">Open risk tally</h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Use this as the running project meeting ledger: add the risk, update the dollars, and close it out when the exposure is gone.
              </p>
            </div>
            {topRisk && (
              <div className="rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs">
                <div className="font-medium text-danger">Largest live item</div>
                <div className="mt-0.5 text-foreground">{topRisk.title}</div>
                <div className="tabular text-muted-foreground">{fmtUSD(weighted(topRisk))}</div>
              </div>
            )}
          </div>
          <ExposuresTable
            exposures={exposures}
            onCreate={onCreateExposure}
            onUpdate={onUpdateExposure}
            onDelete={onDeleteExposure}
          />
        </div>
      </div>

      <MeetingSummary
        project={project}
        activeRisk={activeRisk}
        restoredRisk={restoredRisk}
        warnings={warnings}
        scheduleLabel={schedule.label}
        topRisk={topRisk}
      />
    </section>
  );
}

function MetricTile({ label, value, tone }: { label: string; value: string; tone?: "danger" | "success" }) {
  const cls = tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-foreground";
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={`mt-1 font-serif text-2xl tabular leading-none ${cls}`}>{value}</div>
    </div>
  );
}

function TreatmentCard({ label, total, count }: { label: string; total: number; count: number }) {
  return (
    <div className="rounded-md border border-hairline bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="rounded-full bg-card px-2 py-0.5 text-[10px] text-muted-foreground">{count}</div>
      </div>
      <div className="mt-2 font-serif text-2xl tabular text-foreground">{fmtUSD(total)}</div>
    </div>
  );
}

function BridgeRow({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={`tabular ${danger ? "text-danger" : "text-foreground"}`}>
        {value < 0 ? `-${fmtUSD(Math.abs(value))}` : fmtUSD(value)}
      </span>
    </div>
  );
}

function SovStartPanel({
  bucketCount,
  bucketTotal,
  originalCostBudget,
  onImportBuckets,
  importPending,
}: {
  bucketCount: number;
  bucketTotal: number;
  originalCostBudget: number;
  onImportBuckets: (
    rows: { bucket: string; original_budget: number; actual_to_date: number; ftc: number; sort_order: number }[],
    mode: "replace" | "append",
  ) => void;
  importPending?: boolean;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <FileSpreadsheet className="h-3.5 w-3.5" />
            SOV Baseline
          </div>
          <div className="mt-2 font-serif text-2xl text-foreground">{bucketCount} cost buckets</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Forecasted bucket cost {fmtUSD(bucketTotal)} against original cost budget {fmtUSD(originalCostBudget)}.
          </div>
        </div>
        <ImportSOVSheet onImport={onImportBuckets} pending={importPending} />
      </div>
    </div>
  );
}

function ScheduleCheckPanel({
  project,
  schedule,
  scheduleRiskCount,
  onUpdateProject,
  pending,
}: {
  project: ProjectRow;
  schedule: { label: string; score: number; tone: "success" | "warning" | "danger" };
  scheduleRiskCount: number;
  onUpdateProject: (patch: Partial<ProjectRow>) => void;
  pending?: boolean;
}) {
  const [baseline, setBaseline] = useState(project.baseline_completion_date ?? "");
  const [forecast, setForecast] = useState(project.forecast_completion_date ?? "");
  const [variance, setVariance] = useState(String(project.schedule_variance_weeks ?? 0));

  useEffect(() => {
    setBaseline(project.baseline_completion_date ?? "");
    setForecast(project.forecast_completion_date ?? "");
    setVariance(String(project.schedule_variance_weeks ?? 0));
  }, [project.id, project.baseline_completion_date, project.forecast_completion_date, project.schedule_variance_weeks]);

  const save = () => {
    onUpdateProject({
      baseline_completion_date: baseline || null,
      forecast_completion_date: forecast || null,
      schedule_variance_weeks: Number(variance) || 0,
    });
  };

  return (
    <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            Daily Schedule Check
          </div>
          <div className="mt-2 flex items-center gap-2">
            <span className={`inline-flex rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${toneClass(schedule.tone)}`}>
              {schedule.label}
            </span>
            <span className="text-xs text-muted-foreground">Reliability {compactPct(schedule.score)}</span>
          </div>
        </div>
        <div className="text-right text-xs text-muted-foreground">
          <div>{project.schedule_variance_weeks > 0 ? `+${project.schedule_variance_weeks} wk slipped` : "No slip logged"}</div>
          <div>{scheduleRiskCount} schedule-linked risks</div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <div className="space-y-1.5">
          <Label>Baseline completion</Label>
          <Input type="date" value={baseline} onChange={(e) => setBaseline(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Forecast completion</Label>
          <Input type="date" value={forecast} onChange={(e) => setForecast(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Slip weeks</Label>
          <Input type="number" value={variance} onChange={(e) => setVariance(e.target.value)} />
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Forecast is {formatDate(project.forecast_completion_date)}. Critical path changed: {project.schedule_variance_weeks > 0 || scheduleRiskCount > 0 ? "Yes" : "No"}.
        </p>
        <Button size="sm" variant="outline" disabled={pending} onClick={save}>
          {pending ? "Saving..." : "Save schedule"}
        </Button>
      </div>
    </div>
  );
}

function HoldGuide({
  eTarget,
  cTarget,
  ePct,
  cPct,
  eActual,
  cActual,
}: {
  eTarget: number;
  cTarget: number;
  ePct: number;
  cPct: number;
  eActual: number;
  cActual: number;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5" />
        Hold Guide
      </div>
      <div className="mt-4 space-y-4">
        <HoldRow
          label="Exposure Hold"
          description="Specific known risk with a dollar value."
          actual={eActual}
          target={eTarget}
          pct={ePct}
        />
        <HoldRow
          label="Contingency Hold"
          description="General remaining uncertainty."
          actual={cActual}
          target={cTarget}
          pct={cPct}
        />
      </div>
    </div>
  );
}

function HoldRow({
  label,
  description,
  actual,
  target,
  pct,
}: {
  label: string;
  description: string;
  actual: number;
  target: number;
  pct: number;
}) {
  const ratio = target > 0 ? Math.min(100, (actual / target) * 100) : 100;
  const below = actual < target;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-foreground">{label}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
        <div className={`text-right text-sm tabular ${below ? "text-danger" : "text-success"}`}>
          {fmtUSD(actual)}
          <div className="text-[11px] text-muted-foreground">target {fmtUSD(target)} ({pct}%)</div>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className={`h-full rounded-full ${below ? "bg-danger" : "bg-success"}`} style={{ width: `${ratio}%` }} />
      </div>
    </div>
  );
}

function MeetingSummary({
  project,
  activeRisk,
  restoredRisk,
  warnings,
  scheduleLabel,
  topRisk,
}: {
  project: ProjectRow;
  activeRisk: number;
  restoredRisk: number;
  warnings: Warning[];
  scheduleLabel: string;
  topRisk: ExposureRow | null;
}) {
  return (
    <div className="rounded-lg border border-hairline bg-surface-elevated p-5">
      <div className="mb-3 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        <AlertTriangle className="h-3.5 w-3.5 text-warning" />
        Meeting Summary
      </div>
      <div className="grid gap-3 text-sm md:grid-cols-4">
        <SummaryPoint label="Risk to work" value={`${fmtUSD(activeRisk)} active across the ledger`} />
        <SummaryPoint label="Risk released" value={`${fmtUSD(restoredRisk)} restored or closed out`} />
        <SummaryPoint label="Schedule posture" value={`${scheduleLabel} - forecast ${formatDate(project.forecast_completion_date)}`} />
        <SummaryPoint label="Start here" value={topRisk ? `${CATEGORY_LABELS[topRisk.category]}: ${topRisk.title}` : warnings[0]?.title ?? "No live risk logged"} />
      </div>
    </div>
  );
}

function SummaryPoint({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-card px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}
