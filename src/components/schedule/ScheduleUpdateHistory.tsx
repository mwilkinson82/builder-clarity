import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  type ScheduleUpdateRow,
  type ScheduleMilestoneUpdateRow,
  type ScheduleActivityUpdateRow,
} from "@/lib/schedule.functions";
import { fmtUSD } from "@/lib/format";
import { type ConstructLineStatusBasis } from "@/lib/constructline-cpm";
import { selectLatestScheduleUpdate } from "@/lib/schedule-selectors";
import {
  ACTIVITY_UPDATE_SNAPSHOT_COLUMNS,
  type DelayFragmentSummary,
  formatFinishVarianceDays,
  moneyTone,
  shortDate,
  varianceLabel,
  varianceTone,
} from "./scheduleShared";
import { type CpmForecastStatus } from "./ScheduleSnapshotTimeline";

/** Warn-tinted needs-attention banner. Renders only when the live CPM has
 * drifted off the saved record or the delay ledger has open impacts, and only
 * composes clauses whose data actually exists. */
export function ScheduleAttentionBanner({
  updates,
  cpmForecastStatus,
  unsavedDeltaWeeks,
  delaySummary,
}: {
  updates: ScheduleUpdateRow[];
  cpmForecastStatus: CpmForecastStatus;
  unsavedDeltaWeeks: number;
  delaySummary: DelayFragmentSummary;
}) {
  if (!cpmForecastStatus.isUnsaved && delaySummary.openCount === 0) return null;
  const latestUpdate = selectLatestScheduleUpdate(updates);
  const delayClause =
    delaySummary.openCount > 0
      ? `${delaySummary.openCount} open delay${delaySummary.openCount === 1 ? "" : "s"} totaling ${delaySummary.openDays} day${delaySummary.openDays === 1 ? "" : "s"}`
      : null;
  const nextUpdateNumber = (latestUpdate?.update_number ?? 0) + 1;
  return (
    <div className="flex max-w-[82ch] items-start gap-3 rounded-xl border border-warning/35 bg-warning/5 px-4 py-3">
      <span className="mt-0.5 shrink-0 whitespace-nowrap rounded-full border border-warning/35 bg-surface px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-warning">
        Needs attention
      </span>
      <p className="text-[13.5px] leading-relaxed text-muted-foreground">
        {cpmForecastStatus.isUnsaved ? (
          <>
            <b className="font-semibold text-foreground">Save a fresh snapshot.</b> The live CPM has{" "}
            {unsavedDeltaWeeks > 0 ? "slipped" : "moved"} to{" "}
            {shortDate(cpmForecastStatus.unsavedForecast)}
            {delayClause ? (
              <>
                {" "}
                and carries <b className="font-semibold text-foreground">{delayClause}</b>
              </>
            ) : null}
            .{" "}
          </>
        ) : (
          <>
            <b className="font-semibold text-foreground">Work the delay ledger.</b>{" "}
            <b className="font-semibold text-foreground">{delayClause}</b>{" "}
            {delaySummary.openCount === 1 ? "is" : "are"} logged against the schedule.{" "}
          </>
        )}
        {latestUpdate ? (
          <>
            Update #{latestUpdate.update_number} ({shortDate(latestUpdate.forecast_completion_date)}
            ) is the record.{" "}
          </>
        ) : null}
        Work the update queue in the workspace and save Update #{nextUpdateNumber}.
      </p>
    </div>
  );
}

