const DAY_MS = 24 * 60 * 60 * 1000;

export type ScheduleStatusDraftLike = {
  start_date: string;
  finish_date: string;
  baseline_start_date: string;
  forecast_start_date: string;
  forecast_finish_date: string;
  actual_start_date: string;
  actual_finish_date: string;
  remaining_duration_days: string;
  percent_complete: string | number;
};

export function parseSchedulePercent(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function parseScheduleRemainingDuration(value: string | number | null | undefined) {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(5000, Math.round(parsed)));
}

export function getScheduleStatusAnchorDate(
  draft: ScheduleStatusDraftLike,
  dataDate?: string | null,
) {
  const currentStart =
    draft.actual_start_date ||
    draft.forecast_start_date ||
    draft.baseline_start_date ||
    draft.start_date ||
    null;
  if (!dataDate) return currentStart;

  const percentComplete = parseSchedulePercent(draft.percent_complete);
  if (percentComplete > 0 || draft.actual_start_date) return dataDate;

  const dataDateMs = parseScheduleDateMs(dataDate);
  const currentStartMs = parseScheduleDateMs(currentStart);
  if (dataDateMs == null) return currentStart;
  if (currentStartMs == null) return dataDate;
  return isoDateFromMs(Math.max(dataDateMs, currentStartMs));
}

export function updateScheduleStatusRemainingDuration<TDraft extends ScheduleStatusDraftLike>(
  draft: TDraft,
  value: string,
  dataDate?: string | null,
): TDraft {
  const remainingDuration = parseScheduleRemainingDuration(value);
  const anchorMs = parseScheduleDateMs(getScheduleStatusAnchorDate(draft, dataDate));
  if (remainingDuration == null || anchorMs == null) {
    return { ...draft, remaining_duration_days: value };
  }
  const finishOffsetDays = Math.max(0, remainingDuration - 1);
  return {
    ...draft,
    remaining_duration_days: String(remainingDuration),
    forecast_finish_date: isoDateFromMs(anchorMs + finishOffsetDays * DAY_MS),
  };
}

export function updateScheduleStatusForecastFinishDate<TDraft extends ScheduleStatusDraftLike>(
  draft: TDraft,
  value: string,
  dataDate?: string | null,
): TDraft {
  const anchorMs = parseScheduleDateMs(getScheduleStatusAnchorDate(draft, dataDate));
  const finishMs = parseScheduleDateMs(value);
  if (anchorMs == null || finishMs == null || finishMs < anchorMs) {
    return { ...draft, forecast_finish_date: value };
  }
  const remainingDuration = Math.max(1, Math.round((finishMs - anchorMs) / DAY_MS) + 1);
  return {
    ...draft,
    forecast_finish_date: value,
    remaining_duration_days: String(remainingDuration),
  };
}

export function updateScheduleStatusActualStartDate<TDraft extends ScheduleStatusDraftLike>(
  draft: TDraft,
  value: string,
  dataDate?: string | null,
): TDraft {
  const next = { ...draft, actual_start_date: value };
  if (next.forecast_finish_date) {
    return updateScheduleStatusForecastFinishDate(next, next.forecast_finish_date, dataDate);
  }
  if (next.remaining_duration_days.trim()) {
    return updateScheduleStatusRemainingDuration(next, next.remaining_duration_days, dataDate);
  }
  return next;
}

export function updateScheduleStatusForecastStartDate<TDraft extends ScheduleStatusDraftLike>(
  draft: TDraft,
  value: string,
  dataDate?: string | null,
): TDraft {
  const next = { ...draft, forecast_start_date: value };
  if (next.remaining_duration_days.trim()) {
    return updateScheduleStatusRemainingDuration(next, next.remaining_duration_days, dataDate);
  }
  if (next.forecast_finish_date) {
    return updateScheduleStatusForecastFinishDate(next, next.forecast_finish_date, dataDate);
  }
  return next;
}

export function updateScheduleStatusPercentComplete<TDraft extends ScheduleStatusDraftLike>(
  draft: TDraft,
  value: string,
  dataDate?: string | null,
): TDraft {
  const next = { ...draft, percent_complete: value };
  const percentComplete = parseSchedulePercent(value);
  if (percentComplete >= 100) {
    return {
      ...next,
      remaining_duration_days: "0",
      actual_finish_date: next.actual_finish_date || next.forecast_finish_date || next.finish_date,
    };
  }
  if (next.forecast_finish_date) {
    return updateScheduleStatusForecastFinishDate(next, next.forecast_finish_date, dataDate);
  }
  if (next.remaining_duration_days.trim()) {
    return updateScheduleStatusRemainingDuration(next, next.remaining_duration_days, dataDate);
  }
  return next;
}

function parseScheduleDateMs(value?: string | null) {
  if (!value) return null;
  const ms = new Date(`${value}T00:00:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function isoDateFromMs(ms: number) {
  return new Date(ms).toISOString().slice(0, 10);
}
