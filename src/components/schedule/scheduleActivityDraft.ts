import { type RefObject } from "react";
import { type MilestoneRow, type ScheduleActivityRow } from "@/lib/schedule.functions";
import {
  formatConstructLineDependencyToken,
  isConstructLineMilestoneActivity,
  parseConstructLineDependencyToken,
  type ConstructLineDependencyToken,
} from "@/lib/constructline-cpm";
import {
  getScheduleStatusAnchorDate,
  updateScheduleStatusActualFinishDate,
  updateScheduleStatusActualStartDate,
  updateScheduleStatusForecastFinishDate,
  updateScheduleStatusForecastStartDate,
  updateScheduleStatusPercentComplete,
  updateScheduleStatusRemainingDuration,
} from "@/lib/schedule-status";
import {
  DAY_MS,
  STATUS_LABEL,
  parsePercent,
  parseRemainingDuration,
  shortDate,
} from "./scheduleShared";
import { hasScheduleActivityStarted } from "./scheduleUpdateReadiness";
import { isoDateFromMs, parseDateMs } from "./ScheduleSnapshotTimeline";

export type ActivityDraft = {
  activity_id: string;
  name: string;
  division: string;
  start_date: string;
  finish_date: string;
  baseline_start_date: string;
  baseline_finish_date: string;
  forecast_start_date: string;
  forecast_finish_date: string;
  actual_start_date: string;
  actual_finish_date: string;
  remaining_duration_days: string;
  percent_complete: string;
  predecessor_activity_ids: string;
  successor_activity_ids: string;
  notes: string;
  is_milestone: boolean;
};

export const emptyActivityDraft = (): ActivityDraft => ({
  activity_id: "",
  name: "",
  division: "General",
  start_date: "",
  finish_date: "",
  baseline_start_date: "",
  baseline_finish_date: "",
  forecast_start_date: "",
  forecast_finish_date: "",
  actual_start_date: "",
  actual_finish_date: "",
  remaining_duration_days: "",
  percent_complete: "0",
  predecessor_activity_ids: "",
  successor_activity_ids: "",
  notes: "",
  is_milestone: false,
});

export const activityDraftFromRow = (activity: ScheduleActivityRow): ActivityDraft => {
  const isMilestone = isConstructLineMilestoneActivity(activity);
  return {
    activity_id: activity.activity_id,
    name: activity.name,
    division: activity.division || "General",
    start_date: activity.start_date ?? "",
    finish_date: activity.finish_date ?? "",
    baseline_start_date: activity.baseline_start_date ?? activity.start_date ?? "",
    baseline_finish_date: activity.baseline_finish_date ?? activity.finish_date ?? "",
    forecast_start_date: activity.forecast_start_date ?? activity.start_date ?? "",
    forecast_finish_date: activity.forecast_finish_date ?? activity.finish_date ?? "",
    actual_start_date: activity.actual_start_date ?? "",
    actual_finish_date: activity.actual_finish_date ?? "",
    remaining_duration_days:
      isMilestone ||
      activity.remaining_duration_days == null ||
      !hasScheduleActivityStarted(activity)
        ? isMilestone
          ? "0"
          : ""
        : String(activity.remaining_duration_days),
    percent_complete: String(activity.percent_complete),
    predecessor_activity_ids: formatActivityIds(activity.predecessor_activity_ids),
    successor_activity_ids: formatActivityIds(activity.successor_activity_ids),
    notes: activity.notes ?? "",
    is_milestone: isMilestone,
  };
};

export function scrollActivityDraftIntoView(ref: RefObject<HTMLDivElement | null>) {
  if (typeof window === "undefined") return;
  window.requestAnimationFrame(() => {
    window.requestAnimationFrame(() => {
      const element = ref.current;
      if (!element) return;
      element.scrollIntoView({ block: "start", behavior: "smooth" });
      element.focus({ preventScroll: true });
    });
  });
}

