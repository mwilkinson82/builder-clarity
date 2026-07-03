import {
  type MilestoneStatus,
  type MilestoneRow,
  type ScheduleActivityRow,
  type ScheduleDelayFragmentRow,
  type ScheduleUpdateRow,
} from "@/lib/schedule.functions";
import { type ProjectRow } from "@/lib/projects.functions";
import { computeScheduleVarianceWeeks } from "@/lib/ior";
import { type ConstructLineCpmModel, type ConstructLineCpmTask } from "@/lib/constructline-cpm";
import {
  DAY_MS,
  getActivityBaselineFinish,
  getActivityBaselineStart,
  getActivityForecastFinish,
  getActivityForecastStart,
  isoDateFromMs,
  parseDateMs,
  shortDate,
  type CpmMilestoneForecast,
  type CpmScheduleUpdateDraft,
  type DelayFragmentSummary,
  varianceLabel,
} from "./scheduleShared";

export function buildCpmScheduleUpdateDraft({
  dataDate,
  delaySummary,
  milestones,
  model,
  previousUpdate,
  project,
}: {
  dataDate: string;
  delaySummary: DelayFragmentSummary;
  milestones: MilestoneRow[];
  model: ConstructLineCpmModel;
  previousUpdate: ScheduleUpdateRow | null;
  project: ProjectRow;
}): CpmScheduleUpdateDraft {
  const forecastCompletion =
    model.tasks.length > 0 ? model.cpmFinishDate : project.forecast_completion_date || dataDate;
  const previousCompletion =
    previousUpdate?.forecast_completion_date ?? project.forecast_completion_date ?? null;
  const varianceWeeks = computeScheduleVarianceWeeks(
    project.baseline_completion_date,
    forecastCompletion,
  );
  const movementWeeks = computeScheduleVarianceWeeks(previousCompletion, forecastCompletion);
  const milestoneForecasts = buildCpmMilestoneForecasts(model, milestones);
  const incompleteCriticalTasks = model.tasks.filter(
    (task) => task.isCritical && task.activity.percent_complete < 100,
  );
  const negativeFloatDrivers = incompleteCriticalTasks
    .filter((task) => task.totalFloat < 0)
    .sort((a, b) => a.totalFloat - b.totalFloat);
  const criticalDrivers = [...incompleteCriticalTasks]
    .sort((a, b) => a.totalFloat - b.totalFloat || a.earlyStart - b.earlyStart)
    .slice(0, 3)
    .map((task) => task.dependencyKey || task.activity.name);
  const negativeDriverLabels = negativeFloatDrivers
    .slice(0, 3)
    .map((task) => `${task.dependencyKey || task.activity.name} ${task.totalFloat}d TF`);
  const qualityParts = model.criticalPathReliable
    ? [`${model.criticalCount} critical`, `${model.nearCriticalCount} near-critical`]
    : [`Critical path provisional: ${model.criticalPathReliabilityNote}`];
  if (model.openStartCount > 1 || model.openFinishCount > 1) {
    qualityParts.push(`${model.openStartCount}/${model.openFinishCount} open starts/finishes`);
  }
  if (model.openFinishCount === 1 && model.unanchoredOpenFinishCount > 0) {
    qualityParts.push("finish anchor needed");
  }
  if (model.lateCount > 0) qualityParts.push(`${model.lateCount} late`);
  if (model.outOfSequenceCount > 0) {
    qualityParts.push(`${model.outOfSequenceCount} out-of-sequence`);
  }
  if (negativeFloatDrivers.length > 0) {
    qualityParts.push(
      `${negativeFloatDrivers.length} negative-float ${
        negativeFloatDrivers.length === 1 ? "activity" : "activities"
      }`,
    );
  }
  if (model.maxStack >= 4) {
    qualityParts.push(`${model.maxStack} peak stack at ${model.maxStackLabel}`);
  }
  if (delaySummary.openCount > 0) {
    qualityParts.push(
      `${delaySummary.openCount} open delay impacts / ${delaySummary.openDays} days`,
    );
  }

  const previewParts = [
    `CPM forecast ${shortDate(forecastCompletion)} (${varianceLabel(
      varianceWeeks,
    )} vs baseline, ${varianceLabel(movementWeeks)} movement).`,
    qualityParts.join("; ") + ".",
    criticalDrivers.length > 0 ? `Drivers: ${criticalDrivers.join(", ")}.` : null,
    negativeDriverLabels.length > 0
      ? `Negative float drivers: ${negativeDriverLabels.join(", ")}.`
      : null,
    delaySummary.driverLabels.length > 0
      ? `Delay ledger: ${delaySummary.driverLabels.join(", ")}.`
      : null,
    milestoneForecasts.length > 0
      ? `${milestoneForecasts.length} milestone forecast ${
          milestoneForecasts.length === 1 ? "update" : "updates"
        } matched from CPM diamonds.`
      : null,
  ].filter(Boolean);
  const preview = previewParts.join(" ");

  return {
    data_date: dataDate,
    forecast_completion_date: forecastCompletion,
    variance_weeks: varianceWeeks,
    movement_weeks: movementWeeks,
    milestone_forecasts: milestoneForecasts,
    money_notes: "No schedule dollars auto-calculated from CPM.",
    notes: preview,
    preview,
  };
}

