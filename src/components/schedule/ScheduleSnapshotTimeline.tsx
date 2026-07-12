import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type MilestoneRow,
  type ScheduleActivityRow,
  type ScheduleUpdateRow,
} from "@/lib/schedule.functions";
import { type ProjectRow } from "@/lib/projects.functions";
import { fmtUSD } from "@/lib/format";
import { computeScheduleVarianceWeeks } from "@/lib/ior";
import {
  selectCanonicalLogicTieCount,
  selectLatestScheduleUpdate,
  selectSavedScheduleForecast,
  selectSavedScheduleVarianceWeeks,
} from "@/lib/schedule-selectors";
import {
  DAY_MS,
  type DelayFragmentSummary,
  type MilestoneView,
  STATUS_LABEL,
  STATUS_STYLES,
  moneyTone,
  shortDate,
  varianceLabel,
  isoDateFromMs,
  parseDateMs,
} from "./scheduleShared";

export { isoDateFromMs, parseDateMs };
export {
  getActivityBaselineFinish,
  getActivityBaselineStart,
  getActivityForecastFinish,
  getActivityForecastStart,
  getDateDurationDays,
} from "./scheduleShared";
import {
  getActivityBaselineFinish,
  getActivityBaselineStart,
  getDateDurationDays,
} from "./scheduleShared";
import { MilestoneViewSelect, filterMilestones } from "./ScheduleRiskTab";
import { CompactField } from "./ScheduleMilestones";

// Shape returned by selectCpmForecastStatus — the live-CPM-vs-saved-record
// signal every v2 schedule surface reads.
export type CpmForecastStatus = {
  forecastOfRecord: string | null;
  unsavedForecast: string | null;
  isUnsaved: boolean;
};

// dark-panel exception (THEMING.md known pattern, see BudgetLedgerTable /
// ProjectDashboard): the light-ground semantic tokens (--good/--warn) go muddy
// on bg-dark-panel, so dark tiles use the fixed on-dark tints from the v2
// handoff mocks. Never use these on a light ground.
const DARK_GOOD_TEXT = "text-[#7FB08A]";
const DARK_AMBER_TEXT = "text-[#C09A56]";

/** Top-of-tab dark stat strip: baseline finish, update of record, live CPM,
 * data date, saved updates, and the open delay ledger at a glance. */
export function ScheduleDarkStatStrip({
  project,
  updates,
  cpmForecastStatus,
  unsavedDeltaWeeks,
  delaySummary,
}: {
  project: ProjectRow;
  updates: ScheduleUpdateRow[];
  cpmForecastStatus: CpmForecastStatus;
  unsavedDeltaWeeks: number;
  delaySummary: DelayFragmentSummary;
}) {
  const latestUpdate = selectLatestScheduleUpdate(updates);
  const savedForecast = selectSavedScheduleForecast(updates, project.forecast_completion_date);
  const recordVariance = selectSavedScheduleVarianceWeeks(
    updates,
    project.baseline_completion_date,
    project.forecast_completion_date,
  );
  const scheduleMoneyNet = updates.reduce((total, update) => total + update.schedule_money_net, 0);
  // driverLabels read "A-005 23d" — the strip only wants the activity ids.
  const delayDriverIds = delaySummary.driverLabels.map((label) => label.replace(/\s+\d+d$/, ""));
  return (
    <section className="flex flex-wrap items-start gap-x-10 gap-y-4 rounded-xl bg-dark-panel px-6 py-5 text-dark-panel-foreground">
      <DarkStat label="Baseline finish" value={shortDate(project.baseline_completion_date)} />
      <DarkStat
        label="Update of record"
        value={shortDate(savedForecast)}
        valueClass={recordVariance != null && recordVariance < 0 ? DARK_GOOD_TEXT : undefined}
        sub={
          latestUpdate
            ? `${varianceLabel(latestUpdate.variance_weeks)} · Update #${latestUpdate.update_number}`
            : "No update saved yet"
        }
      />
      {cpmForecastStatus.isUnsaved && (
        <DarkStat
          label="Live CPM (unsaved)"
          value={shortDate(cpmForecastStatus.unsavedForecast)}
          valueClass={unsavedDeltaWeeks > 0 ? DARK_AMBER_TEXT : undefined}
          sub={
            unsavedDeltaWeeks === 0
              ? "within a week of record"
              : `${Math.abs(unsavedDeltaWeeks)} wk ${unsavedDeltaWeeks > 0 ? "later" : "earlier"} than record`
          }
        />
      )}
      <DarkStat label="Data date" value={shortDate(latestUpdate?.data_date)} />
      <DarkStat
        label="Saved updates"
        value={String(updates.length)}
        sub={`net ${fmtUSD(scheduleMoneyNet)}`}
      />
      {delaySummary.openCount > 0 && (
        <div className="ml-auto text-right text-[11.5px] leading-relaxed text-dark-panel-foreground/60">
          <span className="font-semibold text-dark-panel-foreground">
            Delay ledger: {delaySummary.openCount} open
          </span>
          <br />
          {delaySummary.openDays} days
          {delayDriverIds.length > 0 ? ` · ${delayDriverIds.join(", ")}` : ""}
        </div>
      )}
    </section>
  );
}

