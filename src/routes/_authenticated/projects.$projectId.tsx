import { createFileRoute, Link, useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CostBucketsTable } from "@/components/outcome/CostBucketsTable";
import { ChangeOrdersTable } from "@/components/outcome/ChangeOrdersTable";
import { ScheduleRisk } from "@/components/outcome/ScheduleRisk";
import { ProjectTruthReview } from "@/components/outcome/ProjectTruthReview";
import { ImportSOVSheet } from "@/components/outcome/ImportSOVSheet";
import { ReviewsTab } from "@/components/outcome/ReviewsTab";
import { RiskAllocationWorkbench } from "@/components/outcome/RiskAllocationWorkbench";
import { ProjectDashboard } from "@/components/outcome/ProjectDashboard";
import { DecisionsTable } from "@/components/outcome/DecisionsTable";
import { DailyReportsWorkspace } from "@/components/outcome/DailyReportsWorkspace";
import {
  createExposure,
  updateExposure,
  deleteExposure,
  createDecision,
  updateDecision,
  deleteDecision,
  getProject,
  listProjects,
  updateProjectFinancials,
  createChangeOrder,
  updateChangeOrder,
  deleteChangeOrder,
  updateBucket,
  createBucket,
  deleteBucket,
  submitReview,
  updateReview,
  importCostBuckets,
  createBillingApplication,
  updateBillingApplication,
  deleteBillingApplication,
  type ProjectRow,
  type ReviewRow,
  type ChangeOrderRow,
  type BillingApplicationRow,
  type ExposureRow,
} from "@/lib/projects.functions";
import { listSchedule } from "@/lib/schedule.functions";
import { fmtUSD, fmtPct } from "@/lib/format";
import {
  computeScheduleVarianceWeeks,
  type Phase,
  type ExposureCategory,
  type Rollup,
} from "@/lib/ior";
import { generateIorPdf, downloadPdfBytes, type IorPdfStyle } from "@/lib/ior-pdf";
import { toast } from "sonner";
import {
  CalendarClock,
  ClipboardList,
  Download,
  FileText,
  FileSpreadsheet,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Pencil,
  Plus,
  ReceiptText,
  ShieldAlert,
  Trash2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  head: () => ({ meta: [{ title: "Project Outcome Review" }] }),
  component: ProjectPage,
});

const LOCAL_BILLING_ID_PREFIX = "local-pay-app-";
const BILLING_STATUS_VALUES = ["draft", "submitted", "paid", "partial", "rejected"] as const;

function isBillingStatus(value: unknown): value is BillingApplicationRow["status"] {
  return typeof value === "string" && BILLING_STATUS_VALUES.includes(value as never);
}

function isMissingBillingApplicationsTableError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /billing_applications|schema cache/i.test(message);
}

function makeLocalBillingId() {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `${LOCAL_BILLING_ID_PREFIX}${randomId}`;
}

function billingString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function billingNumber(value: unknown) {
  return typeof value === "number" ? value : Number(value ?? 0);
}

function billingDate(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function sortBillingApplications(apps: BillingApplicationRow[]) {
  return [...apps].sort((a, b) => a.sort_order - b.sort_order || a.id.localeCompare(b.id));
}

function makeLocalBillingApplication(
  projectId: string,
  input: BillingDraft,
): BillingApplicationRow {
  return {
    id: makeLocalBillingId(),
    project_id: projectId,
    application_number: input.application_number,
    invoice_number: input.invoice_number,
    submitted_date: input.submitted_date || null,
    due_date: input.due_date || null,
    billing_period: input.billing_period,
    contract_amount: input.contract_amount,
    change_order_amount: input.change_order_amount,
    amount_billed: input.amount_billed,
    paid_to_date: input.paid_to_date,
    retainage: input.retainage,
    status: input.status,
    notes: input.notes,
    sort_order: input.sort_order,
  };
}

function normalizeStoredBillingApplication(
  projectId: string,
  raw: unknown,
): BillingApplicationRow | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = billingString(record.id);
  return {
    id: id.startsWith(LOCAL_BILLING_ID_PREFIX) ? id : makeLocalBillingId(),
    project_id: projectId,
    application_number: billingString(record.application_number, "Pay App"),
    invoice_number: billingString(record.invoice_number),
    submitted_date: billingDate(record.submitted_date),
    due_date: billingDate(record.due_date),
    billing_period: billingString(record.billing_period),
    contract_amount: billingNumber(record.contract_amount),
    change_order_amount: billingNumber(record.change_order_amount),
    amount_billed: billingNumber(record.amount_billed),
    paid_to_date: billingNumber(record.paid_to_date),
    retainage: billingNumber(record.retainage),
    status: isBillingStatus(record.status) ? record.status : "draft",
    notes: billingString(record.notes),
    sort_order: billingNumber(record.sort_order),
  };
}

function localBillingStorageKey(projectId: string) {
  return `ior:billing-applications:${projectId}`;
}

function readLocalBillingApplications(projectId: string) {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(localBillingStorageKey(projectId)) ?? "[]",
    );
    if (!Array.isArray(parsed)) return [];
    return sortBillingApplications(
      parsed
        .map((app) => normalizeStoredBillingApplication(projectId, app))
        .filter((app): app is BillingApplicationRow => Boolean(app)),
    );
  } catch {
    return [];
  }
}

