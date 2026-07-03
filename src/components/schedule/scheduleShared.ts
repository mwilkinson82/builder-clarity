import { PackageSearch, Users, ClipboardList } from "lucide-react";
import {
  type MilestoneStatus,
  type ScheduleRiskKind,
  type ScheduleRiskStatus,
  type MilestoneRow,
  type ScheduleActivityRow,
  type ScheduleCpmTemplateRow,
  type ScheduleDelayFragmentRow,
  type ScheduleRiskRow,
  type ScheduleUpdateRow,
  type ScheduleMilestoneUpdateRow,
  type ScheduleActivityUpdateRow,
} from "@/lib/schedule.functions";
import { computeScheduleVarianceWeeks, type ExposureCategory } from "@/lib/ior";
import {
  type ConstructLineCpmTask,
  type ConstructLineRelationshipType,
} from "@/lib/constructline-cpm";
import { parseScheduleRemainingDuration } from "@/lib/schedule-status";

export const EMPTY_MILESTONES: MilestoneRow[] = [];
export const EMPTY_ACTIVITIES: ScheduleActivityRow[] = [];
export const EMPTY_DELAY_FRAGMENTS: ScheduleDelayFragmentRow[] = [];
export const EMPTY_CPM_TEMPLATES: ScheduleCpmTemplateRow[] = [];
export const EMPTY_SCHEDULE_RISKS: ScheduleRiskRow[] = [];
export const EMPTY_SCHEDULE_UPDATES: ScheduleUpdateRow[] = [];
export const EMPTY_MILESTONE_UPDATES: ScheduleMilestoneUpdateRow[] = [];
export const EMPTY_ACTIVITY_UPDATES: ScheduleActivityUpdateRow[] = [];
export const BROWSER_CPM_TEMPLATE_STORAGE_KEY = "constructline:cpm-templates:v1";

export const STATUS_LABEL: Record<MilestoneStatus, string> = {
  on_track: "On track",
  at_risk: "At risk",
  delayed: "Delayed",
  complete: "Complete",
};
export const STATUS_STYLES: Record<MilestoneStatus, string> = {
  on_track: "bg-success/15 text-success border-success/30",
  at_risk: "bg-warning/15 text-warning border-warning/30",
  delayed: "bg-danger/15 text-danger border-danger/30",
  complete: "bg-muted text-muted-foreground border-hairline",
};

export const RISK_STATUS_LABEL: Record<ScheduleRiskStatus, string> = {
  active: "Active",
  inactive: "Inactive",
  completed: "Completed",
};
export const RISK_STATUS_STYLES: Record<ScheduleRiskStatus, string> = {
  active: "bg-warning/15 text-warning border-warning/30",
  inactive: "bg-secondary text-muted-foreground border-hairline",
  completed: "bg-success/15 text-success border-success/30",
};

export const RISK_META: Record<
  ScheduleRiskKind,
  {
    label: string;
    icon: typeof PackageSearch;
    category: ExposureCategory;
    placeholder: string;
    detailPlaceholder: string;
  }
> = {
  critical_decision: {
    label: "Critical delayed decisions",
    icon: ClipboardList,
    category: "owner_decision",
    placeholder: "Short title (e.g. Appliance package selection)",
    detailPlaceholder:
      "Who owns it, what's blocked, dollar/schedule impact, mitigation plan, and dates. The more context here, the better the IOR report reads.",
  },
  procurement: {
    label: "Procurement risks",
    icon: PackageSearch,
    category: "procurement",
    placeholder: "Short title (e.g. Window package — manufacturer slip)",
    detailPlaceholder:
      "Lead-time situation, vendor commitments, fallback options, cost impact if expedited, and what triggers escalation.",
  },
  trade_performance: {
    label: "Trade performance risks",
    icon: Users,
    category: "trade_performance",
    placeholder: "Short title (e.g. Drywall sub — quality + manpower)",
    detailPlaceholder:
      "What's actually happening on site, evidence, sub's response, supplemental crew options, and dollar risk if it continues.",
  },
};

