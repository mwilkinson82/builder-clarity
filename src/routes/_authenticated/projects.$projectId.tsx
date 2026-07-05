import {
  createFileRoute,
  Link,
  Outlet,
  useChildMatches,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { InvoicePaymentMethodToggles } from "@/components/billing/InvoicePaymentMethodToggles";
import { ReceivablesCockpit } from "@/components/billing/ReceivablesCockpit";
import {
  getInvoiceRemittance,
  getPaymentMethodContext,
  type PaymentMethodContext,
} from "@/lib/payments.functions";
import {
  centsToDollars,
  dollarsToCents,
  invoiceTotalDueDollars,
  isOverRecording,
  methodAvailability,
  pendingPaymentLock,
  percentOfDollars,
  quantizeDollars,
  resolveEnabledMethods,
  sumDollarsToCents,
} from "@/lib/payments-domain";
import { fmtUSDCents } from "@/lib/billing-format";
import { applySovBucketPatch } from "@/lib/sov-rollup";
import { CostBucketsTable } from "@/components/outcome/CostBucketsTable";
import { ChangeOrdersTable } from "@/components/outcome/ChangeOrdersTable";
import { ScheduleRisk } from "@/components/schedule";
import { ProjectTruthReview } from "@/components/outcome/ProjectTruthReview";
import { ImportSOVSheet, type SovMappingProfileDraft } from "@/components/outcome/ImportSOVSheet";
import { ReviewsTab } from "@/components/outcome/ReviewsTab";
import { RiskAllocationWorkbench } from "@/components/outcome/RiskAllocationWorkbench";
import { ProjectDashboard } from "@/components/outcome/ProjectDashboard";
import { DecisionsTable } from "@/components/outcome/DecisionsTable";
import { DailyReportsWorkspace } from "@/components/outcome/DailyReportsWorkspace";
import { ClientPortalWorkspace } from "@/components/outcome/ClientPortalWorkspace";
import {
  InspectionsWorkspace,
  type InspectionDraft,
  type InspectionPatch,
} from "@/components/outcome/InspectionsWorkspace";
import {
  BillingLineItemsPanel,
  ProjectCostTrackingPanel,
  WipAnalysisPanel,
} from "@/components/billing/BillingEnhancements";
import { billingDocumentLabel, normalizeBillingNumberLabel } from "@/lib/billing-labels";
import {
  getClientPortalManagement,
  type ProjectClientAccessRow,
} from "@/lib/client-portal.functions";
import {
  createCostActual,
  generateBillingLineItems,
  getBillingWorkspace,
  importCostActuals,
  updateBillingApplicationRetainageRate,
  updateBillingLineItem,
  updateCostBucketBillingSettings,
  voidCostActual,
  type BillingWorkspaceData,
  type CostActualImportRow,
} from "@/lib/billing.functions";
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
  createInspection,
  updateInspection,
  deleteInspection,
  updateBucket,
  createBucket,
  deleteBucket,
  submitReview,
  updateReview,
  importCostBuckets,
  saveSovMappingProfile,
  createBillingApplication,
  updateBillingApplication,
  deleteBillingApplication,
  createBillingInvoice,
  updateBillingInvoice,
  deleteBillingInvoice,
  archiveProject,
  deleteProject,
  reconcileInvoicePayments,
  recordInvoicePayment,
  type ProjectRow,
  type ReviewRow,
  type ChangeOrderRow,
  type BillingApplicationRow,
  type BillingApplicationEventRow,
  type BillingInvoiceRow,
  type BillingOutputFormat,
  type PaymentLedgerRow,
  type ExposureRow,
  type InspectionRow,
  type SovImportRow,
  type BucketRow,
} from "@/lib/projects.functions";
import { isHarborDemoProject } from "@/lib/demo-seed";
import { listSchedule } from "@/lib/schedule.functions";
import { fmtUSD, fmtPct } from "@/lib/format";
import {
  computeScheduleVarianceWeeks,
  remainingExposureValue,
  type Phase,
  type ExposureCategory,
  type Rollup,
} from "@/lib/ior";
import { cn } from "@/lib/utils";
import { generateIorPdf, downloadPdfBytes, type IorPdfStyle } from "@/lib/ior-pdf";
import { generateInvoicePdf } from "@/lib/invoice-pdf";
import { toast } from "sonner";
import {
  CalendarClock,
  BriefcaseBusiness,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  LayoutDashboard,
  ListChecks,
  LogOut,
  Archive,
  Mail,
  Pencil,
  Plus,
  ReceiptText,
  ShieldAlert,
  Trash2,
  Users,
} from "lucide-react";

const PROJECT_TAB_VALUES = [
  "dashboard",
  "schedule",
  "inspections",
  "risk-tally",
  "todos",
  "sov",
  "billing",
  "change-orders",
  "client-portal",
  "ior-report",
  "daily-reports",
] as const;

type ProjectTabValue = (typeof PROJECT_TAB_VALUES)[number];

const COMPACT_PROJECT_NAV_TABS = new Set<ProjectTabValue>([
  "dashboard",
  "schedule",
  "inspections",
  "risk-tally",
  "todos",
  "sov",
  "billing",
  "change-orders",
  "client-portal",
  "ior-report",
  "daily-reports",
]);

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  ssr: false,
  head: () => ({ meta: [{ title: "Project IOR — Overwatch" }] }),
  validateSearch: (search: Record<string, unknown>): { tab?: ProjectTabValue } => {
    const tab = typeof search.tab === "string" ? search.tab : "";
    return {
      tab: PROJECT_TAB_VALUES.includes(tab as ProjectTabValue)
        ? (tab as ProjectTabValue)
        : undefined,
    };
  },
  component: ProjectRoute,
});

const LOCAL_BILLING_ID_PREFIX = "local-pay-app-";
const BILLING_STATUS_VALUES = ["draft", "submitted", "paid", "partial", "rejected"] as const;
const BILLING_WORKSPACE_TAB_TRIGGER_CLASS =
  "whitespace-nowrap rounded-md border border-accent/35 bg-accent/10 px-3 py-2 text-sm font-semibold text-foreground shadow-sm transition hover:border-accent/60 hover:bg-accent/20 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-[state=active]:border-accent data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-md";
const PROJECT_NAV_RAIL_CLASS =
  "h-auto w-full justify-start gap-1.5 overflow-x-auto rounded-lg border border-accent/25 bg-accent/[0.07] p-1.5 shadow-[0_18px_42px_rgb(27_122_110_/_0.16),0_4px_12px_rgb(31_28_23_/_0.10)] ring-1 ring-accent/15 backdrop-blur-sm lg:-translate-y-1 lg:flex-col lg:items-stretch lg:overflow-visible";

function projectNavItemClass({ compact, active }: { compact: boolean; active?: boolean }) {
  return cn(
    "group relative min-h-[46px] min-w-[148px] overflow-hidden rounded-md border px-3 py-3 text-left transition duration-200 focus-visible:ring-2 focus-visible:ring-ring lg:w-full",
    active
      ? "border-accent/75 bg-accent text-accent-foreground shadow-[0_12px_26px_rgb(27_122_110_/_0.30)] ring-1 ring-accent/35"
      : "border-transparent bg-card/45 text-muted-foreground hover:border-accent/35 hover:bg-card/85 hover:text-foreground hover:shadow-sm",
    compact ? "lg:min-w-0 lg:justify-center lg:px-2 lg:py-3.5" : "justify-start",
    compact && active ? "lg:scale-[1.04]" : "",
  );
}

function projectNavIconClass({ compact, active }: { compact: boolean; active?: boolean }) {
  return cn(
    "h-4 w-4 shrink-0 transition",
    compact ? "lg:mr-0" : "mr-2",
    active ? "text-accent-foreground drop-shadow-sm" : "text-current group-hover:text-accent",
  );
}

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

function makeLocalBillingEvent(
  projectId: string,
  billingApplicationId: string,
  input: {
    event_type: string;
    from_status?: string;
    to_status?: string;
    amount?: number;
    notes?: string;
  },
): BillingApplicationEventRow {
  const randomId =
    typeof globalThis.crypto?.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return {
    id: `local-billing-event-${randomId}`,
    billing_application_id: billingApplicationId,
    project_id: projectId,
    event_type: input.event_type,
    from_status: input.from_status ?? "",
    to_status: input.to_status ?? "",
    amount: input.amount ?? 0,
    notes: input.notes ?? "",
    created_by: null,
    created_at: new Date().toISOString(),
  };
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
  const id = makeLocalBillingId();
  return {
    id,
    project_id: projectId,
    application_number: normalizeBillingNumberLabel(input.application_number),
    invoice_number: normalizeBillingNumberLabel(input.invoice_number),
    submitted_date: input.submitted_date || null,
    due_date: input.due_date || null,
    billing_period: input.billing_period,
    contract_amount: input.contract_amount,
    change_order_amount: input.change_order_amount,
    amount_billed: input.amount_billed,
    paid_to_date: input.paid_to_date,
    retainage: input.retainage,
    has_line_detail: input.has_line_detail,
    total_retainage_held: input.total_retainage_held,
    retainage_released_this_period: input.retainage_released_this_period,
    status: input.status,
    output_format: input.output_format,
    notes: input.notes,
    sort_order: input.sort_order,
    status_events: [
      makeLocalBillingEvent(projectId, id, {
        event_type: "created",
        from_status: "",
        to_status: input.status,
        amount: input.amount_billed,
        notes: input.notes || "Application created locally.",
      }),
    ],
  };
}

function normalizeStoredBillingEvent(
  projectId: string,
  billingApplicationId: string,
  raw: unknown,
): BillingApplicationEventRow | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = billingString(record.id);
  return {
    id: id || `local-billing-event-${Date.now()}`,
    billing_application_id: billingString(record.billing_application_id, billingApplicationId),
    project_id: billingString(record.project_id, projectId),
    event_type: billingString(record.event_type, "status_change"),
    from_status: billingString(record.from_status),
    to_status: billingString(record.to_status),
    amount: billingNumber(record.amount),
    notes: billingString(record.notes),
    created_by: typeof record.created_by === "string" ? record.created_by : null,
    created_at: billingString(record.created_at, new Date().toISOString()),
  };
}