function DarkStat({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-dark-panel-foreground/60">
        {label}
      </div>
      <div
        className={cn("mt-1.5 whitespace-nowrap font-serif text-[23px] leading-none", valueClass)}
      >
        {value}
      </div>
      {sub ? <div className="mt-1.5 text-[11px] text-dark-panel-foreground/60">{sub}</div> : null}
    </div>
  );
}

/** Project completion path: baseline vs saved record vs live CPM on one
 * track, with the serif schedule verdict underneath. */
export function ScheduleCompletionPath({
  project,
  updates,
  cpmForecastStatus,
  unsavedDeltaWeeks,
}: {
  project: ProjectRow;
  updates: ScheduleUpdateRow[];
  cpmForecastStatus: CpmForecastStatus;
  unsavedDeltaWeeks: number;
}) {
  const latestUpdate = selectLatestScheduleUpdate(updates);
  const savedForecast = selectSavedScheduleForecast(updates, project.forecast_completion_date);
  const recordVariance = selectSavedScheduleVarianceWeeks(
    updates,
    project.baseline_completion_date,
    project.forecast_completion_date,
  );
  const bounds = getTimelineBounds([
    project.baseline_completion_date,
    savedForecast,
    cpmForecastStatus.unsavedForecast,
    latestUpdate?.data_date,
  ]);
  const baselinePosition = timelinePosition(project.baseline_completion_date, bounds);
  const recordPosition = timelinePosition(savedForecast, bounds);
  const livePosition = cpmForecastStatus.isUnsaved
    ? timelinePosition(cpmForecastStatus.unsavedForecast, bounds)
    : null;
  const dataDatePosition = timelinePosition(latestUpdate?.data_date, bounds);
  const chipLabel =
    recordVariance == null
      ? "SET DATES"
      : recordVariance === 0
        ? "ON PLAN"
        : `${recordVariance > 0 ? "+" : "−"}${Math.abs(recordVariance)} WK OF RECORD`;
  const chipTone =
    recordVariance == null
      ? "text-muted-foreground"
      : recordVariance > 0
        ? "text-danger"
        : "text-success";
  const dotClass = recordVariance != null && recordVariance > 0 ? "bg-danger" : "bg-success";
  const markers = [
    recordPosition != null
      ? {
          key: "record",
          left: recordPosition,
          label: `Record · ${shortDate(savedForecast)}`,
          dotClass: "bg-success",
          labelClass: "text-success",
        }
      : null,
    livePosition != null
      ? {
          key: "live",
          left: livePosition,
          label: `Live · ${shortDate(cpmForecastStatus.unsavedForecast)}`,
          dotClass: "bg-warning",
          labelClass: "text-warning",
        }
      : null,
    baselinePosition != null
      ? {
          key: "baseline",
          left: baselinePosition,
          label: `Baseline · ${shortDate(project.baseline_completion_date)}`,
          dotClass: "bg-foreground",
          labelClass: "text-foreground",
        }
      : null,
  ].filter((marker): marker is NonNullable<typeof marker> => marker != null);
  // Nearby dates (record vs live a week apart) would overprint their labels —
  // drop a colliding label onto the next row instead.
  const labelRowByKey: Record<string, number> = {};
  const lastLabelLeftByRow: number[] = [];
  for (const marker of [...markers].sort((a, b) => a.left - b.left)) {
    let row = 0;
    while (lastLabelLeftByRow[row] != null && marker.left - lastLabelLeftByRow[row] < 16) row += 1;
    lastLabelLeftByRow[row] = marker.left;
    labelRowByKey[marker.key] = row;
  }
  const maxLabelRow = Math.max(0, ...Object.values(labelRowByKey));

  return (
    <section className="rounded-xl border border-hairline bg-card px-5 py-5 sm:px-6">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <div className="text-[13px] font-semibold text-foreground">Project completion path</div>
        <span className="text-xs text-muted-foreground">baseline vs saved record vs live CPM</span>
        <span className={`ml-auto font-mono text-[10px] font-bold tracking-[0.08em] ${chipTone}`}>
          {chipLabel}
        </span>
      </div>
      <div className="relative mt-6" style={{ height: 64 + maxLabelRow * 14 }}>
        <div className="absolute inset-x-0 top-[22px] h-1.5 rounded-full bg-muted" />
        {dataDatePosition != null && (
          <div
            className="absolute top-[14px] flex flex-col items-center"
            style={{ left: `${dataDatePosition}%` }}
          >
            <span className="h-[22px] w-px -translate-x-1/2 bg-foreground/35" />
            <span className="mt-1.5 -translate-x-1/2 whitespace-nowrap font-mono text-[9px] font-bold text-muted-foreground">
              Data date · {shortDate(latestUpdate?.data_date)}
            </span>
          </div>
        )}
        {markers.map((marker) => (
          <PathMarker
            key={marker.key}
            left={marker.left}
            label={marker.label}
            dotClass={marker.dotClass}
            labelClass={marker.labelClass}
            labelRow={labelRowByKey[marker.key] ?? 0}
          />
        ))}
      </div>
      <div className="mt-5 flex max-w-[54ch] items-start gap-3.5">
        <span className="relative mt-3 h-3 w-3 shrink-0" aria-hidden="true">
          <span className={`absolute inset-0 rounded-full ${dotClass}`} />
          <span
            className={`absolute inset-0 animate-ping rounded-full ${dotClass} motion-reduce:hidden`}
          />
        </span>
        <p className="font-serif text-[26px] leading-[1.34] text-foreground">
          <ScheduleVerdict
            recordVariance={recordVariance}
            cpmForecastStatus={cpmForecastStatus}
            unsavedDeltaWeeks={unsavedDeltaWeeks}
          />
        </p>
      </div>
    </section>
  );
}