export function ScheduleUpdateLedger({
  updates,
  milestoneUpdates,
  activityUpdates,
}: {
  updates: ScheduleUpdateRow[];
  milestoneUpdates: ScheduleMilestoneUpdateRow[];
  activityUpdates: ScheduleActivityUpdateRow[];
}) {
  const [expandedUpdateNumber, setExpandedUpdateNumber] = useState<number | null>(
    updates[0]?.update_number ?? null,
  );
  useEffect(() => {
    if (updates.length === 0) return;
    if (expandedUpdateNumber == null) return;
    if (!updates.some((update) => update.update_number === expandedUpdateNumber)) {
      setExpandedUpdateNumber(updates[0]?.update_number ?? null);
    }
  }, [expandedUpdateNumber, updates]);

  if (updates.length === 0) {
    return (
      <section className="rounded-xl border border-hairline bg-card p-6">
        <div className="text-[13px] font-semibold text-foreground">Schedule update history</div>
        <p className="mt-1 text-sm text-muted-foreground">
          No formal schedule updates have been saved yet. The next saved data-date snapshot becomes
          update 1.
        </p>
      </section>
    );
  }
  const milestoneCountByUpdate = milestoneUpdates.reduce<Record<number, number>>((acc, update) => {
    acc[update.update_number] = (acc[update.update_number] ?? 0) + 1;
    return acc;
  }, {});
  const activitySnapshotByUpdate = buildActivityUpdateSnapshotSummaries(activityUpdates);
  const activityRowsByUpdate = groupActivityUpdateSnapshots(activityUpdates);
  return (
    <section className="rounded-xl border border-hairline bg-card p-6">
      <div className="mb-4 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <div className="text-[13px] font-semibold text-foreground">Schedule update history</div>
        <span className="ml-auto text-xs text-muted-foreground">
          {updates.length} saved update{updates.length === 1 ? "" : "s"} · each records data date,
          forecast, variance, activity status, and net $
        </span>
      </div>
      <div className="overflow-x-auto rounded-md border border-hairline">
        <div className="grid grid-cols-[64px_100px_120px_140px_100px_100px_110px_minmax(180px,1fr)] bg-surface px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          <div>Update</div>
          <div>Data date</div>
          <div>Baseline</div>
          <div>Forecast</div>
          <div>Variance</div>
          <div>Movement</div>
          <div>Net $</div>
          <div>Note</div>
        </div>
        {updates.map((update) => {
          const activitySummary = activitySnapshotByUpdate[update.update_number];
          const activitySnapshotRows = activityRowsByUpdate[update.update_number] ?? [];
          const isSnapshotExpanded = expandedUpdateNumber === update.update_number;
          return (
            <div
              key={update.id}
              className="grid grid-cols-[64px_100px_120px_140px_100px_100px_110px_minmax(180px,1fr)] items-start border-t border-hairline px-3 py-3 text-sm"
            >
              <div className="font-mono text-xs font-medium tabular text-foreground">
                #{update.update_number}
              </div>
              <div className="font-serif text-[15px] tabular text-muted-foreground">
                {shortDate(update.data_date)}
              </div>
              <div className="font-serif text-[15px] tabular text-muted-foreground">
                {shortDate(update.baseline_completion_date)}
              </div>
              <div className="font-serif text-[15px] font-semibold tabular text-foreground">
                {shortDate(update.forecast_completion_date)}
              </div>
              <div
                className={`font-serif text-[15px] tabular ${varianceTone(update.variance_weeks)}`}
              >
                {varianceLabel(update.variance_weeks)}
              </div>
              <div
                className={`font-serif text-[15px] tabular ${varianceTone(update.movement_weeks)}`}
              >
                {varianceLabel(update.movement_weeks)}
              </div>
              <div
                className={`font-serif text-[15px] font-semibold tabular ${moneyTone(update.schedule_money_net)}`}
              >
                {fmtUSD(update.schedule_money_net)}
              </div>
              <div>
                <div className="text-xs text-muted-foreground">
                  {activitySummary
                    ? `${activitySummary.activityCount} activity snapshots · ${activitySummary.criticalCount} critical · ${activitySummary.lateCount + activitySummary.outOfSequenceCount} late/out-of-sequence`
                    : "No activity snapshots were recorded with this update."}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {milestoneCountByUpdate[update.update_number] ?? 0} milestone snapshots
                  {activitySummary?.slippedCount
                    ? ` · ${activitySummary.slippedCount} slipped activities${
                        activitySummary.worstSlippageDays == null
                          ? ""
                          : ` · worst ${formatFinishVarianceDays(activitySummary.worstSlippageDays)}`
                      }`
                    : ""}
                  {activitySummary?.negativeFloatCount
                    ? ` · ${activitySummary.negativeFloatCount} negative-float activities${
                        activitySummary.worstTotalFloatDays == null
                          ? ""
                          : ` · worst ${activitySummary.worstTotalFloatDays}d TF`
                      }`
                    : ""}
                  {activitySummary?.openEndCount
                    ? ` · ${activitySummary.openEndCount} open-ended activities`
                    : ""}
                  {activitySummary?.needsUpdateBasisCount
                    ? ` · ${activitySummary.needsUpdateBasisCount} need update basis`
                    : ""}
                </div>
                {activitySummary && activitySummary.driverLabels.length > 0 && (
                  <div className="mt-1 max-w-2xl text-xs text-muted-foreground">
                    Drivers: {activitySummary.driverLabels.join("; ")}
                  </div>
                )}
                {activitySnapshotRows.length > 0 && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7 px-2 text-xs"
                    onClick={() =>
                      setExpandedUpdateNumber((current) =>
                        current === update.update_number ? null : update.update_number,
                      )
                    }
                  >
                    {isSnapshotExpanded ? "Hide activity snapshot" : "View activity snapshot"}
                  </Button>
                )}
                {update.notes && (
                  <div className="mt-1 max-w-2xl text-xs text-muted-foreground">{update.notes}</div>
                )}
                {update.money_notes && (
                  <div className="mt-1 max-w-2xl text-xs text-muted-foreground">
                    {update.money_notes}
                  </div>
                )}
              </div>
              {isSnapshotExpanded && activitySnapshotRows.length > 0 && (
                <div className="col-span-8 mt-3 overflow-x-auto rounded-md border border-hairline bg-card">
                  <div
                    className="grid min-w-[980px] bg-surface px-3 py-2 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground"
                    style={{ gridTemplateColumns: ACTIVITY_UPDATE_SNAPSHOT_COLUMNS }}
                  >
                    <div>ID</div>
                    <div>Activity</div>
                    <div>Plan</div>
                    <div>Baseline finish</div>
                    <div>Current start</div>
                    <div>Expected finish</div>
                    <div>Variance</div>
                    <div>Remaining</div>
                    <div>% done</div>
                    <div>Basis</div>
                    <div>TF</div>
                    <div>Status</div>
                  </div>
                  {activitySnapshotRows.slice(0, 10).map((snapshot) => (
                    <div
                      key={snapshot.id}
                      className="grid min-w-[980px] items-start border-t border-hairline px-3 py-2 text-xs"
                      style={{ gridTemplateColumns: ACTIVITY_UPDATE_SNAPSHOT_COLUMNS }}
                    >
                      <div className="font-semibold tabular text-foreground">
                        {snapshot.activity_id || "No ID"}
                      </div>
                      <div className="min-w-0">
                        <div className="break-words font-semibold text-foreground">
                          {snapshot.name}
                        </div>
                        <div className="mt-0.5 break-words text-[11px] text-muted-foreground">
                          {snapshot.division}
                        </div>
                      </div>
                      <div className="tabular text-muted-foreground">
                        {snapshot.is_milestone ? "M" : `${snapshot.planned_duration_days}d`}
                      </div>
                      <div className="tabular text-muted-foreground">
                        {shortDate(snapshot.baseline_finish_date)}
                      </div>
                      <div className="tabular text-muted-foreground">
                        {shortDate(snapshot.current_start_date)}
                      </div>
                      <div className="tabular text-muted-foreground">
                        {shortDate(snapshot.current_finish_date)}
                      </div>
                      <div
                        className={cn(
                          "font-semibold tabular",
                          snapshot.slippage_days > 0
                            ? "text-danger"
                            : snapshot.slippage_days < 0
                              ? "text-success"
                              : "text-muted-foreground",
                        )}
                      >
                        {formatFinishVarianceDays(snapshot.slippage_days)}
                      </div>
                      <div className="tabular text-muted-foreground">
                        {formatActivityUpdateSnapshotRemaining(snapshot)}
                      </div>
                      <div className="font-semibold tabular text-foreground">
                        {Math.round(snapshot.percent_complete)}%
                      </div>
                      <div
                        className={cn(
                          "font-semibold uppercase tracking-[0.06em]",
                          getActivityUpdateStatusBasisClass(snapshot.status_basis),
                        )}
                        title={formatActivityUpdateStatusBasisTitle(snapshot.status_basis)}
                      >
                        {formatActivityUpdateStatusBasisLabel(snapshot.status_basis)}
                      </div>
                      <div
                        className={cn(
                          "font-semibold tabular",
                          snapshot.total_float_days <= 0 ? "text-danger" : "text-muted-foreground",
                        )}
                      >
                        {snapshot.total_float_days}d
                      </div>
                      <div className="break-words text-muted-foreground">
                        {formatActivityUpdateSnapshotStatus(snapshot)}
                      </div>
                    </div>
                  ))}
                  {activitySnapshotRows.length > 10 && (
                    <div className="border-t border-hairline px-3 py-2 text-xs text-muted-foreground">
                      Showing 10 of {activitySnapshotRows.length} activity snapshots for this
                      update.
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

type ActivityUpdateSnapshotSummary = {
  activityCount: number;
  criticalCount: number;
  slippedCount: number;
  worstSlippageDays: number | null;
  negativeFloatCount: number;
  worstTotalFloatDays: number | null;
  lateCount: number;
  outOfSequenceCount: number;
  openEndCount: number;
  needsUpdateBasisCount: number;
  driverLabels: string[];
};

function buildActivityUpdateSnapshotSummaries(activityUpdates: ScheduleActivityUpdateRow[]) {
  const grouped = activityUpdates.reduce<Record<number, ScheduleActivityUpdateRow[]>>(
    (acc, update) => {
      acc[update.update_number] = acc[update.update_number] ?? [];
      acc[update.update_number].push(update);
      return acc;
    },
    {},
  );
  return Object.fromEntries(
    Object.entries(grouped).map(([updateNumber, rows]) => [
      Number(updateNumber),
      summarizeActivityUpdateSnapshots(rows),
    ]),
  ) as Record<number, ActivityUpdateSnapshotSummary>;
}

function groupActivityUpdateSnapshots(activityUpdates: ScheduleActivityUpdateRow[]) {
  const grouped = activityUpdates.reduce<Record<number, ScheduleActivityUpdateRow[]>>(
    (acc, update) => {
      acc[update.update_number] = acc[update.update_number] ?? [];
      acc[update.update_number].push(update);
      return acc;
    },
    {},
  );
  for (const rows of Object.values(grouped)) {
    rows.sort((a, b) => scoreActivityUpdateDriver(b) - scoreActivityUpdateDriver(a));
  }
  return grouped;
}

function summarizeActivityUpdateSnapshots(
  rows: ScheduleActivityUpdateRow[],
): ActivityUpdateSnapshotSummary {
  const negativeFloatRows = rows.filter((row) => row.total_float_days < 0);
  const slippedRows = rows.filter((row) => row.slippage_days > 0);
  return {
    activityCount: rows.length,
    criticalCount: rows.filter((row) => row.is_critical).length,
    slippedCount: slippedRows.length,
    worstSlippageDays:
      slippedRows.length > 0 ? Math.max(...slippedRows.map((row) => row.slippage_days)) : null,
    negativeFloatCount: negativeFloatRows.length,
    worstTotalFloatDays:
      negativeFloatRows.length > 0
        ? Math.min(...negativeFloatRows.map((row) => row.total_float_days))
        : null,
    lateCount: rows.filter((row) => row.is_late).length,
    outOfSequenceCount: rows.filter((row) => row.is_out_of_sequence).length,
    openEndCount: rows.filter((row) => row.is_open_start || row.is_open_finish).length,
    needsUpdateBasisCount: rows.filter((row) => row.status_basis === "needs_update").length,
    driverLabels: rows
      .map((row) => ({ row, score: scoreActivityUpdateDriver(row) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((item) => formatActivityUpdateDriver(item.row)),
  };
}

function scoreActivityUpdateDriver(row: ScheduleActivityUpdateRow) {
  return (
    (row.is_critical ? 1000 : 0) +
    (row.total_float_days < 0 ? 900 : 0) +
    (row.is_late ? 600 : 0) +
    (row.is_out_of_sequence ? 500 : 0) +
    (row.status_basis === "needs_update" ? 400 : 0) +
    (row.is_open_start || row.is_open_finish ? 250 : 0) +
    Math.max(0, row.slippage_days) * 10 +
    Math.max(0, 10 - row.total_float_days)
  );
}

function formatActivityUpdateDriver(row: ScheduleActivityUpdateRow) {
  const tags = [
    row.is_critical ? "critical" : null,
    row.total_float_days < 0 ? "negative float" : null,
    row.is_late ? "late" : null,
    row.is_out_of_sequence ? "out-of-seq" : null,
    row.status_basis === "needs_update" ? "needs update basis" : null,
    row.is_open_start || row.is_open_finish ? "open end" : null,
    row.slippage_days > 0 ? `${row.slippage_days}d slip` : null,
    `TF ${row.total_float_days}d`,
  ].filter(Boolean);
  return `${row.activity_id || row.name} ${tags.join(" · ")}`;
}

function formatActivityUpdateSnapshotStatus(row: ScheduleActivityUpdateRow) {
  const tags = [
    row.is_critical ? "critical" : null,
    row.is_near_critical ? "near critical" : null,
    row.total_float_days < 0 ? "negative float" : null,
    row.is_late ? "late" : null,
    row.is_out_of_sequence ? "out-of-seq" : null,
    row.status_basis === "needs_update" ? "needs update basis" : null,
    row.is_open_start ? "open start" : null,
    row.is_open_finish ? "open finish" : null,
    row.is_milestone ? "milestone" : null,
  ].filter(Boolean);
  return tags.length > 0 ? tags.join(" · ") : `${row.percent_complete}% complete`;
}

function formatActivityUpdateSnapshotRemaining(row: ScheduleActivityUpdateRow) {
  if (row.is_milestone) return "0d";
  if (row.actual_finish_date || row.percent_complete >= 100) return "0d";
  if (!row.actual_start_date) {
    return row.percent_complete > 0 ? "needs actual" : "not started";
  }
  if (row.status_basis === "needs_update") return "update";
  return `${row.remaining_duration_days}d`;
}

function formatActivityUpdateStatusBasisLabel(value: ConstructLineStatusBasis) {
  switch (value) {
    case "actual":
      return "actual";
    case "remaining_duration":
      return "remaining";
    case "expected_finish":
      return "expected";
    case "needs_update":
      return "needs update";
    case "planned_dates":
    default:
      return "planned";
  }
}

function formatActivityUpdateStatusBasisTitle(value: ConstructLineStatusBasis) {
  switch (value) {
    case "actual":
      return "Snapshot row was driven by actual finish or completed status.";
    case "remaining_duration":
      return "Snapshot row was driven by remaining duration counted from the data date.";
    case "expected_finish":
      return "Snapshot row was driven by the expected finish forecast.";
    case "needs_update":
      return "Snapshot row was incomplete and past its expected finish when saved.";
    case "planned_dates":
    default:
      return "Snapshot row was still carrying planned baseline dates.";
  }
}

function getActivityUpdateStatusBasisClass(value: ConstructLineStatusBasis) {
  switch (value) {
    case "actual":
      return "text-success";
    case "remaining_duration":
      return "text-foreground";
    case "expected_finish":
      return "text-accent";
    case "needs_update":
      return "text-danger";
    case "planned_dates":
    default:
      return "text-muted-foreground";
  }
}

// ——— Annotate-panel metric cards (used by the collapsed authoring panel in
// ScheduleRiskTab; they read the same update-of-record the ledger shows) ———

export function ScheduleCompletionOfRecordCard({
  value,
  update,
}: {
  value: string | null;
  update: ScheduleUpdateRow | null;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        {update ? `Completion of record · update #${update.update_number}` : "Completion of record"}
      </Label>
      <div className="flex h-9 items-center rounded-md border border-input bg-surface px-3 text-sm tabular text-foreground">
        {value ? shortDate(value) : "No update saved yet"}
      </div>
    </div>
  );
}

export function ScheduleVarianceCard({ value }: { value: number | null }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Baseline variance
      </Label>
      <div
        className={`flex h-9 items-center rounded-md border border-input bg-surface px-3 text-sm tabular ${varianceTone(value)}`}
      >
        {varianceLabel(value)}
      </div>
    </div>
  );
}

export function ScheduleDeltaCard({ value }: { value: number | null }) {
  const label =
    value == null
      ? "No prior update"
      : value > 0
        ? `+${value} wk`
        : value < 0
          ? `${value} wk`
          : "No movement";
  const tone =
    value == null
      ? "text-muted-foreground"
      : value > 0
        ? "text-danger"
        : value < 0
          ? "text-success"
          : "text-foreground";

  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Movement from prior update
      </Label>
      <div
        className={`flex h-9 items-center rounded-md border border-input px-3 text-sm tabular ${tone}`}
      >
        {label}
      </div>
    </div>
  );
}

export function ScheduleMoneyNetCard({
  exposure,
  recovery,
}: {
  exposure: number;
  recovery: number;
}) {
  const net = exposure - recovery;
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">
        Net schedule dollars
      </Label>
      <div
        className={`flex h-9 items-center rounded-md border border-input bg-surface px-3 text-sm font-semibold tabular ${moneyTone(net)}`}
      >
        {fmtUSD(net)}
      </div>
    </div>
  );
}

export function ScheduleIntelligenceMetric({
  label,
  value,
  tone = "text-foreground",
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded border border-hairline bg-card px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-semibold tabular ${tone}`}>{value}</div>
    </div>
  );
}
