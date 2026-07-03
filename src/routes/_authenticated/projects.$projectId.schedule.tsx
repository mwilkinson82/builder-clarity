import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  ClipboardList,
  Diamond,
  GitBranch,
  History,
  PackageSearch,
  Printer,
  Users,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CpmActivityPlanner, type ActivityCreateInput } from "@/components/schedule";
import { selectCanonicalLogicTieCount, selectLatestScheduleUpdate } from "@/lib/schedule-selectors";
import { buildWbsSectionPathMap, replaceWbsPathInDivision } from "@/lib/constructline-wbs";
import { getProject, type ProjectRow } from "@/lib/projects.functions";
import { type SovScheduleLine } from "@/lib/schedule-import";
import {
  createScheduleDelayFragment,
  createScheduleActivity,
  createScheduleWbsSection,
  deleteScheduleDelayFragment,
  deleteScheduleActivity,
  listSchedule,
  moveScheduleWbsSectionParent,
  renameScheduleWbsSection,
  reorderScheduleWbsSections,
  updateScheduleDelayFragment,
  updateScheduleActivity,
  type MilestoneRow,
  type ScheduleActivityRow,
  type ScheduleActivityUpdateRow,
  type ScheduleDelayFragmentRow,
  type ScheduleRiskRow,
  type ScheduleUpdateRow,
  type ScheduleWbsSectionRow,
} from "@/lib/schedule.functions";

type ScheduleQueryCache = {
  activities?: ScheduleActivityRow[];
  wbsSections?: ScheduleWbsSectionRow[];
} & Record<string, unknown>;
type WbsCreateInput = {
  name: string;
  parentId?: string | null;
};
type WbsRenameInput = {
  id: string;
  name: string;
};
type WbsReorderInput = {
  parentId: string | null;
  orderedIds: string[];
};
type WbsReorderPersistInput = WbsReorderInput & {
  saveVersion: number;
};
type WbsParentMoveInput = {
  id: string;
  parentId: string | null;
};
type ScheduleWorkspaceShellSummary = {
  activityCount: number;
  logicTieCount: number;
  latestDataDate: string | null;
  activeMilestoneCount: number;
  openRiskCount: number;
};
const WBS_ORDER_SAVE_DEBOUNCE_MS = 75;

function formatDelayFragmentError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message || "Refresh and try again.";
}

function formatActivityMutationError(error: unknown) {
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
  return message || "Refresh and try again.";
}

function formatWbsMutationError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message || "The WBS change did not save. Refresh and try again.";
}

function getNextWbsSortOrder(
  sections: ScheduleWbsSectionRow[] | undefined,
  parentId: string | null,
) {
  const siblings = (sections ?? []).filter((section) => (section.parent_id ?? null) === parentId);
  return Math.max(0, ...siblings.map((section) => section.sort_order ?? 0)) + 10;
}

function applyOptimisticWbsPathChange(
  current: ScheduleQueryCache | undefined,
  nextSections: ScheduleWbsSectionRow[],
  changedSectionId: string,
  previousPathMap: Map<string, string>,
) {
  if (!current?.wbsSections) return current;
  const nextPathMap = buildWbsSectionPathMap(nextSections);
  const oldPath = previousPathMap.get(changedSectionId);
  const newPath = nextPathMap.get(changedSectionId);
  return {
    ...current,
    wbsSections: nextSections,
    activities:
      oldPath && newPath && oldPath !== newPath
        ? current.activities?.map((activity) => ({
            ...activity,
            division: replaceWbsPathInDivision(activity.division, oldPath, newPath),
          }))
        : current.activities,
  };
}

function applyOptimisticWbsOrderChange(
  current: ScheduleQueryCache | undefined,
  orderedIds: string[],
) {
  if (!current?.wbsSections) return current;
  return {
    ...current,
    wbsSections: applyWbsOrderToSections(current.wbsSections, orderedIds),
  };
}

function applyWbsOrderToSections(sections: ScheduleWbsSectionRow[], orderedIds: string[]) {
  if (orderedIds.length === 0) return sections;
  const orderMap = new Map(orderedIds.map((id, index) => [id, (index + 1) * 10]));
  return sections.map((section) => ({
    ...section,
    sort_order: orderMap.get(section.id) ?? section.sort_order,
  }));
}

