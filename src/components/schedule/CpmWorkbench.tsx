import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Plus,
  ClipboardList,
  Printer,
  GitBranch,
  Gauge,
  Layers,
  Minimize2,
  Diamond,
  ListTree,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  createScheduleUpdate,
  importScheduleCpmTemplate,
  listScheduleCpmTemplates,
  saveCurrentScheduleAsCpmTemplate,
  type MilestoneRow,
  type ScheduleActivityRow,
  type ScheduleDelayFragmentRow,
  type ScheduleWbsPersistence,
  type ScheduleWbsSectionRow,
  type ScheduleUpdateRow,
} from "@/lib/schedule.functions";
import { createExposure, type ProjectRow } from "@/lib/projects.functions";
import { buildConstructLineCpmModel } from "@/lib/constructline-cpm";
import {
  buildWbsDivisionOrder,
  buildWbsDivisionRows,
  cleanWbsDivisionInput,
  compareWbsDivision,
  hasWbsDivision,
  joinWbsPath,
  moveWbsDivisionInOrder,
  splitWbsPath,
  type WbsDivisionRow,
} from "@/lib/constructline-wbs";
import {
  type ActivityCreateInput,
  type ActivityPatchOptions,
  type BrowserCpmTemplate,
  CONSTRUCTLINE_FIT_DAY_PX,
  type DelayFragmentCreateInput,
  type DelayFragmentPatchInput,
  EMPTY_CPM_TEMPLATES,
  EMPTY_SCHEDULE_UPDATES,
  type ScheduleActivityOrder,
  type ScheduleGridView,
  type ScheduleUpdateQueueDialogContext,
  type WbsReorderInput,
  parsePercent,
  parseRemainingDuration,
  shortDate,
  todayIsoDate,
} from "./scheduleShared";
import {
  buildActivityRiskDescription,
  buildCpmScheduleUpdateDraft,
  buildDelayExtensionFinishDates,
  buildDelayFragmentSummary,
  getDelayFragmentsForActivity,
  groupDelayFragmentsByActivity,
} from "./scheduleUpdateDraft";
import { buildScheduleQualityQueue, buildScheduleUpdateReadiness } from "./scheduleUpdateReadiness";
import {
  type ActivityDraft,
  emptyActivityDraft,
  formatActivityDraftSaveError,
  formatActivityLinks,
  getMilestoneDraftDate,
  getNextActivityId,
  parseActivityIds,
  scrollActivityDraftIntoView,
  serializeActivityLinksToArray,
  toggleMilestoneDraft,
  uniqueActivityId,
  updateDraftBaselineFinishDate,
  updateDraftBaselineStartDate,
  validateActivityDraft,
} from "./scheduleActivityDraft";
import {
  buildActivityRowsFromMilestones,
  buildBrowserCpmTemplate,
  groupActivitiesByDivision,
  readBrowserCpmTemplates,
  writeBrowserCpmTemplates,
} from "./scheduleCpmTemplates";
import {
  getCpmGridLayoutStorageKey,
  readStoredGridDayPx,
  writeStoredGridLayout,
} from "./scheduleGridLayout";
import {
  compareScheduleActivitiesByStart,
  describeScheduleGridView,
  filterConstructLineCpmModel,
  getScheduleReportTitle,
  orderConstructLineCpmModel,
} from "./scheduleGridModel";
import { getTimelineBounds } from "./ScheduleSnapshotTimeline";
import {
  ScheduleQualityQueue,
  ScheduleUpdateReadinessPanel,
  ScheduleWorkbenchStat,
} from "./CpmWorkbenchPanels";
import {
  CpmDataDateControl,
  CpmGridToolbar,
  ScheduleOrderControls,
  ScheduleViewControls,
  ScheduleZoomControls,
} from "./CpmGridToolbar";
import { ActivityDivisionInput, LabeledField, WbsManagerDialog } from "./WbsManager";
import { ActivityScheduleMatrix } from "./ScheduleGridMatrix";
import { StackingMiniMap } from "./ScheduleGridRows";
import { ActivityDependencyPicker } from "./ScheduleActivityRegister";
import { ActivityDetailDialog } from "./ActivityDetailDialog";