function ScheduleVerdict({
  recordVariance,
  cpmForecastStatus,
  unsavedDeltaWeeks,
}: {
  recordVariance: number | null;
  cpmForecastStatus: CpmForecastStatus;
  unsavedDeltaWeeks: number;
}) {
  if (recordVariance == null) {
    return (
      <span className="text-muted-foreground">
        Set the baseline and forecast completion dates to read the schedule verdict.
      </span>
    );
  }
  const weeks = Math.abs(recordVariance);
  const weekWord = weeks === 1 ? "week" : "weeks";
  const driftWeeks = Math.abs(unsavedDeltaWeeks);
  const drift = cpmForecastStatus.isUnsaved ? (
    <>
      {" "}
      <span className="text-muted-foreground">
        Since that snapshot the live schedule has drifted
      </span>{" "}
      <span className="font-semibold text-warning">
        {driftWeeks === 0
          ? "less than a week"
          : `${driftWeeks} ${driftWeeks === 1 ? "week" : "weeks"} ${unsavedDeltaWeeks > 0 ? "later" : "earlier"}`}
      </span>
      <span className="text-muted-foreground"> — save a new update to keep the record honest.</span>
    </>
  ) : null;
  if (recordVariance < 0) {
    return (
      <>
        <span>Ahead of baseline by </span>
        <span className="font-semibold text-success">
          {weeks} {weekWord}
        </span>
        <span> on the record.</span>
        {drift}
      </>
    );
  }
  if (recordVariance > 0) {
    return (
      <>
        <span>Behind baseline by </span>
        <span className="font-semibold text-danger">
          {weeks} {weekWord}
        </span>
        <span> on the record.</span>
        {drift}
      </>
    );
  }
  return (
    <>
      <span>Holding the baseline plan on the record.</span>
      {drift}
    </>
  );
}

