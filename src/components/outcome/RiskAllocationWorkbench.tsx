import { useState } from "react";
import { CircleDollarSign, ListChecks, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ExposuresTable, type ExposureDraft } from "@/components/outcome/ExposuresTable";
import { recognizedRiskActuals } from "@/lib/cost-documents";
import { fmtPct, fmtUSD } from "@/lib/format";
import { centsToDollars, dollarsToCents } from "@/lib/payments-domain";
import {
  releasedExposureValue,
  remainingExposureValue,
  type ExposureStatus,
  type ResponsePath,
  type Rollup,
} from "@/lib/ior";
import type { ExposureRow } from "@/lib/projects.functions";
import type { CostActualRow } from "@/lib/billing.functions";

const RESPONSE_LABELS: Record<ResponsePath, string> = {
  eliminate: "Eliminate",
  recover: "Recover",
  offset: "Offset",
  accept: "Accept",
};

const STATUS_LABELS: Record<ExposureStatus, string> = {
  active: "Active",
  escalated: "Escalated",
  recovered: "Recovered",
  eliminated: "Eliminated",
  accepted: "Accepted",
  released: "Released",
};

function remaining(e: ExposureRow) {
  return remainingExposureValue(e);
}

function released(e: ExposureRow) {
  return releasedExposureValue(e);
}

function carriesRemainingRisk(e: ExposureRow) {
  return remaining(e) > 0;
}

export function RiskAllocationWorkbench({
  exposures,
  costActuals,
  rollup,
  guidance,
  focusedExposureId,
  onFocusExposureHandled,
  onCreateExposure,
  onUpdateExposure,
  onDeleteExposure,
  onCreateTodo,
  onCreateChangeOrder,
  onCreateClaim,
}: {
  exposures: ExposureRow[];
  costActuals: CostActualRow[];
  rollup: Rollup;
  guidance: { ePct: number; cPct: number; eTarget: number; cTarget: number };
  focusedExposureId?: string | null;
  onFocusExposureHandled?: () => void;
  onCreateExposure: (d: ExposureDraft) => void;
  onUpdateExposure: (id: string, patch: Partial<ExposureDraft>) => void;
  onDeleteExposure: (id: string) => void;
  onCreateTodo?: (exposure: ExposureRow) => void;
  onCreateChangeOrder?: (exposure: ExposureRow) => void;
  onCreateClaim?: (exposure: ExposureRow) => void;
}) {
  // Bump to open the create-risk dialog inside ExposuresTable from the header button.
  const [createSignal, setCreateSignal] = useState(0);
  const actualIncurredByExposure = recognizedRiskActuals(costActuals).reduce((totals, actual) => {
    if (!actual.exposure_id) return totals;
    totals.set(
      actual.exposure_id,
      (totals.get(actual.exposure_id) ?? 0) + dollarsToCents(actual.amount),
    );
    return totals;
  }, new Map<string, number>());
  const actualIncurred = centsToDollars(
    [...actualIncurredByExposure.values()].reduce((sum, cents) => sum + cents, 0),
  );
  const actualIncurredDollarsByExposure = new Map(
    [...actualIncurredByExposure].map(([id, cents]) => [id, centsToDollars(cents)]),
  );
  const carrying = exposures.filter(carriesRemainingRisk);
  const releasedRows = exposures.filter((e) => released(e) > 0);
  const activeRisk = carrying.reduce((s, e) => s + remaining(e), 0);
  const releasedRisk = releasedRows.reduce((s, e) => s + released(e), 0);

  const treatmentRows = (Object.keys(RESPONSE_LABELS) as ResponsePath[]).map((path) => {
    const matching = carrying.filter((e) => e.response_path === path);
    return {
      path,
      total: matching.reduce((s, e) => s + remaining(e), 0),
      count: matching.length,
    };
  });

  const statusRows = (["recovered", "eliminated", "offset", "accepted"] as const).map((status) => {
    const matching =
      status === "offset"
        ? releasedRows.filter((e) => e.status === "released" && e.response_path === "offset")
        : releasedRows.filter((e) => e.status === status);
    return {
      status,
      label: status === "offset" ? "Offset / released" : STATUS_LABELS[status],
      total: matching.reduce((s, e) => s + released(e), 0),
      count: matching.length,
    };
  });

  const topRisk = carrying.reduce<ExposureRow | null>((current, exposure) => {
    if (!current) return exposure;
    return remaining(exposure) > remaining(current) ? exposure : current;
  }, null);

  return (
    <section className="min-w-0 space-y-5" aria-label="Risk tally workspace">
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-md border border-hairline px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-clay">
          Risk Tally
        </span>
        <Button
          size="sm"
          className="shrink-0 gap-1.5"
          onClick={() => setCreateSignal((n) => n + 1)}
        >
          <Plus className="h-3.5 w-3.5" /> Log risk
        </Button>
      </div>

      <div className="min-w-0 overflow-hidden rounded-lg border border-hairline bg-card shadow-card">
        <div className="grid gap-px bg-hairline lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
          <div className="min-w-0 bg-card p-6 lg:p-8">
            <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
              <span className="inline-block h-px w-7 bg-danger" />
              Risk Tally
            </div>
            <h2 className="mt-2 font-serif text-4xl leading-tight text-foreground">
              Put every exposure into dollars.
            </h2>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Log the risk, choose eliminate / recover / offset / accept, set it as an E-Hold or
              C-Hold, and close it when the exposure is gone.
            </p>
            <div className="mt-5 grid w-full max-w-md grid-cols-1 gap-2.5 sm:grid-cols-2">
              <MetricTile label="Live remaining risk" value={fmtUSD(activeRisk)} tone="danger" />
              <MetricTile label="Actual incurred on risk" value={fmtUSD(actualIncurred)} />
              <MetricTile label="Released / closed" value={fmtUSD(releasedRisk)} tone="success" />
              <MetricTile label="Exposure Hold (E)" value={fmtUSD(rollup.exposureHolds)} />
              <MetricTile label="Contingency Hold (C)" value={fmtUSD(rollup.contingencyHold)} />
            </div>

            <details className="group mt-5">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground transition-colors hover:text-foreground [&::-webkit-details-marker]:hidden">
                Treatment breakdown
                <span aria-hidden className="transition-transform group-open:rotate-180">
                  ▾
                </span>
              </summary>
              <div className="mt-4 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Planned treatment on remaining risk
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                {treatmentRows.map((row) => (
                  <TreatmentCard
                    key={row.path}
                    label={RESPONSE_LABELS[row.path]}
                    total={row.total}
                    count={row.count}
                  />
                ))}
              </div>

              <div className="mt-5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                Released from active holds by status
              </div>
              <div className="mt-3 grid gap-3 md:grid-cols-4">
                {statusRows.map((row) => (
                  <TreatmentCard
                    key={row.status}
                    label={row.label}
                    total={row.total}
                    count={row.count}
                  />
                ))}
              </div>
            </details>
          </div>

          <div className="min-w-0 bg-surface-elevated p-6 lg:p-8">
            <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
              <CircleDollarSign className="h-3.5 w-3.5" />
              GP Impact
            </div>
            <div className="mt-5 space-y-3">
              <BridgeRow
                label="Forecasted GP before holds"
                value={rollup.forecastedGPBeforeHolds}
              />
              <BridgeRow label="Less Exposure Hold (E)" value={-rollup.exposureHolds} danger />
              <BridgeRow label="Less Contingency Hold (C)" value={-rollup.contingencyHold} danger />
              <div className="rounded-md border border-accent/50 bg-accent/10 px-4 py-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm font-medium text-foreground">Indicated GP</span>
                  <span className="font-serif text-3xl tabular text-accent">
                    {fmtUSD(rollup.indicatedGP)}
                  </span>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {fmtPct(rollup.indicatedGPpct)} vs original {fmtPct(rollup.originalGPpct)}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid min-w-0 gap-5">
        <div
          id="risk-ledger"
          className="min-w-0 rounded-lg border border-hairline bg-card p-5 shadow-card"
        >
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h3 className="font-serif text-3xl text-foreground">Open risk tally</h3>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                The running project-meeting ledger. Likely exposure = dollar risk × probability.
                E-Holds are specific priced risks; C-Holds carry general contingency. Use the action
                buttons to push a risk into a Change Order, Claim, or To-do.
              </p>
            </div>
            {topRisk && (
              <div className="w-full rounded-md border border-danger/30 bg-danger/5 px-3 py-2 text-xs sm:w-auto sm:min-w-[220px]">
                <div className="font-medium text-danger">Largest remaining item</div>
                <div className="mt-0.5 truncate font-semibold text-foreground">{topRisk.title}</div>
                <div className="font-serif text-[15px] tabular text-danger">
                  {fmtUSD(remaining(topRisk))}
                </div>
              </div>
            )}
          </div>
          <ExposuresTable
            exposures={exposures}
            actualIncurredByExposure={actualIncurredDollarsByExposure}
            focusedExposureId={focusedExposureId}
            onFocusExposureHandled={onFocusExposureHandled}
            openCreateSignal={createSignal}
            onCreate={onCreateExposure}
            onUpdate={onUpdateExposure}
            onDelete={onDeleteExposure}
            onCreateTodo={onCreateTodo}
            onCreateChangeOrder={onCreateChangeOrder}
            onCreateClaim={onCreateClaim}
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

function MetricTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "success";
}) {
  const cls =
    tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-foreground";
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="font-mono text-[9px] font-bold uppercase leading-tight tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1.5 font-serif text-2xl tabular leading-none ${cls}`}>{value}</div>
    </div>
  );
}