export const CONSTRUCTLINE_ZOOM_LEVELS = [
  { label: "Fit", dayPx: 2 },
  { label: "Month", dayPx: 4 },
  { label: "Week", dayPx: 10 },
  { label: "Day", dayPx: 22 },
] as const;
export const CONSTRUCTLINE_FIT_DAY_PX = CONSTRUCTLINE_ZOOM_LEVELS[0].dayPx;
export const CONSTRUCTLINE_PRINT_TABLE_WIDTH = 490;
export const CONSTRUCTLINE_PRINT_TIMELINE_WIDTH = 1040;
export const CONSTRUCTLINE_MIN_DAY_PX = 1.1;
export const CONSTRUCTLINE_MAX_DAY_PX = 28;
export const CONSTRUCTLINE_TABLE_LAYOUT_STORAGE_VERSION = "v7";
export const CONSTRUCTLINE_TABLE_LAYOUT_STORAGE_NAMESPACE = "constructline:cpm-grid-layout";
export const CONSTRUCTLINE_FOCUS_MATRIX_STICKY_TOP = 8;
export const CONSTRUCTLINE_TABLE_COLUMN_SPECS = [
  { id: "id", label: "ID", compactLabel: "ID", min: 40, default: 44, max: 72 },
  {
    id: "activity",
    label: "Activity description",
    compactLabel: "Activity description",
    min: 100,
    default: 124,
    max: 280,
    align: "left",
  },
  { id: "dur", label: "Duration", compactLabel: "Dur", min: 36, default: 40, max: 70 },
  { id: "plan", label: "Planned dates", compactLabel: "Planned", min: 58, default: 62, max: 98 },
  {
    id: "current",
    label: "Actual / current dates",
    compactLabel: "Actual",
    min: 62,
    default: 68,
    max: 110,
  },
  { id: "slip", label: "Schedule variance", compactLabel: "Slip", min: 34, default: 38, max: 62 },
  { id: "done", label: "Percent complete", compactLabel: "%", min: 34, default: 36, max: 58 },
  { id: "tf", label: "Total float", compactLabel: "Float", min: 36, default: 40, max: 66 },
  { id: "logic", label: "Logic ties", compactLabel: "Logic", min: 46, default: 52, max: 84 },
] as const;
export const CONSTRUCTLINE_TABLE_PRINT_COLUMNS =
  "40px minmax(120px,1fr) 34px 50px 56px 34px 30px 30px 32px";
export const ACTIVITY_UPDATE_SNAPSHOT_COLUMNS =
  "64px minmax(170px,1.15fr) 54px 82px 82px 82px 58px 82px 64px 78px 58px minmax(170px,1fr)";
export const DAY_MS = 24 * 60 * 60 * 1000;
export type ConstructLineTableColumnId = (typeof CONSTRUCTLINE_TABLE_COLUMN_SPECS)[number]["id"];
export type ConstructLineTableColumnWidths = Record<ConstructLineTableColumnId, number>;
export type ConstructLineStoredGridLayout = {
  version?: string;
  widths?: Partial<Record<ConstructLineTableColumnId, number>>;
  dayPx?: number;
  updatedAt?: string;
};
export type ConstructLineGridLayoutPreset = "gantt" | "balanced" | "detail";
export type ScheduleActivityOrder = "start" | "wbs";
export type ScheduleGridView =
  | "all"
  | "active"
  | "update_queue"
  | "lookahead_1w"
  | "lookahead_2w"
  | "lookahead_6w"
  | "recovery"
  | "critical"
  | "issues"
  | "milestones";
export type ActivityPatchOptions = { silent?: boolean };
export type ActivityMatrixRow =
  | { kind: "parent"; division: string; tasks: ConstructLineCpmTask[] }
  | { kind: "group"; division: string; tasks: ConstructLineCpmTask[] }
  | { kind: "task"; task: ConstructLineCpmTask };
export type ScheduleUpdateReadinessItem = {
  task: ConstructLineCpmTask;
  reasons: string[];
  severity: "warning" | "danger";
  sort: number;
};
export type ScheduleUpdateReadinessSummary = {
  openTaskCount: number;
  updateWindowCount: number;
  readyTaskCount: number;
  needsStatusCount: number;
  missingRemainingCount: number;
  missingExpectedFinishCount: number;
  lateCount: number;
  items: ScheduleUpdateReadinessItem[];
};
export type ScheduleUpdateQueueDialogContext = {
  position: number;
  total: number;
  reason: string;
  nextActivity: ScheduleActivityRow | null;
  nextLabel: string | null;
};
export type WbsReorderInput = {
  parentId: string | null;
  orderedIds: string[];
};
export const CONSTRUCTLINE_RELATIONSHIP_TYPES: ConstructLineRelationshipType[] = [
  "FS",
  "SS",
  "FF",
  "SF",
];
export const SCHEDULE_GRID_VIEW_OPTIONS: Array<{ value: ScheduleGridView; label: string }> = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "update_queue", label: "Needs update" },
  { value: "lookahead_1w", label: "1 week lookahead" },
  { value: "lookahead_2w", label: "2 week lookahead" },
  { value: "lookahead_6w", label: "6 week lookahead" },
  { value: "recovery", label: "Recovery" },
  { value: "critical", label: "Critical" },
  { value: "issues", label: "Issues" },
  { value: "milestones", label: "Milestones" },
];
export const SCHEDULE_LOOKAHEAD_DAYS: Partial<Record<ScheduleGridView, number>> = {
  lookahead_1w: 7,
  lookahead_2w: 14,
  lookahead_6w: 42,
};
export const CONSTRUCTLINE_RELATIONSHIP_LABELS: Record<ConstructLineRelationshipType, string> = {
  FS: "Finish to start",
  SS: "Start to start",
  FF: "Finish to finish",
  SF: "Start to finish",
};