export function formatActivityDraftSaveError(error: unknown, isMilestone: boolean) {
  const message = error instanceof Error ? error.message : "";
  const lowerMessage = message.toLowerCase();
  if (
    lowerMessage.includes("activity-status") ||
    lowerMessage.includes("actual_start_date") ||
    lowerMessage.includes("actual_finish_date") ||
    lowerMessage.includes("remaining_duration_days") ||
    lowerMessage.includes("actual start") ||
    lowerMessage.includes("actual finish") ||
    lowerMessage.includes("remaining duration") ||
    lowerMessage.includes("schedule field could not save")
  ) {
    return "The baseline row, WBS, notes, and logic can still save normally. Reopen the activity and save the status update fields after the schedule refresh completes.";
  }
  if (
    lowerMessage.includes("wbs_section_id") ||
    lowerMessage.includes("schema cache") ||
    lowerMessage.includes("schedule_activities")
  ) {
    return isMilestone
      ? "The milestone could not attach to that WBS area yet. Save it under the Milestones WBS path, then attach the area after the schedule refresh completes."
      : "The activity could not attach to that WBS area yet. Save it with its typed WBS path, then attach the area after the schedule refresh completes.";
  }
  return message || (isMilestone ? "The milestone did not save." : "The activity did not save.");
}

export function normalizeActivityName(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function uniqueActivityId(base: string, existingIds: Set<string>) {
  let next = base;
  let suffix = 2;
  while (existingIds.has(next)) {
    next = `${base}-${suffix}`;
    suffix += 1;
  }
  existingIds.add(next);
  return next;
}

export function milestoneActivityNotes(milestone: MilestoneRow) {
  const pieces = [`Created from interim milestone: ${milestone.name}.`];
  if (milestone.owner) pieces.push(`Owner: ${milestone.owner}.`);
  pieces.push(`Milestone status: ${STATUS_LABEL[milestone.status]}.`);
  if (milestone.delay_reason) pieces.push(`Milestone note: ${milestone.delay_reason}`);
  return pieces.join(" ");
}

export function getNextActivityId(activities: ScheduleActivityRow[]) {
  const maxAutoNumber = activities.reduce((max, activity) => {
    const match = activity.activity_id.trim().match(/^A-(\d+)$/i);
    if (!match) return max;
    return Math.max(max, Number.parseInt(match[1], 10) || 0);
  }, 0);
  const existingIds = new Set(activities.map((activity) => activity.activity_id).filter(Boolean));
  return uniqueActivityId(`A-${String(maxAutoNumber + 1).padStart(3, "0")}`, existingIds);
}

export function validateActivityDraft(
  draft: ActivityDraft,
  activities: ScheduleActivityRow[],
  currentActivityId?: string,
) {
  const activityId = draft.activity_id.trim();
  const name = draft.name.trim();
  if (!activityId) return "Activity ID is required.";
  if (!name) return "Activity name is required.";
  const duplicate = activities.find(
    (activity) =>
      activity.id !== currentActivityId &&
      activity.activity_id.trim().toLowerCase() === activityId.toLowerCase(),
  );
  if (duplicate) return `${activityId} is already used by ${duplicate.name}.`;

  const milestoneDate = getMilestoneDraftDate(draft) ?? "";
  if (draft.is_milestone && !milestoneDate) return "Milestones need a schedule date.";
  const start = parseDateMs(draft.baseline_start_date || draft.start_date);
  const finish = parseDateMs(draft.baseline_finish_date || draft.finish_date);
  if (start != null && finish != null && finish < start) {
    return "Baseline finish cannot be earlier than baseline start.";
  }
  const forecastStart = parseDateMs(draft.forecast_start_date);
  const forecastFinish = parseDateMs(draft.forecast_finish_date);
  if (forecastStart != null && forecastFinish != null && forecastFinish < forecastStart) {
    return "Expected finish cannot be earlier than forecast start.";
  }
  const actualStart = parseDateMs(draft.actual_start_date);
  const actualFinish = parseDateMs(draft.actual_finish_date);
  if (actualStart != null && actualFinish != null && actualFinish < actualStart) {
    return "Actual finish cannot be earlier than actual start.";
  }
  const remainingDuration = parseRemainingDuration(draft.remaining_duration_days);
  if (
    draft.remaining_duration_days.trim() &&
    (remainingDuration == null || remainingDuration < 0)
  ) {
    return "Remaining duration must be a whole number of days.";
  }
  return null;
}

export function parseActivityIds(value: string) {
  return parseActivityLinks(value).map((item) => item.activityId);
}

function formatActivityIds(value: string[]) {
  return formatActivityLinks(value.map(parseConstructLineDependencyToken));
}

export function parseActivityLinks(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseConstructLineDependencyToken);
}

export function formatActivityLinks(value: ConstructLineDependencyToken[]) {
  return value
    .filter((item) => item.activityId.trim().length > 0)
    .map(formatConstructLineDependencyToken)
    .join(", ");
}

