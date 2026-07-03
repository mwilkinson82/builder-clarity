import { Button } from "@/components/ui/button";
import { ExternalLink } from "lucide-react";
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
  type MilestoneView,
  STATUS_LABEL,
  STATUS_STYLES,
  moneyTone,
  shortDate,
  varianceLabel,
  varianceTone,
} from "./scheduleShared";
import { MilestoneViewSelect, filterMilestones } from "./ScheduleRiskTab";
import { ScheduleWorkbenchStat } from "./CpmWorkbenchPanels";
import { CompactField } from "./ScheduleMilestones";

export function ScheduleSnapshotTimeline({
  project,
  updates,
  milestones,
  activities,
  milestoneView,
  onMilestoneViewChange,
}: {
  project: ProjectRow;
  updates: ScheduleUpdateRow[];
  milestones: MilestoneRow[];
  activities: ScheduleActivityRow[];
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
  const completionBaseline = timelinePosition(project.baseline_completion_date, bounds);
  const currentCompletion = timelinePosition(savedForecast, bounds);
  const dataDatePosition = timelinePosition(latestUpdate?.data_date, bounds);
  const recentUpdates = updates.slice(0, 6).reverse();
  const completionVariance =
    selectSavedScheduleVarianceWeeks(
      updates,
      project.baseline_completion_date,
      project.forecast_completion_date,
    ) ?? 0;

  return (
    <section className="rounded-lg border border-hairline bg-card p-6">
      <div className="mb-5 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h3 className="font-serif text-2xl text-foreground">Construction schedule</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Baseline dates stay fixed. Current bars move with each data-date update so the team can
            see the schedule snapshot without opening another scheduling tool.
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
        <div className="grid gap-3 md:grid-cols-4">
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

        <div className="rounded-md border border-hairline bg-surface p-4">
          <div className="mb-3 flex items-center justify-between gap-3 text-xs">
            <div>
              <div className="font-semibold text-foreground">Project completion path</div>
              <div className="text-muted-foreground">
                Baseline {shortDate(project.baseline_completion_date)} · Current update{" "}
                {shortDate(savedForecast)}
              </div>
            </div>
            <div className={`font-semibold tabular ${varianceTone(completionVariance)}`}>
              {varianceLabel(completionVariance)}
            </div>
          </div>
          <div className="relative h-10 rounded-full bg-muted">
            {dataDatePosition != null && (
              <div
                className="absolute inset-y-1 w-px bg-foreground/35"
                style={{ left: `${dataDatePosition}%` }}
              >
                <span className="absolute -top-5 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Data date
                </span>
              </div>
            )}
            {completionBaseline != null && (
              <TimelineMarker
                left={completionBaseline}
                label="Baseline"
                className="border-foreground bg-foreground"
              />
            )}
            {currentCompletion != null && (
              <TimelineMarker
                left={currentCompletion}
                label="Current"
                className="border-accent bg-accent"
              />
            )}
          </div>
          <div className="mt-2 flex justify-between text-[11px] text-muted-foreground">
            <span>{shortDate(bounds.startLabel)}</span>
            <span>{shortDate(bounds.endLabel)}</span>
          </div>
        </div>

        <ScheduleWorkspaceLaunch
          activities={activities}
          milestones={milestones}
          project={project}
          latestDataDate={latestUpdate?.data_date ?? null}
        />

        <div className="rounded-md border border-hairline bg-surface">
          <div className="border-b border-hairline px-4 py-3">
            <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
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
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Update #{update.update_number}
                    </div>
                    <div className="mt-1 font-medium text-foreground">
                      Data date {shortDate(update.data_date)}
                    </div>
                  </div>
                  <div
                    className={`text-sm font-semibold tabular ${moneyTone(
                      update.schedule_money_net,
                    )}`}
                  >
                    {fmtUSD(update.schedule_money_net)}
                  </div>
                </div>
                <div className="mt-2 text-sm text-muted-foreground">
                  Current completion {shortDate(update.forecast_completion_date)}
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

function ScheduleWorkspaceLaunch({
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
  const workspacePanels = [
    "Full CPM activity table + Gantt",
    "Schedule update history",
    "Interim milestones",
    "Critical delayed decisions",
    "Procurement risks",
    "Trade performance risks",
  ];

  return (
    <div className="rounded-md border border-hairline bg-surface p-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.46fr)] xl:items-start">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Schedule workspace
          </div>
          <h4 className="mt-1 font-serif text-2xl text-foreground">
            Open the full construction schedule workspace
          </h4>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            This tab keeps the IOR schedule signal clean. The full-width workspace is where the PM
            manages the CPM activity table, Gantt, WBS hierarchy, data dates, schedule updates, and
            schedule-linked risks without the left navigation constraining the work.
          </p>
          <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {workspacePanels.map((panel) => (
              <div
                key={panel}
                className="min-w-0 rounded border border-hairline bg-card px-3 py-2 text-xs font-semibold leading-5 text-foreground"
              >
                {panel}
              </div>
            ))}
          </div>
        </div>
        <div className="min-w-0 rounded-md border border-hairline bg-card p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Working surface
          </div>
          <div className="mt-1 text-sm leading-6 text-muted-foreground">
            Use this when you need to build, update, print, or analyze the actual project schedule.
          </div>
          <Button asChild className="mt-4 w-full gap-2 print:hidden">
            <a href={`/projects/${project.id}/schedule#cpm-grid`} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4" />
              Open full schedule workspace
            </a>
          </Button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <ScheduleWorkbenchStat
          label="Activities"
          value={String(activities.length)}
          sub={`${completedActivities} complete`}
          tone={completedActivities > 0 ? "success" : "default"}
        />
        <ScheduleWorkbenchStat
          label="Logic ties"
          value={String(logicTieCount)}
          sub={`${activitiesWithLogic} linked activities`}
          tone={logicTieCount > 0 ? "success" : "warning"}
        />
        <ScheduleWorkbenchStat
          label="Milestones"
          value={String(activeMilestones)}
          sub={`${milestones.length} total`}
        />
        <ScheduleWorkbenchStat
          label="Latest data date"
          value={shortDate(latestDataDate)}
          sub="current snapshot"
        />
      </div>
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
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold tabular ${toneClass}`}>{value}</div>
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

export function parseDateMs(value?: string | null) {
  if (!value) return null;
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  return Date.UTC(year, month - 1, day);
}

export function isoDateFromMs(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function getActivityDurationDays(activity: ScheduleActivityRow) {
  return getDateDurationDays(
    getActivityBaselineStart(activity),
    getActivityBaselineFinish(activity),
  );
}

export function getActivityBaselineStart(activity: ScheduleActivityRow) {
  return activity.baseline_start_date ?? activity.start_date;
}

export function getActivityBaselineFinish(activity: ScheduleActivityRow) {
  return activity.baseline_finish_date ?? activity.finish_date;
}

export function getActivityForecastStart(activity: ScheduleActivityRow) {
  return (
    activity.actual_start_date ??
    activity.forecast_start_date ??
    activity.start_date ??
    activity.baseline_start_date
  );
}

export function getActivityForecastFinish(activity: ScheduleActivityRow) {
  return (
    activity.actual_finish_date ??
    activity.forecast_finish_date ??
    activity.finish_date ??
    activity.baseline_finish_date
  );
}

export function getDateDurationDays(startDate?: string | null, finishDate?: string | null) {
  const start = parseDateMs(startDate);
  const finish = parseDateMs(finishDate);
  if (start == null || finish == null) return null;
  return Math.max(1, Math.round((finish - start) / DAY_MS) + 1);
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

function TimelineMarker({
  left,
  label,
  className,
}: {
  left: number;
  label: string;
  className: string;
}) {
  return (
    <div className="absolute top-1/2 -translate-y-1/2" style={{ left: `${left}%` }}>
      <div className={`h-4 w-4 -translate-x-1/2 rounded-full border-2 ${className}`} />
      <div className="-translate-x-1/2 pt-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
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