export const DELAY_FRAGMENT_STATUS_LABEL: Record<ScheduleDelayFragmentRow["status"], string> = {
  active: "Active",
  mitigated: "Mitigated",
  accepted: "Accepted",
  recovered: "Recovered",
};
export const DELAY_FRAGMENT_SOURCE_LABEL: Record<ScheduleDelayFragmentRow["source"], string> = {
  field: "Field",
  trade: "Trade",
  owner: "Owner",
  design: "Design",
  procurement: "Procurement",
  weather: "Weather",
  other: "Other",
};

export type ActivityCreateInput = { name: string } & Partial<
  Pick<
    ScheduleActivityRow,
    | "activity_id"
    | "division"
    | "start_date"
    | "finish_date"
    | "baseline_start_date"
    | "baseline_finish_date"
    | "forecast_start_date"
    | "forecast_finish_date"
    | "actual_start_date"
    | "actual_finish_date"
    | "remaining_duration_days"
    | "percent_complete"
    | "predecessor_activity_ids"
    | "successor_activity_ids"
    | "notes"
    | "sort_order"
  >
>;
export type BrowserCpmTemplate = ScheduleCpmTemplateRow & {
  source: "browser";
  activities: ActivityCreateInput[];
  wbsSections: BrowserCpmTemplateWbsSection[];
};
export type BrowserCpmTemplateWbsSection = {
  path: string;
  name: string;
  parentPath: string | null;
  sort_order: number;
};

export type DelayFragmentCreateInput = { title: string } & Partial<
  Pick<
    ScheduleDelayFragmentRow,
    | "schedule_activity_id"
    | "activity_id"
    | "reason"
    | "delay_days"
    | "source"
    | "status"
    | "owner"
    | "identified_on"
    | "resolved_on"
  >
>;

export type DelayFragmentPatchInput = Partial<
  Pick<
    ScheduleDelayFragmentRow,
    | "schedule_activity_id"
    | "activity_id"
    | "title"
    | "reason"
    | "delay_days"
    | "source"
    | "status"
    | "owner"
    | "identified_on"
    | "resolved_on"
  >
>;

export const weeksBetween = computeScheduleVarianceWeeks;

export type MilestoneView = "active" | "complete" | "all";

export type CpmMilestoneForecast = {
  milestone_id: string;
  forecast_date: string | null;
  status: MilestoneStatus;
  delay_reason: string;
};

export type CpmScheduleUpdateDraft = {
  data_date: string;
  forecast_completion_date: string;
  variance_weeks: number | null;
  movement_weeks: number | null;
  milestone_forecasts: CpmMilestoneForecast[];
  money_notes: string;
  notes: string;
  preview: string;
};

export type DelayFragmentSummary = {
  totalCount: number;
  openCount: number;
  openDays: number;
  activeCount: number;
  mitigatedCount: number;
  recoveredCount: number;
  driverLabels: string[];
};

export type ScheduleQualityQueueItem = {
  task: ConstructLineCpmTask;
  severity: "danger" | "warning";
  reasons: string[];
  guidance: string;
  sort: number;
};

export function varianceLabel(value: number | null) {
  if (value == null) return "Set dates";
  if (value > 0) return `+${value} wk`;
  if (value < 0) return `${value} wk`;
  return "On plan";
}

export function varianceTone(value: number | null) {
  if (value == null) return "text-muted-foreground";
  if (value > 0) return "text-danger";
  if (value < 0) return "text-success";
  return "text-foreground";
}

export function moneyTone(value: number) {
  if (value > 0) return "text-danger";
  if (value < 0) return "text-success";
  return "text-foreground";
}

export function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function formatFinishVarianceDays(days: number | null) {
  if (days == null) return "-";
  if (days === 0) return "0d";
  return days > 0 ? `+${days}d` : `${days}d`;
}

export function naturalScheduleCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
}

export function parsePercent(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(100, Math.round(parsed)));
}

export function parseDelayDays(value: string | number | null | undefined) {
  const parsed = Number(value ?? 0);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(365, Math.round(parsed)));
}

export function parseRemainingDuration(value: string | number | null | undefined) {
  return parseScheduleRemainingDuration(value);
}

export function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

export function shortDate(value?: string | null) {
  if (!value) return "Not set";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year}`;
}

export function shortPrintDate(value?: string | null) {
  if (!value) return "Not set";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year.slice(2)}`;
}