export function parseActivityTokens(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function serializeActivityLinksToArray(value: string) {
  return parseActivityTokens(formatActivityLinks(parseActivityLinks(value)));
}

export function getMilestoneDraftDate(draft: ActivityDraft) {
  return (
    draft.forecast_finish_date ||
    draft.baseline_finish_date ||
    draft.finish_date ||
    draft.forecast_start_date ||
    draft.baseline_start_date ||
    draft.start_date ||
    null
  );
}

export function toggleMilestoneDraft(draft: ActivityDraft, isMilestone: boolean): ActivityDraft {
  if (!isMilestone) {
    return {
      ...draft,
      is_milestone: false,
      division: draft.division.trim().toLowerCase() === "milestones" ? "General" : draft.division,
    };
  }

  const milestoneDate = getMilestoneDraftDate(draft) ?? "";
  return {
    ...draft,
    is_milestone: true,
    division: "Milestones",
    start_date: milestoneDate,
    finish_date: milestoneDate,
    baseline_start_date: milestoneDate,
    baseline_finish_date: milestoneDate,
    forecast_start_date: milestoneDate,
    forecast_finish_date: milestoneDate,
    remaining_duration_days: "0",
  };
}

function updateDraftStartDate(draft: ActivityDraft, value: string): ActivityDraft {
  if (!draft.is_milestone) return { ...draft, start_date: value };
  return { ...draft, start_date: value, finish_date: value };
}

function updateDraftFinishDate(draft: ActivityDraft, value: string): ActivityDraft {
  if (!draft.is_milestone) return { ...draft, finish_date: value };
  return { ...draft, start_date: value, finish_date: value };
}

export function updateDraftBaselineStartDate(draft: ActivityDraft, value: string): ActivityDraft {
  if (!draft.is_milestone) {
    return {
      ...draft,
      start_date: value,
      baseline_start_date: value,
      forecast_start_date: draft.forecast_start_date || value,
    };
  }
  return {
    ...draft,
    start_date: value,
    finish_date: value,
    baseline_start_date: value,
    baseline_finish_date: value,
    forecast_start_date: value,
    forecast_finish_date: value,
  };
}

export function updateDraftBaselineFinishDate(draft: ActivityDraft, value: string): ActivityDraft {
  if (!draft.is_milestone) {
    return {
      ...draft,
      finish_date: value,
      baseline_finish_date: value,
      forecast_finish_date: draft.forecast_finish_date || value,
    };
  }
  return {
    ...draft,
    start_date: value,
    finish_date: value,
    baseline_start_date: value,
    baseline_finish_date: value,
    forecast_start_date: value,
    forecast_finish_date: value,
  };
}

export function updateDraftActualStartDate(
  draft: ActivityDraft,
  value: string,
  dataDate?: string | null,
): ActivityDraft {
  if (draft.is_milestone) {
    return { ...draft, actual_start_date: value, remaining_duration_days: "0" };
  }
  return updateScheduleStatusActualStartDate(draft, value, dataDate);
}

export function updateDraftActualFinishDate(
  draft: ActivityDraft,
  value: string,
  dataDate?: string | null,
): ActivityDraft {
  if (draft.is_milestone) {
    return {
      ...draft,
      actual_finish_date: value,
      percent_complete: value ? "100" : draft.percent_complete,
      remaining_duration_days: "0",
    };
  }
  return updateScheduleStatusActualFinishDate(draft, value, dataDate);
}

export function updateDraftForecastStartDate(
  draft: ActivityDraft,
  value: string,
  dataDate?: string | null,
): ActivityDraft {
  if (draft.is_milestone) {
    return {
      ...draft,
      start_date: value,
      finish_date: value,
      forecast_start_date: value,
      forecast_finish_date: value,
      remaining_duration_days: "0",
    };
  }
  return updateScheduleStatusForecastStartDate(draft, value, dataDate);
}

export function updateDraftPercentComplete(
  draft: ActivityDraft,
  value: string,
  dataDate?: string | null,
): ActivityDraft {
  if (draft.is_milestone) {
    const percentComplete = parsePercent(value);
    const milestoneDate = getMilestoneDraftDate(draft) ?? "";
    return {
      ...draft,
      percent_complete: value,
      actual_finish_date:
        percentComplete >= 100
          ? draft.actual_finish_date || milestoneDate
          : draft.actual_finish_date,
      remaining_duration_days: "0",
    };
  }
  return updateScheduleStatusPercentComplete(draft, value, dataDate);
}

function getDraftStatusAnchorDate(draft: ActivityDraft, dataDate?: string | null) {
  return getScheduleStatusAnchorDate(draft, dataDate);
}

export function updateDraftRemainingDuration(
  draft: ActivityDraft,
  value: string,
  dataDate?: string | null,
): ActivityDraft {
  if (draft.is_milestone) return { ...draft, remaining_duration_days: "0" };
  return updateScheduleStatusRemainingDuration(draft, value, dataDate);
}

export function updateDraftForecastFinishDate(
  draft: ActivityDraft,
  value: string,
  dataDate?: string | null,
): ActivityDraft {
  if (draft.is_milestone) {
    return {
      ...draft,
      start_date: value,
      finish_date: value,
      forecast_start_date: value,
      forecast_finish_date: value,
      remaining_duration_days: "0",
    };
  }
  return updateScheduleStatusForecastFinishDate(draft, value, dataDate);
}

export function applyOpenDelayToDraftForecast(
  draft: ActivityDraft,
  openDelayDays: number,
  dataDate?: string | null,
): ActivityDraft {
  const delayDays = Math.max(0, Math.round(openDelayDays));
  if (delayDays <= 0) return draft;

  const baselineFinishMs = parseDateMs(draft.baseline_finish_date || draft.finish_date);
  const currentForecastFinishMs = parseDateMs(
    draft.forecast_finish_date || draft.baseline_finish_date || draft.finish_date,
  );
  const dataDateMs = parseDateMs(dataDate);
  const targetFinishMs =
    baselineFinishMs != null
      ? baselineFinishMs + delayDays * DAY_MS
      : currentForecastFinishMs != null
        ? currentForecastFinishMs + delayDays * DAY_MS
        : dataDateMs != null
          ? dataDateMs + Math.max(0, delayDays - 1) * DAY_MS
          : null;

  if (targetFinishMs == null) return draft;
  const currentOrTargetFinishMs =
    currentForecastFinishMs == null
      ? targetFinishMs
      : Math.max(currentForecastFinishMs, targetFinishMs);
  return updateDraftForecastFinishDate(draft, isoDateFromMs(currentOrTargetFinishMs), dataDate);
}

export function buildActivityUpdateImpact(draft: ActivityDraft, dataDate?: string | null) {
  const baselineFinish = draft.baseline_finish_date || draft.finish_date || null;
  const expectedFinish = draft.forecast_finish_date || baselineFinish;
  const baselineFinishMs = parseDateMs(baselineFinish);
  const expectedFinishMs = parseDateMs(expectedFinish);
  const slipDays =
    baselineFinishMs == null || expectedFinishMs == null
      ? null
      : Math.round((expectedFinishMs - baselineFinishMs) / DAY_MS);
  const percentComplete = parsePercent(draft.percent_complete);
  const remainingDuration = parseRemainingDuration(draft.remaining_duration_days);
  const statusAnchor = getDraftStatusAnchorDate(draft, dataDate);
  const isComplete = percentComplete >= 100 || Boolean(draft.actual_finish_date);
  const isMilestone = draft.is_milestone;
  const hasActualStartBasis = Boolean(draft.actual_start_date) || Boolean(draft.actual_finish_date);
  const finishTone = slipDays == null || slipDays <= 0 ? "default" : "danger";
  const slipTone =
    slipDays == null || slipDays === 0 ? "default" : slipDays > 0 ? "danger" : "success";
  return {
    baselineFinish: baselineFinish ? shortDate(baselineFinish) : "Set baseline",
    expectedFinish: expectedFinish ? shortDate(expectedFinish) : "Set forecast",
    finishTone,
    remainingValue: isMilestone
      ? "Milestone"
      : isComplete
        ? "Complete"
        : !hasActualStartBasis
          ? percentComplete > 0
            ? "Actual start"
            : "Not started"
          : remainingDuration == null
            ? "Missing"
            : String(remainingDuration),
    remainingBasis: isMilestone
      ? "zero-duration point"
      : isComplete
        ? "actual finish controls"
        : !hasActualStartBasis
          ? percentComplete > 0
            ? "set before remaining duration"
            : "current start / finish"
          : statusAnchor
            ? `from ${shortDate(statusAnchor)}`
            : "set data date",
    slipValue:
      slipDays == null
        ? "Set dates"
        : slipDays === 0
          ? "0d"
          : slipDays > 0
            ? `+${slipDays}d`
            : `${slipDays}d`,
    slipBasis:
      slipDays == null
        ? "baseline + expected finish"
        : slipDays === 0
          ? "on baseline"
          : slipDays > 0
            ? "late against baseline"
            : "early against baseline",
    slipTone,
  } as const;
}