export const Route = createFileRoute("/_authenticated/projects/$projectId/schedule")({
  ssr: false,
  head: () => ({ meta: [{ title: "Construction Schedule — Overwatch" }] }),
  component: ScheduleWorkspacePage,
});

function ScheduleWorkspacePage() {
  const { projectId } = Route.useParams();
  const qc = useQueryClient();
  const getProjectFn = useServerFn(getProject);
  const listScheduleFn = useServerFn(listSchedule);
  const createActivityFn = useServerFn(createScheduleActivity);
  const updateActivityFn = useServerFn(updateScheduleActivity);
  const deleteActivityFn = useServerFn(deleteScheduleActivity);
  const createDelayFragmentFn = useServerFn(createScheduleDelayFragment);
  const updateDelayFragmentFn = useServerFn(updateScheduleDelayFragment);
  const deleteDelayFragmentFn = useServerFn(deleteScheduleDelayFragment);
  const createWbsSectionFn = useServerFn(createScheduleWbsSection);
  const moveWbsSectionParentFn = useServerFn(moveScheduleWbsSectionParent);
  const renameWbsSectionFn = useServerFn(renameScheduleWbsSection);
  const reorderWbsSectionsFn = useServerFn(reorderScheduleWbsSections);
  const wbsOrderToastRef = useRef<string | number | null>(null);
  const wbsOrderSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wbsOrderRollbackRef = useRef<ScheduleQueryCache | undefined>(undefined);
  const wbsQueuedOrderRef = useRef<WbsReorderInput | null>(null);
  const wbsOrderVersionRef = useRef(0);
  const [isWbsOrderSaveQueued, setIsWbsOrderSaveQueued] = useState(false);

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProjectFn({ data: { projectId } }),
  });
  const scheduleQuery = useQuery({
    queryKey: ["schedule", projectId],
    queryFn: () => listScheduleFn({ data: { projectId } }),
  });

  const project = projectQuery.data?.project as ProjectRow | undefined;
  // SOV lines for Build-from-SOV: the project query already carries the cost
  // buckets, so the schedule page reads them without an extra fetch.
  const sovLines = useMemo(
    () => (projectQuery.data?.buckets ?? []) as SovScheduleLine[],
    [projectQuery.data?.buckets],
  );
  const activities = useMemo(
    () => (scheduleQuery.data?.activities ?? []) as ScheduleActivityRow[],
    [scheduleQuery.data?.activities],
  );
  const wbsSections = useMemo(() => {
    const sections = (scheduleQuery.data?.wbsSections ?? []) as ScheduleWbsSectionRow[];
    const queuedOrder = wbsQueuedOrderRef.current;
    if (!isWbsOrderSaveQueued || !queuedOrder) return sections;
    return applyWbsOrderToSections(sections, queuedOrder.orderedIds);
  }, [isWbsOrderSaveQueued, scheduleQuery.data?.wbsSections]);
  const milestones = useMemo(
    () => (scheduleQuery.data?.milestones ?? []) as MilestoneRow[],
    [scheduleQuery.data?.milestones],
  );
  const updates = useMemo(
    () => (scheduleQuery.data?.updates ?? []) as ScheduleUpdateRow[],
    [scheduleQuery.data?.updates],
  );
  const activityUpdates = useMemo(
    () => (scheduleQuery.data?.activityUpdates ?? []) as ScheduleActivityUpdateRow[],
    [scheduleQuery.data?.activityUpdates],
  );
  const risks = useMemo(
    () => (scheduleQuery.data?.risks ?? []) as ScheduleRiskRow[],
    [scheduleQuery.data?.risks],
  );
  const delayFragments = useMemo(
    () => (scheduleQuery.data?.delayFragments ?? []) as ScheduleDelayFragmentRow[],
    [scheduleQuery.data?.delayFragments],
  );
  const latestUpdate = selectLatestScheduleUpdate(updates);
  const shellSummary = useMemo<ScheduleWorkspaceShellSummary>(
    () => ({
      activityCount: activities.length,
      logicTieCount: selectCanonicalLogicTieCount(activities),
      latestDataDate: latestUpdate?.data_date ?? null,
      activeMilestoneCount: milestones.filter((milestone) => milestone.status !== "complete")
        .length,
      openRiskCount: risks.filter((risk) => risk.status === "active").length,
    }),
    [activities, latestUpdate?.data_date, milestones, risks],
  );

  const refreshSchedule = async () => {
    await qc.invalidateQueries({ queryKey: ["schedule", projectId] });
    await qc.invalidateQueries({ queryKey: ["project", projectId] });
    await qc.invalidateQueries({ queryKey: ["projects"] });
  };

  useEffect(
    () => () => {
      if (wbsOrderSaveTimerRef.current) {
        clearTimeout(wbsOrderSaveTimerRef.current);
      }
    },
    [],
  );

  const activityCreate = useMutation({
    mutationFn: (activity: ActivityCreateInput) =>
      createActivityFn({ data: { projectId, ...activity } }),
    onSuccess: async () => {
      await refreshSchedule();
      toast.success("Activity added", {
        description: "The row is now in the project schedule workspace.",
      });
    },
    onError: (error) => {
      toast.error("Activity did not save", {
        description: formatActivityMutationError(error),
      });
    },
  });

  const activitySeed = useMutation({
    mutationFn: async (items: ActivityCreateInput[]) => {
      for (const item of items) {
        await createActivityFn({ data: { projectId, ...item } });
      }
    },
    onSuccess: async (_result, items) => {
      await refreshSchedule();
      toast.success("CPM rows created", {
        description: `${items.length} schedule ${items.length === 1 ? "row" : "rows"} added to the schedule workspace.`,
      });
    },
    onError: (error) => {
      toast.error("CPM rows did not save", {
        description: formatActivityMutationError(error),
      });
    },
  });

  const activityUpdate = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Partial<ScheduleActivityRow>;
      silent?: boolean;
    }) => updateActivityFn({ data: { id, patch } }),
    onSuccess: async (_result, variables) => {
      await refreshSchedule();
      if (!variables.silent) {
        toast.success("Activity updated", {
          description: "The CPM row and logic ties were saved.",
        });
      }
    },
    onError: (error) => {
      toast.error("Activity did not update", {
        description: formatActivityMutationError(error),
      });
    },
  });

  const activityDelete = useMutation({
    mutationFn: ({ id }: { id: string }) => deleteActivityFn({ data: { id } }),
    onSuccess: async () => {
      await refreshSchedule();
      toast.success("Activity deleted");
    },
    onError: (error) => {
      toast.error("Activity did not delete", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });

  const wbsCreate = useMutation({
    mutationFn: ({ name, parentId }: WbsCreateInput) =>
      createWbsSectionFn({ data: { projectId, name, parentId: parentId ?? null } }),
    onMutate: async ({ name, parentId }) => {
      await qc.cancelQueries({ queryKey: ["schedule", projectId] });
      const previous = qc.getQueryData<ScheduleQueryCache>(["schedule", projectId]);
      const cleanName = name.trim() || "General";
      const normalizedParentId = parentId ?? null;
      const optimisticId = `optimistic-wbs-${Date.now()}`;
      qc.setQueryData<ScheduleQueryCache>(["schedule", projectId], (current) => {
        if (!current?.wbsSections) return current;
        return {
          ...current,
          wbsSections: [
            ...current.wbsSections,
            {
              id: optimisticId,
              project_id: projectId,
              parent_id: normalizedParentId,
              name: cleanName,
              code: "",
              sort_order: getNextWbsSortOrder(current.wbsSections, normalizedParentId),
            },
          ],
        };
      });
      toast.success(normalizedParentId ? "Child WBS added" : "WBS added", {
        description: normalizedParentId
          ? "The child area is visible now. Saving in the background."
          : "The WBS section is visible now. Saving in the background.",
        duration: 1600,
      });
      return { previous };
    },
    onSuccess: async () => {
      await refreshSchedule();
      toast.success("WBS saved", {
        description: "The project hierarchy is saved.",
        duration: 1400,
      });
    },
    onError: (error, _variables, context) => {
      if (context?.previous) qc.setQueryData(["schedule", projectId], context.previous);
      toast.error("WBS did not save", {
        description: formatWbsMutationError(error),
      });
    },
  });

  const wbsRename = useMutation({
    mutationFn: ({ id, name }: WbsRenameInput) => renameWbsSectionFn({ data: { id, name } }),
    onMutate: async ({ id, name }) => {
      await qc.cancelQueries({ queryKey: ["schedule", projectId] });
      const previous = qc.getQueryData<ScheduleQueryCache>(["schedule", projectId]);
      const previousPathMap = buildWbsSectionPathMap(previous?.wbsSections);
      qc.setQueryData<ScheduleQueryCache>(["schedule", projectId], (current) => {
        if (!current?.wbsSections) return current;
        const nextSections = current.wbsSections.map((section) =>
          section.id === id ? { ...section, name: name.trim() || "General" } : section,
        );
        return applyOptimisticWbsPathChange(current, nextSections, id, previousPathMap);
      });
      toast.success("WBS title applied", {
        description: "The hierarchy and matching activity paths moved immediately.",
        duration: 1600,
      });
      return { previous };
    },
    onSuccess: async () => {
      await refreshSchedule();
      toast.success("WBS renamed", {
        description: "Matching activity divisions were updated.",
        duration: 1400,
      });
    },
    onError: (error, _variables, context) => {
      if (context?.previous) qc.setQueryData(["schedule", projectId], context.previous);
      toast.error("WBS did not update", {
        description: formatWbsMutationError(error),
      });
    },
  });

  const wbsParentMove = useMutation({
    mutationFn: ({ id, parentId }: WbsParentMoveInput) =>
      moveWbsSectionParentFn({ data: { id, parentId } }),
    onMutate: async ({ id, parentId }) => {
      await qc.cancelQueries({ queryKey: ["schedule", projectId] });
      const previous = qc.getQueryData<ScheduleQueryCache>(["schedule", projectId]);
      const normalizedParentId = parentId ?? null;
      const previousPathMap = buildWbsSectionPathMap(previous?.wbsSections);
      qc.setQueryData<ScheduleQueryCache>(["schedule", projectId], (current) => {
        if (!current?.wbsSections) return current;
        const nextSortOrder = getNextWbsSortOrder(
          current.wbsSections.filter((section) => section.id !== id),
          normalizedParentId,
        );
        const nextSections = current.wbsSections.map((section) =>
          section.id === id
            ? { ...section, parent_id: normalizedParentId, sort_order: nextSortOrder }
            : section,
        );
        return applyOptimisticWbsPathChange(current, nextSections, id, previousPathMap);
      });
      toast.success(normalizedParentId ? "WBS nested" : "WBS moved to top level", {
        description: "The grid moved immediately. Saving in the background.",
        duration: 1600,
      });
      return { previous };
    },
    onSuccess: async () => {
      await refreshSchedule();
      toast.success("WBS parent updated", {
        description: "The section and matching activity paths were moved.",
        duration: 1400,
      });
    },
    onError: (error, _variables, context) => {
      if (context?.previous) qc.setQueryData(["schedule", projectId], context.previous);
      toast.error("WBS parent did not update", {
        description: formatWbsMutationError(error),
      });
    },
  });

  const wbsReorder = useMutation({
    mutationFn: ({ parentId, orderedIds }: WbsReorderPersistInput) =>
      reorderWbsSectionsFn({ data: { projectId, parentId, orderedIds } }),
    onSuccess: async (_result, variables) => {
      if (variables.saveVersion !== wbsOrderVersionRef.current) return;
      await refreshSchedule();
      const toastId = wbsOrderToastRef.current ?? "wbs-order-save";
      toast.success("WBS order saved", {
        id: toastId,
        description: "Saved order confirmed.",
        duration: 1200,
      });
      wbsOrderToastRef.current = null;
      wbsOrderRollbackRef.current = undefined;
      wbsQueuedOrderRef.current = null;
      setIsWbsOrderSaveQueued(false);
    },
    onError: (error, variables) => {
      if (variables.saveVersion !== wbsOrderVersionRef.current) return;
      if (wbsOrderRollbackRef.current) {
        qc.setQueryData(["schedule", projectId], wbsOrderRollbackRef.current);
      }
      toast.error("WBS order did not save", {
        id: wbsOrderToastRef.current ?? "wbs-order-error",
        description: formatWbsMutationError(error),
      });
      wbsOrderToastRef.current = null;
      wbsOrderRollbackRef.current = undefined;
      wbsQueuedOrderRef.current = null;
      setIsWbsOrderSaveQueued(false);
    },
  });

  const queueWbsReorder = useCallback(
    (payload: WbsReorderInput) => {
      const toastId = wbsOrderToastRef.current ?? "wbs-order-save";
      wbsOrderToastRef.current = toastId;
      if (wbsOrderSaveTimerRef.current) {
        clearTimeout(wbsOrderSaveTimerRef.current);
      }

      const saveVersion = wbsOrderVersionRef.current + 1;
      wbsOrderVersionRef.current = saveVersion;
      const previous = qc.getQueryData<ScheduleQueryCache>(["schedule", projectId]);
      if (!wbsOrderRollbackRef.current) {
        wbsOrderRollbackRef.current = previous;
      }
      qc.setQueryData<ScheduleQueryCache>(["schedule", projectId], (current) =>
        applyOptimisticWbsOrderChange(current, payload.orderedIds),
      );
      void qc.cancelQueries({ queryKey: ["schedule", projectId] });
      wbsQueuedOrderRef.current = payload;
      setIsWbsOrderSaveQueued(true);
      toast.success("WBS order applied", {
        id: toastId,
        description: "The grid moved now. Final save is confirming in the background.",
        duration: 1400,
      });

      wbsOrderSaveTimerRef.current = setTimeout(() => {
        const queuedOrder = wbsQueuedOrderRef.current;
        wbsOrderSaveTimerRef.current = null;
        if (!queuedOrder) {
          setIsWbsOrderSaveQueued(false);
          return;
        }
        wbsReorder.mutate({ ...queuedOrder, saveVersion });
      }, WBS_ORDER_SAVE_DEBOUNCE_MS);
    },
    [projectId, qc, wbsReorder],
  );

  const delayFragmentCreate = useMutation({
    mutationFn: (fragment: {
      schedule_activity_id?: string | null;
      activity_id?: string;
      title: string;
      reason?: string;
      delay_days?: number;
      source?: ScheduleDelayFragmentRow["source"];
      status?: ScheduleDelayFragmentRow["status"];
      owner?: string;
      identified_on?: string;
      resolved_on?: string | null;
    }) => createDelayFragmentFn({ data: { projectId, ...fragment } }),
    onSuccess: async () => {
      await refreshSchedule();
      toast.success("Delay impact added", {
        description: "The delay is now tied to this CPM schedule.",
      });
    },
    onError: (error) => {
      toast.error("Delay impact did not save", {
        description: formatDelayFragmentError(error),
      });
    },
  });

  const delayFragmentUpdate = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ScheduleDelayFragmentRow> }) =>
      updateDelayFragmentFn({ data: { id, patch } }),
    onSuccess: async () => {
      await refreshSchedule();
      toast.success("Delay impact updated");
    },
    onError: (error) => {
      toast.error("Delay impact did not update", {
        description: formatDelayFragmentError(error),
      });
    },
  });

  const delayFragmentDelete = useMutation({
    mutationFn: (id: string) => deleteDelayFragmentFn({ data: { id } }),
    onSuccess: async () => {
      await refreshSchedule();
      toast.success("Delay impact removed");
    },
    onError: (error) => {
      toast.error("Delay impact did not delete", {
        description: formatDelayFragmentError(error),
      });
    },
  });

  if (projectQuery.isLoading || scheduleQuery.isLoading) {
    return (
      <ScheduleWorkspaceShell>
        <div className="rounded-lg border border-hairline bg-card p-8 text-sm text-muted-foreground">
          Loading construction schedule...
        </div>
      </ScheduleWorkspaceShell>
    );
  }

  if (projectQuery.error || scheduleQuery.error || !project) {
    const message =
      projectQuery.error instanceof Error
        ? projectQuery.error.message
        : scheduleQuery.error instanceof Error
          ? scheduleQuery.error.message
          : "The project schedule could not be loaded.";
    return (
      <ScheduleWorkspaceShell>
        <div className="rounded-lg border border-danger/30 bg-danger/10 p-6">
          <h1 className="font-serif text-2xl text-danger">Schedule did not load</h1>
          <p className="mt-2 text-sm text-danger/80">{message}</p>
          <Button
            type="button"
            className="mt-4"
            variant="outline"
            onClick={() => {
              void projectQuery.refetch();
              void scheduleQuery.refetch();
            }}
          >
            Retry
          </Button>
        </div>
      </ScheduleWorkspaceShell>
    );
  }

  return (
    <ScheduleWorkspaceShell project={project} summary={shellSummary}>
      <CpmActivityPlanner
        workspaceMode="full"
        activities={activities}
        wbsSections={wbsSections}
        delayFragments={delayFragments}
        milestones={milestones}
        updates={updates}
        project={project}
        latestDataDate={latestUpdate?.data_date ?? null}
        sovLines={sovLines}
        onAddActivity={(activity) => activityCreate.mutateAsync(activity)}
        onSeedActivities={(items) => activitySeed.mutate(items)}
        isSeedingActivities={activitySeed.isPending}
        onPatchActivity={async (id, patch, options) => {
          await activityUpdate.mutateAsync({ id, patch, silent: options?.silent });
        }}
        isSavingActivity={activityCreate.isPending || activityUpdate.isPending}
        onDeleteActivity={(id) => activityDelete.mutate({ id })}
        onAddDelayFragment={async (fragment) => {
          await delayFragmentCreate.mutateAsync(fragment);
        }}
        onPatchDelayFragment={async (id, patch) => {
          await delayFragmentUpdate.mutateAsync({ id, patch });
        }}
        onDeleteDelayFragment={async (id) => {
          await delayFragmentDelete.mutateAsync(id);
        }}
        isSavingDelayFragment={
          delayFragmentCreate.isPending ||
          delayFragmentUpdate.isPending ||
          delayFragmentDelete.isPending
        }
        onAddWbsSection={async (name, parentId) => {
          await wbsCreate.mutateAsync({ name, parentId });
        }}
        onRenameWbsSection={async (id, name) => {
          await wbsRename.mutateAsync({ id, name });
        }}
        onMoveWbsSectionParent={async (id, parentId) => {
          await wbsParentMove.mutateAsync({ id, parentId });
        }}
        onReorderWbsSections={async (payload) => {
          await queueWbsReorder(payload);
        }}
        isSavingWbs={wbsCreate.isPending || wbsRename.isPending || wbsParentMove.isPending}
        isSavingWbsOrder={wbsReorder.isPending || isWbsOrderSaveQueued}
      />

      <ScheduleWorkspaceOperations
        milestones={milestones}
        risks={risks}
        updates={updates}
        activityUpdates={activityUpdates}
        project={project}
      />
    </ScheduleWorkspaceShell>
  );
}

