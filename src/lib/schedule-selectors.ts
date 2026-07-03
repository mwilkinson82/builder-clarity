// One number everywhere: canonical schedule selectors. Every surface that
// shows a logic-tie count, a completion forecast, or a schedule variance
// derives it from here — no surface computes these independently.
// Pure module (no env-dependent imports) so node-based smoke tests can load it.
import type { ScheduleActivityRow, ScheduleUpdateRow } from "@/lib/schedule.functions";
import { parseConstructLineDependencyToken } from "./constructline-cpm.ts";
import { computeScheduleVarianceWeeks } from "./ior.ts";

// Canonical logic-tie semantics: one tie is one unique directed relationship
// predecessor -> successor (with its relationship type and lag). Both sides of
// a reciprocal pair describe the same tie, so it counts once. Ties pointing at
// activity IDs that do not exist in the schedule do not count.
export function selectCanonicalLogicTieCount(activities: ScheduleActivityRow[]): number {
  const knownIds = new Set(
    activities.map((activity) => activity.activity_id.trim()).filter(Boolean),
  );
  const ties = new Set<string>();
  for (const activity of activities) {
    const selfId = activity.activity_id.trim();
    if (!selfId) continue;
    for (const raw of activity.predecessor_activity_ids) {
      const token = parseConstructLineDependencyToken(raw);
      if (!knownIds.has(token.activityId)) continue;
      ties.add(`${token.activityId}->${selfId}|${token.relationshipType}|${token.lagDays}`);
    }
    for (const raw of activity.successor_activity_ids) {
      const token = parseConstructLineDependencyToken(raw);
      if (!knownIds.has(token.activityId)) continue;
      ties.add(`${selfId}->${token.activityId}|${token.relationshipType}|${token.lagDays}`);
    }
  }
  return ties.size;
}

// The latest saved schedule update is the single source of truth for forecast,
// variance, and movement. Robust to unsorted input.
export function selectLatestScheduleUpdate(updates: ScheduleUpdateRow[]): ScheduleUpdateRow | null {
  let latest: ScheduleUpdateRow | null = null;
  for (const update of updates) {
    if (!latest || update.update_number > latest.update_number) latest = update;
  }
  return latest;
}

// Completion forecast of record: the latest saved update's forecast. Before
// the first saved update, fall back to the project-level forecast field.
export function selectSavedScheduleForecast(
  updates: ScheduleUpdateRow[],
  projectForecastCompletionDate: string | null,
): string | null {
  return (
    selectLatestScheduleUpdate(updates)?.forecast_completion_date ?? projectForecastCompletionDate
  );
}

// Schedule variance of record (weeks vs baseline), from the latest saved
// update. Before the first saved update, derive from project-level fields.
export function selectSavedScheduleVarianceWeeks(
  updates: ScheduleUpdateRow[],
  projectBaselineCompletionDate: string | null,
  projectForecastCompletionDate: string | null,
): number | null {
  const latest = selectLatestScheduleUpdate(updates);
  if (latest) return latest.variance_weeks;
  return computeScheduleVarianceWeeks(projectBaselineCompletionDate, projectForecastCompletionDate);
}

// Movement of record (weeks vs the prior update), from the latest saved
// update. Before the first saved update, derive from the review fallback.
export function selectSavedScheduleMovementWeeks(
  updates: ScheduleUpdateRow[],
  fallback: { lastReviewForecast?: string | null; currentForecast?: string | null } = {},
): number | null {
  const latest = selectLatestScheduleUpdate(updates);
  if (latest) return latest.movement_weeks;
  return computeScheduleVarianceWeeks(
    fallback.lastReviewForecast ?? null,
    fallback.currentForecast ?? null,
  );
}

// Live CPM state may run ahead of the saved record between snapshots. Show it,
// but label it as the unsaved forecast whenever it differs from the record.
export function selectCpmForecastStatus({
  savedForecast,
  liveCpmForecast,
}: {
  savedForecast: string | null;
  liveCpmForecast: string | null;
}): { forecastOfRecord: string | null; unsavedForecast: string | null; isUnsaved: boolean } {
  const isUnsaved = Boolean(liveCpmForecast) && liveCpmForecast !== savedForecast;
  return {
    forecastOfRecord: savedForecast,
    unsavedForecast: isUnsaved ? liveCpmForecast : null,
    isUnsaved,
  };
}
