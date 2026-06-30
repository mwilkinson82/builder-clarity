import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CpmActivityPlanner, type ActivityCreateInput } from "@/components/outcome/ScheduleRisk";
import { getProject, type ProjectRow } from "@/lib/projects.functions";
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
  type ScheduleDelayFragmentRow,
  type ScheduleRiskRow,
  type ScheduleUpdateRow,
  type ScheduleWbsSectionRow,
} from "@/lib/schedule.functions";

type ScheduleQueryCache = {
  wbsSections?: ScheduleWbsSectionRow[];
} & Record<string, unknown>;
type WbsReorderInput = {
  parentId: string | null;
  orderedIds: string[];
};
type WbsParentMoveInput = {
  id: string;
  parentId: string | null;
};

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

  const projectQuery = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => getProjectFn({ data: { projectId } }),
  });
  const scheduleQuery = useQuery({
    queryKey: ["schedule", projectId],
    queryFn: () => listScheduleFn({ data: { projectId } }),
  });

  const project = projectQuery.data?.project as ProjectRow | undefined;
  const activities = useMemo(
    () => (scheduleQuery.data?.activities ?? []) as ScheduleActivityRow[],
    [scheduleQuery.data?.activities],
  );
  const wbsSections = useMemo(
    () => (scheduleQuery.data?.wbsSections ?? []) as ScheduleWbsSectionRow[],
    [scheduleQuery.data?.wbsSections],
  );
  const milestones = useMemo(
    () => (scheduleQuery.data?.milestones ?? []) as MilestoneRow[],
    [scheduleQuery.data?.milestones],
  );
  const updates = useMemo(
    () => (scheduleQuery.data?.updates ?? []) as ScheduleUpdateRow[],
    [scheduleQuery.data?.updates],
  );
  const risks = useMemo(
    () => (scheduleQuery.data?.risks ?? []) as ScheduleRiskRow[],
    [scheduleQuery.data?.risks],
  );
  const delayFragments = useMemo(
    () => (scheduleQuery.data?.delayFragments ?? []) as ScheduleDelayFragmentRow[],
    [scheduleQuery.data?.delayFragments],
  );
  const wbsPersistence =
    scheduleQuery.data?.wbsPersistence === "migration_required" ? "migration_required" : "ready";
  const delayFragmentPersistence =
    scheduleQuery.data?.delayFragmentPersistence === "migration_required"
      ? "migration_required"
      : "ready";
  const latestUpdate = updates[0] ?? null;

  const refreshSchedule = async () => {
    await qc.invalidateQueries({ queryKey: ["schedule", projectId] });
    await qc.invalidateQueries({ queryKey: ["project", projectId] });
    await qc.invalidateQueries({ queryKey: ["projects"] });
  };

  const activityCreate = useMutation({
    mutationFn: (activity: ActivityCreateInput) =>
      createActivityFn({ data: { projectId, ...activity } }),
    onSuccess: () => {
      void refreshSchedule();
      toast.success("Activity added", {
        description: "The row is now in the project schedule workspace.",
      });
    },
    onError: (error) => {
      toast.error("Activity did not save", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });

  const activitySeed = useMutation({
    mutationFn: async (items: ActivityCreateInput[]) => {
      for (const item of items) {
        await createActivityFn({ data: { projectId, ...item } });
      }
    },
    onSuccess: (_result, items) => {
      void refreshSchedule();
      toast.success("CPM rows created", {
        description: `${items.length} milestone ${items.length === 1 ? "row" : "rows"} added to the schedule workspace.`,
      });
    },
    onError: (error) => {
      toast.error("CPM rows did not save", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
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
    onSuccess: (_result, variables) => {
      void refreshSchedule();
      if (!variables.silent) {
        toast.success("Activity updated", {
          description: "The CPM row and logic ties were saved.",
        });
      }
    },
    onError: (error) => {
      toast.error("Activity did not update", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });

  const activityDelete = useMutation({
    mutationFn: ({ id }: { id: string }) => deleteActivityFn({ data: { id } }),
    onSuccess: () => {
      void refreshSchedule();
      toast.success("Activity deleted");
    },
    onError: (error) => {
      toast.error("Activity did not delete", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });

  const wbsCreate = useMutation({
    mutationFn: ({ name, parentId }: { name: string; parentId?: string | null }) =>
      createWbsSectionFn({ data: { projectId, name, parentId: parentId ?? null } }),
    onSuccess: () => {
      void refreshSchedule();
      toast.success("WBS added", {
        description: "The section is now saved to this project schedule.",
      });
    },
    onError: (error) => {
      toast.error("WBS did not save", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });

  const wbsRename = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameWbsSectionFn({ data: { id, name } }),
    onSuccess: () => {
      void refreshSchedule();
      toast.success("WBS renamed", {
        description: "Matching activity divisions were updated.",
      });
    },
    onError: (error) => {
      toast.error("WBS did not update", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });

  const wbsParentMove = useMutation({
    mutationFn: ({ id, parentId }: WbsParentMoveInput) =>
      moveWbsSectionParentFn({ data: { id, parentId } }),
    onSuccess: () => {
      void refreshSchedule();
      toast.success("WBS parent updated", {
        description: "The section and matching activity paths were moved.",
      });
    },
    onError: (error) => {
      toast.error("WBS parent did not update", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });

  const wbsReorder = useMutation({
    mutationFn: ({ parentId, orderedIds }: WbsReorderInput) =>
      reorderWbsSectionsFn({ data: { projectId, parentId, orderedIds } }),
    onMutate: async ({ orderedIds }) => {
      const existingToastId = wbsOrderToastRef.current ?? undefined;
      const toastId = toast.loading("Saving WBS order", {
        id: existingToastId,
        description: "The grid has already moved to the new order.",
      });
      wbsOrderToastRef.current = toastId;
      await qc.cancelQueries({ queryKey: ["schedule", projectId] });
      const previous = qc.getQueryData(["schedule", projectId]);
      qc.setQueryData<ScheduleQueryCache>(["schedule", projectId], (current) => {
        if (!current?.wbsSections) return current;
        const orderMap = new Map(orderedIds.map((id, index) => [id, (index + 1) * 10]));
        return {
          ...current,
          wbsSections: current.wbsSections.map((section: ScheduleWbsSectionRow) => ({
            ...section,
            sort_order: orderMap.get(section.id) ?? section.sort_order,
          })),
        };
      });
      return { previous, toastId };
    },
    onSuccess: (_result, _variables, context) => {
      if (context?.toastId) {
        toast.success("WBS order saved", {
          id: context.toastId,
          description: "The saved order is now the CPM WBS order.",
        });
      }
      if (wbsOrderToastRef.current === context?.toastId) wbsOrderToastRef.current = null;
    },
    onError: (error, _orderedIds, context) => {
      if (context?.previous) qc.setQueryData(["schedule", projectId], context.previous);
      toast.error("WBS order did not save", {
        id: context?.toastId,
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
      if (wbsOrderToastRef.current === context?.toastId) wbsOrderToastRef.current = null;
    },
  });

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
    onSuccess: () => {
      void refreshSchedule();
      toast.success("Delay fragment added", {
        description: "The delay is now tied to this CPM schedule.",
      });
    },
    onError: (error) => {
      toast.error("Delay fragment did not save", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });

  const delayFragmentUpdate = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ScheduleDelayFragmentRow> }) =>
      updateDelayFragmentFn({ data: { id, patch } }),
    onSuccess: () => {
      void refreshSchedule();
      toast.success("Delay fragment updated");
    },
    onError: (error) => {
      toast.error("Delay fragment did not update", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
      });
    },
  });

  const delayFragmentDelete = useMutation({
    mutationFn: (id: string) => deleteDelayFragmentFn({ data: { id } }),
    onSuccess: () => {
      void refreshSchedule();
      toast.success("Delay fragment removed");
    },
    onError: (error) => {
      toast.error("Delay fragment did not delete", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
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
    <ScheduleWorkspaceShell project={project}>
      <CpmActivityPlanner
        activities={activities}
        wbsSections={wbsSections}
        wbsPersistence={wbsPersistence}
        delayFragments={delayFragments}
        delayFragmentPersistence={delayFragmentPersistence}
        milestones={milestones}
        project={project}
        latestDataDate={latestUpdate?.data_date ?? null}
        onAddActivity={(activity) => activityCreate.mutate(activity)}
        onSeedActivities={(items) => activitySeed.mutate(items)}
        isSeedingActivities={activitySeed.isPending}
        onPatchActivity={async (id, patch, options) => {
          await activityUpdate.mutateAsync({ id, patch, silent: options?.silent });
        }}
        isSavingActivity={activityUpdate.isPending}
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
          await wbsReorder.mutateAsync(payload);
        }}
        isSavingWbs={wbsCreate.isPending || wbsRename.isPending || wbsParentMove.isPending}
        isSavingWbsOrder={wbsReorder.isPending}
      />

      <ScheduleWorkspaceOperations
        milestones={milestones}
        risks={risks}
        updates={updates}
        project={project}
      />
    </ScheduleWorkspaceShell>
  );
}

function ScheduleWorkspaceShell({
  project,
  children,
}: {
  project?: ProjectRow;
  children: ReactNode;
}) {
  return (
    <div className="constructline-schedule-page min-h-screen overflow-x-hidden bg-background text-foreground print:bg-white">
      <header className="sticky top-0 z-30 border-b border-hairline bg-background/95 backdrop-blur print:static">
        <div className="mx-auto flex w-full max-w-[1840px] flex-col gap-3 px-4 py-4 lg:px-8 xl:flex-row xl:items-center xl:justify-between">
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
      </header>
      <main className="mx-auto w-full max-w-[1840px] px-4 py-5 lg:px-8">{children}</main>
    </div>
  );
}

function ScheduleWorkspaceOperations({
  milestones,
  risks,
  updates,
  project,
}: {
  milestones: MilestoneRow[];
  risks: ScheduleRiskRow[];
  updates: ScheduleUpdateRow[];
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

  return (
    <section className="constructline-screen-ops mb-4 mt-5 grid gap-3 xl:grid-cols-3 2xl:grid-cols-5">
      <ScheduleOpsCard
        label="Schedule update history"
        title={`${updates.length} saved ${updates.length === 1 ? "update" : "updates"}`}
        sub={`Baseline ${formatDate(project.baseline_completion_date)} · Forecast ${formatDate(
          project.forecast_completion_date,
        )}`}
        className="xl:col-span-3 2xl:col-span-1"
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
                )}`}
              />
            ))
        )}
      </ScheduleOpsCard>

      <ScheduleOpsCard
        label="Interim milestones"
        title={`${activeMilestones.length} active`}
        sub="Forecast checkpoints"
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
        label="Critical delayed decisions"
        risks={delayedDecisions}
        empty="No critical decision risks."
      />
      <RiskOpsCard
        label="Procurement risks"
        risks={procurementRisks}
        empty="No procurement risks."
      />
      <RiskOpsCard
        label="Trade performance risks"
        risks={tradeRisks}
        empty="No trade performance risks."
      />
    </section>
  );
}

function RiskOpsCard({
  label,
  risks,
  empty,
}: {
  label: string;
  risks: ScheduleRiskRow[];
  empty: string;
}) {
  return (
    <ScheduleOpsCard label={label} title={`${risks.length} open`} sub="Schedule-linked risk">
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
  label,
  title,
  sub,
  children,
  className,
}: {
  label: string;
  title: string;
  sub: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 rounded-lg border border-hairline bg-card p-4 ${className ?? ""}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-lg font-semibold text-foreground">{title}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{sub}</div>
      <div className="mt-3 grid gap-2">{children}</div>
    </div>
  );
}

function ScheduleOpsItem({ title, meta }: { title: string; meta: string }) {
  return (
    <div className="min-w-0 rounded border border-hairline bg-surface px-3 py-2">
      <div className="truncate text-sm font-semibold text-foreground">{title}</div>
      <div className="mt-1 truncate text-xs text-muted-foreground">{meta}</div>
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
