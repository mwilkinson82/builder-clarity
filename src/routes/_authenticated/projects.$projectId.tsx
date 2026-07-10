import {
  createFileRoute,
  Link,
  Outlet,
  useChildMatches,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ChangeOrderAllocationInput } from "@/components/billing/ChangeOrderAllocationPanel";
import { fmtUSDCents } from "@/lib/billing-format";
import { centsToDollars, dollarsToCents } from "@/lib/payments-domain";
import { applySovBucketPatch } from "@/lib/sov-rollup";
import { BudgetLineDrawer } from "@/components/outcome/BudgetLineDrawer";
import { ChangeOrdersTable } from "@/components/outcome/ChangeOrdersTable";
import { ScheduleRisk } from "@/components/schedule";
import { ProjectTruthReview } from "@/components/outcome/ProjectTruthReview";
import { ImportSOVSheet, type SovMappingProfileDraft } from "@/components/outcome/ImportSOVSheet";
import { ReviewsTab } from "@/components/outcome/ReviewsTab";
import { RiskAllocationWorkbench } from "@/components/outcome/RiskAllocationWorkbench";
import {
  ExposureAllocationPanel,
  type ExposureAllocationInput,
} from "@/components/project/ExposureAllocationPanel";
import { BudgetLedgerTable } from "@/components/project/BudgetLedgerTable";
import { ProjectDashboard } from "@/components/outcome/ProjectDashboard";
import { DecisionsTable } from "@/components/outcome/DecisionsTable";
import { DailyReportsWorkspace } from "@/components/outcome/DailyReportsWorkspace";
import { DailyWipWorkspace } from "@/components/outcome/DailyWipWorkspace";
import { ProjectFileRoom } from "@/components/project/ProjectFileRoom";
import { SubmittalLog } from "@/components/project/SubmittalLog";
import { SubcontractorsWorkspace } from "@/components/project/SubcontractorsWorkspace";
import { listProjectSubcontracts } from "@/lib/subcontracts.functions";
import { paymentShareForBucket, summarizeSubCostByBucket } from "@/lib/subcontract-budget";
import {
  applySelfPerformToBuckets,
  latestPercentBySubBucket,
  rowWorkInPlace,
  subCommitmentKey,
  commitmentBySubBucket,
} from "@/lib/daily-wip";
import { listDailyWipEntries } from "@/lib/daily-wip.functions";
import { ClientPortalWorkspace } from "@/components/outcome/ClientPortalWorkspace";
import {
  InspectionsWorkspace,
  type InspectionDraft,
  type InspectionPatch,
} from "@/components/outcome/InspectionsWorkspace";
import {
  ClaimsWorkspace,
  type ClaimDraft,
  type ClaimPatch,
  type ClaimEventDraft,
} from "@/components/outcome/ClaimsWorkspace";
import { billingDocumentLabel } from "@/lib/billing-labels";
import {
  LOCAL_BILLING_ID_PREFIX,
  isMissingBillingApplicationsTableError,
  makeLocalBillingApplication,
  makeLocalBillingEvent,
  readLocalBillingApplications,
  sortBillingApplications,
  writeLocalBillingApplications,
  type BillingDraft,
  type InvoiceDraft,
  type PaymentDraft,
} from "@/lib/billing-local-store";
import { EditFinancialsDialog } from "@/components/project/EditFinancialsDialog";
import {
  SovImportHistory,
  SovMetric,
  WorkspaceHeader,
} from "@/components/project/billing/billing-workspace-atoms";
import {
  createCostActual,
  generateBillingLineItems,
  getBillingWorkspace,
  importCostActuals,
  setCostActualStatus,
  updateBillingApplicationRetainageRate,
  updateBillingLineItem,
  updateBillingLineItems,
  updateCostBucketBillingSettings,
  voidCostActual,
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
  linkChangeOrderExposure,
  createClaim,
  updateClaim,
  deleteClaim,
  createClaimEvent,
  deleteClaimEvent,
  addClaimDocument,
  deleteClaimDocument,
  linkClaimExposure,
  linkClaimChangeOrder,
  allocateChangeOrder,
  deleteChangeOrderAllocation,
  allocateExposure,
  deleteExposureAllocation,
  listExposureAllocations,
  listChangeOrderAllocations,
  lockProjectBudget,
  buildBudgetFromEstimate,
  createInspection,
  updateInspection,
  deleteInspection,
  updateBucket,
  createBucket,
  deleteBucket,
  listBudgetOverrides,
  recordBudgetOverride,
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
  closeProject,
  reopenProject,
  deleteProject,
  reconcileInvoicePayments,
  recordInvoicePayment,
  type ProjectRow,
  type ReviewRow,
  type ChangeOrderRow,
  type BillingApplicationRow,
  type BillingInvoiceRow,
  type ExposureRow,
  type InspectionRow,
  type ClaimRow,
  type ClaimDocType,
  type SovImportRow,
  type BucketRow,
} from "@/lib/projects.functions";
import { isHarborDemoProject } from "@/lib/demo-seed";
import { listSchedule } from "@/lib/schedule.functions";
import { fmtUSD, fmtPct } from "@/lib/format";
import { MoneyInput } from "@/components/ui/money-input";
import { Label } from "@/components/ui/label";
import { remainingExposureValue, type Phase, type ExposureCategory } from "@/lib/ior";
import { cn } from "@/lib/utils";
import { generateIorPdf, downloadPdfBytes, type IorPdfStyle } from "@/lib/ior-pdf";
import { toast } from "sonner";
import {
  Activity,
  CalendarClock,
  BriefcaseBusiness,
  ClipboardCheck,
  ClipboardList,
  Download,
  ExternalLink,
  FileText,
  FileSpreadsheet,
  FolderOpen,
  HardHat,
  LayoutDashboard,
  ListChecks,
  LockKeyhole,
  LogOut,
  Archive,
  CheckCircle2,
  RotateCcw,
  ReceiptText,
  ShieldAlert,
  Gavel,
  Trash2,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// Lazy-loaded so entering a project doesn't pay for the billing tab's bundle
// up front (PROJECTDECOMP1) — it's fetched the first time the Billing tab opens.
const BillingWorkspace = lazy(() =>
  import("@/components/project/billing/BillingWorkspace").then((module) => ({
    default: module.BillingWorkspace,
  })),
);

const PROJECT_TAB_VALUES = [
  "dashboard",
  "schedule",
  "inspections",
  "risk-tally",
  "claims",
  "todos",
  "sov",
  "billing",
  "change-orders",
  "subcontractors",
  "client-portal",
  "ior-report",
  "daily-reports",
  "daily-wip",
  "file-room",
  "rfi-submittals",
] as const;

type ProjectTabValue = (typeof PROJECT_TAB_VALUES)[number];

// NAVLABELS: the rail leads with the text label, not the icon — 13 icon-only
// destinations were indistinguishable ("where am I?"). All 13 tabs stay on the
// rail, grouped into four clusters under mono `.eyebrow` group headers so the
// rail reads as a status board. Grouping is display-only: deep links (?tab=…)
// resolve unchanged, and every tab keeps its existing `value`.
type ProjectNavGroup = { key: string; label: string; values: ProjectTabValue[] };

type ProjectNavItem = {
  value: ProjectTabValue;
  label: string;
  detail: string;
  icon: LucideIcon;
  // Alarming counts (live risk, slipped schedule) render the detail in --crit.
  alert?: boolean;
};

const PROJECT_NAV_GROUPS: ProjectNavGroup[] = [
  { key: "money", label: "Money", values: ["dashboard", "sov", "billing", "change-orders"] },
  {
    key: "field",
    label: "Field",
    values: ["schedule", "daily-reports", "daily-wip", "inspections"],
  },
  { key: "risk", label: "Risk", values: ["risk-tally", "claims", "todos"] },
  { key: "parties", label: "Parties", values: ["subcontractors", "client-portal", "ior-report"] },
  { key: "docs", label: "Docs", values: ["file-room", "rfi-submittals"] },
];

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

// Warm-clay glow tuned to the shipped skin. Shadows reference the `--accent`
// (clay) and `--foreground` (ink) tokens via color-mix — no hardcoded hex, no
// leftover pre-reskin teal (was rgb(27 122 110 …)).
const PROJECT_NAV_RAIL_CLASS =
  "flex h-auto w-full items-stretch justify-start gap-4 overflow-x-auto rounded-lg border border-accent/25 bg-accent/[0.07] p-2 shadow-[0_18px_42px_color-mix(in_srgb,var(--color-accent)_16%,transparent),0_4px_12px_color-mix(in_srgb,var(--color-foreground)_10%,transparent)] ring-1 ring-accent/15 backdrop-blur-sm lg:flex-col lg:gap-5 lg:overflow-visible";

// Active styling rides Radix's `data-[state=active]` rather than a JS flag: the
// shadcn TabsTrigger base sets `data-[state=active]:bg-background/text-foreground`,
// so a plain `bg-accent` loses the cascade and the active tab paints paper. Same
// variant → tailwind-merge keeps ours (it wins as the later class). The CRM item
// is an <a> with no data-state, so it always reads inactive.
function projectNavItemClass() {
  return cn(
    "group relative flex min-w-[168px] items-start gap-2.5 overflow-hidden rounded-md border px-3 py-2.5 text-left transition duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full lg:min-w-0",
    "border-transparent bg-card/45 text-muted-foreground hover:border-accent/35 hover:bg-card/85 hover:text-foreground hover:shadow-sm",
    "data-[state=active]:border-accent/70 data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=active]:shadow-[0_12px_26px_color-mix(in_srgb,var(--color-accent)_30%,transparent)] data-[state=active]:ring-1 data-[state=active]:ring-accent/35 data-[state=active]:hover:bg-accent data-[state=active]:hover:text-accent-foreground",
  );
}

function projectNavIconClass({ active }: { active?: boolean }) {
  return cn(
    "mt-0.5 h-4 w-4 shrink-0 transition",
    active
      ? "text-accent-foreground drop-shadow-sm"
      : "text-muted-foreground group-hover:text-clay",
  );
}

// Detail sub-line under each label. Alarming counts (e.g. live risk exposures,
// a slipped schedule) go `text-danger`; on the filled-clay active item the
// sub-line stays light so it reads against the accent fill.
function projectNavDetailClass({ active, alert }: { active?: boolean; alert?: boolean }) {
  return cn(
    "mt-0.5 block truncate font-mono text-[11px] leading-tight",
    active ? "text-accent-foreground/85" : alert ? "text-danger" : "text-muted-foreground",
  );
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

function changeOrderTypeFromExposure(category: ExposureCategory): ChangeOrderRow["co_type"] {
  switch (category) {
    case "owner_decision":
      return "owner_change";
    case "design_drift":
      return "design_error";
    case "field_change":
      return "unforeseen_condition";
    case "trade_performance":
    case "procurement":
      return "sub_issued";
    default:
      return "other";
  }
}

function exposureCategoryFromClaim(claimType: ClaimRow["claim_type"]): ExposureCategory {
  switch (claimType) {
    case "delay":
    case "extension_of_time":
    case "delay_damages":
    case "acceleration":
      return "schedule_compression";
    case "disruption":
      return "trade_performance";
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
  // CO→risk value prompt: which CO is being sent, and the amount to carry.
  const [coRiskPrompt, setCoRiskPrompt] = useState<{ co: ChangeOrderRow; value: number } | null>(
    null,
  );
  // Claim→risk value prompt: which claim, and the amount to carry as the risk.
  const [claimRiskPrompt, setClaimRiskPrompt] = useState<{ claim: ClaimRow; value: number } | null>(
    null,
  );
  const [creatingInspectionRiskId, setCreatingInspectionRiskId] = useState<string | null>(null);
  const [activeProjectTab, setActiveProjectTab] = useState<ProjectTabValue>(
    search.tab ?? "dashboard",
  );
  const [focusedRiskExposureId, setFocusedRiskExposureId] = useState<string | null>(null);
  const handleRiskFocusHandled = useCallback(() => setFocusedRiskExposureId(null), []);
  // Budget-drawer drill-through: land the Daily WIP tab on a specific day.
  const [focusedWipDate, setFocusedWipDate] = useState<string | null>(null);
  const handleWipFocusHandled = useCallback(() => setFocusedWipDate(null), []);
  // Budget drawer state. Declared BEFORE the drill-through memos below that
  // read it — a dependency array evaluates at render, so referencing a const
  // declared later is a temporal-dead-zone crash of the whole page (this
  // exact bug shipped once; the file's TDZ warning comment exists for a
  // reason — vite build does not type-check, so tsc is the only net).
  const [editingBucketId, setEditingBucketId] = useState<string | null>(null);
  const [addingLine, setAddingLine] = useState(false);
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
  const linkCoExposureFn = useServerFn(linkChangeOrderExposure);
  const allocateChangeOrderFn = useServerFn(allocateChangeOrder);
  const deleteChangeOrderAllocationFn = useServerFn(deleteChangeOrderAllocation);
  const allocateExposureFn = useServerFn(allocateExposure);
  const deleteExposureAllocationFn = useServerFn(deleteExposureAllocation);
  const listExposureAllocationsFn = useServerFn(listExposureAllocations);
  const listChangeOrderAllocationsFn = useServerFn(listChangeOrderAllocations);
  const listProjectSubcontractsFn = useServerFn(listProjectSubcontracts);
  const listDailyWipEntriesFn = useServerFn(listDailyWipEntries);
  const lockProjectBudgetFn = useServerFn(lockProjectBudget);
  const buildBudgetFromEstimateFn = useServerFn(buildBudgetFromEstimate);
  const createInspectionFn = useServerFn(createInspection);
  const updateInspectionFn = useServerFn(updateInspection);
  const deleteInspectionFn = useServerFn(deleteInspection);
  const createClaimFn = useServerFn(createClaim);
  const updateClaimFn = useServerFn(updateClaim);
  const deleteClaimFn = useServerFn(deleteClaim);
  const createClaimEventFn = useServerFn(createClaimEvent);
  const deleteClaimEventFn = useServerFn(deleteClaimEvent);
  const addClaimDocumentFn = useServerFn(addClaimDocument);
  const deleteClaimDocumentFn = useServerFn(deleteClaimDocument);
  const linkClaimExposureFn = useServerFn(linkClaimExposure);
  const linkClaimChangeOrderFn = useServerFn(linkClaimChangeOrder);
  const updateBucketFn = useServerFn(updateBucket);
  const createBucketFn = useServerFn(createBucket);
  const deleteBucketFn = useServerFn(deleteBucket);
  const listBudgetOverridesFn = useServerFn(listBudgetOverrides);
  const recordBudgetOverrideFn = useServerFn(recordBudgetOverride);
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
  const updateBillingLinesFn = useServerFn(updateBillingLineItems);
  const updateBillingRetainageRateFn = useServerFn(updateBillingApplicationRetainageRate);
  const createCostActualFn = useServerFn(createCostActual);
  const importCostActualsFn = useServerFn(importCostActuals);
  const voidCostActualFn = useServerFn(voidCostActual);
  const setCostActualStatusFn = useServerFn(setCostActualStatus);
  const updateBucketBillingSettingsFn = useServerFn(updateCostBucketBillingSettings);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["project", projectId] });
    qc.invalidateQueries({ queryKey: ["projects"] });
    qc.invalidateQueries({ queryKey: ["billing-workspace", projectId] });
    qc.invalidateQueries({ queryKey: ["portfolio-billing"] });
    qc.invalidateQueries({ queryKey: ["exposure-allocations", projectId] });
    qc.invalidateQueries({ queryKey: ["budget-overrides", projectId] });
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
  const closeProjectFn = useServerFn(closeProject);
  const reopenProjectFn = useServerFn(reopenProject);
  const closeMutation = useMutation({
    mutationFn: () => closeProjectFn({ data: { projectId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project closed out", {
        description: "It moved to Closed jobs and dropped out of the active portfolio.",
      });
    },
    onError: (err) =>
      toast.error("Could not close the project", {
        description: err instanceof Error ? err.message : "Try again.",
      }),
  });
  const reopenMutation = useMutation({
    mutationFn: () => reopenProjectFn({ data: { projectId } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["project", projectId] });
      qc.invalidateQueries({ queryKey: ["projects"] });
      toast.success("Project reopened");
    },
    onError: (err) =>
      toast.error("Could not reopen the project", {
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
  const changeOrderAllocate = useMutation({
    mutationFn: (input: ChangeOrderAllocationInput) =>
      allocateChangeOrderFn({ data: { projectId, ...input } }),
    onSuccess: () => {
      invalidate();
      toast.success("Change order allocated", {
        description: "It rolls into the next application's line contract value (G702 line 2).",
      });
    },
    onError: (err) => {
      toast.error("Allocation did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  const changeOrderAllocationRemove = useMutation({
    mutationFn: (input: { id: string }) => deleteChangeOrderAllocationFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Allocation removed");
    },
    onError: (err) => {
      toast.error("Allocation did not remove", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  const exposureAllocationsQuery = useQuery({
    queryKey: ["exposure-allocations", projectId],
    queryFn: () => listExposureAllocationsFn({ data: { projectId } }),
  });
  // BUDGETLOCK1: the budget ledger layers approved CO cost onto the frozen
  // baseline, so the Budget tab needs the project's CO allocations too.
  const changeOrderAllocationsQuery = useQuery({
    queryKey: ["change-order-allocations", projectId],
    queryFn: () => listChangeOrderAllocationsFn({ data: { projectId } }),
  });
  // Subcontractor cost layer (SUBCONTRACTORS Slice 1). Shares its query key with
  // SubcontractorsWorkspace, so a buyout/payment there refreshes the budget here.
  const subcontractsQuery = useQuery({
    queryKey: ["subcontracts", projectId],
    queryFn: () => listProjectSubcontractsFn({ data: { projectId } }),
  });
  // Daily-WIP entries drive earned value: the sub's latest field %-complete per
  // cost code × its buyout commitment = recognized cost (Slice C part 2). Shares
  // the query key with DailyWipWorkspace so a field update reflects here.
  const dailyWipEntriesQuery = useQuery({
    queryKey: ["daily-wip-entries", projectId],
    queryFn: () => listDailyWipEntriesFn({ data: { projectId } }),
  });
  // BUDGETCONSOLIDATE1: the manual-override audit log for budget lines. Powers
  // the "edited" marker on the ledger and the "recent changes" list in the line
  // editor. Degrades to [] where the audit table isn't applied yet.
  const budgetOverridesQuery = useQuery({
    queryKey: ["budget-overrides", projectId],
    queryFn: () => listBudgetOverridesFn({ data: { projectId } }),
  });
  const budgetOverrides = useMemo(
    () => budgetOverridesQuery.data ?? [],
    [budgetOverridesQuery.data],
  );
  const overriddenBucketIds = useMemo(
    () =>
      new Set(
        budgetOverrides.map((o) => o.cost_bucket_id).filter((id): id is string => Boolean(id)),
      ),
    [budgetOverrides],
  );
  const subCostByBucket = useMemo(() => {
    const data = subcontractsQuery.data;
    if (!data) return undefined;
    const currentPct = latestPercentBySubBucket(dailyWipEntriesQuery.data ?? []);
    return summarizeSubCostByBucket(
      data.subcontracts,
      data.allocations,
      data.payments,
      currentPct,
      // Coded sub COs fold into committed on the Budget grid, matching the
      // dashboard rollup (field request 2026-07-09).
      data.change_orders,
      // Explicit per-payment splits override the pro-rata paid distribution.
      data.payment_allocations,
    );
  }, [subcontractsQuery.data, dailyWipEntriesQuery.data]);
  // Budget-drawer drill-through (field request 2026-07-09): the actual rows
  // behind an edited line — its self-perform daily-log lines (a bought-out sub
  // line belongs to the subcontract layer's story, so it's excluded exactly the
  // way the server's self-perform fold excludes it) and each sub payment's
  // pro-rata share on this code.
  const drawerWipDays = useMemo(() => {
    if (!editingBucketId) return [];
    const subs = subcontractsQuery.data;
    const commitments = subs ? commitmentBySubBucket(subs.subcontracts, subs.allocations) : null;
    return (dailyWipEntriesQuery.data ?? [])
      .filter((entry) => entry.cost_bucket_id === editingBucketId)
      .filter((entry) => {
        const key = subCommitmentKey(entry.subcontractor_id, entry.cost_bucket_id);
        return !(key && (commitments?.get(key) ?? 0) > 0);
      })
      .map((entry) => ({
        date: entry.entry_date,
        activity: entry.activity,
        amount: rowWorkInPlace(entry, null),
      }))
      .filter((row) => row.amount !== 0)
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [editingBucketId, dailyWipEntriesQuery.data, subcontractsQuery.data]);
  const drawerSubPayments = useMemo(() => {
    const subs = subcontractsQuery.data;
    if (!editingBucketId || !subs) return [];
    const titleBySubcontract = new Map(
      subs.subcontracts.map((sub) => [sub.id, sub.title] as const),
    );
    const allocationsBySubcontract = new Map<string, typeof subs.allocations>();
    for (const allocation of subs.allocations) {
      const list = allocationsBySubcontract.get(allocation.subcontract_id) ?? [];
      list.push(allocation);
      allocationsBySubcontract.set(allocation.subcontract_id, list);
    }
    return (
      subs.payments
        // The drawer itemizes ACTUAL cost sources — a draft/approved pay app
        // isn't actual cost yet (only paid rows feed the bucket's actuals).
        .filter((payment) => payment.status === "paid")
        .map((payment) => {
          const allocations = allocationsBySubcontract.get(payment.subcontract_id) ?? [];
          const share = paymentShareForBucket(payment.amount, allocations, editingBucketId);
          if (share <= 0) return null;
          const title = titleBySubcontract.get(payment.subcontract_id) || "Subcontract";
          return {
            id: payment.id,
            date: payment.payment_date,
            label: payment.reference ? `${title} · ${payment.reference}` : title,
            amount: share,
          };
        })
        .filter((row): row is NonNullable<typeof row> => row !== null)
        .sort((a, b) => b.date.localeCompare(a.date))
    );
  }, [editingBucketId, subcontractsQuery.data]);

  // The daily P&L prices earned value at what the owner ACTUALLY pays for a
  // code today: base contract value + approved change-order contract dollars
  // allocated to it — the same contract side the budget ledger shows. Base-only
  // would under-earn every CO'd line.
  const wipProfitBuckets = useMemo(() => {
    const buckets = data?.buckets ?? [];
    const approvedIds = new Set(
      (data?.changeOrders ?? []).filter((co) => co.status === "Approved").map((co) => co.id),
    );
    const coContractCents = new Map<string, number>();
    for (const allocation of changeOrderAllocationsQuery.data ?? []) {
      if (!allocation.cost_bucket_id || !approvedIds.has(allocation.change_order_id)) continue;
      coContractCents.set(
        allocation.cost_bucket_id,
        (coContractCents.get(allocation.cost_bucket_id) ?? 0) +
          dollarsToCents(allocation.contract_amount),
      );
    }
    return buckets.map((bucket) => ({
      ...bucket,
      contract_value: centsToDollars(
        dollarsToCents(bucket.contract_value) + (coContractCents.get(bucket.id) ?? 0),
      ),
    }));
  }, [data?.buckets, data?.changeOrders, changeOrderAllocationsQuery.data]);

  // Sub layer totals for the Budget-tab summary cards, so they match the per-code
  // ledger below. A buyout DISPLACES the self-perform forecast for its scope — it
  // doesn't stack on top — so the forecast adjustment is the remaining sub
  // commitment MINUS the budgeted forecast it consumes (netted per bucket, capped
  // at that bucket's own ftc, floored at 0). `paid` is real actual cost incurred
  // and adds straight to Actual-to-date. Isolated to these cards — the shared IOR
  // rollup (dashboard GP) is untouched.
  const subCostTotals = useMemo(() => {
    // Read buckets from the query data (in scope here), NOT the `buckets` const
    // destructured below the loading/error early-return — this hook runs before
    // that declaration, so referencing it would be a use-before-init (TDZ) crash.
    const ftcByBucket = new Map((data?.buckets ?? []).map((b) => [b.id, b.ftc] as const));
    // `paid` is actual cash out (drives Actual to date); `earned` is the work's
    // value (progress), shown as its own total.
    let paidCents = 0;
    let openAdjCents = 0;
    let committedTotalCents = 0;
    let earnedTotalCents = 0;
    if (subCostByBucket) {
      for (const [bucketId, value] of subCostByBucket.entries()) {
        paidCents += dollarsToCents(value.paid);
        earnedTotalCents += dollarsToCents(value.earned ?? 0);
        const committedCents = dollarsToCents(value.committed ?? 0);
        committedTotalCents += committedCents;
        const bucketFtcCents = dollarsToCents(ftcByBucket.get(bucketId) ?? 0);
        // Buyout consumes budgeted forecast up to this code's own ftc, then adds
        // back the remaining commitment: net = open − min(ftc, committed).
        openAdjCents += dollarsToCents(value.open) - Math.min(bucketFtcCents, committedCents);
      }
    }
    return {
      paid: centsToDollars(paidCents),
      openAdj: centsToDollars(openAdjCents),
      committed: centsToDollars(committedTotalCents),
      earned: centsToDollars(earnedTotalCents),
    };
  }, [subCostByBucket, data?.buckets]);
  const budgetLock = useMutation({
    mutationFn: () => lockProjectBudgetFn({ data: { projectId } }),
    onSuccess: () => {
      toast.success("Budget locked", {
        description: "From here on, budget changes come through change orders.",
      });
      qc.invalidateQueries({ queryKey: ["project", projectId] });
    },
    onError: (error) =>
      toast.error("Budget could not be locked", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });
  const exposureAllocate = useMutation({
    mutationFn: (input: ExposureAllocationInput) =>
      allocateExposureFn({ data: { projectId, ...input } }),
    onSuccess: () => {
      invalidate();
      toast.success("Risk allocated", {
        description: "It rolls into the budget's At Risk / Contingency column for that cost code.",
      });
    },
    onError: (err) => {
      toast.error("Allocation did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  const exposureAllocationRemove = useMutation({
    mutationFn: (input: { id: string }) => deleteExposureAllocationFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Allocation removed");
    },
    onError: (err) => {
      toast.error("Allocation did not remove", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  const budgetFromEstimate = useMutation({
    mutationFn: (pricing: "unpriced" | "auto") =>
      buildBudgetFromEstimateFn({ data: { projectId, pricing } }),
    onSuccess: (result) => {
      invalidate();
      const r = (result ?? {}) as {
        updated?: number;
        created?: number;
        priced?: boolean;
        pricingRequested?: boolean;
      };
      const summary =
        "codes" in ((result ?? {}) as object)
          ? ` (${r.updated ?? 0} updated, ${r.created ?? 0} added)`
          : "";
      // Three honest outcomes: priced, chose-manual, or asked-to-price-but-no-markup.
      const description = r.priced
        ? `Cost codes carry the estimate's line costs as budget, and each line's contract value is proposed from the estimate's markup${summary}. Adjust any line.`
        : r.pricingRequested
          ? `Cost codes carry the estimate's line costs as budget${summary}. The estimate has no markup to distribute, so lines are left unpriced — enter each line's contract value.`
          : `Cost codes carry the estimate's line costs as budget${summary}. Enter each line's contract value to complete the picture.`;
      toast.success("Budget built from estimate", { description });
    },
    onError: (err) => {
      toast.error("Could not build budget", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
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
  const claimCreate = useMutation({
    mutationFn: (input: ClaimDraft) => createClaimFn({ data: { projectId, ...input } }),
    onSuccess: () => {
      invalidate();
      toast.success("Claim added", { description: "It's now tracked in the Claims log." });
    },
    onError: (err) => {
      toast.error("Claim did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  const claimUpdate = useMutation({
    mutationFn: (input: { id: string; patch: ClaimPatch }) =>
      updateClaimFn({ data: { id: input.id, ...input.patch } }),
    onSuccess: () => invalidate(),
    onError: (err) => {
      toast.error("Claim did not update", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  const claimDelete = useMutation({
    mutationFn: (input: { id: string }) => deleteClaimFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Claim deleted");
    },
    onError: (err) => {
      toast.error("Claim did not delete", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  const claimEventCreate = useMutation({
    mutationFn: (input: { claimId: string } & ClaimEventDraft) =>
      createClaimEventFn({ data: { projectId, ...input } }),
    onSuccess: () => invalidate(),
    onError: (err) => {
      toast.error("Cycle event did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  const claimEventDelete = useMutation({
    mutationFn: (input: { id: string }) => deleteClaimEventFn({ data: input }),
    onSuccess: () => invalidate(),
    onError: (err) => {
      toast.error("Cycle event did not delete", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  // Claim documents: bytes go straight to the private 'claim-docs' bucket
  // (path <projectId>/<claimId>/<file>, team storage RLS), then a row records
  // the path + name. View via a short-lived signed URL; remove drops both.
  const [uploadingClaimDoc, setUploadingClaimDoc] = useState(false);
  const uploadClaimDocument = async (
    claimId: string,
    file: File,
    docType: ClaimDocType,
    note: string,
  ) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const path = `${projectId}/${claimId}/${crypto.randomUUID()}-${safeName}`;
    setUploadingClaimDoc(true);
    try {
      const { error } = await supabase.storage
        .from("claim-docs")
        .upload(path, file, { contentType: file.type || "application/pdf", upsert: false });
      if (error) {
        toast.error("Upload failed", { description: error.message });
        return;
      }
      await addClaimDocumentFn({
        data: { claimId, projectId, path, name: file.name, doc_type: docType, note },
      });
      invalidate();
      toast.success("Document attached");
    } catch (err) {
      toast.error("Could not save the document", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setUploadingClaimDoc(false);
    }
  };
  const viewClaimDocument = async (path: string) => {
    const { data, error } = await supabase.storage.from("claim-docs").createSignedUrl(path, 600);
    if (error || !data?.signedUrl) {
      toast.error("Could not open the document");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  const removeClaimDocument = async (id: string, path: string) => {
    if (path) await supabase.storage.from("claim-docs").remove([path]);
    try {
      await deleteClaimDocumentFn({ data: { id } });
      invalidate();
      toast.success("Document removed");
    } catch (err) {
      toast.error("Could not remove the document", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    }
  };
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
      toast.error("Budget line did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
    onSettled: () => invalidate(),
  });
  const bucketCreate = useServerMutation<Record<string, unknown>>(createBucketFn as never);
  const bucketDelete = useServerMutation<{ id: string }>(deleteBucketFn);
  // Best-effort audit write — the bucket edit already landed; a log miss must
  // never surface an error to the user.
  const overrideRecord = useMutation({
    mutationFn: (input: {
      projectId: string;
      costBucketId: string;
      field: "actual_to_date" | "ftc" | "contract_value" | "original_budget";
      oldValue: number;
      newValue: number;
    }) => recordBudgetOverrideFn({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["budget-overrides", projectId] }),
  });
  // BUDGETCONSOLIDATE1: the single Budget table opens a line editor drawer.
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
  const billingLinesUpdateAll = useMutation({
    mutationFn: (input: {
      items: {
        id: string;
        patch: {
          work_completed_this_period?: number;
          materials_stored_this_period?: number;
          retainage_pct?: number;
          retainage_released?: number;
        };
      }[];
    }) => updateBillingLinesFn({ data: input }),
    onSuccess: (result) => {
      invalidate();
      toast.success(`${result.saved_count} line${result.saved_count === 1 ? "" : "s"} saved`, {
        description: "The application totals now reflect every line.",
      });
    },
    onError: (err) => {
      toast.error("Lines did not save", {
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
    onSuccess: (_result, variables) => {
      invalidate();
      if (variables.status === "draft") {
        toast.success("Invoice saved as a draft", {
          description: "It won't count as job cost until it's approved or marked paid.",
        });
      } else {
        toast.success("Cost actual saved");
      }
    },
    onError: (err) => {
      toast.error("Cost actual did not save", {
        description: err instanceof Error ? err.message : "Check the cost entry and try again.",
      });
    },
  });
  // Walk an invoice through the payables lifecycle: approve the spend, then
  // mark it paid. Approving a draft is the moment it starts counting as cost.
  const costActualSetStatus = useMutation({
    mutationFn: (input: { id: string; status: "approved" | "paid" }) =>
      setCostActualStatusFn({ data: input }),
    onSuccess: (_result, variables) => {
      invalidate();
      toast.success(variables.status === "paid" ? "Marked paid" : "Approved for payment");
    },
    onError: (err) => {
      toast.error("Could not update the invoice", {
        description: err instanceof Error ? err.message : "Try again.",
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
    claims = [],
    claimEvents = [],
    claimDocuments = [],
    rollup,
    guidance,
    warnings,
    selfPerformByBucket: selfPerformRaw = {},
  } = data;
  // Self-perform daily WIP per cost code (server-computed), folded into the ledger
  // + Budget cards the SAME way the server folded it into `rollup`. Raw `buckets`
  // stay unadjusted for the budget-line drawer, which edits actual_to_date itself.
  const selfPerformByBucket = new Map(Object.entries(selfPerformRaw as Record<string, number>));
  const ledgerBuckets = applySelfPerformToBuckets(buckets, selfPerformByBucket);
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

  // The actual CO→risk create, run after the value prompt is confirmed. The
  // carried dollar value is the user's choice (full CO value or their own).
  const runCreateRiskFromChangeOrder = (co: ChangeOrderRow, dollarExposure: number) => {
    const probability = co.status === "Pending" ? co.probability : 100;
    setCreatingCoRiskId(co.id);
    expCreate.mutate(
      {
        projectId,
        title: `${co.number ? `${co.number} - ` : ""}${co.description}`,
        description: co.notes || co.description,
        category: exposureCategoryFromChangeOrder(co.co_type),
        dollar_exposure: dollarExposure,
        probability,
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
          `Risk carried: ${fmtUSD(dollarExposure)} (${fmtUSD((dollarExposure * probability) / 100)} likely).`,
          co.notes ? `CO notes: ${co.notes}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      {
        onSuccess: async (data) => {
          const exposureId = (data as { id?: string } | undefined)?.id ?? "";
          if (exposureId) {
            try {
              await linkCoExposureFn({ data: { changeOrderId: co.id, exposureId } });
              invalidate();
            } catch {
              // The link column may be a migration behind; the exposure still
              // stands on its own. Fail quiet — don't undercut the success toast.
            }
          }
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

  const handleCreateRiskFromChangeOrder = (co: ChangeOrderRow) => {
    if (co.linked_exposure_id) {
      toast.info("This change order is already in the risk tally", {
        description: "Open the Risk Tally tab to update the linked exposure.",
      });
      return;
    }
    if (co.status === "Approved") {
      toast.info("Approved CO already affects the forecast", {
        description:
          "Use this action for pending or denied change orders that still need to be protected in the risk tally.",
      });
      return;
    }
    const dollarExposure = co.cost_amount > 0 ? co.cost_amount : co.contract_amount;
    if (dollarExposure <= 0) {
      toast.error("CO needs a dollar value before it can become a risk", {
        description: "Add a cost amount or contract amount, then send it to the risk tally.",
      });
      return;
    }
    // Ask before carrying the value: full CO value, or the PM's own number.
    setCoRiskPrompt({ co, value: dollarExposure });
  };

  const handleCreateChangeOrderFromExposure = (exposure: ExposureRow) => {
    if (exposure.linked_change_order_id) {
      toast.info("This risk is already tracked as a change order", {
        description: "Open the Change Orders tab to update it.",
      });
      return;
    }
    if (exposure.dollar_exposure <= 0) {
      toast.error("Risk needs a dollar value before it becomes a change order", {
        description: "Set the exposure amount first, then tag it as a change order.",
      });
      return;
    }
    coCreate.mutate(
      {
        projectId,
        number: "",
        description: exposure.title,
        contract_amount: exposure.dollar_exposure,
        cost_amount: 0,
        status: "Pending",
        probability: exposure.probability,
        owner: exposure.owner || "PM",
        notes: [
          `Created from the risk tally.`,
          exposure.description ? `Risk detail: ${exposure.description}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        co_type: changeOrderTypeFromExposure(exposure.category),
      },
      {
        onSuccess: async (data) => {
          const changeOrderId = (data as { id?: string } | undefined)?.id ?? "";
          if (changeOrderId) {
            try {
              await linkCoExposureFn({ data: { changeOrderId, exposureId: exposure.id } });
              invalidate();
            } catch {
              // Best-effort link; the pending CO still stands if the link
              // column is a migration behind.
            }
          }
          toast.success("Risk tagged as a change order", {
            description: "It's now a pending CO — open the Change Orders tab to price it.",
          });
        },
        onError: (err) => {
          toast.error("Change order was not created", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
      },
    );
  };

  // CLAIM ↔ RISK / CO (slice 5). Same tag/reference model as CO↔risk: creating
  // the counterpart and cross-linking, never moving money on its own.
  const runCreateRiskFromClaim = (claim: ClaimRow, dollarExposure: number) => {
    const weeks =
      claim.time_claimed_days > 0 ? Math.max(1, Math.round(claim.time_claimed_days / 7)) : null;
    expCreate.mutate(
      {
        projectId,
        title: `${claim.claim_number ? `${claim.claim_number} - ` : ""}${claim.title}`,
        description: claim.description || claim.title,
        category: exposureCategoryFromClaim(claim.claim_type),
        dollar_exposure: dollarExposure,
        probability: 100,
        schedule_impact_weeks: weeks,
        owner: claim.owner || "PM",
        response_path: "recover",
        hold_class: "E-Hold",
        status: "active",
        due_date: null,
        next_review_at: null,
        release_condition: `Claim ${claim.claim_number || claim.title} is resolved (awarded, settled, denied, or withdrawn).`,
        notes: [
          `Created from Claims.`,
          `Claim status: ${claim.status}.`,
          `Risk carried: ${fmtUSD(dollarExposure)}.`,
          claim.time_claimed_days > 0 ? `Time sought: ${claim.time_claimed_days} days.` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      },
      {
        onSuccess: async (data) => {
          const exposureId = (data as { id?: string } | undefined)?.id ?? "";
          if (exposureId) {
            try {
              await linkClaimExposureFn({ data: { claimId: claim.id, exposureId } });
              invalidate();
            } catch {
              // Best-effort link; the exposure still stands if the reverse
              // column is a migration behind.
            }
          }
          toast.success("Claim sent to risk tally", {
            description: `${claim.claim_number || "Claim"} is now an E-Hold exposure to recover.`,
          });
        },
        onError: (err) => {
          toast.error("Claim risk allocation did not save", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
      },
    );
  };

  const handleSendClaimToRisk = (claim: ClaimRow) => {
    if (claim.risk_exposure_id) {
      toast.info("This claim is already in the risk tally", {
        description: "Open the Risk Tally tab to update the linked exposure.",
      });
      return;
    }
    // Default to the amount sought; a time-only claim starts at 0 and the PM
    // sets a nominal dollar in the prompt.
    setClaimRiskPrompt({ claim, value: claim.money_claimed > 0 ? claim.money_claimed : 0 });
  };

  const handleTrackExposureAsClaim = (exposure: ExposureRow) => {
    if (exposure.linked_claim_id) {
      toast.info("This risk is already tracked as a claim", {
        description: "Open the Claims tab to update it.",
      });
      return;
    }
    const weeks = exposure.schedule_impact_weeks ?? 0;
    (
      createClaimFn as (i: {
        data: Record<string, unknown>;
      }) => Promise<{ ok: boolean; id?: string }>
    )({
      data: {
        projectId,
        title: exposure.title,
        description: exposure.description || "",
        claim_type: "delay",
        status: "in_preparation",
        money_claimed: exposure.dollar_exposure,
        time_claimed_days: weeks > 0 ? Math.round(weeks * 7) : 0,
        owner: exposure.owner || "PM",
      },
    })
      .then(async (res) => {
        const claimId = res?.id ?? "";
        if (claimId) {
          try {
            await linkClaimExposureFn({ data: { claimId, exposureId: exposure.id } });
          } catch {
            // best-effort link
          }
        }
        invalidate();
        toast.success("Risk tracked as a claim", {
          description: "It's now a claim in preparation — open the Claims tab to build it out.",
        });
      })
      .catch((err: unknown) => {
        toast.error("Claim was not created", {
          description: err instanceof Error ? err.message : "Try again.",
        });
      });
  };

  const handlePromoteClaimToChangeOrder = (claim: ClaimRow) => {
    if (claim.change_order_id) {
      toast.info("This claim is already in change orders", {
        description: "Open the Change Orders tab to update it.",
      });
      return;
    }
    const amount = claim.money_awarded > 0 ? claim.money_awarded : claim.money_claimed;
    coCreate.mutate(
      {
        projectId,
        number: "",
        description: `${claim.claim_number ? `${claim.claim_number} - ` : ""}${claim.title}`,
        contract_amount: amount,
        cost_amount: 0,
        status: "Pending",
        probability: 100,
        owner: claim.owner || "PM",
        notes: [
          `Promoted from a claim.`,
          `Claim status: ${claim.status}.`,
          claim.outcome ? `Outcome: ${claim.outcome}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
        co_type: "owner_change",
      },
      {
        onSuccess: async (data) => {
          const changeOrderId = (data as { id?: string } | undefined)?.id ?? "";
          if (changeOrderId) {
            try {
              await linkClaimChangeOrderFn({ data: { claimId: claim.id, changeOrderId } });
              invalidate();
            } catch {
              // best-effort link
            }
          }
          toast.success("Claim promoted to a change order", {
            description: "It's now a pending CO — open the Change Orders tab to price it.",
          });
        },
        onError: (err) => {
          toast.error("Change order was not created", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
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
  const openClaimCount = claims.filter(
    (claim) => !["resolved", "rejected", "withdrawn"].includes(claim.status),
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

  const projectNavItems: ProjectNavItem[] = [
    { value: "dashboard", label: "Dashboard", detail: "Financial IOR", icon: LayoutDashboard },
    {
      value: "schedule",
      label: "Schedule",
      detail: `${project.schedule_variance_weeks > 0 ? `+${project.schedule_variance_weeks} wk` : "On plan"}`,
      icon: CalendarClock,
      alert: project.schedule_variance_weeks > 0,
    },
    {
      value: "inspections",
      label: "Inspections",
      detail: `${openInspectionCount} open`,
      // ClipboardCheck (pass/fail) — distinct from Change Orders' ClipboardList.
      icon: ClipboardCheck,
    },
    {
      value: "risk-tally",
      label: "Risk Tally",
      detail: `${liveExposureCount} live`,
      icon: ShieldAlert,
      alert: liveExposureCount > 0,
    },
    {
      value: "claims",
      label: "Claims",
      detail: `${openClaimCount} open`,
      icon: Gavel,
    },
    {
      value: "todos",
      label: "To-Dos",
      detail: `${openTodoCount} open`,
      icon: ListChecks,
    },
    {
      value: "sov",
      label: "Budget",
      detail: `${buckets.length} cost codes`,
      icon: FileSpreadsheet,
    },
    {
      value: "billing",
      // Show a real billing figure — the pay-application count, parallel to the
      // Budget tab's "N cost codes". Previously this reused project.percent_complete
      // (the project's overall progress, ~0 on new jobs), so it read "Billing 0%
      // complete" even after real billing — confusing and unrelated to billing.
      label: "Billing",
      detail:
        billingApplications.length > 0
          ? `${billingApplications.length} pay application${
              billingApplications.length === 1 ? "" : "s"
            }`
          : "No pay applications yet",
      icon: ReceiptText,
    },
    {
      value: "change-orders",
      label: "Change Orders",
      detail: fmtUSD(rollup.pendingCOContract),
      icon: ClipboardList,
    },
    {
      value: "subcontractors",
      label: "Subcontractors",
      detail: "Buyouts & payments",
      icon: HardHat,
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
    {
      value: "daily-wip",
      label: "Daily WIP",
      detail: "Work in place",
      // Activity (running work-in-place) — distinct from Schedule's CalendarClock.
      icon: Activity,
    },
    {
      value: "file-room",
      label: "File Room",
      detail: "Contracts, specs, docs",
      icon: FolderOpen,
    },
    {
      value: "rfi-submittals",
      label: "RFIs & Submittals",
      detail: "Logs + transmittals",
      icon: ClipboardList,
    },
  ];
  const navItemByValue = new Map(projectNavItems.map((item) => [item.value, item] as const));
  // Persistent "you are here" title for the content stage: the active tab's
  // group + label (e.g. "Money · Billing").
  const activeNavGroup = PROJECT_NAV_GROUPS.find((group) =>
    group.values.includes(activeProjectTab),
  );
  const activeNavItem = navItemByValue.get(activeProjectTab);
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
              {project.closed_at ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  disabled={reopenMutation.isPending}
                  onClick={() => reopenMutation.mutate()}
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  {reopenMutation.isPending ? "Reopening…" : "Reopen job"}
                </Button>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="sm" className="gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Close project
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Close “{project.name}” out?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Marks the job complete. It moves to Closed jobs on the home and drops out of
                        the active portfolio and its numbers. Nothing is deleted — you can reopen it
                        anytime.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        disabled={closeMutation.isPending}
                        onClick={(e) => {
                          e.preventDefault();
                          closeMutation.mutate();
                        }}
                      >
                        {closeMutation.isPending ? "Closing…" : "Close project"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
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

      <main className="mx-auto w-full min-w-0 max-w-[1640px] px-4 py-6 sm:px-6 lg:px-8">
        <Tabs
          value={activeProjectTab}
          onValueChange={setProjectTab}
          className="grid min-w-0 gap-6 lg:grid-cols-[248px_minmax(0,1fr)] lg:items-start"
        >
          <aside className="min-w-0 lg:sticky lg:top-6">
            <TabsList className={PROJECT_NAV_RAIL_CLASS}>
              {/* Cross-module jump back to the CRM / relationships surface. */}
              <a
                href="/?tab=crm"
                aria-label="CRM: Relationships"
                title="CRM: Relationships"
                className={cn(projectNavItemClass(), "shrink-0 self-start lg:shrink lg:self-auto")}
              >
                <BriefcaseBusiness className={projectNavIconClass({})} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-tight">CRM</span>
                  <span className={projectNavDetailClass({})}>Relationships</span>
                </span>
              </a>
              {PROJECT_NAV_GROUPS.map((group) => (
                <div key={group.key} className="flex shrink-0 flex-col gap-1.5 lg:w-full lg:shrink">
                  <p className="eyebrow px-1 text-[10px] leading-none">{group.label}</p>
                  <div className="flex gap-1.5 lg:flex-col">
                    {group.values.map((value) => {
                      const item = navItemByValue.get(value);
                      if (!item) return null;
                      const Icon = item.icon;
                      const isActive = activeProjectTab === item.value;
                      return (
                        <TabsTrigger
                          key={item.value}
                          value={item.value}
                          aria-label={`${item.label}: ${item.detail}`}
                          title={`${item.label}: ${item.detail}`}
                          className={projectNavItemClass()}
                        >
                          {isActive && (
                            <span
                              aria-hidden="true"
                              className="absolute inset-y-2 left-0.5 w-1 rounded-full bg-accent-foreground/90"
                            />
                          )}
                          <Icon className={projectNavIconClass({ active: isActive })} />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium leading-tight">
                              {item.label}
                            </span>
                            <span
                              className={projectNavDetailClass({
                                active: isActive,
                                alert: item.alert,
                              })}
                            >
                              {item.detail}
                            </span>
                          </span>
                        </TabsTrigger>
                      );
                    })}
                  </div>
                </div>
              ))}
            </TabsList>
          </aside>

          <div className="min-w-0">
            {activeNavGroup && activeNavItem && (
              <div className="mb-6 flex items-end justify-between gap-4 border-b border-hairline pb-4">
                <div className="min-w-0">
                  <p className="eyebrow">
                    {activeNavGroup.label} · {activeNavItem.label}
                  </p>
                  <h1 className="mt-1 truncate font-serif text-3xl leading-tight text-foreground">
                    {activeNavItem.label}
                  </h1>
                </div>
                <span
                  className={cn(
                    "shrink-0 whitespace-nowrap font-mono text-xs",
                    activeNavItem.alert ? "text-danger" : "text-muted-foreground",
                  )}
                >
                  {activeNavItem.detail}
                </span>
              </div>
            )}
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
              <DailyReportsWorkspace projectId={projectId} project={project} buckets={buckets} />
            </TabsContent>

            <TabsContent value="daily-wip" className="mt-0">
              <DailyWipWorkspace
                projectId={projectId}
                buckets={wipProfitBuckets}
                focusDate={focusedWipDate}
                onFocusDateHandled={handleWipFocusHandled}
              />
            </TabsContent>

            <TabsContent value="file-room" className="mt-0">
              <ProjectFileRoom projectId={projectId} />
            </TabsContent>

            <TabsContent value="rfi-submittals" className="mt-0">
              <SubmittalLog
                projectId={projectId}
                projectName={project.name}
                jobNumber={project.job_number}
              />
            </TabsContent>

            <TabsContent value="risk-tally" className="mt-0 space-y-6">
              <RiskAllocationWorkbench
                exposures={exposures}
                rollup={rollup}
                guidance={guidance}
                focusedExposureId={focusedRiskExposureId}
                onFocusExposureHandled={handleRiskFocusHandled}
                onCreateChangeOrder={handleCreateChangeOrderFromExposure}
                onCreateClaim={handleTrackExposureAsClaim}
                onCreateExposure={(d) => expCreate.mutate({ projectId, ...d })}
                onUpdateExposure={(id, patch) => expUpdate.mutate({ id, ...patch })}
                onDeleteExposure={handleDeleteExposure}
                onCreateTodo={createTodoForRisk}
              />
              <div className="rounded-lg border border-hairline bg-card p-6 shadow-card">
                <ExposureAllocationPanel
                  exposures={exposures}
                  buckets={buckets}
                  allocations={exposureAllocationsQuery.data ?? []}
                  onAllocate={(input) => exposureAllocate.mutate(input)}
                  onRemoveAllocation={(id) => exposureAllocationRemove.mutate({ id })}
                  saving={exposureAllocate.isPending || exposureAllocationRemove.isPending}
                />
              </div>
            </TabsContent>

            <TabsContent value="claims" className="mt-0 space-y-6">
              <WorkspaceHeader
                title="Claims"
                subtitle="Delay claims, extension-of-time and delay-damages claims — tracked through the dispute-resolution process from preparation to resolution."
              />
              <ClaimsWorkspace
                claims={claims}
                events={claimEvents}
                documents={claimDocuments}
                onCreate={(input) => claimCreate.mutate(input)}
                onUpdate={(id, patch) => claimUpdate.mutate({ id, patch })}
                onDelete={(id) => claimDelete.mutate({ id })}
                onCreateEvent={(claimId, draft) => claimEventCreate.mutate({ claimId, ...draft })}
                onDeleteEvent={(id) => claimEventDelete.mutate({ id })}
                onUploadDocument={uploadClaimDocument}
                onViewDocument={viewClaimDocument}
                onDeleteDocument={removeClaimDocument}
                onSendToRisk={handleSendClaimToRisk}
                onPromoteToChangeOrder={handlePromoteClaimToChangeOrder}
                uploadingDocument={uploadingClaimDoc}
                saving={claimCreate.isPending || claimUpdate.isPending}
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
                    title="Budget"
                    subtitle="Your budget by cost code — from the estimate — with actual cost and forecast-to-complete. This is the number you manage against; you bill from the SOV in Billing."
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
                            toast.success("Budget imported", {
                              description: `${imported} created, ${updated} updated. Original cost budget is now ${fmtUSD(budget)}.`,
                            });
                            if (
                              typeof result === "object" &&
                              result &&
                              "importHistorySaved" in result &&
                              !(result as { importHistorySaved: boolean }).importHistorySaved
                            ) {
                              toast.warning("Budget imported, history pending", {
                                description:
                                  "The budget lines saved, but the import ledger table is not available yet.",
                              });
                            }
                          },
                          onError: (err) => {
                            toast.error("Budget import did not save", {
                              description: err instanceof Error ? err.message : "Try again.",
                            });
                          },
                        },
                      )
                    }
                    pending={bucketImport.isPending}
                  />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
                  <span className="text-xs text-muted-foreground">
                    Budget comes from the estimate — carry it in, or enter cost lines below by hand.
                  </span>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={budgetFromEstimate.isPending}
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        Build budget from estimate
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Build the budget from the estimate?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This carries the estimate's line costs (material + labor) onto your cost
                          codes as the <span className="font-medium text-foreground">budget</span> —
                          what you drive the job on. Matching cost codes are overwritten; new ones
                          are added. Actuals and forecast-to-complete are not touched.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      {/* BUDGETVSCONTRACT2: the contract value (what the owner pays) is a
                          separate number. Let the user choose how it gets set. */}
                      <div className="space-y-2 rounded-md border border-hairline bg-surface p-3 text-sm">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Contract value (what the client pays)
                        </div>
                        <p className="text-muted-foreground">
                          Budget is your cost; the contract is what the owner pays. How should each
                          line's contract value be set?
                        </p>
                      </div>
                      <AlertDialogFooter className="flex-col gap-2 sm:flex-col sm:space-x-0">
                        <AlertDialogAction
                          className="w-full"
                          onClick={() => budgetFromEstimate.mutate("auto")}
                        >
                          Auto-price from the estimate
                          <span className="ml-1 text-xs opacity-80">
                            (proposes each line's contract from your markup — editable)
                          </span>
                        </AlertDialogAction>
                        <AlertDialogAction
                          className="w-full bg-surface text-foreground hover:bg-surface/80"
                          onClick={() => budgetFromEstimate.mutate("unpriced")}
                        >
                          I'll enter contract values myself
                          <span className="ml-1 text-xs opacity-70">
                            (lines come in as "needs contract value")
                          </span>
                        </AlertDialogAction>
                        <AlertDialogCancel className="mt-0 w-full">Cancel</AlertDialogCancel>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
                <div className="mt-5 grid gap-3 md:grid-cols-3 xl:grid-cols-4">
                  <SovMetric label="Cost buckets loaded" value={String(buckets.length)} />
                  <SovMetric
                    label="Original cost budget"
                    value={fmtUSD(project.original_cost_budget)}
                  />
                  <SovMetric
                    label="Actual to date"
                    value={fmtUSD(rollup.actualToDate + subCostTotals.paid)}
                  />
                  <SovMetric
                    label="Forecast to complete"
                    value={fmtUSD(rollup.ftc + subCostTotals.openAdj)}
                  />
                  <SovMetric
                    label="CO cost exposure"
                    value={fmtUSD(rollup.weightedPendingCOCost)}
                  />
                  <SovMetric
                    label="Forecasted final cost"
                    // rollup.forecastedFinalCost now folds in the subcontractor
                    // layer server-side, so do NOT add subCostTotals here again
                    // (that would double-count). Actual/Forecast cards above still
                    // add it, because those rollup fields stay raw.
                    value={fmtUSD(rollup.forecastedFinalCost)}
                  />
                  {subCostTotals.committed > 0 ? (
                    <SovMetric
                      label="Committed cost (subs)"
                      value={fmtUSD(subCostTotals.committed)}
                    />
                  ) : null}
                  {subCostTotals.paid > 0 ? (
                    <SovMetric label="Paid to date (subs)" value={fmtUSD(subCostTotals.paid)} />
                  ) : null}
                </div>
                <SovImportHistory imports={sovImports ?? []} />
              </div>
              {/* BUDGETLOCK1: the budget is a locked baseline — the only thing
                  that moves it is an approved change order's budgeted cost. */}
              {project.budget_locked_at ? (
                <div className="flex items-center gap-2 rounded-md border border-hairline bg-surface px-4 py-2.5 text-sm text-muted-foreground">
                  <LockKeyhole className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Budget locked{" "}
                    {new Date(project.budget_locked_at).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}{" "}
                    — changes come through change orders.
                  </span>
                </div>
              ) : (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-warning/30 bg-warning/10 px-4 py-2.5">
                  <span className="text-sm text-foreground">
                    <span className="font-medium">Budget not locked yet.</span> Lock it to freeze
                    the baseline — it also locks automatically with the first pay application. After
                    that, budget changes come through change orders.
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    disabled={budgetLock.isPending}
                    onClick={() => {
                      if (
                        window.confirm(
                          "Lock the budget? After locking, budget lines can't be edited — budget changes come through change orders. Unlocking requires an admin request.",
                        )
                      ) {
                        budgetLock.mutate();
                      }
                    }}
                  >
                    <LockKeyhole className="h-3.5 w-3.5" />
                    {budgetLock.isPending ? "Locking…" : "Lock budget"}
                  </Button>
                </div>
              )}
              <div className="rounded-lg border border-hairline bg-card p-6 shadow-card">
                <BudgetLedgerTable
                  buckets={ledgerBuckets}
                  exposures={exposures}
                  allocations={exposureAllocationsQuery.data ?? []}
                  changeOrders={changeOrders}
                  changeOrderAllocations={changeOrderAllocationsQuery.data ?? []}
                  subCostByBucket={subCostByBucket}
                  selfPerformByBucket={selfPerformByBucket}
                  onOpenLine={(id) => {
                    setAddingLine(false);
                    setEditingBucketId(id);
                  }}
                  onAddLine={() => {
                    setEditingBucketId(null);
                    setAddingLine(true);
                  }}
                  editedBucketIds={overriddenBucketIds}
                />
              </div>
              <BudgetLineDrawer
                open={addingLine || editingBucketId !== null}
                onOpenChange={(next) => {
                  if (!next) {
                    setEditingBucketId(null);
                    setAddingLine(false);
                  }
                }}
                mode={addingLine ? "create" : "edit"}
                bucket={addingLine ? null : (buckets.find((b) => b.id === editingBucketId) ?? null)}
                subCost={editingBucketId ? subCostByBucket?.get(editingBucketId) : undefined}
                selfPerformWip={
                  editingBucketId ? (selfPerformByBucket.get(editingBucketId) ?? 0) : 0
                }
                wipDays={drawerWipDays}
                subPayments={drawerSubPayments}
                onOpenWipDay={(date) => {
                  setEditingBucketId(null);
                  setAddingLine(false);
                  setProjectTab("daily-wip");
                  setFocusedWipDate(date);
                }}
                onOpenSubcontractors={() => {
                  setEditingBucketId(null);
                  setAddingLine(false);
                  setProjectTab("subcontractors");
                }}
                budgetLocked={Boolean(project.budget_locked_at)}
                overrides={budgetOverrides}
                onSave={(id, patch) => bucketUpdate.mutateAsync({ id, patch })}
                onCreate={(input) => bucketCreate.mutate({ projectId, ...input })}
                onDelete={(id) => bucketDelete.mutate({ id })}
                onRecordOverride={(costBucketId, field, oldValue, newValue) =>
                  overrideRecord.mutate({ projectId, costBucketId, field, oldValue, newValue })
                }
                saving={bucketUpdate.isPending}
              />
            </TabsContent>

            <TabsContent value="billing" className="mt-0 space-y-6">
              <Suspense
                fallback={
                  <div className="rounded-md border border-hairline bg-surface p-5 text-sm text-muted-foreground">
                    Loading billing…
                  </div>
                }
              >
                <BillingWorkspace
                  project={project}
                  rollup={rollup}
                  changeOrders={changeOrders}
                  buckets={buckets}
                  exposures={exposures}
                  exposureAllocations={exposureAllocationsQuery.data ?? []}
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
                    costActualVoid.isPending ||
                    costActualSetStatus.isPending
                  }
                  savingBucketBilling={bucketBillingUpdate.isPending}
                  onCreate={handleCreatePayApp}
                  onUpdate={handleUpdatePayApp}
                  onDelete={handleDeletePayApp}
                  onGenerateBillingLines={(billingApplicationId) =>
                    billingLineGenerate.mutate({ projectId, billingApplicationId })
                  }
                  onUpdateBillingLine={(id, patch) => billingLineUpdate.mutate({ id, patch })}
                  onSaveAllBillingLines={(items) => billingLinesUpdateAll.mutate({ items })}
                  savingAllBillingLines={billingLinesUpdateAll.isPending}
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
                  onSetCostActualStatus={(id, status) => costActualSetStatus.mutate({ id, status })}
                  onUpdateBucketBillingSettings={(id, patch) =>
                    bucketBillingUpdate.mutate({ id, patch })
                  }
                  onCreateInvoice={handleCreateInvoice}
                  onUpdateInvoice={handleUpdateInvoice}
                  onDeleteInvoice={handleDeleteInvoice}
                  onRecordPayment={handleRecordPayment}
                  onReconcileInvoice={(invoiceId) => invoiceReconcile.mutate(invoiceId)}
                  reconcilingInvoiceId={reconcilingInvoiceId}
                  onAllocateChangeOrder={(input) => changeOrderAllocate.mutate(input)}
                  onRemoveChangeOrderAllocation={(id) => changeOrderAllocationRemove.mutate({ id })}
                  savingAllocation={
                    changeOrderAllocate.isPending || changeOrderAllocationRemove.isPending
                  }
                />
              </Suspense>
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

            <TabsContent value="subcontractors" className="mt-0">
              <SubcontractorsWorkspace projectId={projectId} buckets={buckets} />
            </TabsContent>

            <TabsContent value="client-portal" className="mt-0">
              <ClientPortalWorkspace projectId={projectId} />
            </TabsContent>
          </div>
        </Tabs>

        <AlertDialog
          open={coRiskPrompt !== null}
          onOpenChange={(next) => {
            if (!next) setCoRiskPrompt(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Add this change order to the risk tally</AlertDialogTitle>
              <AlertDialogDescription>
                {coRiskPrompt
                  ? `Carry the full change-order value of ${fmtUSD(
                      coRiskPrompt.co.cost_amount > 0
                        ? coRiskPrompt.co.cost_amount
                        : coRiskPrompt.co.contract_amount,
                    )} as the risk, or set your own amount below. This only creates a linked risk — it does not move any money on its own.`
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="co-risk-value">Risk value to carry</Label>
              <MoneyInput
                id="co-risk-value"
                value={coRiskPrompt?.value ?? 0}
                onValueChange={(value) =>
                  setCoRiskPrompt((current) => (current ? { ...current, value } : current))
                }
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={!coRiskPrompt || coRiskPrompt.value <= 0}
                onClick={(e) => {
                  e.preventDefault();
                  if (!coRiskPrompt || coRiskPrompt.value <= 0) return;
                  runCreateRiskFromChangeOrder(coRiskPrompt.co, coRiskPrompt.value);
                  setCoRiskPrompt(null);
                }}
              >
                Add to risk tally
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <AlertDialog
          open={claimRiskPrompt !== null}
          onOpenChange={(next) => {
            if (!next) setClaimRiskPrompt(null);
          }}
        >
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Add this claim to the risk tally</AlertDialogTitle>
              <AlertDialogDescription>
                {claimRiskPrompt
                  ? `Carry the amount sought${
                      claimRiskPrompt.claim.money_claimed > 0
                        ? ` (${fmtUSD(claimRiskPrompt.claim.money_claimed)})`
                        : ""
                    } as the risk, or set your own amount below. This only creates a linked risk — it does not move any money on its own.`
                  : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="claim-risk-value">Risk value to carry</Label>
              <MoneyInput
                id="claim-risk-value"
                value={claimRiskPrompt?.value ?? 0}
                onValueChange={(value) =>
                  setClaimRiskPrompt((current) => (current ? { ...current, value } : current))
                }
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={!claimRiskPrompt || claimRiskPrompt.value <= 0}
                onClick={(e) => {
                  e.preventDefault();
                  if (!claimRiskPrompt || claimRiskPrompt.value <= 0) return;
                  runCreateRiskFromClaim(claimRiskPrompt.claim, claimRiskPrompt.value);
                  setClaimRiskPrompt(null);
                }}
              >
                Add to risk tally
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
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

function responseAction(path: import("@/lib/ior").ResponsePath) {
  if (path === "eliminate") return "Eliminate";
  if (path === "recover") return "Recover";
  if (path === "offset") return "Offset";
  return "Accept";
}