export function buildDelayFragmentSummary(
  fragments: ScheduleDelayFragmentRow[],
): DelayFragmentSummary {
  const openFragments = fragments.filter(isOpenDelayFragment);
  const sortedDrivers = [...openFragments]
    .sort((a, b) => b.delay_days - a.delay_days)
    .slice(0, 3)
    .map((fragment) => `${fragment.activity_id || "Unassigned"} ${fragment.delay_days}d`);
  return {
    totalCount: fragments.length,
    openCount: openFragments.length,
    openDays: openFragments.reduce((total, fragment) => total + fragment.delay_days, 0),
    activeCount: fragments.filter((fragment) => fragment.status === "active").length,
    mitigatedCount: fragments.filter((fragment) => fragment.status === "mitigated").length,
    recoveredCount: fragments.filter((fragment) => fragment.status === "recovered").length,
    driverLabels: sortedDrivers,
  };
}

export function buildActivityRiskDescription(
  activity: ScheduleActivityRow,
  delaySummary: DelayFragmentSummary,
) {
  const pieces = [
    `CPM activity ${activity.activity_id || "without ID"}: ${activity.name}.`,
    getActivityBaselineStart(activity) || getActivityBaselineFinish(activity)
      ? `Baseline dates: ${shortDate(getActivityBaselineStart(activity))} to ${shortDate(
          getActivityBaselineFinish(activity),
        )}.`
      : "Baseline dates are not fully set.",
    getActivityForecastStart(activity) || getActivityForecastFinish(activity)
      ? `Forecast dates: ${shortDate(getActivityForecastStart(activity))} to ${shortDate(
          getActivityForecastFinish(activity),
        )}.`
      : "Forecast dates are not fully set.",
    `${activity.percent_complete}% complete.`,
  ];
  if (delaySummary.openDays > 0) {
    pieces.push(
      `Open delay impact: ${delaySummary.openDays} days across ${delaySummary.openCount} fragment${
        delaySummary.openCount === 1 ? "" : "s"
      }.`,
    );
  }
  if (activity.notes) pieces.push(`Activity notes: ${activity.notes}`);
  return pieces.join(" ");
}

export function isOpenDelayFragment(fragment: ScheduleDelayFragmentRow) {
  return fragment.status === "active" || fragment.status === "accepted";
}

export function groupDelayFragmentsByActivity(fragments: ScheduleDelayFragmentRow[]) {
  const byKey = new Map<string, ScheduleDelayFragmentRow[]>();
  for (const fragment of fragments) {
    const keys = [fragment.schedule_activity_id, fragment.activity_id]
      .map((key) => key?.trim())
      .filter((key): key is string => Boolean(key));
    for (const key of keys) {
      byKey.set(key, [...(byKey.get(key) ?? []), fragment]);
    }
  }
  return byKey;
}

