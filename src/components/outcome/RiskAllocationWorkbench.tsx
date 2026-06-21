import { CircleDollarSign, ListChecks, TrendingDown } from "lucide-react";
import { ExposuresTable, type ExposureDraft } from "@/components/outcome/ExposuresTable";
import { fmtPct, fmtUSD } from "@/lib/format";
import type { ResponsePath, Rollup } from "@/lib/ior";
import type { ExposureRow } from "@/lib/projects.functions";

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

export function RiskAllocationWorkbench({
  exposures,
  rollup,
  guidance,
  onCreateExposure,
  onUpdateExposure,
  onDeleteExposure,
}: {
  exposures: ExposureRow[];
  rollup: Rollup;
  guidance: { ePct: number; cPct: number; eTarget: number; cTarget: number };
  onCreateExposure: (d: ExposureDraft) => void;
  onUpdateExposure: (id: string, patch: Partial<ExposureDraft>) => void;
  onDeleteExposure: (id: string) => void;
}) {
  const live = exposures.filter(isLiveRisk);
  const closed = exposures.filter(isClosedRisk);
  const activeRisk = live.reduce((s, e) => s + weighted(e), 0);
  const restoredRisk = closed.reduce((s, e) => s + weighted(e), 0);
  const acceptedRisk = live
    .filter((e) => e.response_path === "accept")
    .reduce((s, e) => s + weighted(e), 0);

  const treatmentRows = (Object.keys(RESPONSE_LABELS) as ResponsePath[]).map((path) => {
    const matching = live.filter((e) => e.response_path === path);
    return {
      path,
      total: matching.reduce((s, e) => s + weighted(e), 0),
      count: matching.length,
    };
  });

  const topRisk = live.reduce<ExposureRow | null>((current, exposure) => {
    if (!current) return exposure;
    return weighted(exposure) > weighted(current) ? exposure : current;
  }, null);

  return (
    <section className="space-y-5" aria-label="Risk tally workspace">
      <div className="rounded-lg border border-hairline bg-card shadow-card">
        <div className="grid gap-px bg-hairline lg:grid-cols-[1.15fr_0.85fr]">
          <div className="bg-card p-6 lg:p-8">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  <span className="inline-block h-px w-7 bg-danger" />
                  Risk Tally
                </div>
                <h2 className="mt-2 font-serif text-4xl leading-tight text-foreground">
                  Put every exposure into dollars.
                </h2>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  Log the risk, choose eliminate/recover/offset/accept, and close it when the exposure is gone.
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

      <div className="grid gap-5 lg:grid-cols-[1fr_0.34fr]">
        <div id="risk-ledger" className="rounded-lg border border-hairline bg-card p-5 shadow-card">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h3 className="font-serif text-3xl text-foreground">Open risk tally</h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                This is the running project meeting ledger for dollars currently held against the job.
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

        <HoldGuide
          eTarget={guidance.eTarget}
          cTarget={guidance.cTarget}
          ePct={guidance.ePct}
          cPct={guidance.cPct}
          eActual={rollup.exposureHolds}
          cActual={rollup.contingencyHold}
        />
      </div>
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
    <aside className="rounded-lg border border-hairline bg-card p-5 shadow-card">
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
    </aside>
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
