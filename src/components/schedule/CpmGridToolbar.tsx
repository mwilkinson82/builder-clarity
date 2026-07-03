import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Plus,
  ClipboardList,
  CheckCircle2,
  Printer,
  GitBranch,
  Layers,
  Maximize2,
  ZoomIn,
  ZoomOut,
  Diamond,
  CalendarDays,
  ListTree,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { type ScheduleCpmTemplateRow } from "@/lib/schedule.functions";
import {
  type BrowserCpmTemplate,
  CONSTRUCTLINE_ZOOM_LEVELS,
  SCHEDULE_GRID_VIEW_OPTIONS,
  type ScheduleActivityOrder,
  type ScheduleGridView,
  shortDate,
} from "./scheduleShared";

export function CpmGridToolbar({
  compact = false,
  scheduleView,
  onScheduleViewChange,
  activityOrder,
  onActivityOrderChange,
  dayPx,
  onZoomChange,
  showLogicLines,
  onToggleLogicLines,
  showBaselineBars,
  onToggleBaselineBars,
  onManageWbs,
  onExpand,
  onSeedActivities,
  canSeedActivities,
  isSeedingActivities,
  onPrint,
  onToggleActivityDraft,
  isActivityDraftOpen,
  activityDraftMode,
  onFocusActivityDraft,
  onAddMilestone,
  dataDateDraft,
  latestDataDate,
  isSavingDataDate,
  onDataDateChange,
  onSaveDataDate,
  readinessWarningCount,
  isReadinessWarningArmed,
  templateName,
  onTemplateNameChange,
  templates,
  selectedTemplateId,
  onSelectedTemplateChange,
  isTemplateLoading,
  isSavingTemplate,
  isApplyingTemplate,
  onSaveTemplate,
  onApplyTemplate,
}: {
  compact?: boolean;
  scheduleView: ScheduleGridView;
  onScheduleViewChange: (value: ScheduleGridView) => void;
  activityOrder: ScheduleActivityOrder;
  onActivityOrderChange: (value: ScheduleActivityOrder) => void;
  dayPx: number;
  onZoomChange: (dayPx: number) => void;
  showLogicLines: boolean;
  onToggleLogicLines: () => void;
  showBaselineBars: boolean;
  onToggleBaselineBars: () => void;
  onManageWbs: () => void;
  onExpand: () => void;
  onSeedActivities: () => void;
  canSeedActivities: boolean;
  isSeedingActivities: boolean;
  onPrint: () => void;
  onToggleActivityDraft: () => void;
  isActivityDraftOpen: boolean;
  activityDraftMode: "activity" | "milestone" | null;
  onFocusActivityDraft: () => void;
  onAddMilestone: () => void;
  dataDateDraft: string;
  latestDataDate: string | null;
  isSavingDataDate: boolean;
  onDataDateChange: (value: string) => void;
  onSaveDataDate: () => void;
  readinessWarningCount: number;
  isReadinessWarningArmed: boolean;
  templateName: string;
  onTemplateNameChange: (value: string) => void;
  templates: Array<ScheduleCpmTemplateRow | BrowserCpmTemplate>;
  selectedTemplateId: string;
  onSelectedTemplateChange: (value: string) => void;
  isTemplateLoading: boolean;
  isSavingTemplate: boolean;
  isApplyingTemplate: boolean;
  onSaveTemplate: () => void;
  onApplyTemplate: () => void;
}) {
  const [showTemplateTools, setShowTemplateTools] = useState(false);

  return (
    <div className={cn("flex w-full min-w-0 flex-col", compact ? "gap-2" : "gap-3")}>
      <div
        className={cn(
          "grid min-w-0 gap-2 xl:grid-cols-[minmax(280px,0.82fr)_minmax(0,1.8fr)_minmax(260px,0.78fr)]",
          compact && "gap-1.5",
        )}
      >
        <CpmToolbarGroup label="Schedule snapshot" compact={compact}>
          <CpmDataDateControl
            value={dataDateDraft}
            savedValue={latestDataDate}
            isSaving={isSavingDataDate}
            onChange={onDataDateChange}
            onSave={onSaveDataDate}
            className="w-full"
            readinessWarningCount={readinessWarningCount}
            isReadinessWarningArmed={isReadinessWarningArmed}
            embedded
          />
        </CpmToolbarGroup>
        <CpmToolbarGroup label="View filters" compact={compact}>
          <ScheduleViewControls value={scheduleView} onChange={onScheduleViewChange} />
        </CpmToolbarGroup>
        <CpmToolbarGroup label="Sort and WBS" compact={compact}>
          <ScheduleOrderControls value={activityOrder} onChange={onActivityOrderChange} />
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 whitespace-nowrap"
            onClick={onManageWbs}
          >
            <ListTree className="h-4 w-4" />
            WBS / areas
          </Button>
        </CpmToolbarGroup>
      </div>

      <div
        className={cn(
          "grid min-w-0 gap-2 xl:grid-cols-[minmax(0,0.72fr)_minmax(520px,1.28fr)]",
          compact && "gap-1.5",
        )}
      >
        <CpmToolbarGroup label="Scale and logic" compact={compact}>
          <ScheduleZoomControls dayPx={dayPx} onChange={onZoomChange} />
          <Button
            type="button"
            variant={showLogicLines ? "default" : "outline"}
            className="h-9 gap-2 whitespace-nowrap"
            aria-pressed={showLogicLines}
            onClick={onToggleLogicLines}
          >
            <GitBranch className="h-4 w-4" />
            Logic lines
          </Button>
          <Button
            type="button"
            variant={showBaselineBars ? "default" : "outline"}
            className="h-9 gap-2 whitespace-nowrap"
            aria-pressed={showBaselineBars}
            onClick={onToggleBaselineBars}
          >
            <Layers className="h-4 w-4" />
            Baseline
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 whitespace-nowrap"
            onClick={onExpand}
          >
            <Maximize2 className="h-4 w-4" />
            Expand
          </Button>
        </CpmToolbarGroup>
        <CpmToolbarGroup label="Schedule actions" compact={compact}>
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 whitespace-nowrap"
            disabled={!canSeedActivities || isSeedingActivities}
            onClick={onSeedActivities}
          >
            <ClipboardList className="h-4 w-4" />
            {isSeedingActivities ? "Building..." : "Build from milestones"}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 whitespace-nowrap"
            title="Print optimized for Tabloid / 11 x 17 landscape"
            onClick={onPrint}
          >
            <Printer className="h-4 w-4" />
            Print 11x17
          </Button>
          <Button
            type="button"
            variant={showTemplateTools ? "default" : "outline"}
            className="h-9 gap-2 whitespace-nowrap"
            aria-pressed={showTemplateTools}
            onClick={() => setShowTemplateTools((visible) => !visible)}
          >
            <ClipboardList className="h-4 w-4" />
            Templates
          </Button>
          <Button
            type="button"
            variant={activityDraftMode === "activity" ? "default" : "outline"}
            className="h-9 gap-2 whitespace-nowrap"
            onClick={onToggleActivityDraft}
          >
            <Plus className="h-4 w-4" />
            {activityDraftMode === "activity"
              ? "Activity form open"
              : isActivityDraftOpen
                ? "Close form"
                : "Add activity"}
          </Button>
          <Button
            type="button"
            variant={activityDraftMode === "milestone" ? "default" : "outline"}
            className="h-9 gap-2 whitespace-nowrap"
            onClick={onAddMilestone}
          >
            <Diamond className="h-4 w-4" />
            {activityDraftMode === "milestone" ? "Milestone form open" : "Add milestone"}
          </Button>
        </CpmToolbarGroup>
      </div>

      {activityDraftMode && (
        <div className="flex flex-col gap-2 rounded-md border border-accent/20 bg-accent/10 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 text-muted-foreground">
            <span className="font-semibold text-foreground">
              {activityDraftMode === "milestone"
                ? "Milestone form is open."
                : "Activity form is open."}
            </span>{" "}
            Finish the form below the toolbar, then save it into the CPM table.
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-8 w-fit shrink-0"
            onClick={onFocusActivityDraft}
          >
            Jump to form
          </Button>
        </div>
      )}

      {showTemplateTools && (
        <CpmToolbarGroup label="Templates" compact={compact}>
          <Input
            value={templateName}
            onChange={(event) => onTemplateNameChange(event.target.value)}
            className="h-9 w-[min(100%,280px)] min-w-[220px] bg-card"
            placeholder="Template name"
            disabled={isSavingTemplate}
          />
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 whitespace-nowrap"
            disabled={!templateName.trim() || isSavingTemplate}
            onClick={onSaveTemplate}
          >
            <ClipboardList className="h-4 w-4" />
            {isSavingTemplate ? "Saving..." : "Save current CPM as template"}
          </Button>
          <Select
            value={selectedTemplateId}
            onValueChange={onSelectedTemplateChange}
            disabled={isTemplateLoading || templates.length === 0 || isApplyingTemplate}
          >
            <SelectTrigger className="h-9 w-[min(100%,260px)] min-w-[220px] bg-card">
              <SelectValue
                placeholder={isTemplateLoading ? "Loading templates" : "Choose template"}
              />
            </SelectTrigger>
            <SelectContent>
              {templates.map((template) => (
                <SelectItem key={template.id} value={template.id}>
                  {template.name} · {template.activity_count} activities
                  {"source" in template ? " · browser" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 whitespace-nowrap"
            disabled={!selectedTemplateId || isApplyingTemplate || templates.length === 0}
            onClick={onApplyTemplate}
          >
            <Plus className="h-4 w-4" />
            {isApplyingTemplate ? "Applying..." : "Use template"}
          </Button>
        </CpmToolbarGroup>
      )}
    </div>
  );
}

function CpmToolbarGroup({
  label,
  children,
  className,
  compact = false,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "min-w-0 rounded-md border border-hairline bg-surface",
        compact ? "px-2 py-1.5" : "px-2.5 py-2",
        className,
      )}
    >
      <div
        className={cn(
          "text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground",
          compact ? "mb-1" : "mb-1.5",
        )}
      >
        {label}
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

export function CpmDataDateControl({
  value,
  savedValue,
  isSaving,
  onChange,
  onSave,
  readinessWarningCount = 0,
  isReadinessWarningArmed = false,
  className,
  embedded = false,
}: {
  value: string;
  savedValue: string | null;
  isSaving: boolean;
  onChange: (value: string) => void;
  onSave: () => void;
  readinessWarningCount?: number;
  isReadinessWarningArmed?: boolean;
  className?: string;
  embedded?: boolean;
}) {
  const isDirty = value !== (savedValue ?? "");
  const hasReadinessWarning = isDirty && readinessWarningCount > 0;
  const hasSameDateReadinessWarning = !isDirty && readinessWarningCount > 0;
  const saveButtonLabel = isSaving
    ? "Saving..."
    : (hasReadinessWarning || hasSameDateReadinessWarning) && !isReadinessWarningArmed
      ? "Review gaps"
      : "Save snapshot";
  return (
    <div
      className={cn(
        "flex min-h-9 flex-wrap items-center gap-2",
        !embedded && "rounded-md border border-hairline bg-card px-2 py-1",
        className,
      )}
    >
      <div className="flex min-w-[120px] flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5" />
          Set data date
        </div>
        <div className="text-[11px] leading-tight text-muted-foreground">Runs the update view</div>
      </div>
      <Input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-[148px] bg-surface px-2 text-xs tabular"
        aria-label="Schedule data date"
      />
      <Button
        type="button"
        size="sm"
        variant={isDirty ? "default" : "outline"}
        className="h-8 gap-1.5 whitespace-nowrap px-2.5"
        disabled={!value || isSaving}
        onClick={onSave}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        {saveButtonLabel}
      </Button>
      <div className="basis-full text-[11px] text-muted-foreground sm:basis-auto">
        {isReadinessWarningArmed
          ? "Status gaps acknowledged. Click Save snapshot to save anyway."
          : hasReadinessWarning || hasSameDateReadinessWarning
            ? `${readinessWarningCount} open ${
                readinessWarningCount === 1 ? "row needs" : "rows need"
              } status before this snapshot is clean.`
            : isDirty
              ? "Unsaved data date is driving the CPM view. Save the snapshot after status review."
              : savedValue
                ? `Snapshot saved ${shortDate(savedValue)}. Save again after activity changes.`
                : "Not set"}
      </div>
    </div>
  );
}

export function ScheduleZoomControls({
  dayPx,
  onChange,
}: {
  dayPx: number;
  onChange: (dayPx: number) => void;
}) {
  const isPresetScale = CONSTRUCTLINE_ZOOM_LEVELS.some((level) => level.dayPx === dayPx);
  return (
    <div className="flex min-w-0 items-center overflow-hidden rounded-md border border-hairline bg-card">
      {CONSTRUCTLINE_ZOOM_LEVELS.map((level) => (
        <button
          key={level.label}
          type="button"
          aria-pressed={dayPx === level.dayPx}
          className={cn(
            "h-9 border-r border-hairline px-3 text-xs font-semibold text-muted-foreground hover:bg-muted/60",
            dayPx === level.dayPx && "bg-foreground text-background hover:bg-foreground",
          )}
          onClick={() => onChange(level.dayPx)}
        >
          <span className="inline-flex items-center gap-1.5">
            {level.label === "Fit" && <ZoomOut className="h-3.5 w-3.5" />}
            {level.label === "Day" && <ZoomIn className="h-3.5 w-3.5" />}
            {level.label}
          </span>
        </button>
      ))}
      {!isPresetScale && (
        <span className="px-2 text-[11px] font-semibold tabular text-muted-foreground">
          {dayPx.toFixed(1)} px/day
        </span>
      )}
    </div>
  );
}

export function ScheduleViewControls({
  value,
  onChange,
}: {
  value: ScheduleGridView;
  onChange: (value: ScheduleGridView) => void;
}) {
  return (
    <div className="flex max-w-full overflow-x-auto rounded-md border border-hairline bg-card">
      {SCHEDULE_GRID_VIEW_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={cn(
            "h-9 whitespace-nowrap border-r border-hairline px-3 text-xs font-semibold text-muted-foreground last:border-r-0 hover:bg-muted/60",
            value === option.value && "bg-foreground text-background hover:bg-foreground",
          )}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function ScheduleOrderControls({
  value,
  onChange,
}: {
  value: ScheduleActivityOrder;
  onChange: (value: ScheduleActivityOrder) => void;
}) {
  const options: Array<{
    value: ScheduleActivityOrder;
    label: string;
    icon: typeof CalendarDays;
  }> = [
    { value: "start", label: "Start date", icon: CalendarDays },
    { value: "wbs", label: "WBS order", icon: ListTree },
  ];

  return (
    <div className="flex overflow-hidden rounded-md border border-hairline bg-card">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            className={cn(
              "h-9 border-r border-hairline px-3 text-xs font-semibold text-muted-foreground last:border-r-0 hover:bg-muted/60",
              value === option.value && "bg-foreground text-background hover:bg-foreground",
            )}
            onClick={() => onChange(option.value)}
          >
            <span className="inline-flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5" />
              {option.label}
            </span>
          </button>
        );
      })}
    </div>
  );
}