function TreatmentCard({ label, total, count }: { label: string; total: number; count: number }) {
  return (
    <div className="rounded-md border border-hairline bg-surface px-4 py-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-foreground">{label}</div>
        <div className="rounded-full bg-card px-2 py-0.5 text-[10px] text-muted-foreground">
          {count}
        </div>
      </div>
      <div className="mt-2 font-serif text-2xl tabular text-foreground">{fmtUSD(total)}</div>
    </div>
  );
}

function BridgeRow({ label, value, danger }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-hairline pb-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span
        className={`font-serif text-base tabular ${danger ? "text-danger" : "text-foreground"}`}
      >
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
    <aside className="min-w-0 rounded-lg border border-hairline bg-card p-5 shadow-card">
      <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
        <ListChecks className="h-3.5 w-3.5" />
        Hold Guide
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <HoldRow
          label="Exposure Hold (E)"
          description="Specific known risk with a dollar value."
          actual={eActual}
          target={eTarget}
          pct={ePct}
        />
        <HoldRow
          label="Contingency Hold (C)"
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
        <div className={`text-right tabular ${below ? "text-danger" : "text-success"}`}>
          <span className="font-serif text-base">{fmtUSD(actual)}</span>
          <div className="text-[11px] text-muted-foreground">
            target {fmtUSD(target)} ({pct}%)
          </div>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div
          className={`h-full rounded-full ${below ? "bg-danger" : "bg-success"}`}
          style={{ width: `${ratio}%` }}
        />
      </div>
    </div>
  );
}