function normalizeStoredBillingApplication(
  projectId: string,
  raw: unknown,
): BillingApplicationRow | null {
  if (!raw || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  const id = billingString(record.id);
  const normalizedId = id.startsWith(LOCAL_BILLING_ID_PREFIX) ? id : makeLocalBillingId();
  return {
    id: normalizedId,
    project_id: projectId,
    application_number: normalizeBillingNumberLabel(
      billingString(record.application_number, "Application"),
    ),
    invoice_number: normalizeBillingNumberLabel(billingString(record.invoice_number)),
    submitted_date: billingDate(record.submitted_date),
    due_date: billingDate(record.due_date),
    billing_period: billingString(record.billing_period),
    contract_amount: billingNumber(record.contract_amount),
    change_order_amount: billingNumber(record.change_order_amount),
    amount_billed: billingNumber(record.amount_billed),
    paid_to_date: billingNumber(record.paid_to_date),
    retainage: billingNumber(record.retainage),
    has_line_detail: Boolean(record.has_line_detail ?? false),
    total_retainage_held: billingNumber(record.total_retainage_held),
    retainage_released_this_period: billingNumber(record.retainage_released_this_period),
    status: isBillingStatus(record.status) ? record.status : "draft",
    output_format: billingString(record.output_format) === "aia_g702" ? "aia_g702" : "invoice",
    notes: billingString(record.notes),
    sort_order: billingNumber(record.sort_order),
    status_events: Array.isArray(record.status_events)
      ? record.status_events
          .map((event) => normalizeStoredBillingEvent(projectId, normalizedId, event))
          .filter((event): event is BillingApplicationEventRow => Boolean(event))
      : [],
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

function exposureCategoryFromChangeOrder(coType: ChangeOrderRow["co_type"]): ExposureCategory {
  switch (coType) {
    case "owner_change":
      return "owner_decision";
    case "design_error":
    case "design_omission":
      return "design_drift";
    case "unforeseen_condition":
      return "field_change";
    case "missed_scope":
      return "other";
    case "sub_issued":
      return "trade_performance";
    case "other":
    default:
      return "other";
  }
}

function ProjectRoute() {
  const childMatches = useChildMatches();
  return childMatches.length > 0 ? <Outlet /> : <ProjectPage />;
}

function ProjectPage() {
  const { projectId } = Route.useParams();
  const search = Route.useSearch();
  const get = useServerFn(getProject);
  const list = useServerFn(listProjects);
  const qc = useQueryClient();
  const [creatingCoRiskId, setCreatingCoRiskId] = useState<string | null>(null);
  const [creatingInspectionRiskId, setCreatingInspectionRiskId] = useState<string | null>(null);
  const [activeProjectTab, setActiveProjectTab] = useState<ProjectTabValue>(
    search.tab ?? "dashboard",
  );
  const [focusedRiskExposureId, setFocusedRiskExposureId] = useState<string | null>(null);
  const handleRiskFocusHandled = useCallback(() => setFocusedRiskExposureId(null), []);
  const [companyLogoFailedUrl, setCompanyLogoFailedUrl] = useState("");
  const setProjectTab = (value: string) => {
    if (PROJECT_TAB_VALUES.includes(value as ProjectTabValue)) {
      setActiveProjectTab(value as ProjectTabValue);
    }
  };

  useEffect(() => {
    if (search.tab) setProjectTab(search.tab);
  }, [search.tab]);

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
  const createInspectionFn = useServerFn(createInspection);
  const updateInspectionFn = useServerFn(updateInspection);
  const deleteInspectionFn = useServerFn(deleteInspection);
  const updateBucketFn = useServerFn(updateBucket);
  const createBucketFn = useServerFn(createBucket);
  const deleteBucketFn = useServerFn(deleteBucket);
  const submitReviewFn = useServerFn(submitReview);
  const updateReviewFn = useServerFn(updateReview);
  const importBucketsFn = useServerFn(importCostBuckets);
  const saveSovProfileFn = useServerFn(saveSovMappingProfile);
  const createBillingFn = useServerFn(createBillingApplication);
  const updateBillingFn = useServerFn(updateBillingApplication);
  const deleteBillingFn = useServerFn(deleteBillingApplication);
  const createInvoiceFn = useServerFn(createBillingInvoice);
  const updateInvoiceFn = useServerFn(updateBillingInvoice);
  const deleteInvoiceFn = useServerFn(deleteBillingInvoice);
  const recordPaymentFn = useServerFn(recordInvoicePayment);
  const reconcileInvoiceFn = useServerFn(reconcileInvoicePayments);
  const loadBillingWorkspaceFn = useServerFn(getBillingWorkspace);
  const generateBillingLinesFn = useServerFn(generateBillingLineItems);
  const updateBillingLineFn = useServerFn(updateBillingLineItem);
  const updateBillingRetainageRateFn = useServerFn(updateBillingApplicationRetainageRate);
  const createCostActualFn = useServerFn(createCostActual);
  const importCostActualsFn = useServerFn(importCostActuals);
  const voidCostActualFn = useServerFn(voidCostActual);
  const updateBucketBillingSettingsFn = useServerFn(updateCostBucketBillingSettings);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["billing-workspace", projectId] });
    qc.invalidateQueries({ queryKey: ["portfolio-billing"] });
  };
  const useServerMutation = <I,>(fn: (i: { data: I }) => Promise<unknown>) =>
    useMutation({ mutationFn: (input: I) => fn({ data: input }), onSuccess: invalidate });

  const finUpdate = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      (
        updateFinFn as (i: { data: Record<string, unknown> }) => Promise<{
          ok: boolean;
          project?: ProjectRow;
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
        description: "Header, portfolio, dashboard, and reports are using the saved project info.",
      });
    },
    onError: (err) => {
      toast.error("Project did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  const archiveProjectFn = useServerFn(archiveProject);
  const deleteProjectFn = useServerFn(deleteProject);
  const archiveMutation = useMutation({
    mutationFn: () => archiveProjectFn({ data: { projectId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["portfolio-billing"] });
      toast.success("Project archived", {
        description:
          "It's hidden from the portfolio. Ask an admin to restore it from the database.",
      });
      navigate({ to: "/" });
    },
    onError: (err) =>
      toast.error("Archive failed", {
        description: err instanceof Error ? err.message : "Try again.",
      }),
  });
  const deleteMutation = useMutation({
    mutationFn: () => deleteProjectFn({ data: { projectId } }),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["projects"] });
      qc.invalidateQueries({ queryKey: ["portfolio-billing"] });
      const demoArchived = Boolean(result && "demoArchived" in result && result.demoArchived);
      toast.success(demoArchived ? "Training project hidden" : "Project deleted", {
        description: demoArchived
          ? "Harbor Residence is hidden for your whole company and won't come back on its own."
          : undefined,
      });
      navigate({ to: "/" });
    },
    onError: (err) =>
      toast.error("Delete failed", {
        description: err instanceof Error ? err.message : "Try again.",
      }),
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
  const inspectionCreate = useMutation({
    mutationFn: (input: InspectionDraft) => createInspectionFn({ data: { projectId, ...input } }),
    onSuccess: (result) => {
      invalidate();
      const usedFallback = Boolean(result && "fallback" in result && result.fallback);
      toast.success("Inspection logged", {
        description: usedFallback
          ? "Saved through the shared risk ledger until the inspection table is available."
          : "The inspection log and IOR posture are updated.",
      });
    },
    onError: (err) => {
      toast.error("Inspection did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  const inspectionUpdate = useMutation({
    mutationFn: (input: { id: string; patch: InspectionPatch }) =>
      updateInspectionFn({ data: { id: input.id, ...input.patch } }),
    onSuccess: (result) => {
      invalidate();
      const usedFallback = Boolean(result && "fallback" in result && result.fallback);
      toast.success("Inspection updated", {
        description: usedFallback
          ? "Updated through the shared risk ledger until the inspection table is available."
          : undefined,
      });
    },
    onError: (err) => {
      toast.error("Inspection did not update", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  const inspectionDelete = useMutation({
    mutationFn: (input: { id: string }) => deleteInspectionFn({ data: input }),
    onSuccess: (result) => {
      invalidate();
      const usedFallback = Boolean(result && "fallback" in result && result.fallback);
      toast.success("Inspection deleted", {
        description: usedFallback ? "Removed from the shared risk ledger fallback." : undefined,
      });
    },
    onError: (err) => {
      toast.error("Inspection did not delete", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  // SOV cell commits patch the cached bucket list immediately (group headers,
  // summary cards, and the footer recompute from it), then the settled
  // invalidate pulls the server truth including the IOR-facing rollup. The
  // cancelQueries guard keeps an in-flight refetch from clobbering the
  // optimistic value mid-edit.
  const bucketUpdate = useMutation({
    mutationFn: (input: { id: string; patch: Record<string, unknown> }) =>
      updateBucketFn({ data: input as never }),
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ["project", projectId] });
      const previous = qc.getQueryData(["project", projectId]);
      qc.setQueryData(["project", projectId], (current: unknown) => {
        if (!current || typeof current !== "object") return current;
        const record = current as { buckets?: BucketRow[] };
        if (!Array.isArray(record.buckets)) return current;
        return {
          ...(current as Record<string, unknown>),
          buckets: applySovBucketPatch(record.buckets, id, patch as Partial<BucketRow>),
        };
      });
      return { previous };
    },
    onError: (err, _input, mutateContext) => {
      if (mutateContext?.previous) {
        qc.setQueryData(["project", projectId], mutateContext.previous);
      }
      toast.error("SOV line did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
    onSettled: () => invalidate(),
  });
  const bucketCreate = useServerMutation<Record<string, unknown>>(createBucketFn as never);
  const bucketDelete = useServerMutation<{ id: string }>(deleteBucketFn);
  const reviewSubmit = useServerMutation<Record<string, unknown>>(submitReviewFn as never);
  const reviewUpdate = useServerMutation<Record<string, unknown>>(updateReviewFn as never);
  const bucketImport = useServerMutation<Record<string, unknown>>(importBucketsFn as never);
  const sovProfileSave = useMutation({
    mutationFn: (input: SovMappingProfileDraft) =>
      saveSovProfileFn({ data: { projectId, ...input } }),
    onSuccess: () => {
      toast.success("SOV mapping saved", {
        description: "This spreadsheet format can now be reused on future imports.",
      });
      invalidate();
    },
    onError: (err) => {
      toast.error("SOV mapping did not save", {
        description: err instanceof Error ? err.message : "Try again after setup is complete.",
      });
    },
  });
  const billingCreate = useServerMutation<Record<string, unknown>>(createBillingFn as never);
  const billingUpdate = useServerMutation<Record<string, unknown>>(updateBillingFn as never);
  const billingDelete = useServerMutation<{ id: string }>(deleteBillingFn);
  const invoiceCreate = useMutation({
    mutationFn: (input: { projectId: string } & InvoiceDraft) => createInvoiceFn({ data: input }),
    onSuccess: (_result, input) => {
      invalidate();
      toast.success("Invoice created", {
        description: `${billingDocumentLabel(input.invoice_number, input.title, "Invoice")} is now in the billing ledger.`,
      });
    },
    onError: (err) => {
      toast.error("Invoice did not save", {
        description:
          err instanceof Error
            ? err.message
            : "Publish the invoice/payment migration and try again.",
      });
    },
  });
  const invoiceUpdate = useServerMutation<Record<string, unknown>>(updateInvoiceFn as never);
  const invoiceDelete = useServerMutation<{ id: string }>(deleteInvoiceFn);
  const paymentRecord = useServerMutation<Record<string, unknown>>(recordPaymentFn as never);
  const [reconcilingInvoiceId, setReconcilingInvoiceId] = useState<string | null>(null);
  const invoiceReconcile = useMutation({
    mutationFn: (invoiceId: string) => reconcileInvoiceFn({ data: { invoiceId } }),
    onMutate: (invoiceId) => setReconcilingInvoiceId(invoiceId),
    onSuccess: (result) => {
      invalidate();
      toast.success("Invoice reconciled from payments", {
        description: `Paid amount is now ${fmtUSDCents(result.paidAmount)} across ${result.countedPayments} counted payment${result.countedPayments === 1 ? "" : "s"} · status ${result.status.replace("_", " ")}.`,
      });
    },
    onError: (err) => {
      toast.error("Reconcile did not run", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
    onSettled: () => setReconcilingInvoiceId(null),
  });
  const billingWorkspaceQuery = useQuery({
    queryKey: ["billing-workspace", projectId],
    queryFn: () => loadBillingWorkspaceFn({ data: { projectId } }),
  });
  const billingLineGenerate = useMutation({
    mutationFn: (input: { projectId: string; billingApplicationId: string }) =>
      generateBillingLinesFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Billing lines generated", {
        description: "The application now has SOV-level continuation detail.",
      });
    },
    onError: (err) => {
      toast.error("Billing lines did not generate", {
        description: err instanceof Error ? err.message : "Try again after the migration runs.",
      });
    },
  });
  const billingLineUpdate = useMutation({
    mutationFn: (input: {
      id: string;
      patch: {
        work_completed_this_period?: number;
        materials_stored_this_period?: number;
        retainage_pct?: number;
        retainage_released?: number;
      };
    }) => updateBillingLineFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Billing line saved");
    },
    onError: (err) => {
      toast.error("Billing line did not save", {
        description: err instanceof Error ? err.message : "Check the line values and try again.",
      });
    },
  });
  const billingRetainageRateUpdate = useMutation({
    mutationFn: (input: { billingApplicationId: string; retainage_pct: number }) =>
      updateBillingRetainageRateFn({ data: input }),
    onSuccess: (result) => {
      invalidate();
      toast.success("Retention rate applied", {
        description: `${result.line_count} billing line${result.line_count === 1 ? "" : "s"} recalculated.`,
      });
    },
    onError: (err) => {
      toast.error("Retention rate did not save", {
        description: err instanceof Error ? err.message : "Check the percentage and try again.",
      });
    },
  });
  const costActualCreate = useMutation({
    mutationFn: (input: Parameters<typeof createCostActualFn>[0]["data"]) =>
      createCostActualFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Cost actual saved");
    },
    onError: (err) => {
      toast.error("Cost actual did not save", {
        description: err instanceof Error ? err.message : "Check the cost entry and try again.",
      });
    },
  });
  const costActualImport = useMutation({
    mutationFn: (input: Parameters<typeof importCostActualsFn>[0]["data"]) =>
      importCostActualsFn({ data: input }),
    onSuccess: (result) => {
      invalidate();
      toast.success("Cost import complete", {
        description: `${result.imported_count} imported · ${result.skipped_count} skipped · ${result.unmatched_count} unmatched.`,
      });
    },
    onError: (err) => {
      toast.error("Cost import did not save", {
        description: err instanceof Error ? err.message : "Check the CSV headers and try again.",
      });
    },
  });
  const costActualVoid = useMutation({
    mutationFn: (input: { id: string; notes: string }) => voidCostActualFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Cost actual voided");
    },
    onError: (err) => {
      toast.error("Cost actual did not void", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  const bucketBillingUpdate = useMutation({
    mutationFn: (input: {
      id: string;
      patch: {
        earned_percent_complete?: number;
        retainage_pct?: number;
        billing_method?: "percent" | "unit" | "material";
        contract_quantity?: number;
        unit?: string;
      };
    }) => updateBucketBillingSettingsFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("WIP setting saved");
    },
    onError: (err) => {
      toast.error("WIP setting did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
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
    decisionOwnerOptions,
    reviews,
    sovImports,
    sovMappingProfiles,
    billingApplications,
    billingInvoices,
    inspections = [],
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

  const handleCreateRiskFromChangeOrder = (co: ChangeOrderRow) => {
    const dollarExposure = co.cost_amount > 0 ? co.cost_amount : co.contract_amount;

    if (co.status === "Approved") {
      toast.info("Approved CO already affects the forecast", {
        description:
          "Use this action for pending or denied change orders that still need to be protected in the risk tally.",
      });
      return;
    }

    if (dollarExposure <= 0) {
      toast.error("CO needs a dollar value before it can become a risk", {
        description: "Add a cost amount or contract amount, then send it to the risk tally.",
      });
      return;
    }

    setCreatingCoRiskId(co.id);
    expCreate.mutate(
      {
        projectId,
        title: `${co.number ? `${co.number} - ` : ""}${co.description}`,
        description: co.notes || co.description,
        category: exposureCategoryFromChangeOrder(co.co_type),
        dollar_exposure: dollarExposure,
        probability: co.status === "Pending" ? co.probability : 100,
        schedule_impact_weeks: null,
        owner: co.owner || "PM",
        response_path: "recover",
        hold_class: "E-Hold",
        status: "active",
        due_date: null,
        next_review_at: null,
        release_condition:
          co.status === "Pending"
            ? `Change order ${co.number || co.description} is approved or formally denied.`
            : `Denied change order ${co.number || co.description} is recovered, offset, accepted, or eliminated.`,
        notes: [
          `Created from Change Orders.`,
          `CO status: ${co.status}.`,
          `Contract value: ${fmtUSD(co.contract_amount)}.`,
          `Cost exposure: ${fmtUSD(co.cost_amount)}.`,
          `Likely exposure: ${fmtUSD(dollarExposure * ((co.status === "Pending" ? co.probability : 100) / 100))}.`,
          co.notes ? `CO notes: ${co.notes}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      {
        onSuccess: () => {
          toast.success("CO sent to risk tally", {
            description: `${co.number || "Change order"} is now an E-Hold exposure to recover.`,
          });
        },
        onError: (err) => {
          toast.error("CO risk allocation did not save", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
        onSettled: () => setCreatingCoRiskId(null),
      },
    );
  };

  const handleCreateRiskFromInspection = (inspection: InspectionRow) => {
    if (inspection.risk_exposure_id) {
      toast.info("Inspection already has a linked risk", {
        description: "Open the Risk Tally tab to manage the existing exposure.",
      });
      return;
    }

    const scheduleImpact = Number(inspection.schedule_impact_weeks ?? 0);
    const dollarExposure = Math.max(0, inspection.cost_impact);
    const riskworthy =
      inspection.status === "failed" ||
      inspection.status === "partial" ||
      inspection.result === "fail" ||
      inspection.result === "partial" ||
      scheduleImpact > 0 ||
      dollarExposure > 0;

    if (!riskworthy) {
      toast.info("No inspection risk to allocate yet", {
        description:
          "Failed, partial, cost-impact, or schedule-impact inspections can be sent to the risk tally.",
      });
      return;
    }

    setCreatingInspectionRiskId(inspection.id);
    createExposureFn({
      data: {
        projectId,
        title: `Inspection: ${inspection.inspection_type}`,
        description:
          inspection.corrective_action ||
          inspection.notes ||
          `${inspection.inspection_type} requires follow-through before the inspection cycle closes.`,
        category: scheduleImpact > 0 ? "schedule_compression" : "field_change",
        dollar_exposure: dollarExposure,
        probability: 100,
        schedule_impact_weeks: scheduleImpact > 0 ? scheduleImpact : null,
        owner: inspection.responsible_party || project.project_manager || "PM",
        response_path: "recover",
        hold_class: "E-Hold",
        status: "active",
        due_date: inspection.scheduled_date ?? inspection.completed_date ?? null,
        next_review_at: null,
        release_condition: `${inspection.inspection_type} passes and ${inspection.authority || "the inspection authority"} releases the affected work.`,
        notes: [
          "Created from Inspections.",
          `Status: ${inspection.status}. Result: ${inspection.result}. Attempt: ${inspection.attempt_number}.`,
          inspection.authority ? `Authority: ${inspection.authority}.` : "",
          inspection.inspector ? `Inspector: ${inspection.inspector}.` : "",
          inspection.location ? `Location: ${inspection.location}.` : "",
          `Cost impact: ${fmtUSD(dollarExposure)}.`,
          `Schedule impact: ${scheduleImpact || 0} week${scheduleImpact === 1 ? "" : "s"}.`,
          inspection.corrective_action ? `Corrective action: ${inspection.corrective_action}` : "",
          inspection.notes ? `Inspection notes: ${inspection.notes}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
    })
      .then((result) =>
        updateInspectionFn({
          data: {
            id: inspection.id,
            risk_exposure_id: result.id || null,
          },
        }),
      )
      .then(() => {
        invalidate();
        toast.success("Inspection sent to risk tally", {
          description: `${inspection.inspection_type} is now an E-Hold exposure to recover.`,
        });
      })
      .catch((err) => {
        toast.error("Inspection risk did not save", {
          description: err instanceof Error ? err.message : "Try again.",
        });
      })
      .finally(() => setCreatingInspectionRiskId(null));
  };

  const milestones = scheduleData?.milestones ?? [];
  const scheduleRisks = scheduleData?.risks ?? [];
  const scheduleUpdates = scheduleData?.updates ?? [];
  const activeScheduleRiskCount = scheduleRisks.filter((risk) => risk.status === "active").length;
  const latestScheduleUpdate = scheduleUpdates[0] ?? null;
  const scheduleMovementSinceLastUpdate = latestScheduleUpdate?.movement_weeks ?? null;
  const liveExposureCount = exposures.filter((e) => remainingExposureValue(e) > 0).length;
  const lastReviewForecast =
    reviews[0]?.forecast_completion_date_after ??
    reviews[0]?.forecast_completion_date_before ??
    null;
  const jobNumber = project.job_number || `ID ${project.id.slice(0, 8).toUpperCase()}`;
  // The Harbor training project hides for the whole company instead of
  // hard-deleting (the demo seeders would just bring a deleted one back).
  const isDemoProject = isHarborDemoProject(project as unknown as Record<string, unknown>);
  const openTodoCount = decisions.filter((d) => d.status !== "resolved").length;
  const openInspectionCount = inspections.filter(
    (inspection) => !["passed", "cancelled"].includes(inspection.status),
  ).length;

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
    toast.success("Application created locally", {
      description: "Supabase billing is not live yet, so this browser is holding it for the demo.",
    });
  };

  const handleCreatePayApp = (input: BillingDraft) => {
    billingCreate.mutate(
      { projectId, ...input },
      {
        onSuccess: () => {
          toast.success("Application created", {
            description: `${billingDocumentLabel(input.application_number, input.invoice_number, "Application")} is now in the billing workspace.`,
          });
        },
        onError: (err) => {
          if (isMissingBillingApplicationsTableError(err)) {
            createLocalPayApp(input);
            return;
          }
          toast.error("Application did not save", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
      },
    );
  };

  const handleUpdatePayApp = (id: string, patch: Partial<BillingApplicationRow>) => {
    if (id.startsWith(LOCAL_BILLING_ID_PREFIX)) {
      storeLocalBillingApplications((current) =>
        current.map((app) => {
          if (app.id !== id) return app;
          const statusChanged = patch.status && patch.status !== app.status;
          const paidChanged =
            typeof patch.paid_to_date === "number" && patch.paid_to_date !== app.paid_to_date;
          const lifecycleEvents = [...app.status_events];
          if (statusChanged || paidChanged) {
            lifecycleEvents.unshift(
              makeLocalBillingEvent(projectId, app.id, {
                event_type: statusChanged ? "status_change" : "payment_update",
                from_status: app.status,
                to_status: statusChanged ? patch.status : app.status,
                amount: paidChanged ? patch.paid_to_date : app.amount_billed,
                notes: statusChanged
                  ? `${billingDocumentLabel(app.application_number, app.invoice_number)} moved from ${app.status} to ${patch.status}.`
                  : `${billingDocumentLabel(app.application_number, app.invoice_number)} paid-to-date updated from ${app.paid_to_date} to ${patch.paid_to_date}.`,
              }),
            );
          }
          return { ...app, ...patch, status_events: lifecycleEvents };
        }),
      );
      return;
    }
    billingUpdate.mutate(
      { id, patch },
      {
        onError: (err) => {
          toast.error("Application did not update", {
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
          toast.error("Application did not delete", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
      },
    );
  };

  const handleCreateInvoice = async (input: InvoiceDraft) => {
    await invoiceCreate.mutateAsync({ projectId, ...input });
  };

  const handleUpdateInvoice = (id: string, patch: Partial<BillingInvoiceRow>) => {
    invoiceUpdate.mutate(
      { id, patch },
      {
        onError: (err) => {
          toast.error("Invoice did not update", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
      },
    );
  };

  const handleDeleteInvoice = (id: string) => {
    invoiceDelete.mutate(
      { id },
      {
        onSuccess: () => toast.success("Invoice deleted"),
        onError: (err) => {
          toast.error("Invoice did not delete", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
      },
    );
  };

  const handleRecordPayment = (input: PaymentDraft) => {
    paymentRecord.mutate(input, {
      onSuccess: () => {
        toast.success("Payment recorded", {
          description: "Invoice, payment ledger, and linked application were refreshed.",
        });
      },
      onError: (err) => {
        toast.error("Payment did not save", {
          description:
            err instanceof Error ? err.message : "Publish the payment ledger migration and retry.",
        });
      },
    });
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

  const openDashboardExposure = (exposureId: string) => {
    setActiveProjectTab("risk-tally");
    setFocusedRiskExposureId(exposureId);
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
      value: "inspections",
      label: "Inspections",
      detail: `${openInspectionCount} open`,
      icon: ClipboardList,
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
      value: "client-portal",
      label: "Client Portal",
      detail: "CO approvals",
      icon: Users,
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
  const companyLogoUrl =
    project.organization_logo_url && project.organization_logo_url !== companyLogoFailedUrl
      ? project.organization_logo_url
      : "";
  const companyName = project.organization_name || "Overwatch company";
  const companyInitials = project.organization_name
    ? project.organization_name
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase())
        .join("") || "OW"
    : "OW";
  const headerStats = [
    { label: "Job #", value: jobNumber },
    { label: "Client", value: project.client || "—" },
    { label: "Project Manager", value: project.project_manager || "—" },
    { label: "Original Contract", value: fmtUSD(project.original_contract), tabular: true },
    { label: "Forecasted Final", value: fmtUSD(rollup.forecastedFinalContract), tabular: true },
  ];
  const compactProjectNav = COMPACT_PROJECT_NAV_TABS.has(activeProjectTab);

  return (
    <div className="min-h-screen overflow-x-hidden bg-background text-foreground">
      <header className="relative border-b border-hairline bg-surface-elevated/95 shadow-[0_10px_30px_rgb(31_28_23_/_0.05)]">
        <div className="absolute inset-0 grid-bg opacity-25" />
        <div className="relative mx-auto flex max-w-[1760px] flex-col gap-2 px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-2 border-b border-hairline/70 pb-2.5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-col gap-2 lg:flex-row lg:items-center lg:gap-3">
              <div className="flex min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                  <Link
                    to="/"
                    className="inline-flex h-8 items-center rounded-md px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground transition hover:text-foreground"
                  >
                    ← Portfolio
                  </Link>
                  <div className="hidden h-4 w-px bg-hairline sm:block" />
                  <div className="flex min-w-0 items-center gap-2 rounded-md border border-hairline bg-card/70 px-2.5 py-1.5 shadow-sm">
                    {companyLogoUrl ? (
                      <img
                        src={companyLogoUrl}
                        alt={`${companyName} logo`}
                        className="h-6 w-6 shrink-0 rounded-sm object-contain"
                        onError={() => setCompanyLogoFailedUrl(companyLogoUrl)}
                      />
                    ) : (
                      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-surface text-[10px] font-semibold text-muted-foreground">
                        {companyInitials}
                      </div>
                    )}
                    <span className="max-w-[180px] truncate text-xs font-semibold text-foreground">
                      {companyName}
                    </span>
                  </div>
                </div>
                <Button variant="ghost" size="sm" onClick={signOut} className="gap-1.5 lg:hidden">
                  <LogOut className="h-3.5 w-3.5" /> Sign out
                </Button>
              </div>
              <Select
                value={projectId}
                onValueChange={(v) =>
                  navigate({ to: "/projects/$projectId", params: { projectId: v } })
                }
              >
                <SelectTrigger className="h-8 w-full min-w-[220px] max-w-[360px] text-sm sm:w-[300px]">
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
            <Button
              variant="ghost"
              size="sm"
              onClick={signOut}
              className="hidden w-fit gap-1.5 self-start lg:inline-flex lg:self-auto"
            >
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </Button>
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                <span className="rounded-sm border border-accent/25 bg-accent/10 px-2 py-1 text-accent">
                  IOR
                </span>
                <span>{project.phase} Phase</span>
                <span>{project.percent_complete}% complete</span>
                {lastReviewDays !== null && (
                  <span className={lastReviewDays > 30 ? "text-danger" : ""}>
                    Last reviewed {lastReviewDays}d ago
                  </span>
                )}
                {project.source_opportunity_id && (
                  <a
                    href={`/?tab=crm&opportunity=${project.source_opportunity_id}`}
                    className="inline-flex w-fit shrink-0 items-center gap-1.5 rounded-sm border border-accent/30 bg-accent/10 px-2 py-1 text-[10px] font-semibold text-accent transition hover:border-accent/50 hover:bg-accent/15"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Source: CRM
                  </a>
                )}
              </div>
              <h1 className="truncate font-serif text-2xl leading-none text-foreground lg:text-3xl">
                {project.name}
              </h1>
              <p className="max-w-3xl text-xs leading-5 text-muted-foreground sm:text-sm xl:truncate">
                An IOR operating record, not a budget report. Start from the SOV, work the schedule,
                then price the exposure.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 lg:max-w-[620px] lg:justify-end">
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
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Archive className="h-3.5 w-3.5" /> Archive
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Archive this project?</AlertDialogTitle>
                    <AlertDialogDescription>
                      “{project.name}” will be hidden from the portfolio. Its data — SOV, exposures,
                      change orders, billing, and reports — stays in the database and can be
                      restored later. No records are deleted.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={archiveMutation.isPending}
                      onClick={(e) => {
                        e.preventDefault();
                        archiveMutation.mutate();
                      }}
                    >
                      {archiveMutation.isPending ? "Archiving…" : "Archive project"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-danger hover:text-danger"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  {isDemoProject ? (
                    <AlertDialogHeader>
                      <AlertDialogTitle>Hide the training project?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This hides the Harbor Residence training project for your whole company. It
                        won’t come back on its own; an admin can restore it later if you want it
                        again.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                  ) : (
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this project permanently?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This permanently deletes “{project.name}” and every related record —
                        SOV/cost buckets, exposures, change orders, decisions, schedule, daily
                        reports, billing applications, invoices, and payments. This cannot be
                        undone. Prefer <strong>Archive</strong> if you might need it back.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                  )}
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={deleteMutation.isPending}
                      className="bg-danger text-destructive-foreground hover:bg-danger/90"
                      onClick={(e) => {
                        e.preventDefault();
                        deleteMutation.mutate();
                      }}
                    >
                      {deleteMutation.isPending
                        ? isDemoProject
                          ? "Hiding…"
                          : "Deleting…"
                        : isDemoProject
                          ? "Hide training project"
                          : "Delete forever"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>
          </div>

          <dl className="grid grid-cols-2 overflow-hidden rounded-md border border-hairline bg-card/65 shadow-sm lg:grid-cols-5">
            {headerStats.map((stat, index) => (
              <div
                key={stat.label}
                className={cn(
                  "min-w-0 border-b border-hairline px-3 py-2 odd:border-r last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0",
                  index === headerStats.length - 1 ? "col-span-2 lg:col-span-1" : "",
                )}
              >
                <dt className="truncate text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {stat.label}
                </dt>
                <dd
                  className={cn(
                    "mt-1 break-words text-sm font-semibold leading-tight text-foreground lg:truncate",
                    stat.tabular ? "tabular" : "",
                  )}
                >
                  {stat.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <main
        className={`mx-auto w-full min-w-0 px-4 py-6 sm:px-6 lg:px-8 ${
          compactProjectNav ? "max-w-[1760px]" : "max-w-[1500px]"
        }`}
      >
        <Tabs
          value={activeProjectTab}
          onValueChange={setProjectTab}
          className={`grid min-w-0 gap-6 lg:items-start ${
            compactProjectNav
              ? "lg:grid-cols-[76px_minmax(0,1fr)] xl:grid-cols-[84px_minmax(0,1fr)]"
              : "lg:grid-cols-[238px_minmax(0,1fr)]"
          }`}
        >
          <aside className="min-w-0 lg:sticky lg:top-6">
            <TooltipProvider delayDuration={120}>
              <TabsList className={PROJECT_NAV_RAIL_CLASS}>
                <ProjectNavTooltip enabled={compactProjectNav} label="CRM" detail="Relationships">
                  <a
                    href="/?tab=crm"
                    aria-label="CRM: Relationships"
                    title="CRM: Relationships"
                    className={cn(
                      "inline-flex items-center",
                      projectNavItemClass({ compact: compactProjectNav }),
                    )}
                  >
                    <BriefcaseBusiness
                      className={projectNavIconClass({ compact: compactProjectNav })}
                    />
                    <span className={`min-w-0 ${compactProjectNav ? "lg:sr-only" : ""}`}>
                      <span className="block text-sm font-medium leading-tight">CRM</span>
                      <span className="mt-0.5 block truncate text-[11px] font-normal opacity-80">
                        Relationships
                      </span>
                    </span>
                  </a>
                </ProjectNavTooltip>
                {projectNavItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeProjectTab === item.value;
                  return (
                    <ProjectNavTooltip
                      key={item.value}
                      enabled={compactProjectNav}
                      label={item.label}
                      detail={item.detail}
                    >
                      <TabsTrigger
                        value={item.value}
                        aria-label={`${item.label}: ${item.detail}`}
                        title={`${item.label}: ${item.detail}`}
                        className={projectNavItemClass({
                          compact: compactProjectNav,
                          active: isActive,
                        })}
                      >
                        {isActive && (
                          <span
                            aria-hidden="true"
                            className="absolute inset-y-2 left-1 w-1 rounded-full bg-accent-foreground/90 shadow-[0_0_14px_rgb(255_255_255_/_0.75)]"
                          />
                        )}
                        <Icon
                          className={projectNavIconClass({
                            compact: compactProjectNav,
                            active: isActive,
                          })}
                        />
                        <span className={`min-w-0 ${compactProjectNav ? "lg:sr-only" : ""}`}>
                          <span className="block text-sm font-medium leading-tight">
                            {item.label}
                          </span>
                          <span
                            className={`mt-0.5 block truncate text-[11px] font-normal ${
                              isActive ? "opacity-85" : "opacity-70"
                            }`}
                          >
                            {item.detail}
                          </span>
                        </span>
                      </TabsTrigger>
                    </ProjectNavTooltip>
                  );
                })}
              </TabsList>
            </TooltipProvider>
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
                onOpenExposure={openDashboardExposure}
              />
            </TabsContent>

            <TabsContent value="schedule" className="mt-0">
              <WorkspaceHeader
                title="Schedule"
                subtitle="Completion forecast, interim milestones, critical path movement, and schedule-linked risk."
              />
              <ScheduleRisk project={project} lastReviewForecast={lastReviewForecast} />
            </TabsContent>

            <TabsContent value="inspections" className="mt-0">
              <WorkspaceHeader
                title="Inspections"
                subtitle="Required inspections, pass/fail attempts, reinspection cycles, and inspection-driven IOR risk."
              />
              <InspectionsWorkspace
                inspections={inspections}
                onCreate={(input) => inspectionCreate.mutate(input)}
                onUpdate={(id, patch) => inspectionUpdate.mutate({ id, patch })}
                onDelete={(id) => inspectionDelete.mutate({ id })}
                onCreateRisk={handleCreateRiskFromInspection}
                savingInspection={
                  inspectionCreate.isPending ||
                  inspectionUpdate.isPending ||
                  inspectionDelete.isPending
                }
                creatingRiskId={creatingInspectionRiskId}
              />
            </TabsContent>

            <TabsContent value="daily-reports" className="mt-0">
              <DailyReportsWorkspace projectId={projectId} project={project} />
            </TabsContent>

            <TabsContent value="risk-tally" className="mt-0 space-y-6">
              <RiskAllocationWorkbench
                exposures={exposures}
                rollup={rollup}
                guidance={guidance}
                focusedExposureId={focusedRiskExposureId}
                onFocusExposureHandled={handleRiskFocusHandled}
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
                ownerOptions={decisionOwnerOptions ?? []}
                projectManager={project.project_manager}
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
                    existingBuckets={buckets}
                    mappingProfiles={sovMappingProfiles ?? []}
                    onSaveProfile={(profile) =>
                      sovProfileSave.mutateAsync(profile).then(() => undefined)
                    }
                    savingProfile={sovProfileSave.isPending}
                    onImport={(rows, mode, metadata) =>
                      bucketImport.mutate(
                        { projectId, rows, mode, metadata },
                        {
                          onSuccess: (result) => {
                            const imported =
                              typeof result === "object" && result && "inserted" in result
                                ? Number((result as { inserted: number }).inserted)
                                : rows.length;
                            const updated =
                              typeof result === "object" && result && "updated" in result
                                ? Number((result as { updated: number }).updated)
                                : 0;
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
                              description: `${imported} created, ${updated} updated. Original cost budget is now ${fmtUSD(budget)}.`,
                            });
                            if (
                              typeof result === "object" &&
                              result &&
                              "importHistorySaved" in result &&
                              !(result as { importHistorySaved: boolean }).importHistorySaved
                            ) {
                              toast.warning("SOV imported, history pending", {
                                description:
                                  "The buckets saved, but the import ledger table is not available yet.",
                              });
                            }
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
                <SovImportHistory imports={sovImports ?? []} />
              </div>
              <CostBucketsTable
                buckets={buckets}
                onUpdate={(id, patch) => bucketUpdate.mutateAsync({ id, patch })}
                onCreate={(input) => bucketCreate.mutate({ projectId, ...input })}
                onDelete={(id) => bucketDelete.mutate({ id })}
              />
            </TabsContent>

            <TabsContent value="billing" className="mt-0 space-y-6">
              <BillingWorkspace
                project={project}
                rollup={rollup}
                changeOrders={changeOrders}
                buckets={buckets}
                billingApplications={visibleBillingApplications}
                billingInvoices={billingInvoices ?? []}
                billingWorkspace={billingWorkspaceQuery.data}
                billingWorkspaceLoading={billingWorkspaceQuery.isLoading}
                savingPayApp={billingCreate.isPending}
                savingInvoice={invoiceCreate.isPending}
                savingPayment={paymentRecord.isPending}
                savingBillingLine={billingLineGenerate.isPending || billingLineUpdate.isPending}
                savingRetainageRate={billingRetainageRateUpdate.isPending}
                savingCostActual={
                  costActualCreate.isPending ||
                  costActualImport.isPending ||
                  costActualVoid.isPending
                }
                savingBucketBilling={bucketBillingUpdate.isPending}
                onCreate={handleCreatePayApp}
                onUpdate={handleUpdatePayApp}
                onDelete={handleDeletePayApp}
                onGenerateBillingLines={(billingApplicationId) =>
                  billingLineGenerate.mutate({ projectId, billingApplicationId })
                }
                onUpdateBillingLine={(id, patch) => billingLineUpdate.mutate({ id, patch })}
                onUpdatePayAppRetainageRate={(billingApplicationId, retainage_pct) =>
                  billingRetainageRateUpdate.mutate({ billingApplicationId, retainage_pct })
                }
                onUpdateOutputFormat={(billingApplicationId, output_format) =>
                  handleUpdatePayApp(billingApplicationId, { output_format })
                }
                savingOutputFormat={billingUpdate.isPending}
                onCreateCostActual={(input) =>
                  costActualCreate.mutate({
                    projectId,
                    ...input,
                  })
                }
                onImportCostActuals={(input) => costActualImport.mutate({ projectId, ...input })}
                onVoidCostActual={(id, notes) => costActualVoid.mutate({ id, notes })}
                onUpdateBucketBillingSettings={(id, patch) =>
                  bucketBillingUpdate.mutate({ id, patch })
                }
                onCreateInvoice={handleCreateInvoice}
                onUpdateInvoice={handleUpdateInvoice}
                onDeleteInvoice={handleDeleteInvoice}
                onRecordPayment={handleRecordPayment}
                onReconcileInvoice={(invoiceId) => invoiceReconcile.mutate(invoiceId)}
                reconcilingInvoiceId={reconcilingInvoiceId}
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
                subtitle="Approved change orders add to the forecasted contract. Pending change orders are probability-weighted into the rollup."
              />
              <ChangeOrdersTable
                changeOrders={changeOrders}
                onCreate={(d) => coCreate.mutate({ projectId, ...d })}
                onUpdate={(id, patch) => coUpdate.mutate({ id, ...patch })}
                onDelete={(id) => coDelete.mutate({ id })}
                onCreateRisk={handleCreateRiskFromChangeOrder}
                creatingRiskId={creatingCoRiskId}
              />
            </TabsContent>

            <TabsContent value="client-portal" className="mt-0">
              <ClientPortalWorkspace projectId={projectId} />
            </TabsContent>
          </div>
        </Tabs>
      </main>
    </div>
  );
}

function ProjectNavTooltip({
  enabled,
  label,
  detail,
  children,
}: {
  enabled: boolean;
  label: string;
  detail: string;
  children: ReactNode;
}) {
  if (!enabled) return <>{children}</>;

  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="right" align="center" className="max-w-[220px]">
        <div className="font-medium">{label}</div>
        <div className="mt-0.5 text-[11px] opacity-80">{detail}</div>
      </TooltipContent>
    </Tooltip>
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
    <div className="flex min-h-[72px] flex-col justify-between rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase leading-snug tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="pt-2 text-lg font-medium tabular leading-none text-foreground">{value}</div>
    </div>
  );
}

function SovImportHistory({ imports }: { imports: SovImportRow[] }) {
  const latest = imports[0];
  if (!latest) {
    return (
      <div className="mt-5 rounded-md border border-dashed border-hairline bg-background/60 px-3 py-3 text-sm text-muted-foreground">
        No SOV import history yet. After the next import, Overwatch will show the source file,
        mapping confidence, selected budget basis, and warnings here.
      </div>
    );
  }

  const warnings = Array.isArray(latest.warnings)
    ? latest.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  const confidenceTone =
    latest.confidence === "high"
      ? "text-success"
      : latest.confidence === "medium"
        ? "text-warning"
        : "text-danger";
  const source = [latest.source_name || latest.source_type || "Imported SOV", latest.source_sheet]
    .filter(Boolean)
    .join(" / ");

  return (
    <div className="mt-5 rounded-md border border-hairline bg-background">
      <div className="flex flex-col gap-3 border-b border-hairline px-3 py-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Latest SOV import
          </div>
          <div className="mt-1 font-medium text-foreground">{source}</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {latest.profile || "Generic spreadsheet"} ·{" "}
            <span className={`font-semibold uppercase ${confidenceTone}`}>{latest.confidence}</span>{" "}
            confidence · {formatShortDateTime(latest.created_at)}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
          <MiniLedgerStat label="Rows" value={String(latest.raw_rows)} />
          <MiniLedgerStat label="Staged" value={String(latest.staged_rows)} />
          <MiniLedgerStat label="Created" value={String(latest.inserted_count)} />
          <MiniLedgerStat label="Updated" value={String(latest.updated_count)} />
        </div>
      </div>
      <div className="grid gap-3 px-3 py-3 md:grid-cols-3">
        <div className="rounded-md border border-hairline bg-surface px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Imported budget
          </div>
          <div className="mt-1 text-lg font-medium tabular">{fmtUSD(latest.total_budget)}</div>
        </div>
        <div className="rounded-md border border-hairline bg-surface px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Budget basis
          </div>
          <div className="mt-1 text-sm font-medium">
            {latest.selected_budget_label ||
              (latest.selected_budget_column == null
                ? "Not recorded"
                : `Column ${latest.selected_budget_column + 1}`)}
          </div>
        </div>
        <div className="rounded-md border border-hairline bg-surface px-3 py-2">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Mode
          </div>
          <div className="mt-1 text-sm font-medium capitalize">
            {latest.mode === "append" ? "Merge/update existing" : "Replace all buckets"}
          </div>
        </div>
      </div>
      {warnings.length > 0 && (
        <div className="border-t border-hairline px-3 py-3">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Review flags
          </div>
          <div className="grid gap-2 lg:grid-cols-2">
            {warnings.slice(0, 4).map((warning, index) => (
              <div
                key={`${warning}-${index}`}
                className="rounded-md border border-warning/30 bg-warning/10 px-2.5 py-2 text-xs text-warning"
              >
                {warning}
              </div>
            ))}
          </div>
        </div>
      )}
      {imports.length > 1 && (
        <div className="border-t border-hairline px-3 py-2 text-xs text-muted-foreground">
          {imports.length - 1} previous import{imports.length === 2 ? "" : "s"} retained for audit.
        </div>
      )}
    </div>
  );
}

function MiniLedgerStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-surface px-2.5 py-2">
      <div className="text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-medium tabular text-foreground">{value}</div>
    </div>
  );
}

function formatShortDateTime(value: string) {
  if (!value) return "Date not recorded";
  const compact = value.replace("T", " ").slice(0, 16);
  return compact || "Date not recorded";
}

function invoiceFilename(project: ProjectRow, invoice: BillingInvoiceRow) {
  const projectPart = (project.job_number || project.name || "project")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  const invoicePart = billingDocumentLabel(invoice.invoice_number, invoice.title, "invoice")
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 42);
  return `Overwatch-Invoice-${projectPart || "project"}-${invoicePart || "invoice"}.pdf`;
}

function invoicePortalUrl(projectId: string) {
  if (typeof window === "undefined") return `/client/projects/${projectId}`;
  return `${window.location.origin}/client/projects/${projectId}`;
}

async function enqueueInvoiceEmail(input: {
  project: ProjectRow;
  invoice: BillingInvoiceRow;
  linkedPayApp?: BillingApplicationRow;
  recipientEmail: string;
}) {
  const { project, invoice, linkedPayApp, recipientEmail } = input;
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const accessToken = sessionData.session?.access_token;
  if (sessionError || !accessToken) {
    throw new Error("Your session expired. Sign in again before sending invoice email.");
  }

  const openBalance = centsToDollars(
    Math.max(0, dollarsToCents(invoice.total_due) - dollarsToCents(invoice.paid_amount)),
  );
  const response = await fetch("/lovable/email/transactional/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      templateName: "invoice-notification",
      recipientEmail,
      idempotencyKey: `invoice:${invoice.id}:${recipientEmail}:${Date.now()}`,
      templateData: {
        projectName: project.name,
        clientName: project.client,
        jobNumber: project.job_number,
        invoiceNumber: billingDocumentLabel(invoice.invoice_number, invoice.title, "Invoice"),
        invoiceTitle: normalizeBillingNumberLabel(
          invoice.title || linkedPayApp?.application_number || "",
        ),
        invoiceStatus: invoiceStatusLabel(invoice.status),
        totalDue: fmtUSDCents(invoice.total_due),
        paidAmount: fmtUSDCents(invoice.paid_amount),
        openBalance: fmtUSDCents(openBalance),
        dueDate: invoice.due_date,
        portalUrl: invoicePortalUrl(project.id),
        // Stored checkout links are a pre-Phase-1 vestige (Stripe sessions
        // expire within a day); the client pays through the portal, which
        // creates a fresh session from the live connect status and toggles.
        paymentUrl: "",
        notes:
          invoice.notes ||
          linkedPayApp?.notes ||
          "This invoice is available in the Overwatch client portal.",
      },
    }),
  });

  let result: Record<string, unknown> = {};
  try {
    result = (await response.json()) as Record<string, unknown>;
  } catch {
    result = {};
  }
  if (!response.ok || result.success === false) {
    const errorMessage =
      typeof result.error === "string"
        ? result.error
        : typeof result.reason === "string"
          ? result.reason
          : "The email service did not accept the invoice notification.";
    throw new Error(errorMessage);
  }
}

function responseAction(path: import("@/lib/ior").ResponsePath) {
  if (path === "eliminate") return "Eliminate";
  if (path === "recover") return "Recover";
  if (path === "offset") return "Offset";
  return "Accept";
}

type BillingDraft = Omit<BillingApplicationRow, "id" | "project_id" | "status_events">;
type InvoiceDraft = Omit<
  BillingInvoiceRow,
  | "id"
  | "project_id"
  | "payment_events"
  | "created_at"
  | "updated_at"
  | "sent_at"
  | "paid_at"
  | "payment_enabled"
  | "payment_url"
  | "stripe_checkout_session_id"
  | "stripe_payment_intent_id"
  | "online_payment_status"
  | "payment_link_sent_at"
>;
type PaymentDraft = {
  invoiceId: string;
  amount: number;
  processor_fee: number;
  overwatch_fee: number;
  paid_at: string;
  payment_method: string;
  processor: string;
  processor_payment_id: string;
  reference: string;
  notes: string;
};

function BillingWorkspace({
  project,
  rollup,
  changeOrders,
  buckets,
  billingApplications,
  billingInvoices,
  billingWorkspace,
  billingWorkspaceLoading,
  savingPayApp,
  savingInvoice,
  savingPayment,
  savingBillingLine,
  savingRetainageRate,
  savingCostActual,
  savingBucketBilling,
  onCreate,
  onUpdate,
  onDelete,
  onGenerateBillingLines,
  onUpdateBillingLine,
  onUpdatePayAppRetainageRate,
  onUpdateOutputFormat,
  savingOutputFormat,
  onCreateCostActual,
  onImportCostActuals,
  onVoidCostActual,
  onUpdateBucketBillingSettings,
  onCreateInvoice,
  onUpdateInvoice,
  onDeleteInvoice,
  onRecordPayment,
  onReconcileInvoice,
  reconcilingInvoiceId,
}: {
  project: ProjectRow;
  rollup: Rollup;
  changeOrders: ChangeOrderRow[];
  buckets: BucketRow[];
  billingApplications: BillingApplicationRow[];
  billingInvoices: BillingInvoiceRow[];
  billingWorkspace?: BillingWorkspaceData;
  billingWorkspaceLoading?: boolean;
  savingPayApp?: boolean;
  savingInvoice?: boolean;
  savingPayment?: boolean;
  savingBillingLine?: boolean;
  savingRetainageRate?: boolean;
  savingCostActual?: boolean;
  savingBucketBilling?: boolean;
  onCreate: (input: BillingDraft) => void;
  onUpdate: (id: string, patch: Partial<BillingApplicationRow>) => void;
  onDelete: (id: string) => void;
  onGenerateBillingLines: (billingApplicationId: string) => void;
  onUpdateBillingLine: (
    id: string,
    patch: {
      work_completed_this_period?: number;
      materials_stored_this_period?: number;
      retainage_pct?: number;
      retainage_released?: number;
    },
  ) => void;
  onUpdatePayAppRetainageRate: (billingApplicationId: string, retainagePct: number) => void;
  onUpdateOutputFormat: (billingApplicationId: string, format: BillingOutputFormat) => void;
  savingOutputFormat?: boolean;
  onCreateCostActual: (input: {
    cost_bucket_id: string | null;
    cost_code: string;
    description: string;
    category: "direct" | "labor" | "material" | "equipment" | "subcontract" | "overhead";
    amount: number;
    vendor: string;
    reference_number: string;
    cost_date: string;
    status: "committed" | "paid";
    notes: string;
  }) => void;
  onImportCostActuals: (input: { source_name: string; rows: CostActualImportRow[] }) => void;
  onVoidCostActual: (id: string, notes: string) => void;
  onUpdateBucketBillingSettings: (
    id: string,
    patch: {
      earned_percent_complete?: number;
      retainage_pct?: number;
      billing_method?: "percent" | "unit" | "material";
      contract_quantity?: number;
      unit?: string;
    },
  ) => void;
  onCreateInvoice: (input: InvoiceDraft) => Promise<void>;
  onUpdateInvoice: (id: string, patch: Partial<BillingInvoiceRow>) => void;
  onDeleteInvoice: (id: string) => void;
  onRecordPayment: (input: PaymentDraft) => void;
  onReconcileInvoice: (invoiceId: string) => void;
  reconcilingInvoiceId: string | null;
}) {
  const loadPaymentMethodContext = useServerFn(getPaymentMethodContext);
  const { data: paymentMethodContext } = useQuery({
    queryKey: ["payment-method-context", project.id],
    queryFn: () => loadPaymentMethodContext({ data: { projectId: project.id } }),
    staleTime: 60_000,
  });
  const pendingCOs = changeOrders.filter((co) => co.status === "Pending");
  const weightedPending = pendingCOs.reduce(
    (sum, co) => sum + co.contract_amount * (co.probability / 100),
    0,
  );
  const holds = rollup.exposureHolds + rollup.contingencyHold;
  // Money rollups run in integer cents (round each row, sum, convert once):
  // float-dollar summation here is how fractional-cent drift reached a stored
  // invoice total during founder QA (invoice 2601-001).
  const totalBilledCents = sumDollarsToCents(billingApplications.map((app) => app.amount_billed));
  const totalBilled = centsToDollars(totalBilledCents);
  const paidToDate = centsToDollars(
    sumDollarsToCents(billingApplications.map((app) => app.paid_to_date)),
  );
  const defaultRetainagePct = project.default_retainage_pct ?? 10;
  const percentCompleteEarned = percentOfDollars(
    rollup.forecastedFinalContract,
    project.percent_complete,
  );
  const ledgerEarnedToDate = centsToDollars(
    sumDollarsToCents(
      billingApplications.map((app) => Math.max(app.amount_billed, app.paid_to_date)),
    ),
  );
  const earnedToDate =
    billingApplications.length > 0
      ? Math.max(percentCompleteEarned, ledgerEarnedToDate)
      : percentCompleteEarned;
  const unbilledEarnedToDate = centsToDollars(
    Math.max(0, dollarsToCents(earnedToDate) - totalBilledCents),
  );
  const contractRemaining = centsToDollars(
    Math.max(0, dollarsToCents(rollup.forecastedFinalContract) - totalBilledCents),
  );
  const retainage = centsToDollars(
    sumDollarsToCents(billingApplications.map((app) => app.retainage)),
  );
  const openReceivable = centsToDollars(
    billingApplications.reduce(
      (sum, app) =>
        sum +
        Math.max(
          0,
          dollarsToCents(app.amount_billed) -
            dollarsToCents(app.paid_to_date) -
            dollarsToCents(app.retainage),
        ),
      0,
    ),
  );
  const invoiceTotalDue = centsToDollars(
    sumDollarsToCents(billingInvoices.map((invoice) => invoice.total_due)),
  );
  const invoicePaid = centsToDollars(
    sumDollarsToCents(billingInvoices.map((invoice) => invoice.paid_amount)),
  );
  const invoiceOpenBalance = centsToDollars(
    billingInvoices.reduce(
      (sum, invoice) =>
        sum + Math.max(0, dollarsToCents(invoice.total_due) - dollarsToCents(invoice.paid_amount)),
      0,
    ),
  );
  const clientVisibleInvoices = billingInvoices.filter((invoice) => invoice.client_visible).length;
  const today = new Date().toISOString().slice(0, 10);
  const loadClientPortal = useServerFn(getClientPortalManagement);
  const clientPortalQuery = useQuery({
    queryKey: ["client-portal-management", project.id, "billing-recipients"],
    queryFn: () => loadClientPortal({ data: { projectId: project.id } }),
    enabled: billingInvoices.length > 0,
    staleTime: 30_000,
  });
  const clientPortalAccess = (clientPortalQuery.data?.access ?? []) as ProjectClientAccessRow[];
  const invoiceRecipients = Array.from(
    new Map(
      clientPortalAccess
        .filter(
          (access: ProjectClientAccessRow) =>
            access.status !== "revoked" && access.can_view_billing && access.email,
        )
        .map((access: ProjectClientAccessRow) => [access.email.trim().toLowerCase(), access]),
    ).values(),
  );
  // Online-pay readiness is derived from the LIVE Stripe Connect status plus
  // the per-invoice method toggles — never from stored per-invoice payment
  // links, which went stale an hour after Connect activated in founder QA.
  const invoiceOnlinePayReady = (invoice: BillingInvoiceRow) => {
    if (!paymentMethodContext?.stripeReady) return false;
    const availability = methodAvailability({
      hasPaymentProfile: paymentMethodContext.hasPaymentProfile,
      stripeReady: paymentMethodContext.stripeReady,
      enabled: resolveEnabledMethods(
        invoice.enabled_payment_methods,
        paymentMethodContext.defaultPaymentMethods,
      ),
      invoiceTotalCents: dollarsToCents(invoice.total_due),
      thresholdCents: paymentMethodContext.stripeAmountThresholdCents,
    });
    return availability.card.available || availability.ach_debit.available;
  };
  const onlinePayReadyInvoices = billingInvoices.filter(
    (invoice) =>
      invoice.status !== "void" &&
      invoice.client_visible &&
      invoice.total_due > invoice.paid_amount &&
      invoiceOnlinePayReady(invoice),
  );
  const onlinePayReadyBalance = centsToDollars(
    onlinePayReadyInvoices.reduce(
      (sum, invoice) =>
        sum + Math.max(0, dollarsToCents(invoice.total_due) - dollarsToCents(invoice.paid_amount)),
      0,
    ),
  );
  const recipientStatus = clientPortalQuery.isLoading
    ? "Loading"
    : clientPortalQuery.error
      ? "Needs review"
      : String(invoiceRecipients.length);
  const billingReadinessMessage =
    billingInvoices.length === 0
      ? "Create an invoice from an application or direct billing item before sharing with the client."
      : invoiceRecipients.length === 0
        ? "Turn Billing On for at least one client seat in Client Portal before emailing invoices."
        : !paymentMethodContext
          ? "PDF and email are ready. Checking online payment status..."
          : !paymentMethodContext.stripeReady
            ? paymentMethodContext.stripeConnectStatus === "pending"
              ? "PDF and email are ready. Stripe is verifying the company account — card and bank debit unlock when verification finishes in Getting Paid."
              : "PDF and email are ready. Connect Stripe in Getting Paid (Your Company) to let clients pay by card or bank debit."
            : onlinePayReadyInvoices.length === 0
              ? "Online payments are live. No open client-visible invoice has card or bank debit turned on — use the payment-method toggles in the Send flow."
              : `${onlinePayReadyInvoices.length} invoice${onlinePayReadyInvoices.length === 1 ? "" : "s"} can be paid online by the client.`;
  const activeBillingInvoices = billingInvoices.filter((invoice) => invoice.status !== "void");
  const getActiveInvoiceForPayApp = (payAppId: string) =>
    activeBillingInvoices.find((invoice) => invoice.billing_application_id === payAppId);
  const uninvoicedBillingApplications = billingApplications.filter(
    (app) => !getActiveInvoiceForPayApp(app.id),
  );

  const buildDraft = (): BillingDraft => {
    const nextNumber = String(billingApplications.length + 1);
    return {
      application_number: `Application ${nextNumber}`,
      invoice_number: project.job_number
        ? `${project.job_number}-${nextNumber}`
        : `INV-${nextNumber}`,
      submitted_date: today,
      due_date: addDays(today, 30),
      billing_period: "Current cycle",
      contract_amount: project.original_contract,
      change_order_amount: rollup.approvedCOContract,
      amount_billed: unbilledEarnedToDate,
      paid_to_date: 0,
      retainage: percentOfDollars(unbilledEarnedToDate, defaultRetainagePct),
      has_line_detail: false,
      total_retainage_held: 0,
      retainage_released_this_period: 0,
      status: "draft",
      // AIA-native projects birth applications as aia_g702 (GP3 Task 3), so a
      // lender-driven job stops making the biller flip format every time.
      output_format: project.default_output_format ?? "invoice",
      notes: "",
      sort_order: billingApplications.length + 1,
    };
  };
  const buildInvoiceDraft = (app?: BillingApplicationRow): InvoiceDraft => {
    const sourceIndex = billingInvoices.length + 1;
    const sourceNumber = String(sourceIndex);
    const invoiceNumber = normalizeBillingNumberLabel(
      app?.invoice_number ||
        (project.job_number ? `${project.job_number}-${sourceNumber}` : `INV-${sourceNumber}`),
    );
    // Invoice money inherits pay-app values quantized to exact cents; the
    // total derives in cents so a stored total can never carry float drift.
    const subtotal = quantizeDollars(app?.amount_billed ?? unbilledEarnedToDate);
    const invoiceRetainage = quantizeDollars(
      app?.retainage ?? percentOfDollars(subtotal, defaultRetainagePct),
    );
    const retainageReleased = quantizeDollars(app?.retainage_released_this_period ?? 0);
    const paidAmount = quantizeDollars(app?.paid_to_date ?? 0);
    const totalDue = invoiceTotalDueDollars({
      subtotal,
      retainage: invoiceRetainage,
      retainageReleased,
    });
    const status: BillingInvoiceRow["status"] =
      paidAmount >= totalDue && totalDue > 0
        ? "paid"
        : paidAmount > 0
          ? "partially_paid"
          : app?.status === "draft"
            ? "draft"
            : "sent";
    return {
      billing_application_id: app?.id ?? null,
      invoice_number: invoiceNumber,
      title: normalizeBillingNumberLabel(app?.application_number || `Invoice ${sourceNumber}`),
      issue_date: app?.submitted_date ?? today,
      due_date: app?.due_date ?? addDays(today, 30),
      subtotal,
      retainage: invoiceRetainage,
      total_due: totalDue,
      paid_amount: paidAmount,
      status,
      client_visible: status !== "draft",
      notes: app?.notes ?? "",
      // Seed the toggles from the company defaults so what the contractor
      // sees in the dialog is exactly what gets saved; {} would also inherit
      // at render time, but an explicit copy survives later default changes.
      enabled_payment_methods: paymentMethodContext
        ? {
            direct_bank: paymentMethodContext.defaultPaymentMethods.direct_bank,
            card: paymentMethodContext.defaultPaymentMethods.card,
            ach_debit: paymentMethodContext.defaultPaymentMethods.ach_debit,
          }
        : {},
      sent_recipients: [],
      first_viewed_at: null,
      last_viewed_at: null,
      view_count: 0,
      collections_log: "",
    };
  };
  const [payAppOpen, setPayAppOpen] = useState(false);
  const [draft, setDraft] = useState<BillingDraft>(() => buildDraft());
  const [draftRetainagePct, setDraftRetainagePct] = useState(() =>
    formatBillingPercentInput(defaultRetainagePct),
  );
  const [invoiceOpen, setInvoiceOpen] = useState(false);
  const [invoiceDraft, setInvoiceDraft] = useState<InvoiceDraft>(() => buildInvoiceDraft());
  const [invoiceError, setInvoiceError] = useState("");
  const draftOpenReceivable = centsToDollars(
    Math.max(
      0,
      dollarsToCents(draft.amount_billed) -
        dollarsToCents(draft.paid_to_date) -
        dollarsToCents(draft.retainage),
    ),
  );
  const selectedPayAppInvoice = invoiceDraft.billing_application_id
    ? getActiveInvoiceForPayApp(invoiceDraft.billing_application_id)
    : undefined;
  const normalizedInvoiceNumber = normalizeBillingNumberLabel(invoiceDraft.invoice_number)
    .toLowerCase()
    .trim();
  const duplicateInvoiceNumber = normalizedInvoiceNumber
    ? activeBillingInvoices.find(
        (invoice) =>
          normalizeBillingNumberLabel(invoice.invoice_number).toLowerCase() ===
          normalizedInvoiceNumber,
      )
    : undefined;
  const invoiceBlockingMessage = selectedPayAppInvoice
    ? `This application already has invoice ${billingDocumentLabel(selectedPayAppInvoice.invoice_number, selectedPayAppInvoice.title, "Invoice")}. Edit or void the existing invoice before creating another.`
    : duplicateInvoiceNumber
      ? `Invoice ${normalizeBillingNumberLabel(invoiceDraft.invoice_number)} already exists. Use a unique invoice number.`
      : "";
  const invoiceDialogMessage = invoiceError || invoiceBlockingMessage;

  const openPayAppDialog = () => {
    setDraft(buildDraft());
    setDraftRetainagePct(formatBillingPercentInput(defaultRetainagePct));
    setPayAppOpen(true);
  };

  const updateDraftRetainagePct = (value: string) => {
    setDraftRetainagePct(value);
    const nextPct = parseBillingPercent(value);
    setDraft((current) => ({
      ...current,
      retainage: percentOfDollars(current.amount_billed, nextPct),
    }));
  };

  const savePayApplication = () => {
    const normalizedRetainagePct = parseBillingPercent(draftRetainagePct);
    setDraftRetainagePct(formatBillingPercentInput(normalizedRetainagePct));
    onCreate({
      ...draft,
      amount_billed: quantizeDollars(draft.amount_billed),
      paid_to_date: quantizeDollars(draft.paid_to_date),
      retainage: percentOfDollars(draft.amount_billed, normalizedRetainagePct),
    });
    setPayAppOpen(false);
  };

  const openInvoiceDialog = (app?: BillingApplicationRow) => {
    setInvoiceError("");
    if (app) {
      const existingInvoice = getActiveInvoiceForPayApp(app.id);
      if (existingInvoice) {
        toast.warning("Application already invoiced", {
          description: `${billingDocumentLabel(app.application_number, app.invoice_number, "This application")} is linked to ${billingDocumentLabel(existingInvoice.invoice_number, existingInvoice.title, "Invoice")}.`,
        });
        setInvoiceOpen(false);
        return;
      }
      setInvoiceDraft(buildInvoiceDraft(app));
      setInvoiceOpen(true);
      return;
    }
    setInvoiceDraft(buildInvoiceDraft(uninvoicedBillingApplications[0]));
    setInvoiceOpen(true);
  };

  const selectInvoiceSource = (payAppId: string) => {
    const app = billingApplications.find((item) => item.id === payAppId);
    const existingInvoice = app ? getActiveInvoiceForPayApp(app.id) : undefined;
    if (app && existingInvoice) {
      setInvoiceError(
        `${billingDocumentLabel(app.application_number, app.invoice_number, "This application")} already has invoice ${billingDocumentLabel(existingInvoice.invoice_number, existingInvoice.title, "Invoice")}.`,
      );
      return;
    }
    setInvoiceError("");
    setInvoiceDraft(buildInvoiceDraft(app));
  };

  const saveInvoice = async () => {
    setInvoiceError("");
    if (invoiceBlockingMessage) {
      setInvoiceError(invoiceBlockingMessage);
      return;
    }
    try {
      await onCreateInvoice(invoiceDraft);
      setInvoiceOpen(false);
    } catch (error) {
      setInvoiceError(error instanceof Error ? error.message : "Invoice did not save.");
    }
  };

  const renderEnhancedBillingPanel = (render: (workspace: BillingWorkspaceData) => ReactNode) => {
    if (billingWorkspaceLoading) {
      return (
        <div className="rounded-md border border-hairline bg-surface p-5 text-sm text-muted-foreground">
          Loading billing detail...
        </div>
      );
    }
    if (!billingWorkspace?.schemaReady) {
      return (
        <div className="rounded-md border border-warning/30 bg-warning/10 p-5 text-sm text-warning">
          Enhanced billing tables are not available yet. Apply the Billing and WIP foundation
          migration, then refresh this project.
        </div>
      );
    }
    return render(billingWorkspace);
  };

  return (
    <section className="space-y-4">
      <Tabs defaultValue="billing" className="space-y-4">
        <div className="rounded-lg border border-hairline bg-card p-6 shadow-card">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <WorkspaceHeader
              title="Billing"
              subtitle="Create pay applications from SOV progress, turn approved applications into client invoices, collect payment, and keep A/R aging visible."
              compact
            />
            <Dialog open={payAppOpen} onOpenChange={setPayAppOpen}>
              <DialogTrigger asChild>
                <Button size="sm" onClick={openPayAppDialog} className="gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> New pay application
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-3xl">
                <DialogHeader>
                  <DialogTitle className="font-serif text-2xl">New pay application</DialogTitle>
                  <DialogDescription>
                    Start the billing cycle, then enter SOV progress in Applications.
                  </DialogDescription>
                </DialogHeader>
                <div className="grid gap-4 py-2">
                  <div className="rounded-md border border-accent/25 bg-accent/5 px-3 py-2 text-sm text-muted-foreground">
                    Create the application shell here. After it is saved, open Applications to enter
                    percent complete by SOV line; Overwatch will calculate the current work,
                    retainage, and application amount. Approved change orders only become billable
                    when they are allocated to an SOV cost code and pulled into the application
                    lines.
                  </div>
                  <div className="grid gap-3 md:grid-cols-3">
                    <div className="space-y-1.5">
                      <Label>Application #</Label>
                      <Input
                        value={draft.application_number}
                        onChange={(e) => setDraft({ ...draft, application_number: e.target.value })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Planned invoice #</Label>
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
                  <div className="grid gap-3 md:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Output document</Label>
                      <Select
                        value={draft.output_format}
                        onValueChange={(output_format) =>
                          setDraft({
                            ...draft,
                            output_format: output_format as BillingOutputFormat,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="invoice">Client invoice</SelectItem>
                          <SelectItem value="aia_g702">
                            AIA G702/G703 (formal pay application)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-xs text-muted-foreground">
                        Pick AIA when the owner or lender requires the formal application and
                        continuation sheet. Everything else stays the same.
                      </p>
                    </div>
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
                      <Label>Approved COs included</Label>
                      <MoneyInput
                        value={draft.change_order_amount}
                        onValueChange={(change_order_amount) =>
                          setDraft({ ...draft, change_order_amount })
                        }
                        align="right"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Application amount</Label>
                      <MoneyInput
                        value={draft.amount_billed}
                        onValueChange={(amount_billed) =>
                          setDraft({
                            ...draft,
                            amount_billed,
                            retainage: percentOfDollars(
                              amount_billed,
                              parseBillingPercent(draftRetainagePct),
                            ),
                          })
                        }
                        align="right"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Payments received</Label>
                      <MoneyInput
                        value={draft.paid_to_date}
                        onValueChange={(paid_to_date) => setDraft({ ...draft, paid_to_date })}
                        align="right"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Retainage %</Label>
                      <div className="relative">
                        <Input
                          value={draftRetainagePct}
                          inputMode="decimal"
                          className="pr-7 text-right tabular"
                          onChange={(event) => updateDraftRetainagePct(event.target.value)}
                        />
                        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                          %
                        </span>
                      </div>
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
                        Retainage withheld
                      </div>
                      <div className="mt-2 text-xl font-medium tabular text-foreground">
                        {fmtUSDCents(draft.retainage)}
                      </div>
                      <div className="mt-3 border-t border-hairline pt-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                        Open A/R
                      </div>
                      <div className="mt-2 text-xl font-medium tabular text-foreground">
                        {fmtUSDCents(draftOpenReceivable)}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Application amount less payments received and retainage held.
                      </div>
                    </div>
                  </div>
                </div>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setPayAppOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={savePayApplication} disabled={savingPayApp}>
                    {savingPayApp ? "Saving..." : "Create application"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-4 xl:grid-cols-7">
            <SovMetric
              label="Forecasted contract"
              value={fmtUSDCents(rollup.forecastedFinalContract)}
            />
            <SovMetric label="Earned to date" value={fmtUSDCents(earnedToDate)} />
            <SovMetric label="Billed to date" value={fmtUSDCents(totalBilled)} />
            <SovMetric label="Remaining to bill" value={fmtUSDCents(contractRemaining)} />
            <SovMetric label="Paid to date" value={fmtUSDCents(paidToDate)} />
            <SovMetric label="Open A/R" value={fmtUSDCents(openReceivable)} />
            <SovMetric label="Retainage" value={fmtUSDCents(retainage)} />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Remaining to bill is forecasted contract less billed to date. Open A/R is billed less
            paid and retainage.
          </p>
          <div className="mt-5 grid gap-3 lg:grid-cols-3">
            <BillingWorkflowStep
              step="1"
              title="Application"
              body="Enter percent complete and stored materials by SOV line. Approved COs allocated to cost codes roll into the line contract value."
            />
            <BillingWorkflowStep
              step="2"
              title="Invoice"
              body="Create the client-facing invoice from the application when the bill is ready to send."
            />
            <BillingWorkflowStep
              step="3"
              title="Payment and A/R"
              body="Send, enable online pay when available, record deposits, and track aging until clear."
            />
          </div>
          <TabsList className="mt-5 h-auto w-full justify-start gap-1.5 overflow-x-auto rounded-lg border border-accent/25 bg-accent/5 p-1.5 shadow-card ring-1 ring-accent/10 sm:flex-wrap sm:overflow-visible">
            <TabsTrigger value="billing" className={BILLING_WORKSPACE_TAB_TRIGGER_CLASS}>
              Overview
            </TabsTrigger>
            <TabsTrigger value="pay-app-detail" className={BILLING_WORKSPACE_TAB_TRIGGER_CLASS}>
              Applications
            </TabsTrigger>
            <TabsTrigger value="project-costs" className={BILLING_WORKSPACE_TAB_TRIGGER_CLASS}>
              Cost Ledger
            </TabsTrigger>
            <TabsTrigger value="wip-analysis" className={BILLING_WORKSPACE_TAB_TRIGGER_CLASS}>
              WIP Review
            </TabsTrigger>
            <TabsTrigger value="invoice-ledger" className={BILLING_WORKSPACE_TAB_TRIGGER_CLASS}>
              Invoices & Payments
            </TabsTrigger>
            <TabsTrigger value="pending-cos" className={BILLING_WORKSPACE_TAB_TRIGGER_CLASS}>
              Pending COs
            </TabsTrigger>
            <TabsTrigger value="pay-app-ledger" className={BILLING_WORKSPACE_TAB_TRIGGER_CLASS}>
              A/R Ledger
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="billing" className="mt-0 space-y-4">
          {/* Per-project receivables view (GETTINGPAID1 Task 0). */}
          <ReceivablesCockpit projectId={project.id} showProjectColumn={false} />
          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Billing position
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <SovMetric label="Unbilled earned" value={fmtUSDCents(unbilledEarnedToDate)} />
                <SovMetric label="Remaining to bill" value={fmtUSDCents(contractRemaining)} />
                <SovMetric label="Holds" value={fmtUSDCents(holds)} />
                <SovMetric label="Open A/R" value={fmtUSDCents(openReceivable)} />
                <SovMetric label="Retainage" value={fmtUSDCents(retainage)} />
                <SovMetric label="Pending CO likely" value={fmtUSDCents(weightedPending)} />
              </div>
            </div>
            <div className="rounded-lg border border-hairline bg-card p-5 shadow-card">
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Client payment readiness
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{billingReadinessMessage}</p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <SovMetric label="Invoices" value={String(billingInvoices.length)} />
                <SovMetric label="Client-visible" value={String(clientVisibleInvoices)} />
                <SovMetric label="Billing recipients" value={recipientStatus} />
                <SovMetric label="Payable online" value={String(onlinePayReadyInvoices.length)} />
                <SovMetric label="Payable balance" value={fmtUSDCents(onlinePayReadyBalance)} />
                <SovMetric label="Invoice open" value={fmtUSDCents(invoiceOpenBalance)} />
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="pay-app-detail" className="mt-0">
          {renderEnhancedBillingPanel((workspace) => (
            <BillingLineItemsPanel
              project={project}
              payApps={billingApplications}
              lineItems={workspace.lineItems}
              onGenerateLines={onGenerateBillingLines}
              onUpdateLine={onUpdateBillingLine}
              onUpdatePayAppRetainageRate={onUpdatePayAppRetainageRate}
              onUpdateOutputFormat={onUpdateOutputFormat}
              savingLine={savingBillingLine}
              savingRetainageRate={savingRetainageRate}
              savingOutputFormat={savingOutputFormat}
            />
          ))}
        </TabsContent>

        <TabsContent value="project-costs" className="mt-0">
          {renderEnhancedBillingPanel((workspace) => (
            <ProjectCostTrackingPanel
              projectId={project.id}
              buckets={buckets}
              costActuals={workspace.costActuals}
              onCreateCostActual={onCreateCostActual}
              onImportCostActuals={onImportCostActuals}
              onVoidCostActual={onVoidCostActual}
              savingCost={savingCostActual}
            />
          ))}
        </TabsContent>

        <TabsContent value="wip-analysis" className="mt-0">
          {renderEnhancedBillingPanel((workspace) => (
            <WipAnalysisPanel
              buckets={buckets}
              workspace={workspace}
              onUpdateBucketSettings={onUpdateBucketBillingSettings}
              savingBucket={savingBucketBilling}
            />
          ))}
        </TabsContent>

        <TabsContent value="invoice-ledger" className="mt-0">
          <div className="rounded-lg border border-hairline bg-card p-6 shadow-card xl:col-span-2">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Invoices & payments
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Client-facing invoices created from applications or direct billing items. Send,
                  enable online pay, and record deposits here.
                </p>
              </div>
              <Dialog
                open={invoiceOpen}
                onOpenChange={(open) => {
                  setInvoiceOpen(open);
                  if (!open) setInvoiceError("");
                }}
              >
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openInvoiceDialog()}
                  className="gap-1.5"
                >
                  <ReceiptText className="h-3.5 w-3.5" /> Create invoice
                </Button>
                <DialogContent className="sm:max-w-3xl">
                  <DialogHeader>
                    <DialogTitle className="font-serif text-2xl">Create invoice</DialogTitle>
                    <DialogDescription>
                      Build the client-facing invoice from an application or a direct billing item.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="grid gap-4 py-2">
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Source application</Label>
                        <Select
                          value={invoiceDraft.billing_application_id ?? "none"}
                          onValueChange={(value) =>
                            value === "none"
                              ? setInvoiceDraft(buildInvoiceDraft())
                              : selectInvoiceSource(value)
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">No linked application</SelectItem>
                            {billingApplications.map((app) => {
                              const existingInvoice = getActiveInvoiceForPayApp(app.id);
                              return (
                                <SelectItem
                                  key={app.id}
                                  value={app.id}
                                  disabled={Boolean(existingInvoice)}
                                >
                                  {billingDocumentLabel(app.application_number, app.invoice_number)}
                                  {existingInvoice
                                    ? ` - invoiced as ${billingDocumentLabel(existingInvoice.invoice_number, existingInvoice.title, "Invoice")}`
                                    : ""}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label>Invoice #</Label>
                        <Input
                          value={invoiceDraft.invoice_number}
                          onChange={(e) =>
                            setInvoiceDraft({ ...invoiceDraft, invoice_number: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Status</Label>
                        <Select
                          value={invoiceDraft.status}
                          onValueChange={(status) =>
                            setInvoiceDraft({
                              ...invoiceDraft,
                              status: status as BillingInvoiceRow["status"],
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="draft">Draft</SelectItem>
                            <SelectItem value="sent">Sent</SelectItem>
                            <SelectItem value="viewed">Viewed</SelectItem>
                            <SelectItem value="partially_paid">Partially paid</SelectItem>
                            <SelectItem value="paid">Paid</SelectItem>
                            <SelectItem value="overdue">Overdue</SelectItem>
                            <SelectItem value="void">Void</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-3">
                      <div className="space-y-1.5">
                        <Label>Title</Label>
                        <Input
                          value={invoiceDraft.title}
                          onChange={(e) =>
                            setInvoiceDraft({ ...invoiceDraft, title: e.target.value })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Issue date</Label>
                        <Input
                          type="date"
                          value={invoiceDraft.issue_date ?? ""}
                          onChange={(e) =>
                            setInvoiceDraft({ ...invoiceDraft, issue_date: e.target.value || null })
                          }
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Due date</Label>
                        <Input
                          type="date"
                          value={invoiceDraft.due_date ?? ""}
                          onChange={(e) =>
                            setInvoiceDraft({ ...invoiceDraft, due_date: e.target.value || null })
                          }
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-4">
                      <div className="space-y-1.5">
                        <Label>Subtotal</Label>
                        <MoneyInput
                          value={invoiceDraft.subtotal}
                          onValueChange={(subtotal) =>
                            setInvoiceDraft({
                              ...invoiceDraft,
                              subtotal,
                              total_due: invoiceTotalDueDollars({
                                subtotal,
                                retainage: invoiceDraft.retainage,
                                retainageReleased: 0,
                              }),
                            })
                          }
                          align="right"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Retainage</Label>
                        <MoneyInput
                          value={invoiceDraft.retainage}
                          onValueChange={(retainage) =>
                            setInvoiceDraft({
                              ...invoiceDraft,
                              retainage,
                              total_due: invoiceTotalDueDollars({
                                subtotal: invoiceDraft.subtotal,
                                retainage,
                                retainageReleased: 0,
                              }),
                            })
                          }
                          align="right"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Total due</Label>
                        <MoneyInput
                          value={invoiceDraft.total_due}
                          onValueChange={(total_due) =>
                            setInvoiceDraft({ ...invoiceDraft, total_due })
                          }
                          align="right"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label>Paid</Label>
                        <MoneyInput
                          value={invoiceDraft.paid_amount}
                          onValueChange={(paid_amount) =>
                            setInvoiceDraft({ ...invoiceDraft, paid_amount })
                          }
                          align="right"
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 rounded-md border border-hairline bg-surface px-3 py-2 text-sm">
                      <input
                        type="checkbox"
                        checked={invoiceDraft.client_visible}
                        onChange={(e) =>
                          setInvoiceDraft({ ...invoiceDraft, client_visible: e.target.checked })
                        }
                      />
                      Visible in client portal when billing access is enabled
                    </label>
                    <InvoicePaymentMethodToggles
                      value={invoiceDraft.enabled_payment_methods}
                      invoiceTotal={invoiceDraft.total_due}
                      context={paymentMethodContext}
                      onChange={(enabled_payment_methods) =>
                        setInvoiceDraft({ ...invoiceDraft, enabled_payment_methods })
                      }
                    />
                    <div className="space-y-1.5">
                      <Label>Notes</Label>
                      <Textarea
                        rows={3}
                        value={invoiceDraft.notes}
                        placeholder="Invoice context, exclusions, payment terms, or collection notes."
                        onChange={(e) =>
                          setInvoiceDraft({ ...invoiceDraft, notes: e.target.value })
                        }
                      />
                    </div>
                  </div>
                  {invoiceDialogMessage ? (
                    <div className="rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                      {invoiceDialogMessage}
                    </div>
                  ) : null}
                  <DialogFooter>
                    <Button variant="ghost" onClick={() => setInvoiceOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={saveInvoice}
                      disabled={savingInvoice || Boolean(invoiceBlockingMessage)}
                    >
                      {savingInvoice ? "Saving..." : "Save invoice"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>

            <div className="mb-4 grid gap-3 md:grid-cols-5">
              <SovMetric label="Invoice total due" value={fmtUSDCents(invoiceTotalDue)} />
              <SovMetric label="Invoice paid" value={fmtUSDCents(invoicePaid)} />
              <SovMetric label="Invoice open" value={fmtUSDCents(invoiceOpenBalance)} />
              <SovMetric label="Client-visible" value={String(clientVisibleInvoices)} />
              <SovMetric label="Billing recipients" value={recipientStatus} />
            </div>

            <div className="mb-4 rounded-md border border-hairline bg-surface p-4">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Client payment readiness
                  </div>
                  <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                    {billingReadinessMessage}
                  </p>
                </div>
                <div className="grid w-full min-w-0 gap-2 sm:grid-cols-2 lg:max-w-[320px]">
                  <div className="rounded-md border border-hairline bg-card px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Payable online
                    </div>
                    <div className="pt-2 text-lg font-medium tabular leading-none text-foreground">
                      {onlinePayReadyInvoices.length}
                    </div>
                  </div>
                  <div className="rounded-md border border-hairline bg-card px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      Payable balance
                    </div>
                    <div className="pt-2 text-lg font-medium tabular leading-none text-foreground">
                      {fmtUSDCents(onlinePayReadyBalance)}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-3">
              {billingInvoices.length === 0 ? (
                <div className="rounded-md border border-hairline bg-surface px-3 py-8 text-center text-sm text-muted-foreground">
                  No invoices logged yet. Create one from an application when it is ready for client
                  billing.
                </div>
              ) : (
                billingInvoices.map((invoice) => {
                  const linkedPayApp = billingApplications.find(
                    (app) => app.id === invoice.billing_application_id,
                  );
                  return (
                    <BillingInvoiceRowEditor
                      key={invoice.id}
                      project={project}
                      invoice={invoice}
                      linkedPayApp={linkedPayApp}
                      invoiceRecipients={invoiceRecipients}
                      invoiceRecipientsLoading={clientPortalQuery.isLoading}
                      invoiceRecipientsError={
                        clientPortalQuery.error instanceof Error
                          ? clientPortalQuery.error.message
                          : ""
                      }
                      savingPayment={savingPayment}
                      paymentMethodContext={paymentMethodContext}
                      onPatch={(patch) => onUpdateInvoice(invoice.id, patch)}
                      onDelete={() => onDeleteInvoice(invoice.id)}
                      onRecordPayment={onRecordPayment}
                      onReconcile={() => onReconcileInvoice(invoice.id)}
                      reconciling={reconcilingInvoiceId === invoice.id}
                    />
                  );
                })
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="pending-cos" className="mt-0">
          <div className="rounded-lg border border-hairline bg-card p-6 shadow-card xl:col-span-2">
            <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  Pending change orders: not billable yet
                </div>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  Pending COs are forecast exposure only. They do not enter an application for
                  payment until they are approved and allocated to an SOV cost code.
                </p>
              </div>
              <div className="text-sm tabular text-muted-foreground">
                Raw {fmtUSDCents(rollup.pendingCOContract)} · likely {fmtUSDCents(weightedPending)}
              </div>
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <BillingWorkflowStep
                step="1"
                title="Pending"
                body="Forecasted in risk/contract exposure, but excluded from the application."
              />
              <BillingWorkflowStep
                step="2"
                title="Approved + allocated"
                body="Assign the approved CO value to the correct SOV cost code."
              />
              <BillingWorkflowStep
                step="3"
                title="Application"
                body="The approved CO value appears in Applications as part of the line contract value."
              />
            </div>
            {pendingCOs.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No pending change orders.</p>
            ) : (
              <div className="mt-4 overflow-hidden rounded-md border border-hairline">
                <table className="w-full text-sm">
                  <thead className="bg-surface text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left">Change order</th>
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
                        <td className="px-3 py-2 text-right tabular">
                          {fmtUSDCents(co.contract_amount)}
                        </td>
                        <td className="px-3 py-2 text-right tabular text-muted-foreground">
                          {co.probability}%
                        </td>
                        <td className="px-3 py-2 text-right tabular">
                          {fmtUSDCents(percentOfDollars(co.contract_amount, co.probability))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </TabsContent>

        <TabsContent value="pay-app-ledger" className="mt-0">
          <div className="rounded-lg border border-hairline bg-card p-6 shadow-card xl:col-span-2">
            <div className="mb-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                  A/R ledger
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Accounting register for application balances, linked invoices, open receivables,
                  and aging. Edit SOV progress in Applications; send or collect in Invoices &
                  Payments.
                </p>
              </div>
              <div className="text-sm tabular text-muted-foreground">
                Remaining to bill {fmtUSDCents(contractRemaining)} · Open A/R{" "}
                {fmtUSDCents(openReceivable)} · Holds {fmtUSDCents(holds)}
              </div>
            </div>
            <div className="space-y-3">
              {billingApplications.length === 0 ? (
                <div className="rounded-md border border-hairline bg-surface px-3 py-8 text-center text-sm text-muted-foreground">
                  No applications logged yet. Create the first billing cycle above, then enter
                  progress in Applications.
                </div>
              ) : (
                billingApplications.map((app) => {
                  const linkedInvoice = getActiveInvoiceForPayApp(app.id);
                  return (
                    <BillingApplicationRowEditor
                      key={app.id}
                      app={app}
                      linkedInvoice={linkedInvoice}
                      onPatch={(patch) => onUpdate(app.id, patch)}
                      onCreateInvoice={() => openInvoiceDialog(app)}
                      onDelete={() => onDelete(app.id)}
                    />
                  );
                })
              )}
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </section>
  );
}

function BillingWorkflowStep({ step, title, body }: { step: string; title: string; body: string }) {
  return (
    <div className="flex min-w-0 gap-3 rounded-md border border-hairline bg-surface px-3 py-3">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
        {step}
      </div>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-foreground">{title}</div>
        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{body}</p>
      </div>
    </div>
  );
}

function addDays(date: string, days: number) {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function clampBillingPercent(value: number) {
  return Math.max(0, Math.min(100, value));
}

function parseBillingPercent(value: string | number) {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? clampBillingPercent(parsed) : 0;
}

function formatBillingPercentInput(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function billingEventLabel(event: BillingApplicationEventRow) {
  if (event.event_type === "created") return `Created as ${event.to_status || "draft"}`;
  if (event.event_type === "payment_update") return `Payment updated ${fmtUSDCents(event.amount)}`;
  if (event.from_status && event.to_status) {
    return `${event.from_status} to ${event.to_status}`;
  }
  return event.to_status || event.event_type;
}

function invoiceStatusLabel(status: BillingInvoiceRow["status"]) {
  if (status === "partially_paid") return "Partial";
  return status.replace("_", " ");
}

function parseBillingDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatBillingDate(value?: string | null) {
  const date = parseBillingDate(value);
  if (!date) return "Not set";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function daysBetween(start: Date, end: Date) {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime();
  return Math.round((endDay - startDay) / 86_400_000);
}

function payAppAgingStatus(app: BillingApplicationRow, openReceivable: number) {
  const submittedDate = parseBillingDate(app.submitted_date);
  const dueDate = parseBillingDate(app.due_date);
  const today = new Date();
  const submittedAge = submittedDate ? Math.max(0, daysBetween(submittedDate, today)) : null;

  if (openReceivable <= 0) {
    return {
      label: "Clear",
      detail: "No open A/R",
      className: "border-success/30 bg-success/10 text-success",
    };
  }

  if (dueDate) {
    const dueDelta = daysBetween(dueDate, today);
    if (dueDelta > 0) {
      return {
        label:
          dueDelta >= 90
            ? "90+ days past due"
            : `${dueDelta} ${dueDelta === 1 ? "day" : "days"} past due`,
        detail:
          submittedAge === null
            ? "Aged from due date"
            : `Submitted ${submittedAge} ${submittedAge === 1 ? "day" : "days"} ago`,
        className:
          dueDelta >= 60
            ? "border-danger/30 bg-danger/10 text-danger"
            : "border-warning/30 bg-warning/10 text-warning",
      };
    }
    return {
      label:
        dueDelta === 0
          ? "Due today"
          : `Due in ${Math.abs(dueDelta)} ${Math.abs(dueDelta) === 1 ? "day" : "days"}`,
      detail:
        submittedAge === null
          ? "Not past due"
          : `Submitted ${submittedAge} ${submittedAge === 1 ? "day" : "days"} ago`,
      className: "border-hairline bg-card text-foreground",
    };
  }

  if (submittedAge !== null) {
    return {
      label: `Submitted ${submittedAge} ${submittedAge === 1 ? "day" : "days"} ago`,
      detail: "No due date set",
      className: "border-warning/30 bg-warning/10 text-warning",
    };
  }

  return {
    label: "No aging dates",
    detail: "Add submitted and due dates",
    className: "border-hairline bg-card text-muted-foreground",
  };
}

function invoiceAgingStatus(invoice: BillingInvoiceRow, openBalance: number) {
  const issueDate = parseBillingDate(invoice.issue_date);
  const dueDate = parseBillingDate(invoice.due_date);
  const today = new Date();
  const issueAge = issueDate ? Math.max(0, daysBetween(issueDate, today)) : null;

  if (invoice.status === "void") {
    return {
      label: "Void",
      detail: "Not collectible",
      className: "border-hairline bg-card text-muted-foreground",
    };
  }

  if (openBalance <= 0 || invoice.status === "paid") {
    return {
      label: "Clear",
      detail: "No open balance",
      className: "border-success/30 bg-success/10 text-success",
    };
  }

  if (dueDate) {
    const dueDelta = daysBetween(dueDate, today);
    if (dueDelta > 0) {
      return {
        label:
          dueDelta >= 90
            ? "90+ days past due"
            : `${dueDelta} ${dueDelta === 1 ? "day" : "days"} past due`,
        detail:
          issueAge === null
            ? "Aged from due date"
            : `Issued ${issueAge} ${issueAge === 1 ? "day" : "days"} ago`,
        className:
          dueDelta >= 60
            ? "border-danger/30 bg-danger/10 text-danger"
            : "border-warning/30 bg-warning/10 text-warning",
      };
    }
    return {
      label:
        dueDelta === 0
          ? "Due today"
          : `Due in ${Math.abs(dueDelta)} ${Math.abs(dueDelta) === 1 ? "day" : "days"}`,
      detail:
        issueAge === null
          ? "Not past due"
          : `Issued ${issueAge} ${issueAge === 1 ? "day" : "days"} ago`,
      className: "border-hairline bg-card text-foreground",
    };
  }

  if (issueAge !== null) {
    return {
      label: `Issued ${issueAge} ${issueAge === 1 ? "day" : "days"} ago`,
      detail: "No due date set",
      className: "border-warning/30 bg-warning/10 text-warning",
    };
  }

  return {
    label: "No aging dates",
    detail: "Add issue and due dates",
    className: "border-hairline bg-card text-muted-foreground",
  };
}

function LedgerDetail({
  label,
  value,
  className = "",
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-md border border-hairline bg-card px-3 py-2 ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium tabular text-foreground">{value}</div>
    </div>
  );
}

function BillingApplicationRowEditor({
  app,
  linkedInvoice,
  onPatch,
  onCreateInvoice,
  onDelete,
}: {
  app: BillingApplicationRow;
  linkedInvoice?: BillingInvoiceRow;
  onPatch: (patch: Partial<BillingApplicationRow>) => void;
  onCreateInvoice: () => void;
  onDelete: () => void;
}) {
  const openReceivable = centsToDollars(
    Math.max(
      0,
      dollarsToCents(app.amount_billed) -
        dollarsToCents(app.paid_to_date) -
        dollarsToCents(app.retainage),
    ),
  );
  const events = app.status_events.slice(0, 3);
  const appLabel = billingDocumentLabel(app.application_number, app.invoice_number);
  const invoiceLabel = normalizeBillingNumberLabel(app.invoice_number);
  const aging = payAppAgingStatus(app, openReceivable);

  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <Label>Application</Label>
            <EditableText
              value={appLabel}
              onCommit={(application_number) =>
                onPatch({ application_number: normalizeBillingNumberLabel(application_number) })
              }
            />
            <EditableText
              value={app.billing_period}
              placeholder="Billing period"
              small
              onCommit={(billing_period) => onPatch({ billing_period })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Invoice #</Label>
            <EditableText
              value={invoiceLabel}
              placeholder="Invoice #"
              onCommit={(invoice_number) =>
                onPatch({ invoice_number: normalizeBillingNumberLabel(invoice_number) })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label>Status</Label>
            <Select
              value={app.status}
              onValueChange={(status) =>
                onPatch({ status: status as BillingApplicationRow["status"] })
              }
            >
              <SelectTrigger className="h-8 w-full">
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
        <div className="flex flex-wrap gap-2 lg:justify-end">
          {linkedInvoice ? (
            <div className="flex min-h-9 items-center rounded-md border border-hairline bg-card px-2.5 text-xs text-muted-foreground">
              <ReceiptText className="mr-1.5 h-3.5 w-3.5" />
              {billingDocumentLabel(
                linkedInvoice.invoice_number,
                linkedInvoice.title,
                "Invoice",
              )} · {invoiceStatusLabel(linkedInvoice.status)}
            </div>
          ) : (
            <Button size="sm" variant="outline" className="h-9 gap-1.5" onClick={onCreateInvoice}>
              <ReceiptText className="h-3.5 w-3.5" />
              Create invoice
            </Button>
          )}
          <Button size="icon" variant="ghost" className="h-9 w-9" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <div className="space-y-1.5">
          <Label>Submitted</Label>
          <Input
            type="date"
            value={app.submitted_date ?? ""}
            onChange={(e) => onPatch({ submitted_date: e.target.value || null })}
            className="h-8 w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Due</Label>
          <Input
            type="date"
            value={app.due_date ?? ""}
            onChange={(e) => onPatch({ due_date: e.target.value || null })}
            className="h-8 w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Contract</Label>
          <MoneyInput
            value={app.contract_amount}
            onValueChange={(contract_amount) => onPatch({ contract_amount })}
            align="right"
            className="h-8 w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Approved COs</Label>
          <MoneyInput
            value={app.change_order_amount}
            onValueChange={(change_order_amount) => onPatch({ change_order_amount })}
            align="right"
            className="h-8 w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Application amount</Label>
          <MoneyInput
            value={app.amount_billed}
            onValueChange={(amount_billed) => onPatch({ amount_billed })}
            align="right"
            className="h-8 w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Payments received</Label>
          <MoneyInput
            value={app.paid_to_date}
            onValueChange={(paid_to_date) => onPatch({ paid_to_date })}
            align="right"
            className="h-8 w-full"
          />
        </div>
        <div className="space-y-1.5">
          <Label>Retainage held</Label>
          <MoneyInput
            value={app.retainage}
            onValueChange={(retainage) => onPatch({ retainage })}
            align="right"
            className="h-8 w-full"
          />
        </div>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <LedgerDetail label="Open A/R" value={fmtUSDCents(openReceivable)} />
        <LedgerDetail
          label="A/R aging"
          value={
            <span>
              {aging.label}
              <span className="mt-0.5 block text-[11px] font-normal text-current/75">
                {aging.detail}
              </span>
            </span>
          }
          className={aging.className}
        />
      </div>
      {events.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          {events.map((event) => (
            <span
              key={event.id}
              className="inline-flex items-center gap-2 rounded-md border border-hairline bg-card px-2.5 py-1"
            >
              <span className="font-medium text-foreground">{billingEventLabel(event)}</span>
              <span>{formatShortDateTime(event.created_at)}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function BillingInvoiceRowEditor({
  project,
  invoice,
  linkedPayApp,
  invoiceRecipients,
  invoiceRecipientsLoading,
  invoiceRecipientsError,
  savingPayment,
  paymentMethodContext,
  onPatch,
  onDelete,
  onRecordPayment,
  onReconcile,
  reconciling,
}: {
  project: ProjectRow;
  invoice: BillingInvoiceRow;
  linkedPayApp?: BillingApplicationRow;
  invoiceRecipients: ProjectClientAccessRow[];
  invoiceRecipientsLoading?: boolean;
  invoiceRecipientsError?: string;
  savingPayment?: boolean;
  paymentMethodContext?: PaymentMethodContext;
  onPatch: (patch: Partial<BillingInvoiceRow>) => void;
  onDelete: () => void;
  onRecordPayment: (input: PaymentDraft) => void;
  onReconcile: () => void;
  reconciling?: boolean;
}) {
  const fetchInvoiceRemittance = useServerFn(getInvoiceRemittance);
  const openBalance = centsToDollars(
    Math.max(0, dollarsToCents(invoice.total_due) - dollarsToCents(invoice.paid_amount)),
  );
  const aging = invoiceAgingStatus(invoice, openBalance);
  const invoiceLabel = billingDocumentLabel(invoice.invoice_number, invoice.title, "Invoice");
  const invoiceTitle = normalizeBillingNumberLabel(invoice.title);
  const sourceLabel = linkedPayApp
    ? billingDocumentLabel(linkedPayApp.application_number, linkedPayApp.invoice_number)
    : "Direct invoice";
  // Readiness comes from the live Stripe Connect status plus this invoice's
  // method toggles — never from stored per-invoice payment links.
  const onlinePayAvailability = paymentMethodContext
    ? methodAvailability({
        hasPaymentProfile: paymentMethodContext.hasPaymentProfile,
        stripeReady: paymentMethodContext.stripeReady,
        enabled: resolveEnabledMethods(
          invoice.enabled_payment_methods,
          paymentMethodContext.defaultPaymentMethods,
        ),
        invoiceTotalCents: dollarsToCents(invoice.total_due),
        thresholdCents: paymentMethodContext.stripeAmountThresholdCents,
      })
    : null;
  const onlinePayAvailable = Boolean(
    onlinePayAvailability &&
    (onlinePayAvailability.card.available || onlinePayAvailability.ach_debit.available),
  );
  // Same pending state the client sees: while a Stripe payment is in flight,
  // this invoice must read as "processing", not as collectible.
  const pendingLock = pendingPaymentLock({
    onlinePaymentStatus: invoice.online_payment_status,
    checkoutSessionId: invoice.stripe_checkout_session_id,
    paymentLinkSentAtIso: invoice.payment_link_sent_at,
    openBalanceCents: dollarsToCents(openBalance),
    nowIso: new Date().toISOString(),
  });
  const paymentReadiness =
    invoice.status === "void"
      ? { label: "Void invoice", className: "border-hairline bg-surface text-muted-foreground" }
      : openBalance <= 0
        ? { label: "No open balance", className: "border-success/30 bg-success/10 text-success" }
        : pendingLock.locked
          ? {
              label: `Payment processing — started ${formatBillingDate(pendingLock.startedAtIso?.slice(0, 10))}`,
              className: "border-warning/30 bg-warning/10 text-warning",
            }
          : !invoice.client_visible
            ? {
                label: "Hidden from client",
                className: "border-hairline bg-surface text-muted-foreground",
              }
            : onlinePayAvailable
              ? {
                  label: "Client can pay online",
                  className: "border-success/30 bg-success/10 text-success",
                }
              : {
                  label: "Manual/email only",
                  className: "border-warning/30 bg-warning/10 text-warning",
                };
  const today = new Date().toISOString().slice(0, 10);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [invoiceAction, setInvoiceAction] = useState<"pdf" | "email" | null>(null);
  const [paymentDraft, setPaymentDraft] = useState<PaymentDraft>({
    invoiceId: invoice.id,
    amount: openBalance,
    processor_fee: 0,
    overwatch_fee: 0,
    paid_at: today,
    payment_method: "check",
    processor: "manual",
    processor_payment_id: "",
    reference: "",
    notes: "",
  });
  const netPayout = centsToDollars(
    Math.max(
      0,
      dollarsToCents(paymentDraft.amount) -
        dollarsToCents(paymentDraft.processor_fee) -
        dollarsToCents(paymentDraft.overwatch_fee),
    ),
  );
  const overRecording = isOverRecording(
    dollarsToCents(openBalance),
    dollarsToCents(paymentDraft.amount),
  );
  const sendBlockingMessage =
    invoice.status === "void"
      ? "Void invoices cannot be sent to clients."
      : invoiceRecipientsError
        ? `Client billing recipients did not load: ${invoiceRecipientsError}`
        : invoiceRecipients.length === 0
          ? "No client seats have Billing On. Open Client Portal, grant a client seat, and turn Billing On."
          : "";

  const openPaymentDialog = () => {
    setPaymentDraft({
      invoiceId: invoice.id,
      amount: openBalance,
      processor_fee: 0,
      overwatch_fee: 0,
      paid_at: today,
      payment_method: "check",
      processor: "manual",
      processor_payment_id: "",
      reference: "",
      notes: "",
    });
    setPaymentOpen(true);
  };

  const savePayment = () => {
    onRecordPayment(paymentDraft);
    setPaymentOpen(false);
  };

  const downloadInvoice = async () => {
    setInvoiceAction("pdf");
    try {
      // Remittance fetch is best-effort: no bank details (or no read access)
      // just means the PDF omits the direct-bank block.
      const remittance = await fetchInvoiceRemittance({
        data: { invoiceId: invoice.id },
      }).catch(() => null);
      const bytes = await generateInvoicePdf({ project, invoice, linkedPayApp, remittance });
      downloadPdfBytes(bytes, invoiceFilename(project, invoice));
      toast.success("Invoice PDF downloaded");
    } catch (error) {
      toast.error("Invoice PDF did not generate", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setInvoiceAction(null);
    }
  };

  const emailInvoice = async () => {
    setInvoiceAction("email");
    try {
      if (invoice.status === "void") {
        throw new Error("Void invoices cannot be sent to clients.");
      }
      if (invoiceRecipientsError) {
        throw new Error(`Client billing recipients did not load: ${invoiceRecipientsError}`);
      }
      if (invoiceRecipients.length === 0) {
        throw new Error(
          "No client seats have Billing On. Open Client Portal, grant a client seat, and turn Billing On.",
        );
      }

      const results = await Promise.allSettled(
        invoiceRecipients.map((recipient) =>
          enqueueInvoiceEmail({
            project,
            invoice,
            linkedPayApp,
            recipientEmail: recipient.email,
          }),
        ),
      );
      const sentCount = results.filter((result) => result.status === "fulfilled").length;
      const failed = results.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (sentCount === 0) {
        throw failed?.reason instanceof Error
          ? failed.reason
          : new Error("No invoice emails were queued.");
      }

      onPatch({
        client_visible: true,
        status: invoice.status === "draft" ? "sent" : invoice.status,
        // Send tracking (GETTINGPAID1): the cockpit's status chain shows
        // when the invoice went out and to whom.
        sent_recipients: invoiceRecipients.map((recipient) => recipient.email),
      });
      setSendOpen(false);

      toast.success("Invoice email queued", {
        description:
          sentCount === 1
            ? `Sent to ${invoiceRecipients[0].email}.`
            : `Sent to ${sentCount} client billing recipients.`,
      });
      if (failed) {
        toast.warning("Some invoice emails did not queue", {
          description:
            failed.reason instanceof Error
              ? failed.reason.message
              : "Check client recipients and send again if needed.",
        });
      }
    } catch (error) {
      toast.error("Invoice email did not queue", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setInvoiceAction(null);
    }
  };

  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="grid min-w-0 flex-1 gap-3 lg:grid-cols-[minmax(180px,1fr)_minmax(160px,0.8fr)_minmax(220px,1fr)]">
          <div className="space-y-1.5">
            <Label>Invoice</Label>
            <EditableText
              value={invoiceLabel}
              placeholder="Invoice #"
              onCommit={(invoice_number) =>
                onPatch({ invoice_number: normalizeBillingNumberLabel(invoice_number) })
              }
            />
            <EditableText
              value={invoiceTitle}
              placeholder="Invoice title"
              small
              onCommit={(title) => onPatch({ title: normalizeBillingNumberLabel(title) })}
            />
            {invoice.notes ? (
              <div className="mt-1 text-xs text-muted-foreground">{invoice.notes}</div>
            ) : null}
          </div>
          <div>
            <Label>Source</Label>
            <div className="mt-2 text-sm text-foreground">{sourceLabel}</div>
            {linkedPayApp?.billing_period ? (
              <div className="mt-1 text-xs text-muted-foreground">
                {linkedPayApp.billing_period}
              </div>
            ) : null}
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Issued</Label>
              <Input
                type="date"
                value={invoice.issue_date ?? ""}
                onChange={(e) => onPatch({ issue_date: e.target.value || null })}
                className="h-8 w-full"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Due</Label>
              <Input
                type="date"
                value={invoice.due_date ?? ""}
                onChange={(e) => onPatch({ due_date: e.target.value || null })}
                className="h-8 w-full"
              />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-1 xl:max-w-[500px] xl:justify-end">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={downloadInvoice}
            disabled={invoiceAction === "pdf"}
          >
            <Download className="h-3.5 w-3.5" />
            {invoiceAction === "pdf" ? "PDF..." : "PDF"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 gap-1.5"
            onClick={() => setSendOpen(true)}
            disabled={invoiceAction === "email" || invoiceRecipientsLoading}
          >
            <Mail className="h-3.5 w-3.5" />
            Send
          </Button>
          <Dialog open={sendOpen} onOpenChange={setSendOpen}>
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">Send invoice</DialogTitle>
                <DialogDescription>
                  Confirm the client billing recipients before queuing the invoice email.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="rounded-md border border-hairline bg-surface p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Invoice
                  </div>
                  <div className="mt-1 font-medium text-foreground">{invoiceLabel}</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    <LedgerDetail label="Open" value={fmtUSDCents(openBalance)} />
                    <LedgerDetail label="Due" value={formatBillingDate(invoice.due_date)} />
                    <LedgerDetail
                      label="Client"
                      value={invoice.client_visible ? "Visible" : "Hidden"}
                    />
                  </div>
                </div>

                <div className="rounded-md border border-hairline bg-card p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                    Recipients
                  </div>
                  {invoiceRecipientsLoading ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Loading billing recipients...
                    </p>
                  ) : invoiceRecipients.length > 0 ? (
                    <div className="mt-3 space-y-2">
                      {invoiceRecipients.map((recipient) => (
                        <div
                          key={recipient.id}
                          className="rounded-md border border-hairline bg-surface px-3 py-2 text-sm"
                        >
                          <div className="font-medium text-foreground">{recipient.email}</div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            Billing On · {recipient.status}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-muted-foreground">
                      No billing recipients are available for this project yet.
                    </p>
                  )}
                </div>

                <InvoicePaymentMethodToggles
                  value={invoice.enabled_payment_methods}
                  invoiceTotal={invoice.total_due}
                  context={paymentMethodContext}
                  onChange={(enabled_payment_methods) => onPatch({ enabled_payment_methods })}
                />

                <div className="rounded-md border border-hairline bg-surface p-4 text-sm text-muted-foreground">
                  Confirming will queue the invoice email and mark the invoice visible to the
                  client. It will not enable online payment unless Stripe Connect is already
                  configured for the company.
                </div>

                {sendBlockingMessage ? (
                  <div className="rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
                    {sendBlockingMessage}
                  </div>
                ) : null}
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setSendOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={emailInvoice}
                  disabled={Boolean(sendBlockingMessage) || invoiceAction === "email"}
                >
                  {invoiceAction === "email" ? "Sending..." : "Send invoice"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline" className="h-8" onClick={openPaymentDialog}>
                Record payment
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">Record payment</DialogTitle>
                <DialogDescription>
                  Enter received funds, fees, and reconciliation details for this invoice.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-2">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Amount</Label>
                    <MoneyInput
                      value={paymentDraft.amount}
                      onValueChange={(amount) => setPaymentDraft({ ...paymentDraft, amount })}
                      align="right"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Processor fee</Label>
                    <MoneyInput
                      value={paymentDraft.processor_fee}
                      onValueChange={(processor_fee) =>
                        setPaymentDraft({ ...paymentDraft, processor_fee })
                      }
                      align="right"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Overwatch fee</Label>
                    <MoneyInput
                      value={paymentDraft.overwatch_fee}
                      onValueChange={(overwatch_fee) =>
                        setPaymentDraft({ ...paymentDraft, overwatch_fee })
                      }
                      align="right"
                    />
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Paid date</Label>
                    <Input
                      type="date"
                      value={paymentDraft.paid_at}
                      onChange={(e) =>
                        setPaymentDraft({ ...paymentDraft, paid_at: e.target.value || today })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Method</Label>
                    <Select
                      value={paymentDraft.payment_method}
                      onValueChange={(payment_method) =>
                        setPaymentDraft({ ...paymentDraft, payment_method })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="wire">Wire</SelectItem>
                        <SelectItem value="ach">ACH</SelectItem>
                        <SelectItem value="check">Check</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Reference</Label>
                    <Input
                      value={paymentDraft.reference}
                      placeholder="Check #, wire confirmation, ACH trace"
                      onChange={(e) =>
                        setPaymentDraft({
                          ...paymentDraft,
                          reference: e.target.value,
                          processor_payment_id: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                {overRecording ? (
                  <div className="rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
                    This records {fmtUSDCents(paymentDraft.amount)} against a remaining balance of{" "}
                    {fmtUSDCents(openBalance)}. Double-check the amount — you can still save if this
                    is an intentional overpayment or deposit.
                  </div>
                ) : null}
                <div className="rounded-md border border-hairline bg-surface p-3">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Net payout
                  </div>
                  <div className="mt-1 text-2xl font-medium tabular">{fmtUSDCents(netPayout)}</div>
                </div>
                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Textarea
                    rows={3}
                    value={paymentDraft.notes}
                    placeholder="Payment source, reconciliation note, or partial-payment context."
                    onChange={(e) => setPaymentDraft({ ...paymentDraft, notes: e.target.value })}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setPaymentOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={savePayment} disabled={savingPayment || paymentDraft.amount <= 0}>
                  {savingPayment ? "Saving..." : "Save payment"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {/* Recompute paid/status from the payment ledger — the honest
              correction path when an invoice drifted from its payments
              (e.g. a refund processed before refund reversal shipped). */}
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8"
            disabled={reconciling}
            onClick={onReconcile}
          >
            {reconciling ? "Reconciling..." : "Reconcile payments"}
          </Button>
          <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onDelete}>
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <div className="space-y-1.5">
          <Label>Total due</Label>
          <MoneyInput
            value={invoice.total_due}
            onValueChange={(total_due) => onPatch({ total_due })}
            align="right"
            className="h-8 w-full"
          />
          <div className="text-right text-xs text-muted-foreground">
            Subtotal {fmtUSDCents(invoice.subtotal)}
          </div>
        </div>
        <LedgerDetail label="Paid" value={fmtUSDCents(invoice.paid_amount)} />
        <LedgerDetail label="Open" value={fmtUSDCents(openBalance)} />
        <LedgerDetail
          label="A/R aging"
          value={
            <span>
              {aging.label}
              <span className="mt-0.5 block text-[11px] font-normal text-current/75">
                {aging.detail}
              </span>
            </span>
          }
          className={aging.className}
        />
        <div className="space-y-1.5">
          <Label>Status</Label>
          <Select
            value={invoice.status}
            onValueChange={(status) => onPatch({ status: status as BillingInvoiceRow["status"] })}
          >
            <SelectTrigger className="h-8 w-full capitalize">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="sent">Sent</SelectItem>
              <SelectItem value="viewed">Viewed</SelectItem>
              <SelectItem value="partially_paid">Partially paid</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
              <SelectItem value="overdue">Overdue</SelectItem>
              <SelectItem value="void">Void</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-xs capitalize text-muted-foreground">
            {invoiceStatusLabel(invoice.status)}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>Client</Label>
          <Button
            type="button"
            size="sm"
            variant={invoice.client_visible ? "default" : "outline"}
            className="h-8 w-full justify-start"
            onClick={() => onPatch({ client_visible: !invoice.client_visible })}
          >
            {invoice.client_visible ? "Visible" : "Hidden"}
          </Button>
        </div>
        <div
          className={`rounded-md border px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] ${paymentReadiness.className}`}
        >
          {paymentReadiness.label}
        </div>
      </div>

      {invoice.payment_events.length > 0 ? (
        <div className="mt-3 text-[11px] text-muted-foreground">
          Last payment {fmtUSDCents(invoice.payment_events[0].amount)} ·{" "}
          {formatShortDateTime(invoice.payment_events[0].paid_at)}
        </div>
      ) : null}
    </div>
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
      className={`h-8 w-full min-w-0 ${small ? "mt-1 text-xs text-muted-foreground" : ""}`}
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
  phase: Phase;
  percent_complete: number;
  hold_variance_note: string;
  forecast_completion_date: string | null;
  baseline_completion_date: string | null;
  default_output_format: BillingOutputFormat;
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
  const defaultHoldNote = () => {
    const belowGuidance =
      rollup.exposureHolds < guidance.eTarget || rollup.contingencyHold < guidance.cTarget;
    const posture = belowGuidance
      ? "Below guidance: document why the project can safely carry less hold than the target."
      : "At or above guidance: document what is driving the hold and what must happen to release dollars.";
    return `${posture} Current holds: E-Hold ${fmtUSD(rollup.exposureHolds)} vs ${fmtUSD(guidance.eTarget)} guidance (${guidance.ePct}%) and C-Hold ${fmtUSD(rollup.contingencyHold)} vs ${fmtUSD(guidance.cTarget)} guidance (${guidance.cPct}%).`;
  };
  const init = (): EditableProject => ({
    name: project.name,
    job_number: project.job_number,
    client: project.client,
    project_manager: project.project_manager,
    original_contract: project.original_contract,
    original_cost_budget: project.original_cost_budget,
    phase: project.phase,
    percent_complete: project.percent_complete,
    hold_variance_note: project.hold_variance_note || defaultHoldNote(),
    forecast_completion_date: project.forecast_completion_date,
    baseline_completion_date: project.baseline_completion_date,
    default_output_format: project.default_output_format ?? "invoice",
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
          <div className="space-y-1.5">
            <Label>Default billing document</Label>
            <Select
              value={form.default_output_format}
              onValueChange={(v) =>
                setForm({ ...form, default_output_format: v as BillingOutputFormat })
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="invoice">Client invoice</SelectItem>
                <SelectItem value="aia_g702">AIA G702/G703 (AIA-native project)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              New pay applications start in this format. Choose AIA G702/G703 for lender- or
              owner's-rep-driven jobs so the biller never has to flip it each time.
            </p>
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
              <Label>Calculated variance</Label>
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
                hold_variance_note: form.hold_variance_note.trim() || defaultHoldNote(),
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