export function CpmActivityPlanner({
  workspaceMode = "full",
  activities,
  wbsSections,
  wbsPersistence = "ready",
  delayFragments,
  delayFragmentPersistence = "ready",
  milestones,
  updates = EMPTY_SCHEDULE_UPDATES,
  project,
  latestDataDate,
  onAddActivity,
  onSeedActivities,
  isSeedingActivities,
  onPatchActivity,
  isSavingActivity,
  onDeleteActivity,
  onAddDelayFragment,
  onPatchDelayFragment,
  onDeleteDelayFragment,
  isSavingDelayFragment,
  onAddWbsSection,
  onRenameWbsSection,
  onMoveWbsSectionParent,
  onReorderWbsSections,
  isSavingWbs,
  isSavingWbsOrder = false,
}: {
  workspaceMode?: "embedded" | "full";
  activities: ScheduleActivityRow[];
  wbsSections: ScheduleWbsSectionRow[];
  wbsPersistence?: ScheduleWbsPersistence;
  delayFragments: ScheduleDelayFragmentRow[];
  delayFragmentPersistence?: "ready" | "migration_required";
  milestones: MilestoneRow[];
  updates?: ScheduleUpdateRow[];
  project: ProjectRow;
  latestDataDate: string | null;
  onAddActivity: (activity: ActivityCreateInput) => Promise<unknown> | unknown;
  onSeedActivities: (activities: ActivityCreateInput[]) => void;
  isSeedingActivities: boolean;
  onPatchActivity: (
    id: string,
    patch: Partial<ScheduleActivityRow>,
    options?: ActivityPatchOptions,
  ) => Promise<void>;
  isSavingActivity: boolean;
  onDeleteActivity: (id: string) => void;
  onAddDelayFragment: (fragment: DelayFragmentCreateInput) => Promise<void>;
  onPatchDelayFragment: (id: string, patch: DelayFragmentPatchInput) => Promise<void>;
  onDeleteDelayFragment: (id: string) => Promise<void>;
  isSavingDelayFragment: boolean;
  onAddWbsSection: (name: string, parentId?: string | null) => Promise<void>;
  onRenameWbsSection: (id: string, name: string) => Promise<void>;
  onMoveWbsSectionParent: (id: string, parentId: string | null) => Promise<void>;
  onReorderWbsSections: (input: WbsReorderInput) => Promise<void>;
  isSavingWbs: boolean;
  isSavingWbsOrder?: boolean;
}) {
  const isFullWorkspace = workspaceMode === "full";
  const qc = useQueryClient();
  const createUpdateFn = useServerFn(createScheduleUpdate);
  const listTemplatesFn = useServerFn(listScheduleCpmTemplates);
  const saveTemplateFn = useServerFn(saveCurrentScheduleAsCpmTemplate);
  const importTemplateFn = useServerFn(importScheduleCpmTemplate);
  const createActivityExposureFn = useServerFn(createExposure);
  const [draft, setDraft] = useState<ActivityDraft>(() => emptyActivityDraft());
  const [showDraft, setShowDraft] = useState(false);
  const [draftSaveError, setDraftSaveError] = useState<string | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<string | null>(null);
  const cpmGridLayoutStorageKey = getCpmGridLayoutStorageKey(project.id);
  const [dayPx, setDayPx] = useState<number>(() => readStoredGridDayPx(cpmGridLayoutStorageKey));
  const [showLogicLines, setShowLogicLines] = useState(true);
  const [showBaselineBars, setShowBaselineBars] = useState(true);
  const [activityOrder, setActivityOrder] = useState<ScheduleActivityOrder>("start");
  const [scheduleView, setScheduleView] = useState<ScheduleGridView>("all");
  const [dataDateDraft, setDataDateDraft] = useState(() => latestDataDate ?? todayIsoDate());
  const [templateName, setTemplateName] = useState(() => `${project.name} CPM`);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [browserTemplates, setBrowserTemplates] = useState<BrowserCpmTemplate[]>([]);
  const [isWbsManagerOpen, setIsWbsManagerOpen] = useState(false);
  const [isFocusOpen, setIsFocusOpen] = useState(false);
  const [readinessWarningAcceptedFor, setReadinessWarningAcceptedFor] = useState<string | null>(
    null,
  );
  const didScrollToGridRef = useRef(false);
  const lastCpmGridLayoutStorageKeyRef = useRef(cpmGridLayoutStorageKey);
  const pendingCpmGridLayoutStorageKeyRef = useRef<string | null>(null);
  const draftFormRef = useRef<HTMLDivElement | null>(null);
  const effectiveDataDate = dataDateDraft || latestDataDate || null;
  const wbsDivisionOrder = useMemo(
    () => buildWbsDivisionOrder(activities, wbsSections),
    [activities, wbsSections],
  );
  const sortedActivities = useMemo(
    () =>
      [...activities].sort((a, b) => {
        if (activityOrder === "start") {
          return compareScheduleActivitiesByStart(a, b);
        }
        const division = compareWbsDivision(a.division, b.division, wbsDivisionOrder);
        if (division !== 0) return division;
        return compareScheduleActivitiesByStart(a, b);
      }),
    [activities, activityOrder, wbsDivisionOrder],
  );
  const grouped = useMemo(() => groupActivitiesByDivision(sortedActivities), [sortedActivities]);
  const wbsDivisionRows = useMemo(
    () => buildWbsDivisionRows(sortedActivities, wbsSections, wbsDivisionOrder),
    [sortedActivities, wbsDivisionOrder, wbsSections],
  );
  const knownWbsDivisions = useMemo(
    () => wbsDivisionRows.map((row) => row.division),
    [wbsDivisionRows],
  );
  const isWbsMigrationRequired = wbsPersistence === "migration_required";
  const isWbsPathFallback = wbsPersistence === "path_fallback";
  const showWbsMigrationPending = () => {
    toast.error("Use activity WBS fields for now", {
      description:
        "The grid still groups by each activity WBS path. Edit an activity WBS to adjust the visible schedule structure.",
    });
  };
  useEffect(() => {
    if (lastCpmGridLayoutStorageKeyRef.current === cpmGridLayoutStorageKey) return;
    pendingCpmGridLayoutStorageKeyRef.current = cpmGridLayoutStorageKey;
    lastCpmGridLayoutStorageKeyRef.current = cpmGridLayoutStorageKey;
    setDayPx(readStoredGridDayPx(cpmGridLayoutStorageKey));
  }, [cpmGridLayoutStorageKey]);
  useEffect(() => {
    if (pendingCpmGridLayoutStorageKeyRef.current === cpmGridLayoutStorageKey) {
      pendingCpmGridLayoutStorageKeyRef.current = null;
      return;
    }
    writeStoredGridLayout(cpmGridLayoutStorageKey, { dayPx });
  }, [cpmGridLayoutStorageKey, dayPx]);
  const delaySummary = useMemo(() => buildDelayFragmentSummary(delayFragments), [delayFragments]);
  const latestScheduleUpdate = updates[0] ?? null;
  const baseCpmModel = useMemo(
    () =>
      buildConstructLineCpmModel(sortedActivities, {
        dataDate: effectiveDataDate,
        nearCriticalFloat: 5,
      }),
    [effectiveDataDate, sortedActivities],
  );
  const cpmModel = useMemo(
    () => orderConstructLineCpmModel(baseCpmModel, activityOrder, wbsDivisionOrder),
    [activityOrder, baseCpmModel, wbsDivisionOrder],
  );
  const qualityQueueItems = useMemo(() => buildScheduleQualityQueue(cpmModel), [cpmModel]);
  const updateReadiness = useMemo(
    () => buildScheduleUpdateReadiness(cpmModel, effectiveDataDate),
    [cpmModel, effectiveDataDate],
  );
  const gridViewReferenceDate = effectiveDataDate ?? todayIsoDate();
  const displayedCpmModel = useMemo(
    () =>
      filterConstructLineCpmModel(cpmModel, scheduleView, gridViewReferenceDate, delayFragments),
    [cpmModel, delayFragments, gridViewReferenceDate, scheduleView],
  );
  const scheduleViewSummary = useMemo(
    () =>
      describeScheduleGridView(
        scheduleView,
        displayedCpmModel.tasks.length,
        cpmModel.tasks.length,
        gridViewReferenceDate,
      ),
    [cpmModel.tasks.length, displayedCpmModel.tasks.length, gridViewReferenceDate, scheduleView],
  );
  const delayExtensionFinishDates = useMemo(
    () => buildDelayExtensionFinishDates(sortedActivities, delayFragments),
    [delayFragments, sortedActivities],
  );
  const bounds = useMemo(
    () =>
      getTimelineBounds([
        project.baseline_completion_date,
        project.forecast_completion_date,
        effectiveDataDate,
        ...activities.flatMap((activity) => [
          activity.start_date,
          activity.finish_date,
          activity.baseline_start_date,
          activity.baseline_finish_date,
          activity.forecast_start_date,
          activity.forecast_finish_date,
          activity.actual_start_date,
          activity.actual_finish_date,
        ]),
        ...delayExtensionFinishDates,
      ]),
    [
      activities,
      delayExtensionFinishDates,
      effectiveDataDate,
      project.baseline_completion_date,
      project.forecast_completion_date,
    ],
  );
  const selectedActivity = useMemo(
    () => sortedActivities.find((activity) => activity.id === selectedActivityId) ?? null,
    [selectedActivityId, sortedActivities],
  );
  const selectedUpdateQueueContext = useMemo<ScheduleUpdateQueueDialogContext | null>(() => {
    if (!selectedActivity) return null;
    const selectedIndex = updateReadiness.items.findIndex(
      (item) => item.task.activity.id === selectedActivity.id,
    );
    if (selectedIndex === -1) return null;
    const selectedItem = updateReadiness.items[selectedIndex];
    const nextItem =
      updateReadiness.items
        .slice(selectedIndex + 1)
        .find((item) => item.task.activity.id !== selectedActivity.id) ??
      updateReadiness.items.find((item) => item.task.activity.id !== selectedActivity.id) ??
      null;

    return {
      position: selectedIndex + 1,
      total: updateReadiness.items.length,
      reason: selectedItem.reasons.join(", "),
      nextActivity: nextItem?.task.activity ?? null,
      nextLabel: nextItem
        ? `${nextItem.task.dependencyKey} - ${nextItem.task.activity.name}`
        : null,
    };
  }, [selectedActivity, updateReadiness.items]);
  const milestoneSeedRows = useMemo(
    () => buildActivityRowsFromMilestones(milestones, sortedActivities),
    [milestones, sortedActivities],
  );

  useEffect(() => {
    setDataDateDraft(latestDataDate ?? todayIsoDate());
  }, [latestDataDate]);

  useEffect(() => {
    setReadinessWarningAcceptedFor(null);
  }, [dataDateDraft, updateReadiness.needsStatusCount]);

  useEffect(() => {
    if (!showDraft) return;
    scrollActivityDraftIntoView(draftFormRef);
  }, [draft.is_milestone, showDraft]);

  const templateQuery = useQuery({
    queryKey: ["schedule-cpm-templates", project.id],
    queryFn: () => listTemplatesFn({ data: { projectId: project.id } }),
    staleTime: 30_000,
  });
  const templatePersistence = templateQuery.data?.persistence ?? "ready";
  const cpmTemplates = useMemo(
    () => [...(templateQuery.data?.templates ?? EMPTY_CPM_TEMPLATES), ...browserTemplates],
    [browserTemplates, templateQuery.data?.templates],
  );

  useEffect(() => {
    setBrowserTemplates(readBrowserCpmTemplates());
  }, []);

  useEffect(() => {
    if (!selectedTemplateId && cpmTemplates[0]?.id) setSelectedTemplateId(cpmTemplates[0].id);
  }, [cpmTemplates, selectedTemplateId]);

  useEffect(() => {
    if (selectedActivityId && !selectedActivity) setSelectedActivityId(null);
  }, [selectedActivity, selectedActivityId]);

  useEffect(() => {
    if (!isFocusOpen || typeof document === "undefined") return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isFocusOpen]);

  useEffect(() => {
    if (!isFocusOpen || typeof window === "undefined") return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsFocusOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isFocusOpen]);

  useEffect(() => {
    if (
      didScrollToGridRef.current ||
      typeof window === "undefined" ||
      window.location.hash !== "#cpm-grid"
    ) {
      return;
    }
    const grid = document.getElementById("cpm-grid");
    if (!grid) return;
    didScrollToGridRef.current = true;
    window.requestAnimationFrame(() => {
      grid.scrollIntoView({ block: "start" });
    });
  }, [displayedCpmModel.tasks.length]);

  const addActivity = async () => {
    if (isSavingActivity) return;
    const validationError = validateActivityDraft(draft, sortedActivities);
    if (validationError) {
      toast.error("Activity is not ready to save", {
        description: validationError,
      });
      return;
    }
    const name = draft.name.trim();
    const milestoneDate = getMilestoneDraftDate(draft);
    const baselineStart = draft.is_milestone
      ? milestoneDate
      : draft.baseline_start_date || draft.start_date || null;
    const baselineFinish = draft.is_milestone
      ? milestoneDate
      : draft.baseline_finish_date || draft.finish_date || null;
    const forecastStart = draft.is_milestone
      ? milestoneDate
      : draft.forecast_start_date || baselineStart;
    const forecastFinish = draft.is_milestone
      ? milestoneDate
      : draft.forecast_finish_date || baselineFinish;
    const percentComplete = parsePercent(draft.percent_complete);
    const draftHasActualStartBasis =
      Boolean(draft.actual_start_date) || Boolean(draft.actual_finish_date);
    setDraftSaveError(null);
    try {
      await Promise.resolve(
        onAddActivity({
          activity_id: draft.activity_id.trim() || undefined,
          name,
          division: draft.is_milestone ? "Milestones" : draft.division.trim() || "General",
          start_date: baselineStart,
          finish_date: baselineFinish,
          baseline_start_date: baselineStart,
          baseline_finish_date: baselineFinish,
          forecast_start_date: forecastStart,
          forecast_finish_date: forecastFinish,
          actual_start_date: draft.actual_start_date || null,
          actual_finish_date: draft.actual_finish_date || null,
          remaining_duration_days: draft.is_milestone
            ? 0
            : draftHasActualStartBasis
              ? parseRemainingDuration(draft.remaining_duration_days)
              : null,
          percent_complete: percentComplete,
          predecessor_activity_ids: serializeActivityLinksToArray(draft.predecessor_activity_ids),
          successor_activity_ids: serializeActivityLinksToArray(draft.successor_activity_ids),
          notes: draft.notes.trim(),
        }),
      );
      setDraft(emptyActivityDraft());
      setShowDraft(false);
    } catch (error) {
      setDraftSaveError(formatActivityDraftSaveError(error, draft.is_milestone));
    }
  };
  const openActivityDraft = () => {
    setDraftSaveError(null);
    setDraft({
      ...emptyActivityDraft(),
      activity_id: getNextActivityId(sortedActivities),
      division: knownWbsDivisions[0] ?? "General",
    });
    setShowDraft(true);
    toast.success("Activity form opened", {
      description: "Finish the row in the highlighted form above the table, then save it.",
      duration: 1800,
    });
    scrollActivityDraftIntoView(draftFormRef);
  };
  const toggleActivityDraft = () => {
    if (showDraft) {
      setShowDraft(false);
      setDraftSaveError(null);
      return;
    }
    openActivityDraft();
  };
  const openMilestoneDraft = () => {
    if (showDraft && draft.is_milestone) {
      scrollActivityDraftIntoView(draftFormRef);
      toast.info("Milestone form is already open", {
        description: "Use the form under the CPM toolbar to save the milestone.",
      });
      return;
    }
    setDraftSaveError(null);
    const existingIds = new Set(sortedActivities.map((activity) => activity.activity_id));
    const milestoneDate =
      cpmModel.cpmFinishDate || project.forecast_completion_date || todayIsoDate();
    const openFinishPredecessors = cpmModel.tasks
      .filter((task) => task.isOpenFinish && !task.isMilestone)
      .map((task) => ({
        activityId: task.dependencyKey || task.activity.activity_id,
        relationshipType: "FS" as const,
        lagDays: 0,
      }));
    setDraft({
      ...emptyActivityDraft(),
      activity_id: uniqueActivityId(
        `MS-${String(milestones.length + 1).padStart(3, "0")}`,
        existingIds,
      ),
      name: "Substantial completion milestone",
      division: "Milestones",
      start_date: milestoneDate,
      finish_date: milestoneDate,
      baseline_start_date: milestoneDate,
      baseline_finish_date: milestoneDate,
      forecast_start_date: milestoneDate,
      forecast_finish_date: milestoneDate,
      remaining_duration_days: "0",
      predecessor_activity_ids: formatActivityLinks(openFinishPredecessors),
      notes:
        openFinishPredecessors.length > 0
          ? "Completion milestone created from the CPM workspace. Open-finish activities were tied to this milestone so the completion path has a finish anchor."
          : "Completion milestone created from the CPM workspace. Add predecessor ties from the final activities that drive completion.",
      is_milestone: true,
    });
    setShowDraft(true);
    toast.success("Milestone form opened", {
      description: "Finish the highlighted milestone form above the table, then save it.",
      duration: 1800,
    });
    scrollActivityDraftIntoView(draftFormRef);
  };
  const addWbsDivision = (divisionName: string, parentId: string | null = null) => {
    if (isWbsMigrationRequired) {
      showWbsMigrationPending();
      return;
    }
    const division = cleanWbsDivisionInput(divisionName);
    if (!division) return;
    const parentRow = parentId ? wbsDivisionRows.find((row) => row.id === parentId) : null;
    const nextPath = parentRow
      ? joinWbsPath([...splitWbsPath(parentRow.division), division])
      : division;
    if (hasWbsDivision(knownWbsDivisions, nextPath)) {
      toast.error("WBS already exists", {
        description: `${nextPath} is already in the schedule.`,
      });
      return;
    }
    setActivityOrder("wbs");
    void onAddWbsSection(division, parentId);
  };
  const renameWbsDivision = async (fromDivision: string, toDivision: string) => {
    if (isWbsMigrationRequired) {
      showWbsMigrationPending();
      return;
    }
    const nextDivision = cleanWbsDivisionInput(toDivision);
    if (!nextDivision || nextDivision === fromDivision) return;
    const row = wbsDivisionRows.find((item) => item.division === fromDivision);
    const nextPath = row?.parentPath
      ? joinWbsPath([...splitWbsPath(row.parentPath), nextDivision])
      : nextDivision;
    if (
      hasWbsDivision(
        knownWbsDivisions.filter((division) => division !== fromDivision),
        nextPath,
      )
    ) {
      toast.error("WBS already exists", {
        description: `${nextPath} is already in the schedule.`,
      });
      return;
    }
    if (!row?.id) return;
    await onRenameWbsSection(row.id, nextDivision);
  };
  const moveWbsDivisionParent = async (division: string, parentId: string | null) => {
    if (isWbsMigrationRequired) {
      showWbsMigrationPending();
      return;
    }
    const row = wbsDivisionRows.find((item) => item.division === division);
    const alreadyInTargetParent =
      (row?.parentId ?? null) === parentId && (!isWbsPathFallback || !row?.parentPath);
    if (!row?.id || alreadyInTargetParent) return;
    const parentRow = parentId ? wbsDivisionRows.find((item) => item.id === parentId) : null;
    const nextPath = parentRow
      ? joinWbsPath([...splitWbsPath(parentRow.division), row.title])
      : row.title;
    if (
      hasWbsDivision(
        knownWbsDivisions.filter((item) => item !== division),
        nextPath,
      )
    ) {
      toast.error("WBS already exists", {
        description: `${nextPath} is already in the schedule.`,
      });
      return;
    }
    setActivityOrder("wbs");
    await onMoveWbsSectionParent(row.id, parentId);
  };
  const moveWbsDivision = (division: string, direction: -1 | 1) => {
    if (isWbsMigrationRequired) {
      showWbsMigrationPending();
      return;
    }
    const orderedRows = moveWbsDivisionInOrder(wbsDivisionRows, division, direction);
    const orderedIds = orderedRows.map((row) => row.id).filter((id): id is string => Boolean(id));
    if (orderedIds.length > 0) {
      void onReorderWbsSections({
        parentId: orderedRows[0]?.parentId ?? null,
        orderedIds,
      });
    }
    setActivityOrder("wbs");
  };
  const reorderWbsDivisions = (orderedDivisions: string[]) => {
    if (isWbsMigrationRequired) {
      showWbsMigrationPending();
      return;
    }
    const orderedRows = orderedDivisions
      .map((division) => wbsDivisionRows.find((row) => row.division === division))
      .filter((row): row is WbsDivisionRow => Boolean(row?.id));
    const orderedIds = orderedRows.map((row) => row.id).filter((id): id is string => Boolean(id));
    if (orderedIds.length > 0) {
      void onReorderWbsSections({
        parentId: orderedRows[0]?.parentId ?? null,
        orderedIds,
      });
    }
    setActivityOrder("wbs");
  };
  const dataDateUpdate = useMutation({
    mutationFn: (nextDataDate: string) => {
      const workbenchDraft = buildCpmScheduleUpdateDraft({
        dataDate: nextDataDate,
        delaySummary,
        milestones,
        model: cpmModel,
        previousUpdate: latestScheduleUpdate,
        project,
      });
      return createUpdateFn({
        data: {
          projectId: project.id,
          forecast_completion_date: workbenchDraft.forecast_completion_date,
          data_date: nextDataDate,
          update_date: nextDataDate,
          schedule_money_exposure: 0,
          schedule_money_recovery: 0,
          money_notes: workbenchDraft.money_notes,
          notes: workbenchDraft.notes,
          milestone_forecasts: workbenchDraft.milestone_forecasts,
        },
      });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["schedule", project.id] }),
        qc.invalidateQueries({ queryKey: ["project", project.id] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
      ]);
      toast.success("Data date saved", {
        description: "The CPM data-date snapshot was added to the schedule update history.",
      });
    },
    onError: (error) => {
      toast.error("Data date did not save", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });
  const saveBrowserTemplate = () => {
    const template = buildBrowserCpmTemplate(
      project,
      templateName.trim() || `${project.name} CPM`,
      sortedActivities,
      wbsSections,
    );
    const nextTemplates = [
      template,
      ...browserTemplates.filter((item) => item.name !== template.name),
    ].slice(0, 25);
    writeBrowserCpmTemplates(nextTemplates);
    setBrowserTemplates(nextTemplates);
    setSelectedTemplateId(template.id);
    toast.success("CPM template saved", {
      description:
        "Template saved in this browser and available from the template picker on other projects opened here.",
    });
  };
  const templateSave = useMutation({
    mutationFn: () =>
      saveTemplateFn({
        data: {
          projectId: project.id,
          name: templateName.trim() || `${project.name} CPM`,
          description: `Saved from ${project.name} on ${shortDate(todayIsoDate())}.`,
        },
      }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["schedule-cpm-templates", project.id] });
      toast.success("CPM template saved", {
        description: "This schedule can now be used on another project.",
      });
    },
    onError: (error) => {
      toast.error("CPM template did not save", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });
  const templateImport = useMutation({
    mutationFn: (templateId: string) =>
      importTemplateFn({ data: { projectId: project.id, templateId } }),
    onSuccess: async (result) => {
      await qc.invalidateQueries({ queryKey: ["schedule", project.id] });
      toast.success("CPM template applied", {
        description: `${result.inserted} activities added${
          result.skipped ? `, ${result.skipped} duplicate IDs skipped` : ""
        }.`,
      });
    },
    onError: (error) => {
      toast.error("CPM template did not apply", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });
  const applyBrowserTemplate = (template: BrowserCpmTemplate) => {
    const existingIds = new Set(sortedActivities.map((activity) => activity.activity_id));
    const rows = template.activities
      .filter((activity) => !activity.activity_id || !existingIds.has(activity.activity_id))
      .map((activity, index) => ({
        ...activity,
        percent_complete: 0,
        sort_order: sortedActivities.length + index + 1,
      }));
    if (rows.length === 0) {
      toast.info("Template already matches this schedule", {
        description: "No new activity IDs were available to add.",
      });
      return;
    }
    onSeedActivities(rows);
    toast.success("CPM template applied", {
      description: `${rows.length} browser template ${
        rows.length === 1 ? "activity" : "activities"
      } queued with saved WBS paths and logic ties.`,
    });
  };
  const saveCpmTemplate = () => {
    if (!templateName.trim()) return;
    if (templatePersistence === "migration_required") {
      saveBrowserTemplate();
      return;
    }
    templateSave.mutate();
  };
  const applySelectedCpmTemplate = () => {
    if (!selectedTemplateId) return;
    const browserTemplate = browserTemplates.find((template) => template.id === selectedTemplateId);
    if (browserTemplate) {
      applyBrowserTemplate(browserTemplate);
      return;
    }
    templateImport.mutate(selectedTemplateId);
  };
  const activityRiskCreate = useMutation({
    mutationFn: async (activity: ScheduleActivityRow) => {
      const linkedDelaySummary = buildDelayFragmentSummary(
        getDelayFragmentsForActivity(activity, groupDelayFragmentsByActivity(delayFragments)),
      );
      const scheduleImpactWeeks =
        linkedDelaySummary.openDays > 0
          ? Math.max(1, Math.ceil(linkedDelaySummary.openDays / 7))
          : null;
      return createActivityExposureFn({
        data: {
          projectId: project.id,
          title: `${activity.activity_id ? `${activity.activity_id} - ` : ""}${activity.name}`,
          description: buildActivityRiskDescription(activity, linkedDelaySummary),
          category: "schedule_compression",
          dollar_exposure: 0,
          probability: 100,
          schedule_impact_weeks: scheduleImpactWeeks,
          owner: project.project_manager || "",
          response_path: "recover",
          hold_class: "E-Hold",
          status: "active",
          due_date: activity.forecast_finish_date ?? activity.finish_date,
          next_review_at: effectiveDataDate ?? todayIsoDate(),
          release_condition: `Activity recovered or absorbed: ${activity.activity_id || activity.name}`,
          notes:
            "Created from the CPM activity detail. Price the exposure and set the response path in Risk Tally.",
        },
      });
    },
    onSuccess: async (_result, activity) => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["project", project.id] }),
        qc.invalidateQueries({ queryKey: ["projects"] }),
      ]);
      toast.success("Activity sent to Risk Tally", {
        description: `${activity.activity_id || activity.name} is ready to price as a schedule risk.`,
      });
    },
    onError: (error) => {
      toast.error("Activity did not send to Risk Tally", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });
  const completedActivities = sortedActivities.filter(
    (activity) => activity.percent_complete >= 100,
  ).length;
  const activitiesWithLogic = sortedActivities.filter(
    (activity) =>
      activity.predecessor_activity_ids.length > 0 || activity.successor_activity_ids.length > 0,
  ).length;
  const activitiesWithDates = sortedActivities.filter(
    (activity) =>
      activity.start_date ||
      activity.finish_date ||
      activity.baseline_start_date ||
      activity.baseline_finish_date ||
      activity.forecast_start_date ||
      activity.forecast_finish_date,
  ).length;
  const printedLogicTieCount = displayedCpmModel.tasks.reduce(
    (total, task) => total + task.predecessorKeys.length,
    0,
  );
  const isDataDateDirty = dataDateDraft !== (latestDataDate ?? "");
  const scheduleReportTitle = getScheduleReportTitle(scheduleView);
  const isCriticalPathReport = scheduleView === "critical";
  const isRecoveryReport = scheduleView === "recovery";
  const printReportLabel = isCriticalPathReport ? "Critical Path Report" : scheduleReportTitle;
  const contractorName = project.organization_name || "Overwatch";
  const criticalBasisLabel = displayedCpmModel.criticalPathReliable
    ? "Critical basis valid"
    : "Critical basis provisional";
  const isReadinessSaveWarningArmed =
    updateReadiness.needsStatusCount > 0 && readinessWarningAcceptedFor === dataDateDraft;
  const saveDataDate = () => {
    if (!dataDateDraft || dataDateUpdate.isPending) return;
    if (updateReadiness.needsStatusCount > 0 && readinessWarningAcceptedFor !== dataDateDraft) {
      setReadinessWarningAcceptedFor(dataDateDraft);
      setScheduleView("update_queue");
      toast.warning("CPM update has status gaps", {
        description: `${updateReadiness.needsStatusCount} open ${
          updateReadiness.needsStatusCount === 1 ? "activity needs" : "activities need"
        } current start, expected finish, actual progress, or late-status review. Click Save snapshot to save anyway.`,
      });
      return;
    }
    setReadinessWarningAcceptedFor(null);
    dataDateUpdate.mutate(dataDateDraft);
  };
  const confirmDeleteActivity = (activity: ScheduleActivityRow) => {
    const label = activity.activity_id
      ? `${activity.activity_id} - ${activity.name}`
      : activity.name;
    if (
      typeof window !== "undefined" &&
      !window.confirm(`Delete ${label}? This also removes its logic ties from linked activities.`)
    ) {
      return;
    }
    if (selectedActivityId === activity.id) setSelectedActivityId(null);
    onDeleteActivity(activity.id);
  };
  const activityDraftMode = showDraft ? (draft.is_milestone ? "milestone" : "activity") : null;
  const activityDraftEditor = showDraft ? (
    <div
      ref={draftFormRef}
      tabIndex={-1}
      aria-label={draft.is_milestone ? "New milestone form" : "New activity form"}
      className="scroll-mt-28 rounded-md border border-accent/35 bg-accent/10 p-4 shadow-sm outline-none ring-1 ring-accent/10 focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {draft.is_milestone ? "New completion milestone" : "New CPM activity"}
          </div>
          <div className="mt-1 font-serif text-xl text-foreground">
            {draft.is_milestone ? "Add a schedule milestone" : "Add an activity row"}
          </div>
          <div className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Fill the row, choose predecessor/successor activities from the schedule, then save it
            into the CPM table.
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant={draft.is_milestone ? "default" : "outline"}
            className="gap-2 print:hidden"
            aria-pressed={draft.is_milestone}
            onClick={() => setDraft(toggleMilestoneDraft(draft, !draft.is_milestone))}
          >
            <Diamond className="h-4 w-4" />
            Milestone
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="print:hidden"
            onClick={() => {
              setDraft(emptyActivityDraft());
              setShowDraft(false);
              setDraftSaveError(null);
            }}
            disabled={isSavingActivity}
          >
            Cancel
          </Button>
        </div>
      </div>
      <div className="grid gap-3 lg:grid-cols-[140px_minmax(260px,1fr)_210px] xl:grid-cols-[140px_minmax(280px,1fr)_210px_160px_160px_110px]">
        <LabeledField label="Activity ID">
          <Input
            value={draft.activity_id}
            onChange={(e) => setDraft({ ...draft, activity_id: e.target.value })}
            placeholder="A-010"
            className="h-10"
          />
        </LabeledField>
        <LabeledField label="Activity">
          <Input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            placeholder={draft.is_milestone ? "Substantial completion" : "Frame exterior walls"}
            className="h-10"
          />
        </LabeledField>
        <LabeledField label="WBS / area">
          <ActivityDivisionInput
            value={draft.division}
            onChange={(division) => setDraft({ ...draft, division })}
            options={knownWbsDivisions}
            listId="new-activity-wbs-divisions"
          />
        </LabeledField>
        <LabeledField label="Baseline start">
          <Input
            type="date"
            value={draft.baseline_start_date}
            onChange={(e) => setDraft(updateDraftBaselineStartDate(draft, e.target.value))}
            className="h-10"
          />
        </LabeledField>
        <LabeledField label="Baseline finish">
          <Input
            type="date"
            value={draft.baseline_finish_date}
            onChange={(e) => setDraft(updateDraftBaselineFinishDate(draft, e.target.value))}
            className="h-10"
          />
        </LabeledField>
        <LabeledField label="% done">
          <Input
            type="number"
            min={0}
            max={100}
            value={draft.percent_complete}
            onChange={(e) => setDraft({ ...draft, percent_complete: e.target.value })}
            className="h-10 tabular"
          />
        </LabeledField>
      </div>
      <div className="mt-4 grid gap-4">
        <div className="grid gap-3 xl:grid-cols-2">
          <ActivityDependencyPicker
            label="Predecessors - work before this row"
            emptyLabel="Choose activities that must finish first"
            selectedIds={draft.predecessor_activity_ids}
            activities={sortedActivities}
            blockedActivityId={draft.activity_id}
            blockedIds={parseActivityIds(draft.successor_activity_ids)}
            onChange={(value) => setDraft({ ...draft, predecessor_activity_ids: value })}
          />
          <ActivityDependencyPicker
            label="Successors - work after this row"
            emptyLabel="Choose activities that follow this one"
            selectedIds={draft.successor_activity_ids}
            activities={sortedActivities}
            blockedActivityId={draft.activity_id}
            blockedIds={parseActivityIds(draft.predecessor_activity_ids)}
            onChange={(value) => setDraft({ ...draft, successor_activity_ids: value })}
          />
        </div>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_auto] xl:items-end">
          <LabeledField label="Notes / constraint">
            <Textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Scope, sequencing constraint, crew assumption, or schedule risk."
              className="min-h-20 resize-y"
            />
          </LabeledField>
          <Button
            type="button"
            className="h-11 min-w-[160px] gap-2 justify-self-end"
            disabled={!draft.name.trim() || isSavingActivity}
            onClick={() => void addActivity()}
          >
            {draft.is_milestone ? <Diamond className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {isSavingActivity
              ? draft.is_milestone
                ? "Saving milestone..."
                : "Saving activity..."
              : draft.is_milestone
                ? "Save milestone"
                : "Save activity"}
          </Button>
        </div>
      </div>
      {draftSaveError && (
        <div className="mt-3 rounded-md border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
          {draftSaveError}
        </div>
      )}
    </div>
  ) : null;

  return (
    <>
      <section className="constructline-cpm-print-shell" aria-label="Printable CPM schedule">
        <div className="constructline-cpm-print-titlebar">
          <div>
            {(project.organization_logo_url || project.organization_name) && (
              <div className="constructline-print-brand">
                {project.organization_logo_url && (
                  <img
                    src={project.organization_logo_url}
                    alt={`${project.organization_name} logo`}
                  />
                )}
                {project.organization_name && <span>{project.organization_name}</span>}
              </div>
            )}
            <div className="constructline-cpm-print-kicker">
              {contractorName} · ConstructLine CPM
            </div>
            <h1>
              {project.name} · {printReportLabel}
            </h1>
            <div className="constructline-cpm-print-meta">
              {project.job_number && <span>Job # {project.job_number}</span>}
              {project.client && <span>{project.client}</span>}
              {project.project_manager && <span>PM {project.project_manager}</span>}
              <span>Data date {effectiveDataDate ? shortDate(effectiveDataDate) : "not set"}</span>
              <span>
                {shortDate(displayedCpmModel.timelineStartDate)} to{" "}
                {shortDate(displayedCpmModel.timelineFinishDate)}
              </span>
              {showLogicLines && (
                <span>
                  {displayedCpmModel.tasks.length} activities · {printedLogicTieCount} logic ties
                  shown
                </span>
              )}
              {delaySummary.openCount > 0 && (
                <span>
                  {delaySummary.openCount} open delay impact
                  {delaySummary.openCount === 1 ? "" : "s"} · {delaySummary.openDays} days
                </span>
              )}
              <span>Optimized for 11 x 17 landscape</span>
              <span>{activityOrder === "start" ? "Start-date order" : "WBS order"}</span>
              <span>{scheduleViewSummary}</span>
            </div>
          </div>
          <div
            className={cn(
              "constructline-cpm-print-status",
              isCriticalPathReport && "constructline-cpm-print-status-critical",
              isRecoveryReport && "constructline-cpm-print-status-recovery",
            )}
          >
            <span>
              {isCriticalPathReport
                ? "Critical path report"
                : isRecoveryReport
                  ? "Recovery report"
                  : "Report type"}
            </span>
            <strong>{printReportLabel}</strong>
            <em>
              {criticalBasisLabel} · Finish {shortDate(displayedCpmModel.cpmFinishDate)}
            </em>
          </div>
        </div>
        <div className="constructline-cpm-print-report-strip">
          <span className="constructline-cpm-print-report-strip-company">
            <strong>Company</strong>
            {contractorName}
          </span>
          <span className="constructline-cpm-print-report-strip-report">
            <strong>Report</strong>
            {printReportLabel}
          </span>
          <span className="constructline-cpm-print-report-strip-basis">
            <strong>Critical basis</strong>
            {displayedCpmModel.criticalPathReliable ? "Valid" : "Provisional"}
          </span>
          <span>
            <strong>Finish</strong>
            {shortDate(displayedCpmModel.cpmFinishDate)}
          </span>
          <span>
            <strong>Data date</strong>
            {effectiveDataDate ? shortDate(effectiveDataDate) : "Not set"}
          </span>
          <span>
            <strong>Legend</strong>
            Critical red · near critical gold · complete green · milestone diamond · hatched delay
            period
          </span>
        </div>
        <ActivityScheduleMatrix
          model={displayedCpmModel}
          delayFragments={delayFragments}
          dayPx={CONSTRUCTLINE_FIT_DAY_PX}
          dataDate={effectiveDataDate}
          viewSummary={scheduleViewSummary}
          emptyTitle="No activities match this schedule view."
          emptyDescription="Switch back to All activities or choose a broader view."
          showLogicLines={showLogicLines}
          showBaselineBars={showBaselineBars}
          isPrintMode
          onOpenActivity={() => undefined}
          onDeleteActivity={() => undefined}
        />
        <footer className="constructline-cpm-print-footer">
          <span className="constructline-cpm-print-footer-primary">Company: {contractorName}</span>
          <span className="constructline-cpm-print-footer-report">
            {printReportLabel} · {criticalBasisLabel} · Finish{" "}
            {shortDate(displayedCpmModel.cpmFinishDate)}
          </span>
          <span>Critical path finish {shortDate(displayedCpmModel.cpmFinishDate)}</span>
          <span>Project finish {shortDate(displayedCpmModel.cpmFinishDate)}</span>
          <span>Data date {effectiveDataDate ? shortDate(effectiveDataDate) : "not set"}</span>
          <span>
            Legend: critical red · near critical gold · complete green · milestone diamond · hatched
            delay period
          </span>
        </footer>
      </section>
      <div
        className={cn(
          "constructline-screen-workbench rounded-lg border border-hairline bg-surface",
          isFullWorkspace ? "p-3 lg:p-4" : "p-5",
        )}
      >
        {!isFullWorkspace && (
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                ConstructLine beta
              </div>
              <h4 className="mt-1 font-serif text-2xl text-foreground">CPM schedule workbench</h4>
              <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                Build the working job schedule with activity IDs, divisions, start/finish dates,
                progress, predecessor/successor logic, float, critical path, and activity stacking.
              </p>
            </div>
          </div>
        )}

        {isWbsMigrationRequired && (
          <div className="mt-4 rounded-md border border-warning/25 bg-warning/10 px-4 py-3 text-sm text-warning">
            This project is using activity WBS paths for grouping. Schedule sections remain visible,
            and activity-level WBS edits still control where each row appears.
          </div>
        )}

        {!isFullWorkspace && isWbsPathFallback && (
          <div className="mt-4 rounded-md border border-hairline bg-card px-4 py-3 text-sm text-muted-foreground">
            Activity-path WBS mode is active. Parent and child areas save as readable paths such as
            Concrete / Northwest corner, so the CPM grid can group location, room, area, trade, or
            subcontractor sequences.
          </div>
        )}

        <ActivityScheduleMatrix
          matrixId="cpm-grid"
          model={displayedCpmModel}
          delayFragments={delayFragments}
          layoutStorageKey={cpmGridLayoutStorageKey}
          isDenseHeader={isFullWorkspace}
          draftEditor={isFocusOpen ? null : activityDraftEditor}
          toolbar={
            <CpmGridToolbar
              compact={isFullWorkspace}
              scheduleView={scheduleView}
              onScheduleViewChange={setScheduleView}
              activityOrder={activityOrder}
              onActivityOrderChange={setActivityOrder}
              dayPx={dayPx}
              onZoomChange={setDayPx}
              showLogicLines={showLogicLines}
              onToggleLogicLines={() => setShowLogicLines((visible) => !visible)}
              showBaselineBars={showBaselineBars}
              onToggleBaselineBars={() => setShowBaselineBars((visible) => !visible)}
              onManageWbs={() => setIsWbsManagerOpen(true)}
              onExpand={() => setIsFocusOpen(true)}
              onSeedActivities={() => onSeedActivities(milestoneSeedRows)}
              canSeedActivities={milestoneSeedRows.length > 0}
              isSeedingActivities={isSeedingActivities}
              onPrint={() => typeof window !== "undefined" && window.print()}
              onToggleActivityDraft={toggleActivityDraft}
              isActivityDraftOpen={showDraft}
              activityDraftMode={activityDraftMode}
              onFocusActivityDraft={() => scrollActivityDraftIntoView(draftFormRef)}
              onAddMilestone={openMilestoneDraft}
              dataDateDraft={dataDateDraft}
              latestDataDate={latestDataDate}
              isSavingDataDate={dataDateUpdate.isPending}
              onDataDateChange={setDataDateDraft}
              onSaveDataDate={saveDataDate}
              readinessWarningCount={updateReadiness.needsStatusCount}
              isReadinessWarningArmed={isReadinessSaveWarningArmed}
              templateName={templateName}
              onTemplateNameChange={setTemplateName}
              templates={cpmTemplates}
              selectedTemplateId={selectedTemplateId}
              onSelectedTemplateChange={setSelectedTemplateId}
              templatePersistence={templatePersistence}
              isTemplateLoading={templateQuery.isLoading}
              isSavingTemplate={templateSave.isPending}
              isApplyingTemplate={templateImport.isPending || isSeedingActivities}
              onSaveTemplate={saveCpmTemplate}
              onApplyTemplate={applySelectedCpmTemplate}
            />
          }
          viewSummary={scheduleViewSummary}
          emptyTitle={
            scheduleView === "all"
              ? "No CPM activities yet."
              : "No activities match this schedule view."
          }
          emptyDescription={
            scheduleView === "all"
              ? "Add the first activity to start building the working schedule."
              : "Switch back to All activities or choose a broader view."
          }
          dayPx={dayPx}
          onDayPxChange={setDayPx}
          dataDate={effectiveDataDate}
          showLogicLines={showLogicLines}
          showBaselineBars={showBaselineBars}
          onOpenActivity={(activity) => setSelectedActivityId(activity.id)}
          onDeleteActivity={(id) => {
            const activity = sortedActivities.find((item) => item.id === id);
            if (activity) confirmDeleteActivity(activity);
          }}
        />

        <ScheduleUpdateReadinessPanel
          summary={updateReadiness}
          dataDate={effectiveDataDate}
          onShowActive={() => setScheduleView("active")}
          onShowUpdateQueue={() => setScheduleView("update_queue")}
          onOpenActivity={(activity) => setSelectedActivityId(activity.id)}
        />

        <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="rounded-md border border-hairline bg-card p-4">
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" />
              Schedule intelligence
            </div>
            <div className="mt-3 grid gap-2 md:grid-cols-2">
              {cpmModel.recommendations.slice(0, 4).map((item) => (
                <div
                  key={item}
                  className="rounded border border-hairline bg-surface px-3 py-2 text-sm text-foreground"
                >
                  {item}
                </div>
              ))}
            </div>
            {cpmModel.diagnostics.length > 0 && (
              <div className="mt-3 rounded border border-warning/25 bg-warning/10 px-3 py-2 text-xs text-warning">
                {cpmModel.diagnostics.slice(0, 2).join(" ")}
              </div>
            )}
            {delaySummary.openCount > 0 && (
              <div className="mt-3 rounded border border-danger/20 bg-danger/10 px-3 py-2 text-xs text-danger">
                Delay ledger has {delaySummary.openCount} open fragment
                {delaySummary.openCount === 1 ? "" : "s"} totaling {delaySummary.openDays} days.
                {delaySummary.driverLabels.length > 0
                  ? ` Drivers: ${delaySummary.driverLabels.join(", ")}.`
                  : ""}
              </div>
            )}
          </div>
          <div className="rounded-md border border-hairline bg-card p-4">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <Layers className="h-3.5 w-3.5" />
                Activity stacking
              </div>
              <div className="text-xs font-semibold tabular text-foreground">
                {cpmModel.maxStack} peak
              </div>
            </div>
            <StackingMiniMap model={cpmModel} />
          </div>
        </div>

        <ScheduleQualityQueue
          items={qualityQueueItems}
          onShowIssues={() => setScheduleView("issues")}
          onOpenActivity={(activity) => setSelectedActivityId(activity.id)}
        />

        <div className="mt-5 grid gap-3 md:grid-cols-4">
          <ScheduleWorkbenchStat
            label="Activities"
            value={String(sortedActivities.length)}
            sub="in plan"
          />
          <ScheduleWorkbenchStat
            label="Complete"
            value={`${completedActivities}/${sortedActivities.length || 0}`}
            sub="progress count"
            tone={completedActivities > 0 ? "success" : "default"}
          />
          <ScheduleWorkbenchStat
            label="Logic ties"
            value={String(activitiesWithLogic)}
            sub="pred / succ"
            tone={activitiesWithLogic > 0 ? "success" : "warning"}
          />
          <ScheduleWorkbenchStat
            label="Dated"
            value={`${activitiesWithDates}/${sortedActivities.length || 0}`}
            sub={`${shortDate(bounds.startLabel)} to ${shortDate(bounds.endLabel)}`}
          />
        </div>

        {milestones.length > 0 && milestoneSeedRows.length > 0 && (
          <div className="mt-4 rounded-md border border-hairline bg-card p-3 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">Milestone bridge:</span>{" "}
            {milestoneSeedRows.length} milestone {milestoneSeedRows.length === 1 ? "is" : "are"}{" "}
            ready to become CPM activity rows. Build them once, then add logic ties and update
            percent complete from the schedule workbench.
          </div>
        )}
      </div>

      {isFocusOpen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background p-2 text-foreground print:hidden sm:p-3">
          <div className="mb-2 flex shrink-0 flex-col gap-2 rounded-md border border-hairline bg-card px-3 py-2 shadow-sm lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                ConstructLine CPM grid
              </div>
              <div className="mt-0.5 font-serif text-lg text-foreground">
                {project.name} schedule
              </div>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <CpmDataDateControl
                value={dataDateDraft}
                savedValue={latestDataDate}
                isSaving={dataDateUpdate.isPending}
                onChange={setDataDateDraft}
                onSave={saveDataDate}
                className="min-w-[260px]"
                readinessWarningCount={updateReadiness.needsStatusCount}
                isReadinessWarningArmed={isReadinessSaveWarningArmed}
              />
              <ScheduleViewControls value={scheduleView} onChange={setScheduleView} />
              <ScheduleOrderControls value={activityOrder} onChange={setActivityOrder} />
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => setIsWbsManagerOpen(true)}
              >
                <ListTree className="h-4 w-4" />
                WBS / areas
              </Button>
              <ScheduleZoomControls dayPx={dayPx} onChange={setDayPx} />
              <Button
                type="button"
                variant={showLogicLines ? "default" : "outline"}
                className="gap-2"
                aria-pressed={showLogicLines}
                onClick={() => setShowLogicLines((visible) => !visible)}
              >
                <GitBranch className="h-4 w-4" />
                Logic lines
              </Button>
              <Button
                type="button"
                variant={showBaselineBars ? "default" : "outline"}
                className="gap-2"
                aria-pressed={showBaselineBars}
                onClick={() => setShowBaselineBars((visible) => !visible)}
              >
                <Layers className="h-4 w-4" />
                Baseline
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                title="Print optimized for Tabloid / 11 x 17 landscape"
                onClick={() => typeof window !== "undefined" && window.print()}
              >
                <Printer className="h-4 w-4" />
                Print 11x17
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                disabled={milestoneSeedRows.length === 0 || isSeedingActivities}
                onClick={() => onSeedActivities(milestoneSeedRows)}
              >
                <ClipboardList className="h-4 w-4" />
                {isSeedingActivities ? "Building..." : "Build from milestones"}
              </Button>
              <Button
                type="button"
                variant={activityDraftMode === "activity" ? "default" : "outline"}
                className="gap-2"
                onClick={toggleActivityDraft}
              >
                <Plus className="h-4 w-4" />
                {activityDraftMode === "activity"
                  ? "Activity form open"
                  : showDraft
                    ? "Close form"
                    : "Add activity"}
              </Button>
              <Button
                type="button"
                variant={activityDraftMode === "milestone" ? "default" : "outline"}
                className="gap-2"
                onClick={openMilestoneDraft}
              >
                <Diamond className="h-4 w-4" />
                {activityDraftMode === "milestone" ? "Milestone form open" : "Add milestone"}
              </Button>
              {activityDraftMode && (
                <Button
                  type="button"
                  variant="outline"
                  className="gap-2"
                  onClick={() => scrollActivityDraftIntoView(draftFormRef)}
                >
                  Jump to form
                </Button>
              )}
              <Button type="button" className="gap-2" onClick={() => setIsFocusOpen(false)}>
                <Minimize2 className="h-4 w-4" />
                Close
              </Button>
            </div>
          </div>

          <ActivityScheduleMatrix
            model={displayedCpmModel}
            delayFragments={delayFragments}
            layoutStorageKey={cpmGridLayoutStorageKey}
            draftEditor={activityDraftEditor}
            dayPx={dayPx}
            onDayPxChange={setDayPx}
            dataDate={effectiveDataDate}
            viewSummary={scheduleViewSummary}
            emptyTitle={
              scheduleView === "all"
                ? "No CPM activities yet."
                : "No activities match this schedule view."
            }
            emptyDescription={
              scheduleView === "all"
                ? "Add the first activity to start building the working schedule."
                : "Switch back to All activities or choose a broader view."
            }
            showLogicLines={showLogicLines}
            showBaselineBars={showBaselineBars}
            isFocusMode
            onOpenActivity={(activity) => setSelectedActivityId(activity.id)}
            onDeleteActivity={(id) => {
              const activity = sortedActivities.find((item) => item.id === id);
              if (activity) confirmDeleteActivity(activity);
            }}
          />
        </div>
      )}

      {selectedActivity && (
        <ActivityDetailDialog
          activity={selectedActivity}
          activities={sortedActivities}
          dataDate={effectiveDataDate}
          updateQueueContext={selectedUpdateQueueContext}
          isSaving={isSavingActivity}
          onClose={() => setSelectedActivityId(null)}
          onSave={(patch) => onPatchActivity(selectedActivity.id, patch)}
          onSaveAndContinue={(nextActivity) => {
            setScheduleView("update_queue");
            setSelectedActivityId(nextActivity?.id ?? null);
          }}
          onDelete={() => confirmDeleteActivity(selectedActivity)}
          divisionOptions={knownWbsDivisions}
          delayFragments={delayFragments}
          delayFragmentPersistence={delayFragmentPersistence}
          isSavingDelayFragment={isSavingDelayFragment}
          onAddDelayFragment={onAddDelayFragment}
          onPatchDelayFragment={onPatchDelayFragment}
          onDeleteDelayFragment={onDeleteDelayFragment}
          isSendingToRiskTally={activityRiskCreate.isPending}
          onSendToRiskTally={(activity) => activityRiskCreate.mutateAsync(activity)}
        />
      )}

      <WbsManagerDialog
        open={isWbsManagerOpen}
        divisions={wbsDivisionRows}
        isSaving={isSavingWbs}
        onOpenChange={setIsWbsManagerOpen}
        onAddDivision={addWbsDivision}
        onRenameDivision={renameWbsDivision}
        onMoveDivisionParent={moveWbsDivisionParent}
        onMoveDivision={moveWbsDivision}
        onReorderDivisions={reorderWbsDivisions}
        isSavingOrder={isSavingWbsOrder}
        isPersistenceReady={!isWbsMigrationRequired}
        isPathFallback={isWbsPathFallback}
      />
    </>
  );
}