export function getDelayFragmentsForActivity(
  activity: ScheduleActivityRow,
  byKey: Map<string, ScheduleDelayFragmentRow[]>,
) {
  const unique = new Map<string, ScheduleDelayFragmentRow>();
  for (const key of [activity.id, activity.activity_id]) {
    if (!key) continue;
    for (const fragment of byKey.get(key) ?? []) {
      unique.set(fragment.id, fragment);
    }
  }
  return Array.from(unique.values());
}

export function buildDelayExtensionFinishDates(
  activities: ScheduleActivityRow[],
  delayFragments: ScheduleDelayFragmentRow[],
) {
  const byActivity = groupDelayFragmentsByActivity(delayFragments);
  return activities.flatMap((activity) => {
    const baseMs = parseDateMs(
      getActivityForecastFinish(activity) ?? getActivityForecastStart(activity),
    );
    if (baseMs == null) return [];
    const delaySummary = buildDelayFragmentSummary(
      getDelayFragmentsForActivity(activity, byActivity),
    );
    if (delaySummary.openDays <= 0) return [];
    const baselineMs = parseDateMs(getActivityBaselineFinish(activity));
    const delayDaysAlreadyCarried =
      baselineMs == null ? 0 : Math.max(0, Math.round((baseMs - baselineMs) / DAY_MS));
    const uncarriedDelayDays = Math.max(0, delaySummary.openDays - delayDaysAlreadyCarried);
    if (uncarriedDelayDays <= 0) return [];
    return [isoDateFromMs(baseMs + uncarriedDelayDays * DAY_MS)];
  });
}

function buildCpmMilestoneForecasts(
  model: ConstructLineCpmModel,
  milestones: MilestoneRow[],
): CpmMilestoneForecast[] {
  const milestoneByName = new Map(
    milestones.map((milestone) => [normalizeScheduleMatchName(milestone.name), milestone]),
  );
  const seen = new Set<string>();

  return model.tasks.flatMap((task) => {
    if (!task.isMilestone) return [];
    const milestone = milestoneByName.get(normalizeScheduleMatchName(task.activity.name));
    if (!milestone || seen.has(milestone.id)) return [];
    seen.add(milestone.id);
    const forecastDate = task.visualFinishDate;
    const varianceWeeks = computeScheduleVarianceWeeks(milestone.baseline_date, forecastDate);
    const status = cpmMilestoneStatus(task, varianceWeeks);
    const delayReason = cpmMilestoneReason(task, forecastDate, varianceWeeks);
    if (
      milestone.forecast_date === forecastDate &&
      milestone.status === status &&
      milestone.delay_reason === delayReason
    ) {
      return [];
    }
    return [
      {
        milestone_id: milestone.id,
        forecast_date: forecastDate,
        status,
        delay_reason: delayReason,
      },
    ];
  });
}

function cpmMilestoneStatus(
  task: ConstructLineCpmTask,
  varianceWeeks: number | null,
): MilestoneStatus {
  if (task.activity.percent_complete >= 100) return "complete";
  if ((varianceWeeks ?? 0) > 0 || task.isLate) return "delayed";
  if (task.isOutOfSequence || task.totalFloat <= 5) return "at_risk";
  return "on_track";
}

function cpmMilestoneReason(
  task: ConstructLineCpmTask,
  forecastDate: string,
  varianceWeeks: number | null,
) {
  const parts = [`CPM forecast ${shortDate(forecastDate)}`];
  if (varianceWeeks != null) parts.push(`${varianceLabel(varianceWeeks)} vs baseline`);
  if (task.totalFloat < 0) parts.push(`${task.totalFloat}d total float`);
  else if (task.isCritical) parts.push("critical path");
  else if (task.isNearCritical) parts.push(`${task.totalFloat}d total float`);
  if (task.isLate) parts.push("past data date");
  if (task.isOutOfSequence) parts.push("out-of-sequence progress");
  if (task.isOpenStart || task.isOpenFinish) parts.push("open-end logic");
  return `${parts.join("; ")}.`;
}

function normalizeScheduleMatchName(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/\bmilestone\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isOpenDelayStatus(status: ScheduleDelayFragmentRow["status"]) {
  return status === "active" || status === "accepted";
}
