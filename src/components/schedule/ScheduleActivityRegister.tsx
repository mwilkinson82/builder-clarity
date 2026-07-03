import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Trash2, Pencil, Check, ChevronsUpDown, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { type ScheduleActivityRow } from "@/lib/schedule.functions";
import {
  describeConstructLineDependencyToken,
  type ConstructLineDependencyToken,
  type ConstructLineRelationshipType,
} from "@/lib/constructline-cpm";
import {
  CONSTRUCTLINE_RELATIONSHIP_LABELS,
  CONSTRUCTLINE_RELATIONSHIP_TYPES,
  shortDate,
} from "./scheduleShared";
import { formatActivityLinks, parseActivityLinks } from "./scheduleActivityDraft";
import {
  type TimelineBounds,
  getActivityDurationDays,
  getActivityForecastFinish,
  getActivityForecastStart,
  parseDateMs,
  timelinePosition,
} from "./ScheduleSnapshotTimeline";

function LegacyActivityScheduleMatrixReference() {
  return null;
}

function LegacyActivityScheduleMatrix({
  grouped,
  bounds,
  dataDatePosition,
  onOpenActivity,
  onDeleteActivity,
}: {
  grouped: Array<{ division: string; activities: ScheduleActivityRow[] }>;
  bounds: TimelineBounds;
  dataDatePosition: number | null;
  onOpenActivity: (activity: ScheduleActivityRow) => void;
  onDeleteActivity: (id: string) => void;
}) {
  const totalActivities = grouped.reduce((sum, group) => sum + group.activities.length, 0);

  return (
    <div className="mt-5 min-w-0 overflow-hidden rounded-md border border-hairline bg-card">
      <div className="grid border-b border-hairline 2xl:grid-cols-[minmax(760px,1.05fr)_minmax(680px,0.95fr)]">
        <div className="flex flex-col gap-2 border-b border-hairline px-4 py-4 sm:flex-row sm:items-end sm:justify-between 2xl:border-b-0 2xl:border-r 2xl:border-hairline">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Activity register
            </div>
            <div className="mt-1 font-serif text-xl text-foreground">CPM activity table</div>
          </div>
          <div className="text-sm font-semibold tabular text-muted-foreground">
            {totalActivities} {totalActivities === 1 ? "activity" : "activities"}
          </div>
        </div>
        <div className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Gantt chart
            </div>
            <div className="mt-1 font-serif text-xl text-foreground">Schedule timeline</div>
            <div className="mt-1 text-sm text-muted-foreground">
              {shortDate(bounds.startLabel)} to {shortDate(bounds.endLabel)}
            </div>
          </div>
          <div className="flex flex-wrap gap-4 text-[12px] text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-5 rounded-full bg-accent/70" />
              Duration
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-5 rounded-full bg-success" />
              Complete
            </span>
          </div>
        </div>
      </div>

      <div className="hidden border-b border-hairline bg-muted/55 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground 2xl:grid 2xl:grid-cols-[minmax(760px,1.05fr)_minmax(680px,0.95fr)]">
        <div className="grid grid-cols-[64px_minmax(0,1.35fr)_104px_116px_58px_76px_52px] gap-3 border-r border-hairline px-4 py-3">
          <div>ID</div>
          <div>Activity</div>
          <div>Division</div>
          <div>Dates</div>
          <div>% done</div>
          <div>Logic</div>
          <div />
        </div>
        <div className="grid grid-cols-[172px_minmax(150px,1fr)_58px] gap-3 px-4 py-3">
          <div>Activity</div>
          <div>Timeline</div>
          <div className="text-right">Done</div>
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="px-6 py-10 text-center">
          <div className="font-serif text-xl text-foreground">No CPM activities yet.</div>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-muted-foreground">
            Add the first activity to start building the working schedule. This is where the PM will
            eventually manage activity IDs, dates, progress, divisions, and logic ties.
          </p>
        </div>
      ) : (
        <div className="max-h-[clamp(420px,calc(100vh-310px),760px)] overflow-y-auto overscroll-contain">
          {grouped.map((group) => (
            <div key={group.division}>
              <div className="grid border-b border-hairline bg-muted/35 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground 2xl:grid-cols-[minmax(760px,1.05fr)_minmax(680px,0.95fr)]">
                <div className="px-4 py-2 2xl:border-r 2xl:border-hairline">
                  {group.division} · {group.activities.length} activities
                </div>
                <div className="hidden px-4 py-2 2xl:block">{group.division}</div>
              </div>
              {group.activities.map((activity) => (
                <div
                  key={activity.id}
                  className="grid border-b border-hairline last:border-b-0 2xl:grid-cols-[minmax(760px,1.05fr)_minmax(680px,0.95fr)]"
                >
                  <ActivityRegisterRow
                    activity={activity}
                    onOpen={() => onOpenActivity(activity)}
                    onDelete={() => onDeleteActivity(activity.id)}
                  />
                  <ActivityGanttRow
                    activity={activity}
                    bounds={bounds}
                    dataDatePosition={dataDatePosition}
                    onOpen={() => onOpenActivity(activity)}
                  />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="flex justify-between border-t border-hairline px-4 py-2 text-[11px] text-muted-foreground">
        <span>{shortDate(bounds.startLabel)}</span>
        <span>{shortDate(bounds.endLabel)}</span>
      </div>
    </div>
  );
}

function ActivityRegisterRow({
  activity,
  onOpen,
  onDelete,
}: {
  activity: ScheduleActivityRow;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const duration = getActivityDurationDays(activity);
  const logicCount =
    activity.predecessor_activity_ids.length + activity.successor_activity_ids.length;
  const percent = Math.max(0, Math.min(100, activity.percent_complete));

  return (
    <div
      role="button"
      tabIndex={0}
      className="grid h-full min-h-[92px] cursor-pointer gap-3 px-4 py-3 transition-colors hover:bg-muted/45 lg:grid-cols-[64px_minmax(0,1.35fr)_104px_116px_58px_76px_52px] lg:items-center 2xl:border-r 2xl:border-hairline"
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="font-semibold tabular text-foreground">{activity.activity_id || "No ID"}</div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-foreground">{activity.name}</div>
        {activity.notes && (
          <div className="mt-0.5 line-clamp-2 text-xs leading-snug text-muted-foreground">
            {activity.notes}
          </div>
        )}
      </div>
      <div className="truncate text-xs font-semibold text-muted-foreground">
        {activity.division || "General"}
      </div>
      <div className="text-xs text-muted-foreground">
        <div className="font-semibold tabular text-foreground">
          {shortDate(getActivityForecastStart(activity))} →{" "}
          {shortDate(getActivityForecastFinish(activity))}
        </div>
        <div className="mt-0.5 tabular">
          {duration == null ? "No duration" : `${duration} day${duration === 1 ? "" : "s"}`}
        </div>
      </div>
      <div className="text-sm font-semibold tabular text-foreground">
        <div>{percent}%</div>
        <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${percent >= 100 ? "bg-success" : "bg-accent"}`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>
      <div className="min-w-0 text-xs text-muted-foreground">
        <div className="font-semibold tabular text-foreground">{logicCount} ties</div>
        <div className="mt-1 hidden flex-wrap gap-1 xl:flex">
          <ActivityIdPills ids={activity.predecessor_activity_ids.slice(0, 2)} emptyLabel="" />
          <ActivityIdPills ids={activity.successor_activity_ids.slice(0, 2)} emptyLabel="" />
        </div>
      </div>
      <div className="flex justify-end gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          onClick={(event) => {
            event.stopPropagation();
            onOpen();
          }}
          aria-label={`Open activity ${activity.activity_id || activity.name}`}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-danger"
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          aria-label={`Delete activity ${activity.activity_id || activity.name}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

function ActivityLogicSummary({ activity }: { activity: ScheduleActivityRow }) {
  const duration = getActivityDurationDays(activity);
  return (
    <div className="rounded-md border border-hairline bg-surface p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        Logic summary
      </div>
      <div className="grid gap-2 text-sm sm:grid-cols-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Duration
          </div>
          <div className="mt-1 font-semibold tabular text-foreground">
            {duration == null ? "No dates" : `${duration} day${duration === 1 ? "" : "s"}`}
          </div>
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Predecessors
          </div>
          <ActivityIdPills ids={activity.predecessor_activity_ids} emptyLabel="None" />
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Successors
          </div>
          <ActivityIdPills ids={activity.successor_activity_ids} emptyLabel="None" />
        </div>
      </div>
    </div>
  );
}

export function ActivityIdPills({ ids, emptyLabel }: { ids: string[]; emptyLabel: string }) {
  if (ids.length === 0) {
    if (!emptyLabel) return null;
    return <div className="mt-1 text-sm font-semibold text-muted-foreground">{emptyLabel}</div>;
  }
  return (
    <div className="mt-1 flex flex-wrap gap-1">
      {ids.map((id) => (
        <span
          key={id}
          className="max-w-full break-all rounded border border-hairline bg-card px-1.5 py-0.5 text-[11px] font-semibold tabular text-foreground"
        >
          {describeConstructLineDependencyToken(id)}
        </span>
      ))}
    </div>
  );
}

export function ActivityDependencyPicker({
  label,
  emptyLabel,
  selectedIds,
  activities,
  blockedActivityId,
  blockedIds = [],
  onChange,
}: {
  label: string;
  emptyLabel: string;
  selectedIds: string;
  activities: ScheduleActivityRow[];
  blockedActivityId?: string;
  blockedIds?: string[];
  onChange: (value: string) => void;
}) {
  const selectedLinks = parseActivityLinks(selectedIds);
  const selectedActivityIds = selectedLinks.map((link) => link.activityId);
  const selectedIdSet = new Set(selectedActivityIds);
  const blockedIdSet = new Set(
    [blockedActivityId, ...blockedIds].map((id) => id?.trim()).filter(Boolean),
  );
  const activitiesById = new Map(
    activities
      .map((activity) => [activity.activity_id.trim(), activity] as const)
      .filter(([activityId]) => activityId.length > 0),
  );
  const options = activities.filter((activity) => {
    const activityId = activity.activity_id.trim();
    return activityId.length > 0 && !blockedIdSet.has(activityId);
  });

  const toggleActivity = (activityId: string) => {
    const nextLinks = selectedIdSet.has(activityId)
      ? selectedLinks.filter((link) => link.activityId !== activityId)
      : [...selectedLinks, { activityId, relationshipType: "FS" as const, lagDays: 0 }];
    onChange(formatActivityLinks(nextLinks));
  };
  const removeActivity = (activityId: string) => {
    onChange(formatActivityLinks(selectedLinks.filter((link) => link.activityId !== activityId)));
  };
  const updateActivityLink = (
    activityId: string,
    patch: Partial<Pick<ConstructLineDependencyToken, "relationshipType" | "lagDays">>,
  ) => {
    onChange(
      formatActivityLinks(
        selectedLinks.map((link) =>
          link.activityId === activityId
            ? {
                ...link,
                ...patch,
                lagDays: patch.lagDays ?? link.lagDays,
                relationshipType: patch.relationshipType ?? link.relationshipType,
              }
            : link,
        ),
      ),
    );
  };

  return (
    <div className="min-w-0 space-y-2">
      <div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Pick activities from the schedule, then set relationship type and lag days.
        </div>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-10 w-full justify-between gap-2 px-3 py-2 text-left"
          >
            <span className="min-w-0 truncate text-sm font-medium">
              {selectedActivityIds.length > 0
                ? `${selectedActivityIds.length} selected`
                : emptyLabel}
            </span>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
        >
          <Command>
            <CommandInput placeholder={`Search ${label.toLowerCase()}...`} />
            <CommandList>
              <CommandEmpty>No activities found.</CommandEmpty>
              <CommandGroup>
                {options.map((activity) => {
                  const activityId = activity.activity_id.trim();
                  const isSelected = selectedIdSet.has(activityId);
                  return (
                    <CommandItem
                      key={activity.id}
                      value={`${activityId} ${activity.name} ${activity.division}`}
                      onSelect={() => toggleActivity(activityId)}
                      className="items-start gap-3"
                    >
                      <Check
                        className={cn(
                          "mt-0.5 h-4 w-4 text-success",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 font-semibold tabular text-foreground">
                            {activityId}
                          </span>
                          <span className="truncate font-medium text-foreground">
                            {activity.name}
                          </span>
                        </div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {activity.division || "General"} ·{" "}
                          {shortDate(getActivityForecastStart(activity))} to{" "}
                          {shortDate(getActivityForecastFinish(activity))}
                        </div>
                      </div>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selectedLinks.length > 0 && (
        <div className="grid gap-2">
          {selectedLinks.map((link) => {
            const activityId = link.activityId;
            const activity = activitiesById.get(activityId);
            return (
              <div
                key={activityId}
                className="grid min-w-0 gap-3 rounded-md border border-hairline bg-card p-3 md:grid-cols-[minmax(0,1fr)_minmax(132px,160px)_96px_32px] md:items-end"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="shrink-0 text-xs font-semibold tabular text-foreground">
                      {activityId}
                    </span>
                    <span className="min-w-0 break-words text-sm font-medium text-foreground">
                      {activity?.name ?? "Activity not found"}
                    </span>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {activity
                      ? `${activity.division || "General"} · ${shortDate(
                          getActivityForecastStart(activity),
                        )} to ${shortDate(getActivityForecastFinish(activity))}`
                      : "This saved activity ID is not currently in the schedule list."}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Relationship
                  </div>
                  <Select
                    value={link.relationshipType}
                    onValueChange={(relationshipType) =>
                      updateActivityLink(activityId, {
                        relationshipType: relationshipType as ConstructLineRelationshipType,
                      })
                    }
                  >
                    <SelectTrigger
                      className="h-9 min-w-0 px-2 text-xs font-semibold"
                      aria-label={`${activityId} relationship type`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CONSTRUCTLINE_RELATIONSHIP_TYPES.map((type) => (
                        <SelectItem key={type} value={type}>
                          <span className="font-semibold tabular">{type}</span>
                          <span className="ml-2 text-muted-foreground">
                            {CONSTRUCTLINE_RELATIONSHIP_LABELS[type]}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="min-w-0">
                  <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                    Lag / lead
                  </div>
                  <div className="relative min-w-0">
                    <Input
                      type="number"
                      min={-999}
                      max={999}
                      value={link.lagDays}
                      onChange={(event) =>
                        updateActivityLink(activityId, { lagDays: Number(event.target.value) })
                      }
                      title="Lag days. Use negative values for lead."
                      className="h-9 min-w-0 pr-6 text-xs font-semibold tabular"
                      aria-label={`${activityId} lag days`}
                    />
                    <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-semibold text-muted-foreground">
                      d
                    </span>
                  </div>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 justify-self-end text-muted-foreground hover:text-danger lg:justify-self-center"
                  onClick={() => removeActivity(activityId)}
                  aria-label={`Remove ${activityId}`}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ActivityGanttRow({
  activity,
  bounds,
  dataDatePosition,
  onOpen,
}: {
  activity: ScheduleActivityRow;
  bounds: TimelineBounds;
  dataDatePosition: number | null;
  onOpen: () => void;
}) {
  const start = timelinePosition(getActivityForecastStart(activity), bounds);
  const finish = timelinePosition(getActivityForecastFinish(activity), bounds);
  const left = Math.min(start ?? finish ?? 0, finish ?? start ?? 0);
  const width =
    start == null && finish == null
      ? 0
      : Math.max(1.5, Math.abs((finish ?? start ?? 0) - (start ?? finish ?? 0)));
  const percent = Math.max(0, Math.min(100, activity.percent_complete));
  const dataDateMs = parseDateMs(new Date().toISOString().slice(0, 10));
  const finishMs = parseDateMs(getActivityForecastFinish(activity));
  const isLate = percent < 100 && finishMs != null && dataDateMs != null && finishMs < dataDateMs;
  return (
    <button
      type="button"
      className="grid h-full min-h-[92px] w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/40 lg:grid-cols-[172px_minmax(150px,1fr)_58px] lg:items-center"
      onClick={onOpen}
    >
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold tabular text-foreground">
          {activity.activity_id || "No ID"}
        </div>
        <div className="mt-1 truncate text-xs text-muted-foreground">{activity.name}</div>
      </div>
      <div className="relative h-10 rounded-md bg-muted">
        {dataDatePosition != null && (
          <div
            className="absolute inset-y-1 z-10 w-px bg-foreground/30"
            style={{ left: `${dataDatePosition}%` }}
          />
        )}
        {width > 0 && (
          <div
            className={`absolute top-1/2 h-3 -translate-y-1/2 overflow-hidden rounded-full ${
              isLate ? "bg-danger/35" : "bg-accent/35"
            }`}
            style={{ left: `${left}%`, width: `${width}%` }}
          >
            <div
              className={`h-full rounded-full ${isLate ? "bg-danger" : "bg-success"}`}
              style={{ width: `${percent}%` }}
            />
          </div>
        )}
      </div>
      <div
        className={`text-right text-sm font-semibold tabular ${isLate ? "text-danger" : "text-muted-foreground"}`}
      >
        {percent}%
      </div>
    </button>
  );
}
