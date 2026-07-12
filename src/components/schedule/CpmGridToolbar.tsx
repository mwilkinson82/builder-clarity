import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  ChevronDown,
  FileSpreadsheet,
  GitBranch,
  Layers,
  Maximize2,
  Upload,
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

// Mono status chip for the CPM command bar (house v2: mono label + tabular value
// in a hairline pill; semantic tones only).
export function CpmStatusChip({
  label,
  value,
  tone = "default",
  title,
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning" | "danger";
  title?: string;
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-hairline bg-card px-2.5 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.08em]",
        toneClass,
      )}
      title={title}
    >
      {label}
      <b className="tabular">{value}</b>
    </span>
  );
}

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
  onImportSchedule,
  onBuildFromSov,
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
  statusChips,
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
  onImportSchedule: () => void;
  onBuildFromSov: () => void;
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
  statusChips?: ReactNode;
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
    <div className="w-full min-w-0 rounded-xl border border-hairline bg-card print:hidden">
      {/* Row 1 — data-date snapshot, view filters, and CPM status chips. */}
      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 px-3 lg:px-4",
          compact ? "py-2" : "py-2.5",
        )}
      >
        <div aria-label="Schedule snapshot" className="flex min-w-0 flex-wrap items-center">
          <CpmDataDateControl
            value={dataDateDraft}
            savedValue={latestDataDate}
            isSaving={isSavingDataDate}
            onChange={onDataDateChange}
            onSave={onSaveDataDate}
            readinessWarningCount={readinessWarningCount}
            isReadinessWarningArmed={isReadinessWarningArmed}
            embedded
          />
        </div>
        <span className="hidden h-5 w-px shrink-0 bg-hairline xl:block" aria-hidden="true" />
        <ScheduleViewControls value={scheduleView} onChange={onScheduleViewChange} />
        {statusChips && (
          <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
            {statusChips}
          </div>
        )}
      </div>

      {/* Row 2 — scale + logic toggles + sort/WBS, with row actions on the right. */}
      <div
        className={cn(
          "flex min-w-0 flex-wrap items-center gap-2 border-t border-hairline px-3 lg:px-4",
          compact ? "py-2" : "py-2.5",
        )}
      >
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
        <div
          aria-label="Schedule actions"
          className="ml-auto flex min-w-0 flex-wrap items-center gap-2"
        >
          <Button
            type="button"
            className="h-9 gap-2 whitespace-nowrap"
            aria-pressed={activityDraftMode === "activity"}
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-9 gap-1.5 whitespace-nowrap"
                disabled={isSeedingActivities}
              >
                <Upload className="h-4 w-4" />
                {isSeedingActivities ? "Building..." : "Import / Build"}
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem
                disabled={!canSeedActivities || isSeedingActivities}
                onSelect={() => onSeedActivities()}
              >
                <ClipboardList className="mr-2 h-4 w-4" />
                Build from milestones
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isSeedingActivities}
                title="Bring in a schedule you already have in Excel or CSV"
                onSelect={() => onImportSchedule()}
              >
                <Upload className="mr-2 h-4 w-4" />
                Import schedule
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={isSeedingActivities}
                title="Propose one activity per schedule-of-values line"
                onSelect={() => onBuildFromSov()}
              >
                <FileSpreadsheet className="mr-2 h-4 w-4" />
                Build from SOV
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={showTemplateTools}
                aria-pressed={showTemplateTools}
                onCheckedChange={(checked) => setShowTemplateTools(checked === true)}
              >
                Templates
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-2 whitespace-nowrap border-foreground/50 font-semibold"
            onClick={onExpand}
          >
            <Maximize2 className="h-4 w-4" />
            Expand
          </Button>
        </div>
      </div>

      {activityDraftMode && (
        <div className="flex flex-col gap-2 border-t border-hairline bg-accent/10 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between lg:px-4">
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
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-t border-hairline px-3 py-2.5 lg:px-4">
          <span className="eyebrow">Templates</span>
          <Input
            value={templateName}
            onChange={(event) => onTemplateNameChange(event.target.value)}
            className="h-9 w-[min(100%,280px)] min-w-[220px] bg-surface"
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
            <SelectTrigger className="h-9 w-[min(100%,260px)] min-w-[220px] bg-surface">
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
        </div>
      )}
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
  const hasReadinessWarning = readinessWarningCount > 0;
  // The button always says what it does. Status gaps live in the helper text
  // and tint the button amber until the first click arms the acknowledgement.
  const isUnacknowledgedWarning = hasReadinessWarning && !isReadinessWarningArmed;
  const saveButtonLabel = isSaving ? "Saving..." : "Save snapshot";
  return (
    <div
      className={cn(
        "flex min-h-9 min-w-0 flex-wrap items-center gap-2",
        !embedded && "rounded-lg border border-hairline bg-card px-2.5 py-1.5",
        className,
      )}
    >
      <span className="shrink-0 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        <CalendarDays className="mr-1 inline h-3.5 w-3.5 align-[-3px]" aria-hidden="true" />
        Data date
      </span>
      <Input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 w-[148px] bg-surface px-2 text-xs tabular"
        aria-label="Schedule data date"
        title="Runs the update view"
      />
      <Button
        type="button"
        size="sm"
        variant="signal"
        className={cn(
          "h-8 gap-1.5 whitespace-nowrap px-3 font-semibold",
          isUnacknowledgedWarning &&
            "border border-warning/50 bg-warning/15 text-warning hover:bg-warning/25 hover:text-warning",
        )}
        disabled={!value || isSaving}
        onClick={onSave}
      >
        <CheckCircle2 className="h-3.5 w-3.5" />
        {saveButtonLabel}
      </Button>
      <div className="basis-full text-[11px] leading-tight text-muted-foreground xl:max-w-[300px] sm:basis-auto">
        {isReadinessWarningArmed
          ? "Status gaps acknowledged. Click Save snapshot to save anyway."
          : hasReadinessWarning
            ? `${readinessWarningCount} open ${
                readinessWarningCount === 1 ? "row needs" : "rows need"
              } status first — Save snapshot opens the queue, then saves on the second click.`
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
    <div className="flex min-w-0 items-center gap-0.5 rounded-[9px] bg-secondary p-[3px]">
      {CONSTRUCTLINE_ZOOM_LEVELS.map((level) => (
        <button
          key={level.label}
          type="button"
          aria-pressed={dayPx === level.dayPx}
          className={cn(
            "h-8 whitespace-nowrap rounded-[7px] px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground",
            dayPx === level.dayPx && "bg-foreground text-background hover:text-background",
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
    <div
      aria-label="View filters"
      className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-[9px] bg-secondary p-[3px]"
    >
      {SCHEDULE_GRID_VIEW_OPTIONS.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          className={cn(
            "h-8 whitespace-nowrap rounded-[7px] px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground",
            value === option.value && "bg-foreground text-background hover:text-background",
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
    <div className="flex min-w-0 items-center gap-0.5 rounded-[9px] bg-secondary p-[3px]">
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            className={cn(
              "h-8 whitespace-nowrap rounded-[7px] px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground",
              value === option.value && "bg-foreground text-background hover:text-background",
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