function writeLocalBillingApplications(projectId: string, apps: BillingApplicationRow[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(localBillingStorageKey(projectId), JSON.stringify(apps));
}

function ProjectPage() {
  const { projectId } = Route.useParams();
  const get = useServerFn(getProject);
  const list = useServerFn(listProjects);
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ["project", projectId],
    queryFn: () => get({ data: { projectId } }),
  });
  const { data: portfolio = [] } = useQuery({
    queryKey: ["projects"],
    queryFn: () => list(),
  });

  const createExposureFn = useServerFn(createExposure);
  const updateExposureFn = useServerFn(updateExposure);
  const deleteExposureFn = useServerFn(deleteExposure);
  const createDecisionFn = useServerFn(createDecision);
  const updateDecisionFn = useServerFn(updateDecision);
  const deleteDecisionFn = useServerFn(deleteDecision);
  const updateFinFn = useServerFn(updateProjectFinancials);
  const createCoFn = useServerFn(createChangeOrder);
  const updateCoFn = useServerFn(updateChangeOrder);
  const deleteCoFn = useServerFn(deleteChangeOrder);
  const updateBucketFn = useServerFn(updateBucket);
  const createBucketFn = useServerFn(createBucket);
  const deleteBucketFn = useServerFn(deleteBucket);
  const submitReviewFn = useServerFn(submitReview);
  const updateReviewFn = useServerFn(updateReview);
  const importBucketsFn = useServerFn(importCostBuckets);
  const createBillingFn = useServerFn(createBillingApplication);
  const updateBillingFn = useServerFn(updateBillingApplication);
  const deleteBillingFn = useServerFn(deleteBillingApplication);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    qc.invalidateQueries({ queryKey: ["projects"] });
  };
  const useServerMutation = <I,>(fn: (i: { data: I }) => Promise<unknown>) =>
    useMutation({ mutationFn: (input: I) => fn({ data: input }), onSuccess: invalidate });

  const finUpdate = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      (
        updateFinFn as (i: { data: Record<string, unknown> }) => Promise<{
          ok: boolean;
          project?: ProjectRow;
          jobNumberSkipped?: boolean;
        }>
      )({ data: input }),
    onSuccess: (result) => {
      if (result.project) {
        qc.setQueryData(["project", projectId], (current: unknown) => {
          if (!current || typeof current !== "object") return current;
          return { ...(current as Record<string, unknown>), project: result.project };
        });
      }
      invalidate();
      toast.success("Project updated", {
        description: result.jobNumberSkipped
          ? "Saved project info. Job number needs the Supabase column migration before it can persist."
          : "The dashboard is using the saved project info.",
      });
    },
    onError: (err) => {
      toast.error("Project did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  const expCreate = useServerMutation<Record<string, unknown>>(createExposureFn as never);
  const expUpdate = useServerMutation<Record<string, unknown>>(updateExposureFn as never);
  const expDelete = useServerMutation<{ id: string }>(deleteExposureFn);
  const decisionCreate = useServerMutation<Record<string, unknown>>(createDecisionFn as never);
  const decisionUpdate = useServerMutation<Record<string, unknown>>(updateDecisionFn as never);
  const decisionDelete = useServerMutation<{ id: string }>(deleteDecisionFn);
  const coCreate = useServerMutation<Record<string, unknown>>(createCoFn as never);
  const coUpdate = useServerMutation<Record<string, unknown>>(updateCoFn as never);
  const coDelete = useServerMutation<{ id: string }>(deleteCoFn);
  const bucketUpdate = useServerMutation<Record<string, unknown>>(updateBucketFn as never);
  const bucketCreate = useServerMutation<Record<string, unknown>>(createBucketFn as never);
  const bucketDelete = useServerMutation<{ id: string }>(deleteBucketFn);
  const reviewSubmit = useServerMutation<Record<string, unknown>>(submitReviewFn as never);
  const reviewUpdate = useServerMutation<Record<string, unknown>>(updateReviewFn as never);
  const bucketImport = useServerMutation<Record<string, unknown>>(importBucketsFn as never);
  const billingCreate = useServerMutation<Record<string, unknown>>(createBillingFn as never);
  const billingUpdate = useServerMutation<Record<string, unknown>>(updateBillingFn as never);
  const billingDelete = useServerMutation<{ id: string }>(deleteBillingFn);
  const listScheduleFn = useServerFn(listSchedule);
  const { data: scheduleData } = useQuery({
    queryKey: ["schedule", projectId],
    queryFn: () => listScheduleFn({ data: { projectId } }),
  });
  // Last-reviewed chip is gated by hydration to avoid SSR/CSR text mismatch
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setHydrated(true);
  }, []);
  const [localBillingApplications, setLocalBillingApplications] = useState<BillingApplicationRow[]>(
    [],
  );
  useEffect(() => {
    setLocalBillingApplications(readLocalBillingApplications(projectId));
  }, [projectId]);
  const storeLocalBillingApplications = (
    updater: (current: BillingApplicationRow[]) => BillingApplicationRow[],
  ) => {
    setLocalBillingApplications((current) => {
      const next = sortBillingApplications(updater(current));
      writeLocalBillingApplications(projectId, next);
      return next;
    });
  };

  const navigate = useNavigate();
  const router = useRouter();
  const signOut = async () => {
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth" });
  };

  if (isLoading) return <div className="p-10 text-muted-foreground">Loading…</div>;
  if (error || !data) {
    return (
      <div className="p-10">
        <p className="text-sm text-danger">Could not load project.</p>
        <Link to="/" className="mt-4 inline-block text-sm underline">
          ← Back to portfolio
        </Link>
      </div>
    );
  }

  const {
    project,
    exposures,
    changeOrders,
    buckets,
    decisions,
    reviews,
    billingApplications,
    rollup,
    guidance,
    warnings,
  } = data;
  const billingApplicationIds = new Set(billingApplications.map((app) => app.id));
  const visibleBillingApplications = sortBillingApplications([
    ...billingApplications,
    ...localBillingApplications.filter(
      (app) => app.project_id === projectId && !billingApplicationIds.has(app.id),
    ),
  ]);

  const lastReviewDays =
    hydrated && project.last_reviewed_at
      ? Math.floor((Date.now() - new Date(project.last_reviewed_at).getTime()) / 86400000)
      : null;

  const handleSubmitReview = async (input: {
    reviewer: string;
    forecast_completion_date_before: string | null;
    forecast_completion_date_after: string | null;
    summary_notes: string;
    body_markdown: string;
    pdf_style: IorPdfStyle;
    kpi_snapshot: Record<string, number | string>;
    newExposures: Array<{
      title: string;
      description: string;
      category: ExposureCategory;
      dollar_exposure: number;
      probability: number;
      owner: string;
      response_path: import("@/lib/ior").ResponsePath | null;
      hold_class: import("@/lib/ior").HoldClass;
    }>;
    resolutionUpdates: Array<{
      id: string;
      status: import("@/lib/ior").ExposureStatus;
      note: string;
    }>;
    pdfBytes: Uint8Array;
  }) => {
    // Create new exposures
    for (const e of input.newExposures) {
      if (!e.response_path) continue;
      expCreate.mutate({
        projectId,
        title: e.title,
        description: e.description,
        category: e.category,
        dollar_exposure: e.dollar_exposure,
        probability: e.probability,
        owner: e.owner,
        response_path: e.response_path,
        hold_class: e.hold_class,
        status: "active",
        release_condition: "",
      });
    }
    // Apply resolutions
    for (const r of input.resolutionUpdates) {
      const patch: Record<string, unknown> = { status: r.status };
      if (r.note) patch.notes = r.note;
      if (r.status === "recovered" || r.status === "eliminated" || r.status === "released") {
        patch.resolved_at = new Date().toISOString();
      }
      expUpdate.mutate({ id: r.id, ...patch });
    }
    // Submit the review row
    reviewSubmit.mutate({
      projectId,
      reviewer: input.reviewer,
      forecast_completion_date_before: input.forecast_completion_date_before,
      forecast_completion_date_after: input.forecast_completion_date_after,
      summary_notes: input.summary_notes,
      body_markdown: input.body_markdown,
      pdf_style: input.pdf_style,
      kpi_snapshot: input.kpi_snapshot,
      email_recipients: [],
    });
    // PDF was already downloaded by the wizard itself.
  };

  const milestones = scheduleData?.milestones ?? [];
  const scheduleRisks = scheduleData?.risks ?? [];
  const scheduleUpdates = scheduleData?.updates ?? [];
  const activeScheduleRiskCount = scheduleRisks.filter((risk) => risk.status === "active").length;
  const latestScheduleUpdate = scheduleUpdates[0] ?? null;
  const scheduleMovementSinceLastUpdate = latestScheduleUpdate?.movement_weeks ?? null;
  const liveExposureCount = exposures.filter(
    (e) => e.status === "active" || e.status === "escalated",
  ).length;
  const lastReviewForecast =
    reviews[0]?.forecast_completion_date_after ??
    reviews[0]?.forecast_completion_date_before ??
    null;
  const jobNumber = project.job_number || `ID ${project.id.slice(0, 8).toUpperCase()}`;
  const openTodoCount = decisions.filter((d) => d.status !== "resolved").length;

  const createTodoForRisk = (exposure: ExposureRow) => {
    const impact =
      exposure.notes ||
      exposure.release_condition ||
      exposure.description ||
      `Own the ${exposure.response_path} path for ${fmtUSD(exposure.dollar_exposure)} exposure.`;
    decisionCreate.mutate(
      {
        projectId,
        decision: `${responseAction(exposure.response_path)}: ${exposure.title}`,
        impact: impact.slice(0, 500),
        owner: exposure.owner,
        due_date: exposure.next_review_at,
        status: "open",
        linked_exposure_id: exposure.id,
        linked_co_id: null,
        notes: impact.length > 500 ? impact : "",
      },
      {
        onSuccess: () => {
          toast.success("Linked to-do created", {
            description: `${exposure.title} is now on the To-Dos tab.`,
          });
        },
        onError: (err) => {
          toast.error("Linked to-do did not save", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
      },
    );
  };

  const createLocalPayApp = (input: BillingDraft) => {
    const localPayApp = makeLocalBillingApplication(projectId, input);
    storeLocalBillingApplications((current) => [...current, localPayApp]);
    toast.success("Pay app added locally", {
      description: "Supabase billing is not live yet, so this browser is holding it for the demo.",
    });
  };

  const handleCreatePayApp = (input: BillingDraft) => {
    billingCreate.mutate(
      { projectId, ...input },
      {
        onSuccess: () => {
          toast.success("Pay app added", {
            description: `${input.application_number || "Pay application"} is now in the billing ledger.`,
          });
        },
        onError: (err) => {
          if (isMissingBillingApplicationsTableError(err)) {
            createLocalPayApp(input);
            return;
          }
          toast.error("Pay app did not save", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
      },
    );
  };

  const handleUpdatePayApp = (id: string, patch: Partial<BillingApplicationRow>) => {
    if (id.startsWith(LOCAL_BILLING_ID_PREFIX)) {
      storeLocalBillingApplications((current) =>
        current.map((app) => (app.id === id ? { ...app, ...patch } : app)),
      );
      return;
    }
    billingUpdate.mutate(
      { id, patch },
      {
        onError: (err) => {
          toast.error("Pay app did not update", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
      },
    );
  };

  const handleDeletePayApp = (id: string) => {
    if (id.startsWith(LOCAL_BILLING_ID_PREFIX)) {
      storeLocalBillingApplications((current) => current.filter((app) => app.id !== id));
      return;
    }
    billingDelete.mutate(
      { id },
      {
        onError: (err) => {
          toast.error("Pay app did not delete", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
      },
    );
  };

  const handleDeleteExposure = (id: string) => {
    const exposure = exposures.find((item) => item.id === id);
    if (exposure && !window.confirm(`Delete risk "${exposure.title}"?`)) return;

    qc.setQueryData(["project", projectId], (current: unknown) => {
      if (!current || typeof current !== "object") return current;
      const record = current as { exposures?: ExposureRow[] };
      if (!Array.isArray(record.exposures)) return current;
      return {
        ...(current as Record<string, unknown>),
        exposures: record.exposures.filter((item) => item.id !== id),
      };
    });

    expDelete.mutate(
      { id },
      {
        onSuccess: () => {
          toast.success("Risk deleted");
          invalidate();
        },
        onError: (err) => {
          invalidate();
          toast.error("Risk did not delete", {
            description: err instanceof Error ? err.message : "Refresh and try again.",
          });
        },
      },
    );
  };

  const downloadCurrentReport = async (style: IorPdfStyle) => {
    const bytes = await generateIorPdf(
      {
        project,
        rollup,
        exposures,
        changeOrders,
        buckets,
        decisions,
        reviews,
        milestones,
        scheduleRisks,
        narrative: project.last_review_summary,
        generatedAt: new Date(),
      },
      style,
    );
    downloadPdfBytes(
      bytes,
      `IOR_${project.name.replace(/\s+/g, "_")}_${new Date().toISOString().slice(0, 10)}.pdf`,
    );
  };

  const buildPdfInputForReview = (r: ReviewRow | null) => ({
    project,
    rollup,
    exposures,
    changeOrders,
    buckets,
    decisions,
    reviews,
    milestones,
    scheduleRisks,
    narrative: r?.body_markdown || r?.summary_notes,
    generatedAt: r ? new Date(r.reviewed_at) : new Date(),
  });

  const projectNavItems = [
    { value: "dashboard", label: "Dashboard", detail: "Financial IOR", icon: LayoutDashboard },
    {
      value: "schedule",
      label: "Schedule",
      detail: `${project.schedule_variance_weeks > 0 ? `+${project.schedule_variance_weeks} wk` : "On plan"}`,
      icon: CalendarClock,
    },
    {
      value: "risk-tally",
      label: "Risk Tally",
      detail: `${liveExposureCount} live`,
      icon: ShieldAlert,
    },
    {
      value: "todos",
      label: "To-Dos",
      detail: `${openTodoCount} open`,
      icon: ListChecks,
    },
    {
      value: "sov",
      label: "SOV / Costs",
      detail: `${buckets.length} buckets`,
      icon: FileSpreadsheet,
    },
    {
      value: "billing",
      label: "Billing",
      detail: `${project.percent_complete}% complete`,
      icon: ReceiptText,
    },
    {
      value: "change-orders",
      label: "Change Orders",
      detail: fmtUSD(rollup.pendingCOContract),
      icon: ClipboardList,
    },
    {
      value: "ior-report",
      label: "IOR Reports",
      detail: `${reviews.length} saved`,
      icon: Download,
    },
    {
      value: "daily-reports",
      label: "Daily Reports",
      detail: "Job log",
      icon: FileText,
    },
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="relative border-b border-hairline bg-surface-elevated">
        <div className="absolute inset-0 grid-bg opacity-40" />
        <div className="relative mx-auto max-w-[1400px] px-6 py-5 lg:px-10 lg:py-6">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <Link
                to="/"
                className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground hover:text-foreground"
              >
                ← Portfolio
              </Link>
              <Select
                value={projectId}
                onValueChange={(v) =>
                  navigate({ to: "/projects/$projectId", params: { projectId: v } })
                }
              >
                <SelectTrigger className="h-8 w-[260px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {portfolio.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5">
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </Button>
          </div>

          <div className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <div className="flex items-center gap-3 text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                <span className="inline-block h-px w-8 bg-accent" />
                IOR · {project.phase} Phase · {project.percent_complete}% complete
                {lastReviewDays !== null && (
                  <span className={lastReviewDays > 30 ? "text-danger" : ""}>
                    · Last reviewed {lastReviewDays}d ago
                  </span>
                )}
              </div>
              <h1 className="mt-2 font-serif text-4xl leading-[1.05] text-foreground lg:text-5xl">
                {project.name}
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                An IOR operating record, not a budget report. Start from the SOV, work the schedule,
                then price the exposure.
              </p>
            </div>
            <div className="flex flex-col items-end gap-3">
              <div className="flex flex-wrap items-center justify-end gap-2">
                <ProjectTruthReview
                  project={project}
                  exposures={exposures}
                  changeOrders={changeOrders}
                  buckets={buckets}
                  decisions={decisions}
                  rollup={rollup}
                  onSubmit={handleSubmitReview}
                  pending={reviewSubmit.isPending}
                />
                <DownloadReportMenu onDownload={downloadCurrentReport} />
                <EditFinancialsDialog
                  project={project}
                  rollup={rollup}
                  guidance={guidance}
                  onSave={(patch) => finUpdate.mutate({ projectId, patch })}
                  pending={finUpdate.isPending}
                />
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm md:grid-cols-5">
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Job #
                  </dt>
                  <dd className="mt-0.5 tabular text-foreground">{jobNumber}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Client
                  </dt>
                  <dd className="mt-0.5 text-foreground">{project.client || "—"}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Project Manager
                  </dt>
                  <dd className="mt-0.5 text-foreground">{project.project_manager || "—"}</dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Original Contract
                  </dt>
                  <dd className="mt-0.5 tabular text-foreground">
                    {fmtUSD(project.original_contract)}
                  </dd>
                </div>
                <div>
                  <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                    Forecasted Final
                  </dt>
                  <dd className="mt-0.5 tabular text-foreground">
                    {fmtUSD(rollup.forecastedFinalContract)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-4 py-6 sm:px-6 lg:px-8">
        <Tabs
          defaultValue="dashboard"
          className="grid gap-6 lg:grid-cols-[238px_minmax(0,1fr)] lg:items-start"
        >
          <aside className="lg:sticky lg:top-6">
            <TabsList className="h-auto w-full justify-start gap-1 overflow-x-auto rounded-lg border border-hairline bg-card p-1 shadow-card lg:flex-col lg:items-stretch lg:overflow-visible">
              {projectNavItems.map((item) => {
                const Icon = item.icon;
                return (
                  <TabsTrigger
                    key={item.value}
                    value={item.value}
                    className="min-w-[148px] justify-start rounded-md px-3 py-3 text-left data-[state=active]:bg-foreground data-[state=active]:text-background lg:w-full"
                  >
                    <Icon className="mr-2 h-4 w-4 shrink-0" />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium leading-tight">{item.label}</span>
                      <span className="mt-0.5 block truncate text-[11px] font-normal opacity-70">
                        {item.detail}
                      </span>
                    </span>
                  </TabsTrigger>
                );
              })}
            </TabsList>
          </aside>

          <div className="min-w-0">
            <TabsContent value="dashboard" className="mt-0">
              <ProjectDashboard
                project={project}
                exposures={exposures}
                rollup={rollup}
                warnings={warnings}
                scheduleRiskCount={activeScheduleRiskCount}
                lastReviewForecast={lastReviewForecast}
                scheduleMovementSinceLastUpdate={scheduleMovementSinceLastUpdate}
              />
            </TabsContent>

            <TabsContent value="schedule" className="mt-0">
              <WorkspaceHeader
                title="Schedule"
                subtitle="Completion forecast, interim milestones, critical path movement, and schedule-linked risk."
              />
              <ScheduleRisk project={project} lastReviewForecast={lastReviewForecast} />
            </TabsContent>

            <TabsContent value="daily-reports" className="mt-0">
              <DailyReportsWorkspace projectId={projectId} />
            </TabsContent>

            <TabsContent value="risk-tally" className="mt-0 space-y-6">
              <RiskAllocationWorkbench
                exposures={exposures}
                rollup={rollup}
                guidance={guidance}
                onCreateExposure={(d) => expCreate.mutate({ projectId, ...d })}
                onUpdateExposure={(id, patch) => expUpdate.mutate({ id, ...patch })}
                onDeleteExposure={handleDeleteExposure}
                onCreateTodo={createTodoForRisk}
              />
            </TabsContent>

            <TabsContent value="todos" className="mt-0 space-y-6">
              <WorkspaceHeader
                title="To-Dos"
                subtitle="Owned actions created from risk plans, schedule issues, change orders, and IOR review follow-through."
              />
              <DecisionsTable
                decisions={decisions}
                exposures={exposures}
                onCreate={(d) => decisionCreate.mutate({ projectId, ...d })}
                onUpdate={(id, patch) => decisionUpdate.mutate({ id, ...patch })}
                onDelete={(id) => decisionDelete.mutate({ id })}
              />
            </TabsContent>

            <TabsContent value="sov" className="mt-0 space-y-6">
              <div className="rounded-lg border border-hairline bg-card p-6 shadow-card">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <WorkspaceHeader
                    title="SOV / Costs"
                    subtitle="Imported schedule of values, cost buckets, actual cost, and forecast-to-complete."
                    compact
                  />
                  <ImportSOVSheet
                    onImport={(rows, mode) =>
                      bucketImport.mutate(
                        { projectId, rows, mode },
                        {
                          onSuccess: (result) => {
                            const imported =
                              typeof result === "object" && result && "inserted" in result
                                ? Number((result as { inserted: number }).inserted)
                                : rows.length;
                            const budget =
                              typeof result === "object" && result && "originalCostBudget" in result
                                ? Number(
                                    (result as { originalCostBudget: number }).originalCostBudget,
                                  )
                                : rows.reduce(
                                    (total, row) => total + row.actual_to_date + row.ftc,
                                    0,
                                  );
                            toast.success("SOV imported", {
                              description: `${imported} cost buckets loaded. Original cost budget is now ${fmtUSD(budget)}.`,
                            });
                          },
                          onError: (err) => {
                            toast.error("SOV import did not save", {
                              description: err instanceof Error ? err.message : "Try again.",
                            });
                          },
                        },
                      )
                    }
                    pending={bucketImport.isPending}
                  />
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <SovMetric label="Cost buckets loaded" value={String(buckets.length)} />
                  <SovMetric
                    label="Original cost budget"
                    value={fmtUSD(project.original_cost_budget)}
                  />
                  <SovMetric label="Actual to date" value={fmtUSD(rollup.actualToDate)} />
                  <SovMetric label="Forecast to complete" value={fmtUSD(rollup.ftc)} />
                  <SovMetric
                    label="CO cost exposure"
                    value={fmtUSD(rollup.weightedPendingCOCost)}
                  />
                  <SovMetric
                    label="Forecasted final cost"
                    value={fmtUSD(rollup.forecastedFinalCost)}
                  />
                </div>
              </div>
              <CostBucketsTable
                buckets={buckets}
                onUpdate={(id, patch) => bucketUpdate.mutate({ id, patch })}
                onCreate={(input) => bucketCreate.mutate({ projectId, ...input })}
                onDelete={(id) => bucketDelete.mutate({ id })}
              />
            </TabsContent>

            <TabsContent value="billing" className="mt-0 space-y-6">
              <BillingWorkspace
                project={project}
                rollup={rollup}
                changeOrders={changeOrders}
                billingApplications={visibleBillingApplications}
                savingPayApp={billingCreate.isPending}
                onCreate={handleCreatePayApp}
                onUpdate={handleUpdatePayApp}
                onDelete={handleDeletePayApp}
              />
            </TabsContent>

            <TabsContent value="ior-report" className="mt-0 space-y-6">
              <div className="rounded-lg border border-hairline bg-card p-6 shadow-card">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <WorkspaceHeader
                    title="IOR Reports"
                    subtitle="Create the current PDF and manage saved report cycles."
                    compact
                  />
                  <div className="flex flex-wrap gap-2">
                    <ProjectTruthReview
                      project={project}
                      exposures={exposures}
                      changeOrders={changeOrders}
                      buckets={buckets}
                      decisions={decisions}
                      rollup={rollup}
                      onSubmit={handleSubmitReview}
                      pending={reviewSubmit.isPending}
                    />
                    <DownloadReportMenu onDownload={downloadCurrentReport} />
                  </div>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-4">
                  <SovMetric label="Indicated GP" value={fmtUSD(rollup.indicatedGP)} />
                  <SovMetric label="Indicated GP %" value={fmtPct(rollup.indicatedGPpct)} />
                  <SovMetric label="GP at risk" value={fmtUSD(rollup.gpAtRisk)} />
                  <SovMetric label="Saved reports" value={String(reviews.length)} />
                </div>
              </div>
              <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
                <WorkspaceHeader
                  title="Saved IOR Reports"
                  subtitle="Historical narratives, PDFs, and email-ready summaries."
                  compact
                />
                <ReviewsTab
                  reviews={reviews}
                  project={project}
                  buildPdfInput={buildPdfInputForReview}
                  onUpdate={(id, patch) => reviewUpdate.mutate({ id, patch })}
                  pending={reviewUpdate.isPending}
                />
              </div>
            </TabsContent>

            <TabsContent value="change-orders" className="mt-0">
              <WorkspaceHeader
                title="Change Orders"
                subtitle="Approved COs add to both sides. Pending COs are probability-weighted into the rollup."
              />
              <ChangeOrdersTable
                changeOrders={changeOrders}
                onCreate={(d) => coCreate.mutate({ projectId, ...d })}
                onUpdate={(id, patch) => coUpdate.mutate({ id, ...patch })}
                onDelete={(id) => coDelete.mutate({ id })}
              />
            </TabsContent>
          </div>
        </Tabs>
      </main>
    </div>
  );
}

function DownloadReportMenu({
  onDownload,
}: {
  onDownload: (style: IorPdfStyle) => void | Promise<void>;
}) {
  return (
    <Button size="sm" variant="outline" className="gap-1.5" onClick={() => onDownload("executive")}>
      <Download className="h-3.5 w-3.5" /> Download IOR PDF
    </Button>
  );
}

function WorkspaceHeader({
  title,
  subtitle,
  compact,
}: {
  title: string;
  subtitle: string;
  compact?: boolean;
}) {
  return (
    <div className={compact ? "" : "mb-5"}>
      <h2 className={`font-serif text-foreground ${compact ? "text-3xl" : "text-4xl"}`}>{title}</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{subtitle}</p>
    </div>
  );
}

function SovMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-lg font-medium tabular text-foreground">{value}</div>
    </div>
  );
}

function responseAction(path: import("@/lib/ior").ResponsePath) {
  if (path === "eliminate") return "Eliminate";
  if (path === "recover") return "Recover";
  if (path === "offset") return "Offset";
  return "Accept";
}

type BillingDraft = Omit<BillingApplicationRow, "id" | "project_id">;

function BillingWorkspace({
  project,
  rollup,
  changeOrders,
  billingApplications,
  savingPayApp,
  onCreate,
  onUpdate,
  onDelete,
}: {
  project: ProjectRow;
  rollup: Rollup;
  changeOrders: ChangeOrderRow[];
  billingApplications: BillingApplicationRow[];
  savingPayApp?: boolean;
  onCreate: (input: BillingDraft) => void;
  onUpdate: (id: string, patch: Partial<BillingApplicationRow>) => void;
  onDelete: (id: string) => void;
}) {
  const earnedToDate = rollup.forecastedFinalContract * (project.percent_complete / 100);
  const pendingCOs = changeOrders.filter((co) => co.status === "Pending");
  const weightedPending = pendingCOs.reduce(
    (sum, co) => sum + co.contract_amount * (co.probability / 100),
    0,
  );
  const holds = rollup.exposureHolds + rollup.contingencyHold;
  const totalBilled = billingApplications.reduce((sum, app) => sum + app.amount_billed, 0);
  const contractRemaining = Math.max(0, rollup.forecastedFinalContract - totalBilled);
  const paidToDate = billingApplications.reduce((sum, app) => sum + app.paid_to_date, 0);
  const retainage = billingApplications.reduce((sum, app) => sum + app.retainage, 0);
  const outstanding = billingApplications.reduce(
    (sum, app) => sum + Math.max(0, app.amount_billed - app.paid_to_date - app.retainage),
    0,
  );
  const today = new Date().toISOString().slice(0, 10);

  const buildDraft = (): BillingDraft => {
    const nextNumber = String(billingApplications.length + 1).padStart(3, "0");
    return {
      application_number: `Pay App ${nextNumber}`,
      invoice_number: project.job_number
        ? `${project.job_number}-${nextNumber}`
        : `INV-${nextNumber}`,
      submitted_date: today,
      due_date: addDays(today, 30),
      billing_period: "Current cycle",
      contract_amount: project.original_contract,
      change_order_amount: rollup.approvedCOContract,
      amount_billed: earnedToDate,
      paid_to_date: 0,
      retainage: earnedToDate * 0.1,
      status: "draft",
      notes: "",
      sort_order: billingApplications.length + 1,
    };
  };
  const [payAppOpen, setPayAppOpen] = useState(false);
  const [draft, setDraft] = useState<BillingDraft>(() => buildDraft());
  const draftOutstanding = Math.max(0, draft.amount_billed - draft.paid_to_date - draft.retainage);

  const openPayAppDialog = () => {
    setDraft(buildDraft());
    setPayAppOpen(true);
  };

  const savePayApplication = () => {
    onCreate(draft);
    setPayAppOpen(false);
  };

  return (
    <section className="space-y-6">
      <div className="rounded-lg border border-hairline bg-card p-6 shadow-card">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <WorkspaceHeader
            title="Billing"
            subtitle="Pay applications, invoice status, paid-to-date, retainage, outstanding balances, and pending COs."
            compact
          />
          <Dialog open={payAppOpen} onOpenChange={setPayAppOpen}>
            <DialogTrigger asChild>
              <Button size="sm" onClick={openPayAppDialog} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add pay app
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">Add pay application</DialogTitle>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Pay app</Label>
                    <Input
                      value={draft.application_number}
                      onChange={(e) => setDraft({ ...draft, application_number: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Invoice #</Label>
                    <Input
                      value={draft.invoice_number}
                      onChange={(e) => setDraft({ ...draft, invoice_number: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Status</Label>
                    <Select
                      value={draft.status}
                      onValueChange={(status) =>
                        setDraft({ ...draft, status: status as BillingApplicationRow["status"] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="submitted">Submitted</SelectItem>
                        <SelectItem value="partial">Partial</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="rejected">Rejected</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Billing period</Label>
                    <Input
                      value={draft.billing_period}
                      onChange={(e) => setDraft({ ...draft, billing_period: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Submitted date</Label>
                    <Input
                      type="date"
                      value={draft.submitted_date ?? ""}
                      onChange={(e) =>
                        setDraft({ ...draft, submitted_date: e.target.value || null })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Due date</Label>
                    <Input
                      type="date"
                      value={draft.due_date ?? ""}
                      onChange={(e) => setDraft({ ...draft, due_date: e.target.value || null })}
                    />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-5">
                  <div className="space-y-1.5">
                    <Label>Contract</Label>
                    <MoneyInput
                      value={draft.contract_amount}
                      onValueChange={(contract_amount) => setDraft({ ...draft, contract_amount })}
                      align="right"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Change orders</Label>
                    <MoneyInput
                      value={draft.change_order_amount}
                      onValueChange={(change_order_amount) =>
                        setDraft({ ...draft, change_order_amount })
                      }
                      align="right"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Amount billed</Label>
                    <MoneyInput
                      value={draft.amount_billed}
                      onValueChange={(amount_billed) => setDraft({ ...draft, amount_billed })}
                      align="right"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Paid to date</Label>
                    <MoneyInput
                      value={draft.paid_to_date}
                      onValueChange={(paid_to_date) => setDraft({ ...draft, paid_to_date })}
                      align="right"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Retainage</Label>
                    <MoneyInput
                      value={draft.retainage}
                      onValueChange={(retainage) => setDraft({ ...draft, retainage })}
                      align="right"
                    />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_180px]">
                  <div className="space-y-1.5">
                    <Label>Notes</Label>
                    <Textarea
                      rows={3}
                      value={draft.notes}
                      placeholder="Billing narrative, exclusions, retainage notes, or collection issue."
                      onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                    />
                  </div>
                  <div className="rounded-md border border-hairline bg-surface p-3">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Open balance
                    </div>
                    <div className="mt-2 text-2xl font-medium tabular text-foreground">
                      {fmtUSD(draftOutstanding)}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Billed less paid and retainage.
                    </div>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPayAppOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={savePayApplication} disabled={savingPayApp}>
                  {savingPayApp ? "Saving..." : "Save pay app"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          <SovMetric label="Forecasted contract" value={fmtUSD(rollup.forecastedFinalContract)} />
          <SovMetric label="Earned to date" value={fmtUSD(earnedToDate)} />
          <SovMetric label="Billed to date" value={fmtUSD(totalBilled)} />
          <SovMetric label="Paid to date" value={fmtUSD(paidToDate)} />
          <SovMetric label="Outstanding" value={fmtUSD(outstanding)} />
          <SovMetric label="Retainage" value={fmtUSD(retainage)} />
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <div className="rounded-lg border border-hairline bg-card p-6 shadow-card xl:col-span-2">
          <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Pay application ledger
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Contract billing, change-order billing, invoice dates, paid-to-date, retainage, and
                open balance.
              </p>
            </div>
            <div className="text-sm tabular text-muted-foreground">
              Remaining contract {fmtUSD(contractRemaining)} · Holds {fmtUSD(holds)}
            </div>
          </div>
          <div className="overflow-x-auto rounded-md border border-hairline">
            <table className="min-w-[1180px] w-full text-sm">
              <thead className="bg-surface text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-left">Pay app</th>
                  <th className="px-3 py-2 text-left">Invoice</th>
                  <th className="px-3 py-2 text-left">Submitted / Due</th>
                  <th className="px-3 py-2 text-right">Contract</th>
                  <th className="px-3 py-2 text-right">COs</th>
                  <th className="px-3 py-2 text-right">Billed</th>
                  <th className="px-3 py-2 text-right">Paid</th>
                  <th className="px-3 py-2 text-right">Retainage</th>
                  <th className="px-3 py-2 text-right">Outstanding</th>
                  <th className="px-3 py-2 text-left">Status</th>
                  <th className="w-10 px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline">
                {billingApplications.length === 0 ? (
                  <tr>
                    <td
                      colSpan={11}
                      className="px-3 py-8 text-center text-sm text-muted-foreground"
                    >
                      No pay applications logged yet. Add the first pay app above.
                    </td>
                  </tr>
                ) : (
                  billingApplications.map((app) => (
                    <BillingApplicationRowEditor
                      key={app.id}
                      app={app}
                      onPatch={(patch) => onUpdate(app.id, patch)}
                      onDelete={() => onDelete(app.id)}
                    />
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-hairline bg-card p-6 shadow-card xl:col-span-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
            Pending COs in billing
          </div>
          <div className="mt-1 text-sm tabular text-muted-foreground">
            Raw {fmtUSD(rollup.pendingCOContract)} · likely {fmtUSD(weightedPending)}
          </div>
          {pendingCOs.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">No pending change orders.</p>
          ) : (
            <div className="mt-4 overflow-hidden rounded-md border border-hairline">
              <table className="w-full text-sm">
                <thead className="bg-surface text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left">CO</th>
                    <th className="px-3 py-2 text-right">Contract</th>
                    <th className="px-3 py-2 text-right">Prob.</th>
                    <th className="px-3 py-2 text-right">Likely</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-hairline">
                  {pendingCOs.map((co) => (
                    <tr key={co.number}>
                      <td className="px-3 py-2">
                        <div className="font-medium text-foreground">{co.number}</div>
                        <div className="text-xs text-muted-foreground">{co.description}</div>
                      </td>
                      <td className="px-3 py-2 text-right tabular">{fmtUSD(co.contract_amount)}</td>
                      <td className="px-3 py-2 text-right tabular text-muted-foreground">
                        {co.probability}%
                      </td>
                      <td className="px-3 py-2 text-right tabular">
                        {fmtUSD(co.contract_amount * (co.probability / 100))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function BillingApplicationRowEditor({
  app,
  onPatch,
  onDelete,
}: {
  app: BillingApplicationRow;
  onPatch: (patch: Partial<BillingApplicationRow>) => void;
  onDelete: () => void;
}) {
  const outstanding = Math.max(0, app.amount_billed - app.paid_to_date - app.retainage);

  return (
    <tr>
      <td className="px-3 py-2 align-top">
        <EditableText
          value={app.application_number}
          onCommit={(application_number) => onPatch({ application_number })}
        />
        <EditableText
          value={app.billing_period}
          placeholder="Billing period"
          small
          onCommit={(billing_period) => onPatch({ billing_period })}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <EditableText
          value={app.invoice_number}
          placeholder="Invoice #"
          onCommit={(invoice_number) => onPatch({ invoice_number })}
        />
      </td>
      <td className="px-3 py-2 align-top">
        <Input
          type="date"
          value={app.submitted_date ?? ""}
          onChange={(e) => onPatch({ submitted_date: e.target.value || null })}
          className="h-8 min-w-[138px]"
        />
        <Input
          type="date"
          value={app.due_date ?? ""}
          onChange={(e) => onPatch({ due_date: e.target.value || null })}
          className="mt-1 h-8 min-w-[138px]"
        />
      </td>
      <td className="px-3 py-2 align-top">
        <MoneyInput
          value={app.contract_amount}
          onValueChange={(contract_amount) => onPatch({ contract_amount })}
          align="right"
          className="ml-auto h-8 w-28"
        />
      </td>
      <td className="px-3 py-2 align-top">
        <MoneyInput
          value={app.change_order_amount}
          onValueChange={(change_order_amount) => onPatch({ change_order_amount })}
          align="right"
          className="ml-auto h-8 w-28"
        />
      </td>
      <td className="px-3 py-2 align-top">
        <MoneyInput
          value={app.amount_billed}
          onValueChange={(amount_billed) => onPatch({ amount_billed })}
          align="right"
          className="ml-auto h-8 w-28"
        />
      </td>
      <td className="px-3 py-2 align-top">
        <MoneyInput
          value={app.paid_to_date}
          onValueChange={(paid_to_date) => onPatch({ paid_to_date })}
          align="right"
          className="ml-auto h-8 w-28"
        />
      </td>
      <td className="px-3 py-2 align-top">
        <MoneyInput
          value={app.retainage}
          onValueChange={(retainage) => onPatch({ retainage })}
          align="right"
          className="ml-auto h-8 w-28"
        />
      </td>
      <td className="px-3 py-3 text-right align-top tabular font-medium">{fmtUSD(outstanding)}</td>
      <td className="px-3 py-2 align-top">
        <Select
          value={app.status}
          onValueChange={(status) => onPatch({ status: status as BillingApplicationRow["status"] })}
        >
          <SelectTrigger className="h-8 w-[118px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="submitted">Submitted</SelectItem>
            <SelectItem value="partial">Partial</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
            <SelectItem value="rejected">Rejected</SelectItem>
          </SelectContent>
        </Select>
      </td>
      <td className="px-3 py-2 align-top">
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </td>
    </tr>
  );
}

function EditableText({
  value,
  placeholder,
  small,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  small?: boolean;
  onCommit: (value: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <Input
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onCommit(local);
      }}
      className={`h-8 min-w-[128px] ${small ? "mt-1 text-xs text-muted-foreground" : ""}`}
    />
  );
}

type EditableProject = {
  name: string;
  job_number: string;
  client: string;
  project_manager: string;
  original_contract: number;
  original_cost_budget: number;
  schedule_variance_weeks: number;
  phase: Phase;
  percent_complete: number;
  hold_variance_note: string;
  forecast_completion_date: string | null;
  baseline_completion_date: string | null;
};

function EditFinancialsDialog({
  project,
  rollup,
  guidance,
  onSave,
  pending,
}: {
  project: ProjectRow;
  rollup: Rollup;
  guidance: { ePct: number; cPct: number; eTarget: number; cTarget: number };
  onSave: (patch: Partial<EditableProject>) => void;
  pending: boolean;
}) {
  const [open, setOpen] = useState(false);
  const defaultHoldNote = () =>
    `Current holds: E-Hold ${fmtUSD(rollup.exposureHolds)} vs ${fmtUSD(guidance.eTarget)} guidance (${guidance.ePct}%) and C-Hold ${fmtUSD(rollup.contingencyHold)} vs ${fmtUSD(guidance.cTarget)} guidance (${guidance.cPct}%). Explain why this hold posture is right for the project phase.`;
  const init = (): EditableProject => ({
    name: project.name,
    job_number: project.job_number,
    client: project.client,
    project_manager: project.project_manager,
    original_contract: project.original_contract,
    original_cost_budget: project.original_cost_budget,
    schedule_variance_weeks: project.schedule_variance_weeks,
    phase: project.phase,
    percent_complete: project.percent_complete,
    hold_variance_note: project.hold_variance_note || defaultHoldNote(),
    forecast_completion_date: project.forecast_completion_date,
    baseline_completion_date: project.baseline_completion_date,
  });
  const [form, setForm] = useState<EditableProject>(init);
  const calculatedScheduleVariance = computeScheduleVarianceWeeks(
    form.baseline_completion_date,
    form.forecast_completion_date,
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setForm(init());
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="ghost" className="gap-1.5">
          <Pencil className="h-3.5 w-3.5" /> Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Edit project</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Project name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Job number</Label>
              <Input
                value={form.job_number}
                onChange={(e) => setForm({ ...form, job_number: e.target.value })}
                placeholder="e.g. 26-014"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Client</Label>
            <Input
              value={form.client}
              onChange={(e) => setForm({ ...form, client: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Project manager</Label>
            <Input
              value={form.project_manager}
              onChange={(e) => setForm({ ...form, project_manager: e.target.value })}
              placeholder="e.g. Marshall Wilkinson"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Original contract</Label>
              <MoneyInput
                value={form.original_contract}
                onValueChange={(v) => setForm({ ...form, original_contract: v })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Original cost budget</Label>
              <MoneyInput
                value={form.original_cost_budget}
                onValueChange={(v) => setForm({ ...form, original_cost_budget: v })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Phase</Label>
              <Select
                value={form.phase}
                onValueChange={(v) => setForm({ ...form, phase: v as Phase })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Early">Early</SelectItem>
                  <SelectItem value="Middle">Middle</SelectItem>
                  <SelectItem value="Late">Late</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>% complete</Label>
              <Input
                type="number"
                min={0}
                max={100}
                value={form.percent_complete}
                onChange={(e) => setForm({ ...form, percent_complete: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1.5">
              <Label>Baseline completion</Label>
              <Input
                type="date"
                value={form.baseline_completion_date ?? ""}
                onChange={(e) =>
                  setForm({ ...form, baseline_completion_date: e.target.value || null })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Forecast completion</Label>
              <Input
                type="date"
                value={form.forecast_completion_date ?? ""}
                onChange={(e) =>
                  setForm({ ...form, forecast_completion_date: e.target.value || null })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>Schedule variance</Label>
              <div
                className={`flex h-10 items-center rounded-md border border-input bg-surface px-3 text-sm tabular ${
                  (calculatedScheduleVariance ?? 0) > 0
                    ? "text-danger"
                    : (calculatedScheduleVariance ?? 0) < 0
                      ? "text-success"
                      : "text-foreground"
                }`}
              >
                {calculatedScheduleVariance == null
                  ? "Set dates"
                  : calculatedScheduleVariance > 0
                    ? `+${calculatedScheduleVariance} wk`
                    : calculatedScheduleVariance < 0
                      ? `${calculatedScheduleVariance} wk`
                      : "On plan"}
              </div>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>
              Hold guidance note{" "}
              <span className="text-muted-foreground">
                (why current E-Hold/C-Hold posture is appropriate)
              </span>
            </Label>
            <Textarea
              rows={2}
              value={form.hold_variance_note}
              placeholder={defaultHoldNote()}
              onChange={(e) => setForm({ ...form, hold_variance_note: e.target.value })}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() => {
              onSave({
                ...form,
                schedule_variance_weeks: calculatedScheduleVariance ?? 0,
              });
              setOpen(false);
            }}
          >
            {pending ? "Saving…" : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