function ScheduleWorkspaceShell({
  project,
  summary,
  children,
}: {
  project?: ProjectRow;
  summary?: ScheduleWorkspaceShellSummary;
  children: ReactNode;
}) {
  return (
    <div className="constructline-schedule-page min-h-screen overflow-x-clip bg-background text-foreground print:bg-white">
      <header className="sticky top-0 z-50 border-b border-hairline bg-background shadow-sm print:static">
        <div className="mx-auto flex w-full max-w-[1840px] flex-col gap-3 px-4 py-4 lg:px-8">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
              <Button asChild variant="ghost" className="w-fit gap-2 print:hidden">
                <a href={project ? `/projects/${project.id}` : "/"}>
                  <ArrowLeft className="h-4 w-4" />
                  Back to IOR
                </a>
              </Button>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {project?.organization_name || "Company"}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
                  {project?.job_number && <span>Job # {project.job_number}</span>}
                  {project?.client && <span>{project.client}</span>}
                  {project?.project_manager && <span>PM {project.project_manager}</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 print:hidden">
              <WorkspaceNavLink href="#cpm-grid" tone="primary">
                CPM table + Gantt
              </WorkspaceNavLink>
              <WorkspaceNavLink href="#schedule-update-history">Updates</WorkspaceNavLink>
              <WorkspaceNavLink href="#interim-milestones">Milestones</WorkspaceNavLink>
              <WorkspaceNavLink href="#critical-delayed-decisions">Decisions</WorkspaceNavLink>
              <WorkspaceNavLink href="#procurement-risks">Procurement</WorkspaceNavLink>
              <WorkspaceNavLink href="#trade-performance-risks">Trades</WorkspaceNavLink>
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
            </div>
          </div>
          {summary && <ScheduleWorkspaceHeaderStats summary={summary} />}
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1840px] px-4 py-5 lg:px-8">{children}</main>
    </div>
  );
}

function ScheduleWorkspaceHeaderStats({ summary }: { summary: ScheduleWorkspaceShellSummary }) {
  return (
    <div className="constructline-workspace-status grid gap-2 print:hidden sm:grid-cols-2 lg:grid-cols-5">
      <ScheduleWorkspaceHeaderStat
        icon={ClipboardList}
        label="Activities"
        value={String(summary.activityCount)}
      />
      <ScheduleWorkspaceHeaderStat
        icon={GitBranch}
        label="Logic ties"
        value={String(summary.logicTieCount)}
      />
      <ScheduleWorkspaceHeaderStat
        icon={CalendarDays}
        label="Last update"
        value={summary.latestDataDate ? formatDate(summary.latestDataDate) : "Not set"}
      />
      <ScheduleWorkspaceHeaderStat
        icon={Diamond}
        label="Milestones"
        value={String(summary.activeMilestoneCount)}
      />
      <ScheduleWorkspaceHeaderStat
        icon={AlertTriangle}
        label="Open risks"
        value={String(summary.openRiskCount)}
      />
    </div>
  );
}

function ScheduleWorkspaceHeaderStat({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-md border border-hairline bg-card/80 px-3 py-2 shadow-sm">
      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0">
        <div className="truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </div>
        <div className="truncate text-sm font-semibold tabular text-foreground">{value}</div>
      </div>
    </div>
  );
}

function WorkspaceNavLink({
  href,
  tone = "default",
  children,
}: {
  href: string;
  tone?: "default" | "primary";
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className={`inline-flex h-10 items-center rounded-md border px-3 text-sm font-semibold shadow-sm transition ${
        tone === "primary"
          ? "border-foreground bg-foreground text-background hover:bg-foreground/90"
          : "border-hairline bg-card text-foreground hover:bg-muted"
      }`}
    >
      {children}
    </a>
  );
}

function ScheduleWorkspaceOperations({
  milestones,
  risks,
  updates,
  activityUpdates,
  project,
}: {
  milestones: MilestoneRow[];
  risks: ScheduleRiskRow[];
  updates: ScheduleUpdateRow[];
  activityUpdates: ScheduleActivityUpdateRow[];
  project: ProjectRow;
}) {
  const activeMilestones = milestones
    .filter((milestone) => milestone.status !== "complete")
    .sort((a, b) =>
      (a.forecast_date ?? a.baseline_date ?? "9999-12-31").localeCompare(
        b.forecast_date ?? b.baseline_date ?? "9999-12-31",
      ),
    )
    .slice(0, 4);
  const delayedDecisions = risks.filter((risk) => risk.kind === "critical_decision").slice(0, 4);
  const procurementRisks = risks.filter((risk) => risk.kind === "procurement").slice(0, 4);
  const tradeRisks = risks.filter((risk) => risk.kind === "trade_performance").slice(0, 4);
  const latestUpdate = updates[0] ?? null;
  const activitySnapshotCountByUpdate = activityUpdates.reduce<Record<number, number>>(
    (acc, snapshot) => {
      acc[snapshot.update_number] = (acc[snapshot.update_number] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return (
    <section className="constructline-screen-ops mb-4 mt-5 scroll-mt-28 rounded-lg border border-hairline bg-surface p-5">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Schedule operations
          </div>
          <h2 className="mt-1 font-serif text-2xl text-foreground">
            Updates, milestones, and schedule-linked risks
          </h2>
        </div>
        <div className="max-w-3xl text-sm leading-6 text-muted-foreground">
          This workspace keeps CPM activity planning beside the operational signals that explain why
          the schedule moved.
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-12">
        <ScheduleOpsCard
          id="schedule-update-history"
          icon={History}
          label="Schedule update history"
          title={`${updates.length} saved ${updates.length === 1 ? "update" : "updates"}`}
          sub={
            latestUpdate
              ? `Latest ${formatDate(latestUpdate.data_date)} · ${formatVariance(latestUpdate.variance_weeks)} vs baseline`
              : `Baseline ${formatDate(project.baseline_completion_date)} · Forecast ${formatDate(
                  project.forecast_completion_date,
                )}`
          }
          className="xl:col-span-4"
        >
          {updates.length === 0 ? (
            <ScheduleOpsEmpty>No saved schedule updates yet.</ScheduleOpsEmpty>
          ) : (
            updates
              .slice(0, 4)
              .map((update) => (
                <ScheduleOpsItem
                  key={update.id}
                  title={`Update #${update.update_number} · ${formatDate(update.data_date)}`}
                  meta={`${formatVariance(update.variance_weeks)} vs baseline · finish ${formatDate(
                    update.forecast_completion_date,
                  )} · ${activitySnapshotCountByUpdate[update.update_number] ?? 0} activity snapshots`}
                />
              ))
          )}
        </ScheduleOpsCard>

        <ScheduleOpsCard
          id="interim-milestones"
          icon={Diamond}
          label="Interim milestones"
          title={`${activeMilestones.length} active`}
          sub="Forecast checkpoints"
          className="xl:col-span-4"
        >
          {activeMilestones.length === 0 ? (
            <ScheduleOpsEmpty>No active interim milestones.</ScheduleOpsEmpty>
          ) : (
            activeMilestones.map((milestone) => (
              <ScheduleOpsItem
                key={milestone.id}
                title={milestone.name}
                meta={`${formatDate(milestone.forecast_date ?? milestone.baseline_date)} · ${milestone.status.replace(
                  "_",
                  " ",
                )}`}
              />
            ))
          )}
        </ScheduleOpsCard>

        <RiskOpsCard
          id="critical-delayed-decisions"
          icon={ClipboardList}
          label="Critical delayed decisions"
          risks={delayedDecisions}
          empty="No critical decision risks."
          className="xl:col-span-4"
        />
        <RiskOpsCard
          id="procurement-risks"
          icon={PackageSearch}
          label="Procurement risks"
          risks={procurementRisks}
          empty="No procurement risks."
          className="xl:col-span-6"
        />
        <RiskOpsCard
          id="trade-performance-risks"
          icon={Users}
          label="Trade performance risks"
          risks={tradeRisks}
          empty="No trade performance risks."
          className="xl:col-span-6"
        />
      </div>
    </section>
  );
}

function RiskOpsCard({
  id,
  icon,
  label,
  risks,
  empty,
  className,
}: {
  id?: string;
  icon: LucideIcon;
  label: string;
  risks: ScheduleRiskRow[];
  empty: string;
  className?: string;
}) {
  return (
    <ScheduleOpsCard
      id={id}
      icon={icon}
      label={label}
      title={`${risks.length} open`}
      sub="Schedule-linked risk"
      className={className}
    >
      {risks.length === 0 ? (
        <ScheduleOpsEmpty>{empty}</ScheduleOpsEmpty>
      ) : (
        risks.map((risk) => (
          <ScheduleOpsItem
            key={risk.id}
            title={risk.title}
            meta={`${risk.owner || "Unassigned"} · ${
              risk.schedule_impact_weeks == null
                ? "No duration"
                : `${risk.schedule_impact_weeks} wk`
            }`}
          />
        ))
      )}
    </ScheduleOpsCard>
  );
}

function ScheduleOpsCard({
  id,
  icon: Icon = AlertTriangle,
  label,
  title,
  sub,
  children,
  className,
}: {
  id?: string;
  icon?: LucideIcon;
  label: string;
  title: string;
  sub: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      id={id}
      className={`min-w-0 scroll-mt-28 rounded-lg border border-hairline bg-card p-4 shadow-sm ${className ?? ""}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface text-muted-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {label}
          </div>
          <div className="mt-1 break-words text-lg font-semibold leading-6 text-foreground">
            {title}
          </div>
          <div className="mt-1 break-words text-xs leading-5 text-muted-foreground">{sub}</div>
        </div>
      </div>
      <div className="mt-3 grid gap-2">{children}</div>
    </div>
  );
}

function ScheduleOpsItem({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="min-w-0 rounded border border-hairline bg-surface px-3 py-2">
      <div className="break-words text-sm font-semibold leading-5 text-foreground">{title}</div>
      <div className="mt-1 break-words text-xs leading-5 text-muted-foreground">{meta}</div>
    </div>
  );
}

function ScheduleOpsEmpty({ children }: { children: ReactNode }) {
  return (
    <div className="rounded border border-dashed border-hairline bg-surface/70 px-3 py-3 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not set";
  const [year, month, day] = value.split("-");
  if (!year || !month || !day) return value;
  return `${month}/${day}/${year}`;
}

function formatVariance(value: number | null) {
  if (value == null) return "Not set";
  if (value > 0) return `+${value} wk`;
  if (value < 0) return `${value} wk`;
  return "On plan";
}