function PathMarker({
  left,
  label,
  dotClass,
  labelClass,
  labelRow = 0,
}: {
  left: number;
  label: string;
  dotClass: string;
  labelClass: string;
  labelRow?: number;
}) {
  return (
    <div
      className="absolute top-[17px] flex -translate-x-1/2 flex-col items-center"
      style={{ left: `${left}%` }}
    >
      <span className={`h-[15px] w-[15px] rounded-full ${dotClass}`} />
      <span
        className={`whitespace-nowrap font-mono text-[9px] font-bold ${labelClass}`}
        style={{ marginTop: 6 + labelRow * 14 }}
      >
        {label}
      </span>
    </div>
  );
}

/** Interim milestone plan: the meeting-review mini-Gantt with its stat tiles
 * and the most recent saved-update cards. All pre-v2 capability kept. */
export function ScheduleMilestonePlan({
  project,
  updates,
  milestones,
  milestoneView,
  onMilestoneViewChange,
}: {
  project: ProjectRow;
  updates: ScheduleUpdateRow[];
  milestones: MilestoneRow[];
  milestoneView: MilestoneView;
  onMilestoneViewChange: (value: MilestoneView) => void;
}) {
  const latestUpdate = selectLatestScheduleUpdate(updates);
  const savedForecast = selectSavedScheduleForecast(updates, project.forecast_completion_date);
  const visibleMilestones = filterMilestones(milestones, milestoneView);
  const activeMilestoneCount = milestones.filter((m) => m.status !== "complete").length;
  const completedMilestoneCount = milestones.filter((m) => m.status === "complete").length;
  const schedulePressureCount = milestones.filter(
    (m) => m.status === "delayed" || m.status === "at_risk",
  ).length;
  const dateValues = [
    project.baseline_completion_date,
    savedForecast,
    ...updates.flatMap((update) => [update.data_date, update.forecast_completion_date]),
    ...milestones.flatMap((milestone) => [milestone.baseline_date, milestone.forecast_date]),
  ];
  const bounds = getTimelineBounds(dateValues);
  const dataDatePosition = timelinePosition(latestUpdate?.data_date, bounds);
  const recentUpdates = updates.slice(0, 6).reverse();

  return (
    <section className="rounded-xl border border-hairline bg-card p-5 sm:p-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[13px] font-semibold text-foreground">Interim milestone plan</div>
          <p className="mt-1 text-sm text-muted-foreground">
            Baseline dates stay fixed. Current bars move with each data-date update so the team can
            review the milestone picture without opening the workspace.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <MilestoneViewSelect value={milestoneView} onChange={onMilestoneViewChange} />
          <div className="text-xs text-muted-foreground">
            {recentUpdates.length > 0
              ? `${recentUpdates.length} latest update${recentUpdates.length === 1 ? "" : "s"} shown`
              : "No updates saved yet"}
          </div>
        </div>
      </div>

      <div className="space-y-5">
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <ScheduleStat
            label="Latest data date"
            value={shortDate(latestUpdate?.data_date)}
            sub={latestUpdate ? `Update #${latestUpdate.update_number}` : "No update saved"}
          />
          <ScheduleStat
            label="Active milestones"
            value={String(activeMilestoneCount)}
            sub={`${completedMilestoneCount} complete`}
          />
          <ScheduleStat
            label="Delayed / at risk"
            value={String(schedulePressureCount)}
            sub="Needs meeting attention"
            tone={schedulePressureCount > 0 ? "danger" : "success"}
          />
          <ScheduleStat
            label="Schedule dollars"
            value={fmtUSD(latestUpdate?.schedule_money_net ?? 0)}
            sub="Latest update net"
            tone={(latestUpdate?.schedule_money_net ?? 0) > 0 ? "danger" : "success"}
          />
        </div>

        <div className="rounded-md border border-hairline bg-surface">
          <div className="border-b border-hairline px-4 py-3">
            <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                  Baseline vs current milestone plan
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Showing {visibleMilestones.length} of {milestones.length} milestones. Use this as
                  the simple Gantt view for meeting review.
                </div>
              </div>
              <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full border border-foreground bg-card" />
                  Baseline
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-2.5 w-2.5 rounded-full border border-accent bg-accent" />
                  Current
                </span>
              </div>
            </div>
          </div>
          {visibleMilestones.length === 0 ? (
            <div className="px-4 py-8 text-sm text-muted-foreground">
              No {milestoneView === "complete" ? "completed" : milestoneView} milestones to show.
              Add schedule milestones below to build the plan.
            </div>
          ) : (
            <div className="max-h-[560px] overflow-y-auto">
              {visibleMilestones.map((milestone) => (
                <SchedulePlanRow
                  key={milestone.id}
                  milestone={milestone}
                  bounds={bounds}
                  dataDatePosition={dataDatePosition}
                />
              ))}
            </div>
          )}
        </div>

        {recentUpdates.length > 0 && (
          <div className="grid gap-3 md:grid-cols-3">
            {recentUpdates.map((update) => (
              <div key={update.id} className="rounded-md border border-hairline bg-surface p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      Update #{update.update_number}
                    </div>
                    <div className="mt-1 font-medium text-foreground">
                      Data date {shortDate(update.data_date)}
                    </div>
                  </div>
                  <div
                    className={`font-serif text-[15px] tabular ${moneyTone(
                      update.schedule_money_net,
                    )}`}
                  >
                    {fmtUSD(update.schedule_money_net)}
                  </div>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Forecast {shortDate(update.forecast_completion_date)}
                </div>
                {(update.notes || update.money_notes) && (
                  <p className="mt-2 line-clamp-3 text-xs text-muted-foreground">
                    {update.notes || update.money_notes}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

/** Dark workbench handoff panel: this tab reviews, the workspace authors. */
export function ScheduleWorkspaceLaunch({
  project,
  activities,
  milestones,
  latestDataDate,
}: {
  project: ProjectRow;
  activities: ScheduleActivityRow[];
  milestones: MilestoneRow[];
  latestDataDate: string | null;
}) {
  const completedActivities = activities.filter(
    (activity) => activity.percent_complete >= 100,
  ).length;
  const activitiesWithLogic = activities.filter(
    (activity) =>
      activity.predecessor_activity_ids.length > 0 || activity.successor_activity_ids.length > 0,
  ).length;
  const logicTieCount = selectCanonicalLogicTieCount(activities);
  const activeMilestones = milestones.filter((milestone) => milestone.status !== "complete").length;
  const workspaceChips = [
    "CPM table + Gantt",
    "Logic ties",
    "Data-date updates",
    "Delay ledger",
    "WBS / areas",
  ];

  return (
    <section className="rounded-xl bg-dark-panel px-6 py-6 text-dark-panel-foreground">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-8">
        <div className="min-w-0 flex-1">
          <div
            className={`font-mono text-[9px] font-bold uppercase tracking-[0.14em] ${DARK_AMBER_TEXT}`}
          >
            The working surface
          </div>
          <h4 className="mt-1.5 font-serif text-2xl">Open the full CPM schedule workspace</h4>
          <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-dark-panel-foreground/60">
            This tab keeps the IOR schedule signal clean. The full-width workspace is the
            Primavera-style CPM engine — activity table, Gantt, WBS, logic ties, data-date updates,
            delay ledger — where the PM builds and updates the schedule.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {workspaceChips.map((chip) => (
              <span
                key={chip}
                className="whitespace-nowrap rounded-md border border-dark-panel-foreground/20 px-2.5 py-1.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.06em] text-dark-panel-foreground/60"
              >
                {chip}
              </span>
            ))}
          </div>
        </div>
        {/* Outline on dark, deliberately NOT coral: the top-of-tab CTA is the
            view's one signal. */}
        <Button
          asChild
          variant="outline"
          className="shrink-0 gap-2 border-dark-panel-foreground/30 bg-transparent text-dark-panel-foreground hover:bg-dark-panel-foreground/10 hover:text-dark-panel-foreground print:hidden lg:self-start"
        >
          <a href={`/projects/${project.id}/schedule#cpm-grid`} target="_blank" rel="noreferrer">
            <ExternalLink className="h-4 w-4" />
            Open workspace
          </a>
        </Button>
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <DarkStatTile
          label="Activities"
          value={String(activities.length)}
          sub={`${completedActivities} complete`}
          tone={completedActivities > 0 ? "good" : undefined}
        />
        <DarkStatTile
          label="Logic ties"
          value={String(logicTieCount)}
          sub={`${activitiesWithLogic} linked activities`}
          tone={logicTieCount > 0 ? "good" : "amber"}
        />
        <DarkStatTile
          label="Milestones"
          value={String(activeMilestones)}
          sub={`${milestones.length} total`}
        />
        <DarkStatTile
          label="Latest data date"
          value={shortDate(latestDataDate)}
          sub="current snapshot"
        />
      </div>
    </section>
  );
}

function DarkStatTile({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "good" | "amber";
}) {
  const toneClass =
    tone === "good"
      ? DARK_GOOD_TEXT
      : tone === "amber"
        ? DARK_AMBER_TEXT
        : "text-dark-panel-foreground";
  return (
    <div className="min-w-0 rounded-lg border border-dark-panel-foreground/15 px-3 py-2.5">
      <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-dark-panel-foreground/60">
        {label}
      </div>
      <div className={`mt-1 truncate font-serif text-lg tabular ${toneClass}`}>{value}</div>
      <div className="mt-0.5 truncate text-[11px] text-dark-panel-foreground/60">{sub}</div>
    </div>
  );
}

/** Bottom meta row: job identity left, schedule size right. */
export function ScheduleMetaRow({
  project,
  activities,
}: {
  project: ProjectRow;
  activities: ScheduleActivityRow[];
}) {
  const logicTieCount = selectCanonicalLogicTieCount(activities);
  return (
    <div className="flex flex-wrap items-end gap-x-8 gap-y-4 border-t border-hairline pt-4">
      <MetaField label="Job #" value={project.job_number || "—"} />
      <MetaField label="Client" value={project.client || "—"} />
      <MetaField label="Project manager" value={project.project_manager || "—"} />
      <div className="ml-auto text-right">
        <div className="text-[11.5px] text-muted-foreground">Activities</div>
        <div className="mt-0.5 whitespace-nowrap font-serif text-[17px] text-foreground">
          {activities.length} · {logicTieCount} logic ties
        </div>
      </div>
    </div>
  );
}

function MetaField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[11.5px] text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-foreground">{value}</div>
    </div>
  );
}

function ScheduleStat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger" ? "text-danger" : tone === "success" ? "text-success" : "text-foreground";
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-3">
      <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 font-serif text-lg tabular ${toneClass}`}>{value}</div>
      <div className="mt-0.5 min-h-4 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

export type TimelineBounds = {
  start: number;
  end: number;
  startLabel: string | null;
  endLabel: string | null;
};

export function getActivityDurationDays(activity: ScheduleActivityRow) {
  return getDateDurationDays(
    getActivityBaselineStart(activity),
    getActivityBaselineFinish(activity),
  );
}

export function getTimelineBounds(values: Array<string | null | undefined>): TimelineBounds {
  const parsed = values
    .map((value) => parseDateMs(value))
    .filter((value): value is number => value != null);
  const today = parseDateMs(new Date().toISOString().slice(0, 10)) ?? Date.now();
  const oneWeek = 7 * DAY_MS;
  const start = Math.min(...parsed, today) - oneWeek;
  const end = Math.max(...parsed, today) + oneWeek;
  return {
    start,
    end,
    startLabel: isoDateFromMs(start),
    endLabel: isoDateFromMs(end),
  };
}

export function timelinePosition(value: string | null | undefined, bounds: TimelineBounds) {
  const ms = parseDateMs(value);
  if (ms == null || bounds.end <= bounds.start) return null;
  const pct = ((ms - bounds.start) / (bounds.end - bounds.start)) * 100;
  return Math.max(0, Math.min(100, pct));
}

function SchedulePlanRow({
  milestone,
  bounds,
  dataDatePosition,
}: {
  milestone: MilestoneRow;
  bounds: TimelineBounds;
  dataDatePosition: number | null;
}) {
  const baseline = timelinePosition(milestone.baseline_date, bounds);
  const current = timelinePosition(milestone.forecast_date, bounds);
  const start = baseline ?? current ?? 0;
  const end = current ?? baseline ?? 0;
  const left = Math.min(start, end);
  const width = Math.max(2, Math.abs(end - start));
  const variance = computeScheduleVarianceWeeks(milestone.baseline_date, milestone.forecast_date);
  const isLate = (variance ?? 0) > 0 || milestone.status === "delayed";
  const isPressure = isLate || milestone.status === "at_risk";
  return (
    <div className="grid gap-3 border-b border-hairline px-4 py-3 last:border-b-0 lg:grid-cols-[minmax(180px,1.25fr)_minmax(280px,2fr)_92px_92px_86px_116px] lg:items-center">
      <div className="min-w-0 lg:pr-2">
        <div className="text-sm font-medium leading-snug text-foreground">{milestone.name}</div>
        <div className="mt-1 text-xs text-muted-foreground">{milestone.owner || "Unassigned"}</div>
        {milestone.delay_reason && (
          <div className="mt-1 line-clamp-2 text-xs leading-snug text-muted-foreground">
            {milestone.delay_reason}
          </div>
        )}
      </div>
      <div>
        <div className="relative h-9 rounded-md bg-muted">
          {dataDatePosition != null && (
            <div
              className="absolute inset-y-1 w-px bg-foreground/25"
              style={{ left: `${dataDatePosition}%` }}
            />
          )}
          {(baseline != null || current != null) && (
            <div
              className={`absolute top-1/2 h-2 -translate-y-1/2 rounded-full ${
                isPressure ? "bg-danger/60" : "bg-success/60"
              }`}
              style={{ left: `${left}%`, width: `${width}%` }}
            />
          )}
          {baseline != null && (
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-foreground bg-card"
              style={{ left: `${baseline}%` }}
            />
          )}
          {current != null && (
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent bg-accent"
              style={{ left: `${current}%` }}
            />
          )}
        </div>
      </div>
      <CompactField label="Baseline" value={shortDate(milestone.baseline_date)} />
      <CompactField label="Current" value={shortDate(milestone.forecast_date)} />
      <CompactField label="Variance" value={varianceLabel(variance)} />
      <span
        className={`inline-flex min-h-8 items-center justify-center rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] ${STATUS_STYLES[milestone.status]}`}
      >
        {STATUS_LABEL[milestone.status]}
      </span>
    </div>
  );
}
