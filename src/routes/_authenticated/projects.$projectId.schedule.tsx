import { createFileRoute } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { CpmActivityPlanner, type ActivityCreateInput } from "@/components/outcome/ScheduleRisk";
import { getProject, type ProjectRow } from "@/lib/projects.functions";
import {
  createScheduleActivity,
  deleteScheduleActivity,
  listSchedule,
  updateScheduleActivity,
  type MilestoneRow,
  type ScheduleActivityRow,
  type ScheduleUpdateRow,
} from "@/lib/schedule.functions";
import { computeScheduleVarianceWeeks } from "@/lib/ior";

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
  const milestones = useMemo(
    () => (scheduleQuery.data?.milestones ?? []) as MilestoneRow[],
    [scheduleQuery.data?.milestones],
  );
  const updates = useMemo(
    () => (scheduleQuery.data?.updates ?? []) as ScheduleUpdateRow[],
    [scheduleQuery.data?.updates],
  );
  const latestUpdate = updates[0] ?? null;

  const refreshSchedule = async () => {
    await qc.invalidateQueries({ queryKey: ["schedule", projectId] });
    await qc.invalidateQueries({ queryKey: ["project", projectId] });
    await qc.invalidateQueries({ queryKey: ["projects"] });
  };

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
    onSuccess: async (_result, items) => {
      await refreshSchedule();
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
    mutationFn: ({ id, patch }: { id: string; patch: Partial<ScheduleActivityRow> }) =>
      updateActivityFn({ data: { id, patch } }),
    onSuccess: refreshSchedule,
    onError: (error) => {
      toast.error("Activity did not update", {
        description: error instanceof Error ? error.message : "Refresh and try again.",
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

  const metrics = useMemo(
    () => buildScheduleMetrics(project, activities, milestones, updates),
    [activities, milestones, project, updates],
  );

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
      <section className="constructline-screen-summary mb-4 grid gap-3 lg:grid-cols-[minmax(360px,1.35fr)_repeat(4,minmax(160px,0.5fr))]">
        <div className="rounded-lg border border-hairline bg-card p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Project construction schedule
          </div>
          <h1 className="mt-2 font-serif text-3xl text-foreground">{project.name}</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Full-width CPM workspace for activities, activity IDs, divisions, dates, progress, and
            predecessor / successor logic.
          </p>
        </div>
        <ScheduleMetricCard
          label="Activities"
          value={String(metrics.activityCount)}
          sub={`${metrics.completeCount} complete`}
        />
        <ScheduleMetricCard
          label="Logic ties"
          value={String(metrics.logicCount)}
          sub="pred / succ"
          tone={metrics.logicCount > 0 ? "success" : "warning"}
        />
        <ScheduleMetricCard
          label="Data date"
          value={formatDate(metrics.latestDataDate)}
          sub={latestUpdate ? `Update #${latestUpdate.update_number}` : "No update saved"}
        />
        <ScheduleMetricCard
          label="Variance"
          value={formatVariance(metrics.completionVariance)}
          sub="vs baseline"
          tone={(metrics.completionVariance ?? 0) > 0 ? "danger" : "success"}
        />
      </section>

      <CpmActivityPlanner
        activities={activities}
        milestones={milestones}
        project={project}
        latestDataDate={latestUpdate?.data_date ?? null}
        onAddActivity={(activity) => activityCreate.mutate(activity)}
        onSeedActivities={(items) => activitySeed.mutate(items)}
        isSeedingActivities={activitySeed.isPending}
        onPatchActivity={(id, patch) => activityUpdate.mutate({ id, patch })}
        onDeleteActivity={(id) => activityDelete.mutate({ id })}
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
                Overwatch schedule workspace
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
              onClick={() => typeof window !== "undefined" && window.print()}
            >
              <Printer className="h-4 w-4" />
              Print schedule
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-[1840px] px-4 py-5 lg:px-8">{children}</main>
    </div>
  );
}

function ScheduleMetricCard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "default" | "success" | "warning" | "danger";
}) {
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "warning"
        ? "text-warning"
        : tone === "danger"
          ? "text-danger"
          : "text-foreground";
  return (
    <div className="flex min-h-[120px] flex-col justify-between rounded-lg border border-hairline bg-card p-4">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div>
        <div className={`text-2xl font-semibold tabular ${toneClass}`}>{value}</div>
        <div className="mt-1 text-xs text-muted-foreground">{sub}</div>
      </div>
    </div>
  );
}

function buildScheduleMetrics(
  project: ProjectRow | undefined,
  activities: ScheduleActivityRow[],
  milestones: MilestoneRow[],
  updates: ScheduleUpdateRow[],
) {
  const latestUpdate = updates[0] ?? null;
  return {
    activityCount: activities.length,
    completeCount: activities.filter((activity) => activity.percent_complete >= 100).length,
    logicCount: activities.filter(
      (activity) =>
        activity.predecessor_activity_ids.length > 0 || activity.successor_activity_ids.length > 0,
    ).length,
    activeMilestoneCount: milestones.filter((milestone) => milestone.status !== "complete").length,
    latestDataDate: latestUpdate?.data_date ?? null,
    completionVariance: project
      ? computeScheduleVarianceWeeks(
          project.baseline_completion_date,
          project.forecast_completion_date,
        )
      : null,
  };
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
