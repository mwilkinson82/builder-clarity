import {
  createFileRoute,
  Link,
  Outlet,
  useChildMatches,
  useNavigate,
  useRouter,
} from "@tanstack/react-router";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AppFooter } from "@/components/layout/AppFooter";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { friendlyErrorMessage } from "@/lib/friendly-error";
import { reportLovableError } from "@/lib/lovable-error-reporting";
import { applySovBucketPatch } from "@/lib/sov-rollup";
import { BudgetLineDrawer } from "@/components/outcome/BudgetLineDrawer";
import { ChangeOrdersTable, type ChangeOrderDraft } from "@/components/outcome/ChangeOrdersTable";
import { ScheduleRisk } from "@/components/schedule";
import { ProjectTruthReview } from "@/components/outcome/ProjectTruthReview";
import { ImportSOVSheet, type SovMappingProfileDraft } from "@/components/outcome/ImportSOVSheet";
import { ReviewsTab } from "@/components/outcome/ReviewsTab";
import { RiskAllocationWorkbench } from "@/components/outcome/RiskAllocationWorkbench";
import {
  ExposureAllocationPanel,
  type ExposureAllocationDeleteInput,
  type ExposureAllocationInput,
  type ExposureAllocationUpdateInput,
} from "@/components/project/ExposureAllocationPanel";
import { BudgetLedgerTable } from "@/components/project/BudgetLedgerTable";
import { ProjectDashboard } from "@/components/outcome/ProjectDashboard";
import { DecisionsTable } from "@/components/outcome/DecisionsTable";
import { DailyReportsWorkspace } from "@/components/outcome/DailyReportsWorkspace";
import { DailyWipWorkspace } from "@/components/outcome/DailyWipWorkspace";
import { TomorrowPlanWorkspace } from "@/components/outcome/TomorrowPlanWorkspace";
import { ProjectFileRoom } from "@/components/project/ProjectFileRoom";
import { SubmittalLog } from "@/components/project/SubmittalLog";
import { SubcontractorsWorkspace } from "@/components/project/SubcontractorsWorkspace";
import { SubcontractFinancialReadState } from "@/components/project/SubcontractFinancialReadState";
import { BudgetFinancialReadState } from "@/components/project/BudgetFinancialReadState";
import { listProjectSubcontracts } from "@/lib/subcontracts.functions";
import { sendChangeOrderToClient } from "@/lib/client-portal.functions";
import { paymentShareForBucket, summarizeSubCostByBucket } from "@/lib/subcontract-budget";
import {
  applySelfPerformToBuckets,
  latestPercentBySubBucket,
  rowWorkInPlace,
  subCommitmentKey,
  commitmentBySubBucket,
} from "@/lib/daily-wip";
import { listDailyWipEntries } from "@/lib/daily-wip.functions";
import {
  createExposureAllocation,
  deleteExposureAllocation,
  listExposureAllocations,
  updateExposureAllocation,
} from "@/lib/exposure-allocations.functions";
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
  sortBillingApplications,
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
  applyCertifiedSovPositionToBilling,
  createCostActual,
  updateCostActual,
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
  addChangeOrderDocument,
  deleteChangeOrderDocument,
  linkClaimExposure,
  linkClaimChangeOrder,
  allocateChangeOrder,
  deleteChangeOrderAllocation,
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
  submitReview,
  updateReview,
  deleteReview,
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
  type CoDocType,
  type SovImportRow,
  type BucketRow,
  listCostActualsForBudget,
} from "@/lib/projects.functions";
import { isHarborDemoProject } from "@/lib/demo-seed";
import { HARBOR_DEMO_TOMORROW_PLAN_DATE } from "@/lib/harbor-production-demo";
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
  ArrowLeft,
  CalendarCheck2,
  CalendarClock,
  ChevronDown,
  ChevronRight,
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
  Plus,
  PackageCheck,
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

const SelectionsWorkspace = lazy(() =>
  import("@/components/outcome/SelectionsWorkspace").then((module) => ({
    default: module.SelectionsWorkspace,
  })),
);

const PROJECT_TAB_VALUES = [
  "dashboard",
  "schedule",
  "selections",
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
  "tomorrow-plan",
  "daily-wip",
  "file-room",
  "rfi-submittals",
] as const;

type ProjectTabValue = (typeof PROJECT_TAB_VALUES)[number];

// NAVLABELS: the rail leads with the text label, not the icon. The destinations
// are grouped around the IOR operating loop: establish the GP target, plan the
// work, control commercial commitments, capture field truth, and share the
// client record. Grouping is display-only: deep links (?tab=…) resolve
// unchanged, and every tab keeps its existing `value`.
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
  {
    key: "ior",
    label: "IOR",
    values: ["dashboard", "risk-tally", "todos", "claims", "ior-report"],
  },
  {
    key: "plan-procurement",
    label: "Plan & Procurement",
    values: ["schedule", "selections", "rfi-submittals"],
  },
  {
    key: "commercial",
    label: "Commercial",
    values: ["sov", "subcontractors", "change-orders", "billing"],
  },
  {
    key: "field",
    label: "Field",
    values: ["daily-reports", "tomorrow-plan", "daily-wip", "inspections"],
  },
  {
    key: "client-records",
    label: "Client & Records",
    values: ["client-portal", "file-room"],
  },
];

const projectNavGroupKeyForTab = (tab: ProjectTabValue) =>
  PROJECT_NAV_GROUPS.find((group) => group.values.includes(tab))?.key;

export const Route = createFileRoute("/_authenticated/projects/$projectId")({
  ssr: false,
  head: () => ({ meta: [{ title: "Project IOR — Overwatch" }] }),
  validateSearch: (
    search: Record<string, unknown>,
  ): { tab?: ProjectTabValue; wipView?: "daily" | "production" } => {
    const tab = typeof search.tab === "string" ? search.tab : "";
    const wipView =
      search.wipView === "production" || search.wipView === "daily" ? search.wipView : undefined;
    return {
      tab: PROJECT_TAB_VALUES.includes(tab as ProjectTabValue)
        ? (tab as ProjectTabValue)
        : undefined,
      wipView,
    };
  },
  component: ProjectRoute,
  errorComponent: ProjectRouteError,
});

// Route-level boundary: a throw in any child renders a recoverable card (retry
// or head back to the portfolio), never a blank shell. The raw error stays in
// the console/monitoring; the reader sees a mapped, plain-English reason.
function ProjectRouteError({ error, reset }: { error: Error; reset: () => void }) {
  const router = useRouter();
  useEffect(() => {
    console.error("Project view crashed:", error);
    reportLovableError(error, { boundary: "project_route_error_component" });
  }, [error]);
  return (
    <div className="p-10">
      <section
        role="alert"
        className="max-w-xl rounded-xl border border-danger/30 bg-danger/10 p-5 shadow-card"
      >
        <h2 className="font-serif text-xl text-foreground">This page hit a snag</h2>
        <p className="mt-2 text-sm leading-relaxed text-danger">
          {friendlyErrorMessage(error, "Something went wrong loading this project. Try again.")}
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="signal"
            size="sm"
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Try again
          </Button>
          <Button asChild type="button" variant="outline" size="sm">
            <Link to="/">Back to portfolio</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}

// v2 floating rail (docs/THEMING.md structural signatures): a rounded paper
// card that floats on the page wash — radius 15, hairline border, one soft
// wide glow (`shadow-nav`). Structure is unchanged; this is chrome only.
const PROJECT_NAV_RAIL_CLASS =
  "flex h-auto w-full items-stretch justify-start gap-4 overflow-x-auto rounded-[15px] border border-hairline bg-background p-3 shadow-nav lg:flex-col lg:gap-5 lg:overflow-visible";

// Rail item styling is inline in the accordion (see the nav render): the active
// group's box lists its tabs (active = quiet paper2 fill + a clay dot), while
// inactive groups collapse to a single status-hint row. No icons — the mock's
// rail is text + right-aligned value, matching the wider v2 type-led system.

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
  // Multi-expand navigation: every project group starts open so the full
  // workspace is discoverable without accordion hunting. After first paint,
  // each group still keeps the expanded/collapsed state the user chooses.
  const [expandedNavGroupKeys, setExpandedNavGroupKeys] = useState<Set<string>>(
    () => new Set(PROJECT_NAV_GROUPS.map((group) => group.key)),
  );
  const [focusedRiskExposureId, setFocusedRiskExposureId] = useState<string | null>(null);
  const handleRiskFocusHandled = useCallback(() => setFocusedRiskExposureId(null), []);
  // Budget-drawer drill-through: land the Daily WIP tab on a specific day.
  const [focusedWipDate, setFocusedWipDate] = useState<string | null>(null);
  const handleWipFocusHandled = useCallback(() => setFocusedWipDate(null), []);
  // Budget-drawer drill-through: land the Billing tab on a specific stage (the
  // "Invoices & recorded costs" row → the Costs ledger). Cleared when navigating
  // away from billing so a repeat click re-fires the deep-link effect.
  const [billingFocusStage, setBillingFocusStage] = useState<string | undefined>(undefined);
  // Budget drawer state. Declared BEFORE the drill-through memos below that
  // read it — a dependency array evaluates at render, so referencing a const
  // declared later is a temporal-dead-zone crash of the whole page (this
  // exact bug shipped once; the file's TDZ warning comment exists for a
  // reason — vite build does not type-check, so tsc is the only net).
  const [editingBucketId, setEditingBucketId] = useState<string | null>(null);
  const [addingLine, setAddingLine] = useState(false);
  const [companyLogoFailedUrl, setCompanyLogoFailedUrl] = useState("");
  // v2 shell: Close/Archive/Delete live in the "···" overflow menu; each opens
  // its confirm dialog through this single controlled state.
  const [confirmAction, setConfirmAction] = useState<"close" | "archive" | "delete" | null>(null);
  const setProjectTab = (value: string) => {
    if (PROJECT_TAB_VALUES.includes(value as ProjectTabValue)) {
      setActiveProjectTab(value as ProjectTabValue);
      // Leaving billing clears the deep-link stage so the next drawer click sets
      // it fresh (undefined → "project-costs" is a change the effect re-fires on).
      if (value !== "billing") setBillingFocusStage(undefined);
    }
  };

  useEffect(() => {
    if (search.tab) setProjectTab(search.tab);
  }, [search.tab]);

  useEffect(() => {
    const activeGroupKey = projectNavGroupKeyForTab(activeProjectTab);
    if (!activeGroupKey) return;
    setExpandedNavGroupKeys((current) => {
      if (current.has(activeGroupKey)) return current;
      const next = new Set(current);
      next.add(activeGroupKey);
      return next;
    });
  }, [activeProjectTab]);

  const toggleNavGroup = (groupKey: string) => {
    setExpandedNavGroupKeys((current) => {
      const next = new Set(current);
      if (next.has(groupKey)) next.delete(groupKey);
      else next.add(groupKey);
      return next;
    });
  };

  const {
    data,
    isLoading,
    error,
    refetch: refetchProject,
    isFetching: projectFetching,
  } = useQuery({
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
  const sendCoFn = useServerFn(sendChangeOrderToClient);
  const deleteCoFn = useServerFn(deleteChangeOrder);
  const linkCoExposureFn = useServerFn(linkChangeOrderExposure);
  const allocateChangeOrderFn = useServerFn(allocateChangeOrder);
  const deleteChangeOrderAllocationFn = useServerFn(deleteChangeOrderAllocation);
  const createExposureAllocationFn = useServerFn(createExposureAllocation);
  const updateExposureAllocationFn = useServerFn(updateExposureAllocation);
  const deleteExposureAllocationFn = useServerFn(deleteExposureAllocation);
  const listExposureAllocationsFn = useServerFn(listExposureAllocations);
  const listChangeOrderAllocationsFn = useServerFn(listChangeOrderAllocations);
  const listProjectSubcontractsFn = useServerFn(listProjectSubcontracts);
  const listDailyWipEntriesFn = useServerFn(listDailyWipEntries);
  const listCostActualsFn = useServerFn(listCostActualsForBudget);
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
  const addChangeOrderDocumentFn = useServerFn(addChangeOrderDocument);
  const deleteChangeOrderDocumentFn = useServerFn(deleteChangeOrderDocument);
  const linkClaimExposureFn = useServerFn(linkClaimExposure);
  const linkClaimChangeOrderFn = useServerFn(linkClaimChangeOrder);
  const updateBucketFn = useServerFn(updateBucket);
  const createBucketFn = useServerFn(createBucket);
  const deleteBucketFn = useServerFn(deleteBucket);
  const listBudgetOverridesFn = useServerFn(listBudgetOverrides);
  const submitReviewFn = useServerFn(submitReview);
  const updateReviewFn = useServerFn(updateReview);
  const deleteReviewFn = useServerFn(deleteReview);
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
  const applyCertifiedSovPositionFn = useServerFn(applyCertifiedSovPositionToBilling);
  const createCostActualFn = useServerFn(createCostActual);
  const updateCostActualFn = useServerFn(updateCostActual);
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
    // The Budget drawer itemizes invoices from this key; a counted row's edit
    // must never leave the explaining list out of sync with the rollup (#261
    // invariant — a stale list manufactures a phantom "hand-entered" line).
    qc.invalidateQueries({ queryKey: ["cost-actuals", projectId] });
  };
  const useServerMutation = <I,>(fn: (i: { data: I }) => Promise<unknown>) =>
    useMutation({ mutationFn: (input: I) => fn({ data: input }), onSuccess: invalidate });

  // Retain command keys across transport failures. They rotate only after the
  // database confirms success, so a lost response cannot create a second write.
  const budgetLockOperationKeyRef = useRef(crypto.randomUUID());

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
      toast.success(demoArchived ? "Training project hidden" : "Project archived", {
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
  const changeOrderRetryKeys = useRef(new Map<string, string>());
  const changeOrderCommittedVersions = useRef(new Map<string, string>());
  useEffect(() => {
    const currentVersions = new Map(
      (data?.changeOrders ?? []).map((changeOrder) => [changeOrder.id, changeOrder.updated_at]),
    );
    for (const [changeOrderId, committedVersion] of changeOrderCommittedVersions.current) {
      const currentVersion = currentVersions.get(changeOrderId);
      if (!currentVersion || currentVersion !== committedVersion) {
        changeOrderCommittedVersions.current.delete(changeOrderId);
      }
    }
  }, [data?.changeOrders]);
  const changeOrderCommandKey = (intent: string) => {
    const existing = changeOrderRetryKeys.current.get(intent);
    if (existing) return existing;
    const nonce =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const key = `change-order:${intent}:${nonce}`;
    changeOrderRetryKeys.current.set(intent, key);
    return key;
  };
  type ChangeOrderCommandResult = {
    ok: boolean;
    id: string;
    changeOrderId: string;
    updatedAt: string;
    deduplicated: boolean;
  };
  const coCreate = useMutation({
    mutationFn: (input: { projectId: string; operationKey: string } & ChangeOrderDraft) =>
      (
        createCoFn as (i: {
          data: { projectId: string; operationKey: string } & ChangeOrderDraft;
        }) => Promise<ChangeOrderCommandResult>
      )({ data: input }),
    onSuccess: invalidate,
  });
  const coUpdate = useMutation({
    mutationFn: (
      input: {
        id: string;
        projectId: string;
        expectedUpdatedAt: string;
        operationKey: string;
      } & Partial<ChangeOrderDraft>,
    ) =>
      (
        updateCoFn as (i: {
          data: {
            id: string;
            projectId: string;
            expectedUpdatedAt: string;
            operationKey: string;
          } & Partial<ChangeOrderDraft>;
        }) => Promise<ChangeOrderCommandResult>
      )({ data: input }),
    onSuccess: invalidate,
  });
  const coDelete = useMutation({
    mutationFn: (input: {
      id: string;
      projectId: string;
      expectedUpdatedAt: string;
      operationKey: string;
    }) =>
      (deleteCoFn as (i: { data: typeof input }) => Promise<ChangeOrderCommandResult>)({
        data: input,
      }),
    onSuccess: invalidate,
  });
  // Send / nudge a change order to the client (stamps client_sent_at). One send
  // is in flight at a time; the row shows "Sending…" via coSendToClient.variables.
  const coSendToClient = useMutation({
    mutationFn: (input: { changeOrderId: string }) =>
      (sendCoFn as (i: { data: { changeOrderId: string } }) => Promise<{ nudged: boolean }>)({
        data: input,
      }),
    onSuccess: (result, input) => {
      changeOrderCommittedVersions.current.delete(input.changeOrderId);
      invalidate();
      toast.success(result?.nudged ? "Client nudged" : "Shared with the client", {
        description: result?.nudged
          ? "Refreshed the shared date on this change order."
          : "The client can review and respond in their portal.",
      });
    },
    onError: (err) =>
      toast.error("Couldn't share the change order", {
        description: err instanceof Error ? err.message : "Try again.",
      }),
  });
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
  // Invoices/costs recorded in Billing job costs — the Budget drawer itemizes
  // the ones behind an edited line's actual (they're folded into
  // actual_to_date by a DB trigger, so they're already IN the number shown).
  const costActualsQuery = useQuery({
    queryKey: ["cost-actuals", projectId],
    queryFn: () => listCostActualsFn({ data: { projectId } }),
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
      // Recognized supplier invoices linked to a sub CO/pay app already live in
      // bucket actuals; they relieve Open here without adding cost twice.
      costActualsQuery.data ?? [],
    );
  }, [subcontractsQuery.data, dailyWipEntriesQuery.data, costActualsQuery.data]);
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
  const drawerInvoices = useMemo(() => {
    if (!editingBucketId) return [];
    return (costActualsQuery.data ?? [])
      .filter((row) => row.cost_bucket_id === editingBucketId)
      .map((row) => ({
        id: row.id,
        date: row.cost_date,
        label: [row.vendor || row.description || "Cost entry", row.reference_number]
          .filter(Boolean)
          .join(" · "),
        amount: row.amount,
      }));
  }, [editingBucketId, costActualsQuery.data]);
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
    mutationFn: () =>
      lockProjectBudgetFn({
        data: { projectId, operationKey: budgetLockOperationKeyRef.current },
      }),
    onSuccess: () => {
      budgetLockOperationKeyRef.current = crypto.randomUUID();
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
      createExposureAllocationFn({ data: { projectId, ...input } }),
    onSuccess: async () => {
      invalidate();
      await qc.refetchQueries({ queryKey: ["exposure-allocations", projectId] });
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
  const exposureAllocationUpdate = useMutation({
    mutationFn: (input: ExposureAllocationUpdateInput) =>
      updateExposureAllocationFn({ data: input }),
    onSuccess: async () => {
      invalidate();
      await qc.refetchQueries({ queryKey: ["exposure-allocations", projectId] });
      toast.success("Risk allocation updated");
    },
    onError: (err) => {
      toast.error("Allocation did not update", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  const exposureAllocationRemove = useMutation({
    mutationFn: (input: ExposureAllocationDeleteInput) =>
      deleteExposureAllocationFn({ data: input }),
    onSuccess: async () => {
      invalidate();
      await qc.refetchQueries({ queryKey: ["exposure-allocations", projectId] });
      toast.success("Allocation removed");
    },
    onError: (err) => {
      toast.error("Allocation did not remove", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });
  const budgetBuildOperationKeys = useRef(new Map<"unpriced" | "auto", string>());
  const budgetFromEstimate = useMutation({
    mutationFn: ({
      pricing,
      operationKey,
    }: {
      pricing: "unpriced" | "auto";
      operationKey: string;
    }) =>
      buildBudgetFromEstimateFn({
        data: { projectId, pricing, operation_key: operationKey },
      }),
    onSuccess: (result, variables) => {
      budgetBuildOperationKeys.current.delete(variables.pricing);
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
  const requestBudgetFromEstimate = (pricing: "unpriced" | "auto") => {
    const operationKey =
      budgetBuildOperationKeys.current.get(pricing) ??
      `estimate-budget:${pricing}:${crypto.randomUUID()}`;
    budgetBuildOperationKeys.current.set(pricing, operationKey);
    budgetFromEstimate.mutate({ pricing, operationKey });
  };
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
  // Change-order documents: bytes go straight to the private 'co-docs' bucket
  // (path <projectId>/<changeOrderId>/<file>, team storage RLS), then a row
  // records the path + name. View via a short-lived signed URL; remove drops both.
  const [uploadingCoDocId, setUploadingCoDocId] = useState<string | null>(null);
  const uploadCoDocument = async (
    changeOrderId: string,
    file: File,
    docType: CoDocType,
    note: string,
  ) => {
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const path = `${projectId}/${changeOrderId}/${crypto.randomUUID()}-${safeName}`;
    setUploadingCoDocId(changeOrderId);
    try {
      const { error } = await supabase.storage
        .from("co-docs")
        .upload(path, file, { contentType: file.type || "application/pdf", upsert: false });
      if (error) {
        toast.error("Upload failed", { description: error.message });
        return;
      }
      await addChangeOrderDocumentFn({
        data: { changeOrderId, projectId, path, name: file.name, doc_type: docType, note },
      });
      invalidate();
      toast.success("Document attached");
    } catch (err) {
      toast.error("Could not save the document", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setUploadingCoDocId(null);
    }
  };
  const viewCoDocument = async (path: string) => {
    const { data, error } = await supabase.storage.from("co-docs").createSignedUrl(path, 600);
    if (error || !data?.signedUrl) {
      toast.error("Could not open the document");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };
  const removeCoDocument = async (id: string, path: string) => {
    if (path) await supabase.storage.from("co-docs").remove([path]);
    try {
      await deleteChangeOrderDocumentFn({ data: { id } });
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
    mutationFn: (input: {
      id: string;
      patch: Record<string, unknown>;
      operation_key: string;
      note: string;
    }) => updateBucketFn({ data: input as never }),
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
  const bucketDelete = useServerMutation<{
    projectId: string;
    id: string;
    operation_key: string;
  }>(deleteBucketFn);
  // BUDGETCONSOLIDATE1: the single Budget table opens a line editor drawer.
  const reviewSubmit = useServerMutation<Record<string, unknown>>(submitReviewFn as never);
  const reviewUpdate = useServerMutation<Record<string, unknown>>(updateReviewFn as never);
  const reviewDelete = useServerMutation<{ id: string; projectId: string }>(deleteReviewFn);
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
        description: err instanceof Error ? err.message : "Try again in a moment.",
      });
    },
  });
  const billingCreate = useServerMutation<Record<string, unknown>>(createBillingFn as never);
  const billingUpdate = useServerMutation<Record<string, unknown>>(updateBillingFn as never);
  const billingDelete = useServerMutation<{ id: string; idempotency_key: string }>(deleteBillingFn);
  // Keep one key for an ambiguous failed response. Retrying the same user
  // intent must return the original database command instead of applying it a
  // second time.
  const billingCommandRetryKeys = useRef(new Map<string, string>());
  const billingCommandKey = (intent: string) => {
    const existing = billingCommandRetryKeys.current.get(intent);
    if (existing) return existing;
    const nonce =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const key = `billing-application:${intent}:${nonce}`;
    billingCommandRetryKeys.current.set(intent, key);
    return key;
  };
  const invoiceCommandRetryKeys = useRef(new Map<string, string>());
  // Query invalidation is asynchronous. Keep the version returned by the last
  // committed invoice command so a second intentional edit does not reuse the
  // pre-command timestamp while the project query is still refreshing.
  const invoiceCommittedVersions = useRef(new Map<string, string>());
  const invoiceCommandKey = (intent: string) => {
    const existing = invoiceCommandRetryKeys.current.get(intent);
    if (existing) return existing;
    const nonce =
      typeof globalThis.crypto?.randomUUID === "function"
        ? globalThis.crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const key = `invoice:${intent}:${nonce}`;
    invoiceCommandRetryKeys.current.set(intent, key);
    return key;
  };
  const invoiceCreate = useMutation({
    mutationFn: (input: { projectId: string; idempotency_key: string } & InvoiceDraft) =>
      createInvoiceFn({ data: input }),
    onSuccess: (_result, input) => {
      invalidate();
      toast.success("Invoice created", {
        description: `${billingDocumentLabel(input.invoice_number, input.title, "Invoice")} is now in the billing ledger.`,
      });
    },
    onError: (err) => {
      toast.error("Invoice did not save", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      });
    },
  });
  const invoiceUpdate = useServerMutation<Record<string, unknown>>(updateInvoiceFn as never);
  const invoiceDelete = useServerMutation<{ id: string; idempotency_key: string }>(deleteInvoiceFn);
  const paymentRecord = useServerMutation<Record<string, unknown>>(recordPaymentFn as never);
  const [reconcilingInvoiceId, setReconcilingInvoiceId] = useState<string | null>(null);
  const invoiceReconcile = useMutation({
    mutationFn: (invoiceId: string) => reconcileInvoiceFn({ data: { invoiceId } }),
    onMutate: (invoiceId) => setReconcilingInvoiceId(invoiceId),
    onSuccess: (result) => {
      invalidate();
      toast.success("Invoice reconciled from payments", {
        description: `Recalculated ${result.invoiceCount} invoice${result.invoiceCount === 1 ? "" : "s"}${result.applicationCount > 0 ? ` and ${result.applicationCount} linked pay application${result.applicationCount === 1 ? "" : "s"}` : ""} from the payment ledger.`,
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
  const certifiedSovBillingApply = useMutation({
    mutationFn: (input: { certificationId: string; billingApplicationId: string }) =>
      applyCertifiedSovPositionFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("PM-certified position applied", {
        description:
          "The matching SOV line and draft application totals were updated. The application remains unsubmitted.",
      });
    },
    onError: (err) => {
      toast.error("Certified position was not applied", {
        description: err instanceof Error ? err.message : "Review the PM handoff and try again.",
      });
    },
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
        description: err instanceof Error ? err.message : "Try again in a moment.",
      });
    },
  });
  const billingLineUpdate = useMutation({
    mutationFn: (input: {
      id: string;
      expected_updated_at: string;
      operation_key: string;
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
        expected_updated_at: string;
        patch: {
          work_completed_this_period?: number;
          materials_stored_this_period?: number;
          retainage_pct?: number;
          retainage_released?: number;
        };
      }[];
      operation_key: string;
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
  const costActualUpdate = useMutation({
    mutationFn: (input: Parameters<typeof updateCostActualFn>[0]["data"]) =>
      updateCostActualFn({ data: input }),
    onSuccess: () => {
      invalidate();
      toast.success("Cost updated");
    },
    onError: (err) => {
      toast.error("Draft cost did not save", {
        description: err instanceof Error ? err.message : "Check the entry and try again.",
      });
    },
  });
  // Walk an invoice through the payables lifecycle: approve the spend, then
  // mark it paid. Approving a draft is the moment it starts counting as cost.
  const costActualSetStatus = useMutation({
    mutationFn: (input: {
      id: string;
      status: "approved" | "paid";
      payment_method?: string;
      payment_reference?: string;
      paid_date?: string | null;
      operation_key: string;
    }) => setCostActualStatusFn({ data: input }),
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
    mutationFn: (input: { id: string; notes: string; operation_key: string }) =>
      voidCostActualFn({ data: input }),
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
  const navigate = useNavigate();
  const router = useRouter();
  const signOut = async () => {
    await supabase.auth.signOut();
    router.invalidate();
    navigate({ to: "/auth" });
  };

  if (isLoading) return <div className="p-10 text-muted-foreground">Loading…</div>;
  if (error || !data) {
    if (error) console.error("Project load failed:", error);
    return (
      <div className="p-10">
        <section
          role="alert"
          className="max-w-xl rounded-xl border border-danger/30 bg-danger/10 p-5 shadow-card"
        >
          <h2 className="font-serif text-xl text-foreground">This project didn't load</h2>
          <p className="mt-2 text-sm leading-relaxed text-danger">
            {friendlyErrorMessage(error, "We couldn't load this project. Try again.")}
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="signal"
              size="sm"
              disabled={projectFetching}
              onClick={() => void refetchProject()}
            >
              {projectFetching ? "Retrying…" : "Retry"}
            </Button>
            <Button asChild type="button" variant="outline" size="sm">
              <Link to="/">Back to portfolio</Link>
            </Button>
          </div>
        </section>
      </div>
    );
  }
  if (subcontractsQuery.isLoading) {
    return (
      <div className="p-10">
        <SubcontractFinancialReadState loading />
      </div>
    );
  }
  if (subcontractsQuery.isError || !subcontractsQuery.data) {
    return (
      <div className="p-10">
        <SubcontractFinancialReadState
          error={subcontractsQuery.error}
          retrying={subcontractsQuery.isFetching}
          onRetry={() => {
            void subcontractsQuery.refetch();
          }}
        />
      </div>
    );
  }
  const budgetFinancialQueries = [
    changeOrderAllocationsQuery,
    costActualsQuery,
    budgetOverridesQuery,
    // Risk-allocation dollars feed the ledger's At Risk / Contingency column;
    // a failed read must stop the budget rather than render those as $0.
    exposureAllocationsQuery,
  ];
  if (budgetFinancialQueries.some((query) => query.isLoading)) {
    return (
      <div className="p-10">
        <BudgetFinancialReadState loading />
      </div>
    );
  }
  const failedBudgetFinancialQuery = budgetFinancialQueries.find(
    (query) => query.isError || !query.data,
  );
  if (failedBudgetFinancialQuery) {
    return (
      <div className="p-10">
        <BudgetFinancialReadState
          error={failedBudgetFinancialQuery.error}
          retrying={budgetFinancialQueries.some((query) => query.isFetching)}
          onRetry={() => {
            void Promise.all(budgetFinancialQueries.map((query) => query.refetch()));
          }}
        />
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
    changeOrderDocuments = [],
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
  // Financial records are server-authoritative. Never merge browser-only pay
  // applications into the ledger: a missing or failed database write must stay
  // visibly failed instead of looking like a successful financial document.
  const visibleBillingApplications = sortBillingApplications([...billingApplications]);

  const lastReviewDays =
    hydrated && project.last_reviewed_at
      ? Math.floor((Date.now() - new Date(project.last_reviewed_at).getTime()) / 86400000)
      : null;

  const handleCreateChangeOrder = async (draft: ChangeOrderDraft): Promise<boolean> => {
    const intent = `create:${JSON.stringify(draft)}`;
    try {
      await coCreate.mutateAsync({
        projectId,
        ...draft,
        operationKey: changeOrderCommandKey(intent),
      });
      changeOrderRetryKeys.current.delete(intent);
      toast.success("Change order created", {
        description: "The contract and cost impact were committed together.",
      });
      return true;
    } catch (err) {
      toast.error("Change order did not save", {
        description: err instanceof Error ? err.message : "Refresh and try again.",
      });
      return false;
    }
  };

  const handleUpdateChangeOrder = async (
    id: string,
    patch: Partial<ChangeOrderDraft>,
    sourceUpdatedAt: string,
  ): Promise<boolean> => {
    const expectedUpdatedAt = changeOrderCommittedVersions.current.get(id) ?? sourceUpdatedAt;
    const intent = `update:${id}:${expectedUpdatedAt}:${JSON.stringify(
      Object.entries(patch).sort(([left], [right]) => left.localeCompare(right)),
    )}`;
    try {
      const result = await coUpdate.mutateAsync({
        id,
        projectId,
        expectedUpdatedAt,
        operationKey: changeOrderCommandKey(intent),
        ...patch,
      });
      if (result.updatedAt) changeOrderCommittedVersions.current.set(id, result.updatedAt);
      changeOrderRetryKeys.current.delete(intent);
      toast.success("Change order updated");
      return true;
    } catch (err) {
      if (err instanceof Error && /changed after you opened|refresh before/i.test(err.message)) {
        changeOrderCommittedVersions.current.delete(id);
        invalidate();
      }
      toast.error("Change order did not update", {
        description: err instanceof Error ? err.message : "Refresh and try again.",
      });
      return false;
    }
  };

  const handleDeleteChangeOrder = async (changeOrder: ChangeOrderRow): Promise<boolean> => {
    const expectedUpdatedAt =
      changeOrderCommittedVersions.current.get(changeOrder.id) ?? changeOrder.updated_at;
    const intent = `delete:${changeOrder.id}:${expectedUpdatedAt}`;
    try {
      await coDelete.mutateAsync({
        id: changeOrder.id,
        projectId,
        expectedUpdatedAt,
        operationKey: changeOrderCommandKey(intent),
      });
      changeOrderRetryKeys.current.delete(intent);
      changeOrderCommittedVersions.current.delete(changeOrder.id);
      toast.success("Pending change order deleted");
      return true;
    } catch (err) {
      if (err instanceof Error && /changed after you opened|refresh before/i.test(err.message)) {
        changeOrderCommittedVersions.current.delete(changeOrder.id);
        invalidate();
      }
      toast.error("Change order did not delete", {
        description: err instanceof Error ? err.message : "Refresh and try again.",
      });
      return false;
    }
  };

  const handleChangeOrderStatus = (changeOrder: ChangeOrderRow, status: "Approved" | "Denied") =>
    handleUpdateChangeOrder(changeOrder.id, { status }, changeOrder.updated_at);

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
              changeOrderCommittedVersions.current.delete(co.id);
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
    const draft: ChangeOrderDraft = {
      number: "",
      description: exposure.title,
      contract_amount: exposure.dollar_exposure,
      cost_amount: 0,
      financial_direction: "addition",
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
      pricing_method: "lump_sum",
      schedule_impact_days: 0,
      requested_by: exposure.owner || "PM",
      date_initiated: null,
    };
    const intent = `risk:${exposure.id}`;
    coCreate
      .mutateAsync({
        projectId,
        ...draft,
        operationKey: changeOrderCommandKey(intent),
      })
      .then(async (data) => {
        changeOrderRetryKeys.current.delete(intent);
        const changeOrderId = data.id;
        if (changeOrderId) {
          try {
            await linkCoExposureFn({ data: { changeOrderId, exposureId: exposure.id } });
            changeOrderCommittedVersions.current.delete(changeOrderId);
            invalidate();
          } catch {
            // Best-effort link; the pending CO still stands if the link
            // column is a migration behind.
          }
        }
        toast.success("Risk tagged as a change order", {
          description: "It's now a pending CO — open the Change Orders tab to price it.",
        });
      })
      .catch((err: unknown) => {
        toast.error("Change order was not created", {
          description: err instanceof Error ? err.message : "Try again.",
        });
      });
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
    const draft: ChangeOrderDraft = {
      number: "",
      description: `${claim.claim_number ? `${claim.claim_number} - ` : ""}${claim.title}`,
      contract_amount: amount,
      cost_amount: 0,
      financial_direction: "addition",
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
      pricing_method: "lump_sum",
      schedule_impact_days: 0,
      requested_by: claim.owner || "PM",
      date_initiated: null,
    };
    const intent = `claim:${claim.id}`;
    coCreate
      .mutateAsync({
        projectId,
        ...draft,
        operationKey: changeOrderCommandKey(intent),
      })
      .then(async (data) => {
        changeOrderRetryKeys.current.delete(intent);
        const changeOrderId = data.id;
        if (changeOrderId) {
          try {
            await linkClaimChangeOrderFn({ data: { claimId: claim.id, changeOrderId } });
            changeOrderCommittedVersions.current.delete(changeOrderId);
            invalidate();
          } catch {
            // best-effort link
          }
        }
        toast.success("Claim promoted to a change order", {
          description: "It's now a pending CO — open the Change Orders tab to price it.",
        });
      })
      .catch((err: unknown) => {
        toast.error("Change order was not created", {
          description: err instanceof Error ? err.message : "Try again.",
        });
      });
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

  const handleCreatePayApp = async (input: BillingDraft, idempotencyKey: string) => {
    try {
      await billingCreate.mutateAsync({
        projectId,
        ...input,
        idempotency_key: idempotencyKey,
      });
      toast.success("Application created", {
        description: `${billingDocumentLabel(input.application_number, input.invoice_number, "Application")} is now in the billing workspace.`,
      });
    } catch (err) {
      toast.error("Application did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      });
      throw err;
    }
  };

  const handleUpdatePayApp = async (
    id: string,
    patch: Partial<BillingApplicationRow>,
  ): Promise<boolean> => {
    const intent = `update:${id}:${JSON.stringify(
      Object.entries(patch).sort(([left], [right]) => left.localeCompare(right)),
    )}`;
    try {
      await billingUpdate.mutateAsync({
        id,
        patch,
        idempotency_key: billingCommandKey(intent),
      });
      billingCommandRetryKeys.current.delete(intent);
      return true;
    } catch (err) {
      // Preserve the retry key after an ambiguous failure. The editor also
      // keeps its local draft uncommitted, so focusing and blurring the same
      // value safely retries the exact same database command.
      toast.error("Application did not update", {
        description: err instanceof Error ? err.message : "Try again.",
      });
      return false;
    }
  };

  const handleDeletePayApp = (id: string) => {
    const intent = `delete:${id}`;
    billingDelete.mutate(
      { id, idempotency_key: billingCommandKey(intent) },
      {
        onSuccess: () => {
          billingCommandRetryKeys.current.delete(intent);
        },
        onError: (err) => {
          toast.error("Application did not delete", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
      },
    );
  };

  const handleCreateInvoice = async (input: InvoiceDraft) => {
    const intent = `create:${JSON.stringify(input)}`;
    await invoiceCreate.mutateAsync({
      projectId,
      ...input,
      idempotency_key: invoiceCommandKey(intent),
    });
    invoiceCommandRetryKeys.current.delete(intent);
  };

  const handleUpdateInvoice = async (
    id: string,
    patch: Partial<BillingInvoiceRow>,
    options: { expectedUpdatedAt: string; idempotencyKey?: string; reason?: string },
  ): Promise<boolean> => {
    const expectedUpdatedAt = invoiceCommittedVersions.current.get(id) ?? options.expectedUpdatedAt;
    const intent = `update:${id}:${expectedUpdatedAt}:${JSON.stringify(
      Object.entries(patch).sort(([left], [right]) => left.localeCompare(right)),
    )}`;
    const idempotencyKey = options.idempotencyKey ?? invoiceCommandKey(intent);
    try {
      const result = await invoiceUpdate.mutateAsync({
        id,
        patch,
        expected_updated_at: expectedUpdatedAt,
        idempotency_key: idempotencyKey,
        reason: options.reason,
      });
      const updatedAt =
        result &&
        typeof result === "object" &&
        "updatedAt" in result &&
        typeof result.updatedAt === "string"
          ? result.updatedAt
          : null;
      if (updatedAt) invoiceCommittedVersions.current.set(id, updatedAt);
      if (!options.idempotencyKey) invoiceCommandRetryKeys.current.delete(intent);
      return true;
    } catch (err) {
      // A genuine stale-write error means another actor won. Drop our local
      // version and refresh; an ambiguous transport failure keeps the version
      // and retry key so the same database command can be replayed safely.
      if (err instanceof Error && /changed after you opened|refresh before/i.test(err.message)) {
        invoiceCommittedVersions.current.delete(id);
        invalidate();
      }
      toast.error("Invoice did not update", {
        description: err instanceof Error ? err.message : "Refresh and try again.",
      });
      return false;
    }
  };

  const handleDeleteInvoice = (id: string) => {
    const intent = `delete:${id}`;
    invoiceDelete.mutate(
      { id, idempotency_key: invoiceCommandKey(intent) },
      {
        onSuccess: () => {
          invoiceCommandRetryKeys.current.delete(intent);
          toast.success("Invoice draft deleted");
        },
        onError: (err) => {
          toast.error("Invoice did not delete", {
            description: err instanceof Error ? err.message : "Try again.",
          });
        },
      },
    );
  };

  const handleRecordPayment = async (input: PaymentDraft) => {
    try {
      await paymentRecord.mutateAsync(input);
      toast.success("Payment recorded", {
        description: "Invoice, payment ledger, and linked application were refreshed.",
      });
    } catch (err) {
      toast.error("Payment did not save", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      });
      throw err;
    }
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
    {
      value: "dashboard",
      label: "Current IOR",
      detail: "GP recovery",
      icon: LayoutDashboard,
    },
    {
      value: "schedule",
      label: "Schedule",
      detail: `${project.schedule_variance_weeks > 0 ? `+${project.schedule_variance_weeks} wk` : "On plan"}`,
      icon: CalendarClock,
      alert: project.schedule_variance_weeks > 0,
    },
    {
      value: "selections",
      label: "Selections and Material Procurement",
      detail: "Approval-gated release",
      icon: PackageCheck,
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
      label: "Recovery Plan",
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
      detail: "Approvals & access",
      icon: Users,
    },
    {
      value: "ior-report",
      label: "Reviews & Reports",
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
      value: "tomorrow-plan",
      label: "Tomorrow Plan",
      detail: "Ready the work",
      icon: CalendarCheck2,
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
  // group + label (e.g. "Commercial · Billing").
  const activeNavGroup = PROJECT_NAV_GROUPS.find((group) =>
    group.values.includes(activeProjectTab),
  );
  const activeNavItem = navItemByValue.get(activeProjectTab);
  // A collapsed group shows one status hint on the right. If any item in the
  // group is alarming (live risk, slipped schedule), that item's detail wins in
  // danger tone. All hints read existing nav data — no new query.
  const navGroupHint = (
    group: ProjectNavGroup,
  ): { text: string; tone: "good" | "crit" | "muted" } => {
    const items = group.values
      .map((v) => navItemByValue.get(v))
      .filter((i): i is ProjectNavItem => Boolean(i));
    // Any alarming item (behind schedule, live risk) wins in crit + bold.
    const alerting = items.find((i) => i.alert);
    if (alerting) return { text: alerting.detail, tone: "crit" };
    switch (group.key) {
      case "plan-procurement":
        // Schedule-health rule: on-plan / ahead reads good (green); a behind
        // schedule would have alerted above.
        return { text: navItemByValue.get("schedule")?.detail ?? "", tone: "good" };
      case "ior":
        // No live exposures (else it would have alerted) — a calm count.
        return { text: navItemByValue.get("risk-tally")?.detail ?? "", tone: "muted" };
      default:
        return { text: navItemByValue.get(group.values[0])?.detail ?? "", tone: "muted" };
    }
  };
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
  // v2: the old header's stat strip (Job #, Client, PM, contracts) now renders
  // inside ProjectDashboard's bottom row, bound to the same fields — with the
  // contract stat relabeled "Contract incl. approved COs" per the data-integrity
  // rule (no ambiguous money labels).

  return (
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-wash text-foreground">
      {/* v2 shell: on mobile a slim top bar carries back-link, company, project
          switcher, and sign-out; on lg+ all of that lives in the floating rail. */}
      <header className="flex items-center gap-2 border-b border-hairline bg-wash px-4 py-2 lg:hidden">
        <Link
          to="/"
          aria-label="Back to portfolio"
          className="inline-flex h-8 shrink-0 items-center rounded-md px-1 text-sm text-muted-foreground transition hover:text-foreground"
        >
          ←
        </Link>
        {companyLogoUrl ? (
          <img
            src={companyLogoUrl}
            alt={`${companyName} logo`}
            className="h-6 w-6 shrink-0 rounded-sm object-contain"
            onError={() => setCompanyLogoFailedUrl(companyLogoUrl)}
          />
        ) : (
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm bg-secondary text-[10px] font-semibold text-muted-foreground">
            {companyInitials}
          </div>
        )}
        <Select
          value={projectId}
          onValueChange={(v) => navigate({ to: "/projects/$projectId", params: { projectId: v } })}
        >
          <SelectTrigger className="h-8 min-w-0 flex-1 text-sm">
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
        <Button
          variant="ghost"
          size="sm"
          onClick={signOut}
          aria-label="Sign out"
          className="shrink-0 gap-1.5"
        >
          <LogOut className="h-3.5 w-3.5" />
        </Button>
      </header>

      <main className="mx-auto w-full min-w-0 max-w-[1640px] flex-1 px-4 py-6 sm:px-6 lg:px-8">
        <Tabs
          value={activeProjectTab}
          onValueChange={setProjectTab}
          className="grid min-w-0 gap-6 lg:grid-cols-[248px_minmax(0,1fr)] lg:items-start"
        >
          <aside className="min-w-0 lg:sticky lg:top-6">
            <TabsList className={PROJECT_NAV_RAIL_CLASS}>
              {/* v2: the rail leads with tenant identity — company mark + the
                  project switcher (same Select, slimmed to a text control). */}
              <div className="mb-1 hidden w-full border-b border-hairline pb-3 lg:block">
                <div className="flex items-center gap-2.5 px-1.5">
                  {companyLogoUrl ? (
                    <img
                      src={companyLogoUrl}
                      alt={`${companyName} logo`}
                      className="h-7 w-7 shrink-0 rounded-lg object-contain"
                      onError={() => setCompanyLogoFailedUrl(companyLogoUrl)}
                    />
                  ) : (
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary font-serif text-[13px] text-primary-foreground">
                      {companyInitials}
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13.5px] font-semibold leading-tight">
                      {companyName}
                    </div>
                    <Select
                      value={projectId}
                      onValueChange={(v) =>
                        navigate({ to: "/projects/$projectId", params: { projectId: v } })
                      }
                    >
                      <SelectTrigger
                        aria-label="Switch project"
                        className="h-auto w-full justify-start gap-1 border-0 bg-transparent p-0 text-[11.5px] text-muted-foreground shadow-none focus:ring-0 [&>svg]:h-3 [&>svg]:w-3"
                      >
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
                </div>
                <Link
                  to="/"
                  className="mt-3 flex w-full cursor-pointer items-center gap-2 rounded-lg px-1.5 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Portfolio
                </Link>
              </div>
              {/* Multi-expand rail: each group toggles independently. Navigating
                  to a destination opens its group without closing any section
                  the user already opened. Deep links (?tab=…) and every tab
                  value remain unchanged. */}
              {/* Portfolio-level cross-links stay available inside a project so
                  users never have to back out just to reach CRM or Estimating. */}
              <button
                type="button"
                onClick={() => navigate({ to: "/", search: { tab: "crm" } })}
                aria-label="CRM: Relationships"
                title="CRM: Relationships"
                className="flex w-auto shrink-0 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full lg:shrink"
              >
                <span className="font-medium">CRM</span>
                <span className="text-[11.5px] text-muted-foreground">▸</span>
              </button>
              <button
                type="button"
                onClick={() => navigate({ to: "/estimates" })}
                aria-label="Estimating: Estimates and Plan Room"
                title="Estimating: Estimates and Plan Room"
                className="flex w-auto shrink-0 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full lg:shrink"
              >
                <span className="font-medium">Estimating</span>
                <span className="text-[11.5px] text-muted-foreground">▸</span>
              </button>
              {PROJECT_NAV_GROUPS.map((group) => {
                const isActiveGroup = group.key === activeNavGroup?.key;
                const isExpanded = expandedNavGroupKeys.has(group.key);
                const hint = navGroupHint(group);
                const groupContentId = `project-nav-group-${group.key}`;
                if (isExpanded) {
                  return (
                    <div
                      key={group.key}
                      className="w-[240px] shrink-0 rounded-xl border border-hairline bg-surface p-1.5 lg:w-full lg:shrink"
                    >
                      <button
                        type="button"
                        onClick={() => toggleNavGroup(group.key)}
                        aria-expanded="true"
                        aria-controls={groupContentId}
                        className={cn(
                          "flex w-full cursor-pointer items-center justify-between rounded-lg px-2 pb-1.5 pt-1 text-left text-[13.5px] font-semibold transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          isActiveGroup ? "text-foreground" : "text-muted-foreground",
                        )}
                      >
                        {group.label}
                        <ChevronDown
                          aria-hidden="true"
                          className="h-5 w-5 shrink-0 text-muted-foreground"
                        />
                      </button>
                      <div id={groupContentId}>
                        {group.values.map((value) => {
                          const item = navItemByValue.get(value);
                          if (!item) return null;
                          const isActive = activeProjectTab === item.value;
                          return (
                            <TabsTrigger
                              key={item.value}
                              value={item.value}
                              aria-label={`${item.label}: ${item.detail}`}
                              title={`${item.label}: ${item.detail}`}
                              className={cn(
                                "flex w-full cursor-pointer items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13.5px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                                "text-muted-foreground hover:bg-secondary hover:text-foreground hover:shadow-sm",
                                "data-[state=active]:bg-secondary data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:hover:bg-secondary",
                              )}
                            >
                              <span className="min-w-0 flex-1 truncate">{item.label}</span>
                              {isActive ? (
                                <span
                                  aria-hidden="true"
                                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-clay"
                                />
                              ) : (
                                <span
                                  className={cn(
                                    "max-w-[52%] shrink-0 truncate text-[11.5px]",
                                    item.alert ? "text-danger" : "text-muted-foreground",
                                  )}
                                >
                                  {item.detail}
                                </span>
                              )}
                            </TabsTrigger>
                          );
                        })}
                      </div>
                    </div>
                  );
                }
                return (
                  <button
                    key={group.key}
                    type="button"
                    onClick={() => toggleNavGroup(group.key)}
                    aria-expanded="false"
                    aria-controls={groupContentId}
                    aria-label={`${group.label}: ${hint.text}`}
                    title={`${group.label}: ${hint.text}`}
                    className={cn(
                      "flex w-auto shrink-0 cursor-pointer items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-secondary hover:text-foreground hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full lg:shrink",
                      isActiveGroup ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    <span className="font-medium">{group.label}</span>
                    <span className="flex min-w-0 shrink items-center gap-1.5">
                      {hint.text && (
                        <span
                          className={cn(
                            "truncate text-[11.5px]",
                            hint.tone === "crit"
                              ? "font-semibold text-danger"
                              : hint.tone === "good"
                                ? "font-semibold text-success"
                                : "text-muted-foreground",
                          )}
                        >
                          {hint.text}
                        </span>
                      )}
                      <ChevronRight
                        aria-hidden="true"
                        className="h-5 w-5 shrink-0 text-muted-foreground"
                      />
                    </span>
                  </button>
                );
              })}
              {/* Sign-out stays anchored at the bottom; Portfolio now lives
                  beneath the project switcher so it is always discoverable. */}
              <div className="mt-auto hidden w-full items-center justify-end border-t border-hairline pt-2.5 lg:flex">
                <button
                  type="button"
                  onClick={signOut}
                  className="rounded px-1.5 text-xs text-muted-foreground transition hover:text-foreground"
                >
                  Sign out
                </button>
              </div>
            </TabsList>
          </aside>

          <div className="min-w-0">
            {/* v2 context strip: where-am-I + IOR badges left, the project's
                standing actions right. Replaces the old full-width header —
                every action and badge from it lives on, nothing dropped. */}
            {activeNavGroup && activeNavItem && (
              <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-hairline pb-3">
                <p className="eyebrow leading-none">
                  {activeNavGroup.label} · {activeNavItem.label}
                </p>
                <span className="rounded-md border border-hairline px-1.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-clay">
                  IOR
                </span>
                <span className="text-xs text-muted-foreground">
                  {project.phase} Phase · {project.percent_complete}% complete
                </span>
                {lastReviewDays !== null && (
                  <span
                    className={cn(
                      "text-xs",
                      lastReviewDays > 30 ? "text-danger" : "text-muted-foreground",
                    )}
                  >
                    Reviewed {lastReviewDays}d ago
                  </span>
                )}
                {project.source_opportunity_id && (
                  <a
                    href={`/?tab=crm&opportunity=${project.source_opportunity_id}`}
                    className="inline-flex w-fit shrink-0 items-center gap-1 text-xs font-semibold text-clay transition hover:text-foreground"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Source: CRM
                  </a>
                )}
                <div className="ml-auto flex flex-wrap items-center gap-2">
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
                    onSave={(attempt) =>
                      finUpdate.mutateAsync({
                        projectId,
                        ...attempt,
                      })
                    }
                    pending={finUpdate.isPending}
                  />
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm" aria-label="More project actions">
                        ···
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      {project.closed_at ? (
                        <DropdownMenuItem
                          disabled={reopenMutation.isPending}
                          onSelect={() => reopenMutation.mutate()}
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {reopenMutation.isPending ? "Reopening…" : "Reopen job"}
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem onSelect={() => setConfirmAction("close")}>
                          <CheckCircle2 className="h-3.5 w-3.5" /> Close project
                        </DropdownMenuItem>
                      )}
                      <DropdownMenuItem onSelect={() => setConfirmAction("archive")}>
                        <Archive className="h-3.5 w-3.5" /> Archive
                      </DropdownMenuItem>
                      {isDemoProject ? (
                        <DropdownMenuItem
                          className="text-danger focus:text-danger"
                          onSelect={() => setConfirmAction("delete")}
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Hide training project
                        </DropdownMenuItem>
                      ) : null}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
            )}
            <AlertDialog
              open={confirmAction === "close"}
              onOpenChange={(o) => {
                if (!o) setConfirmAction(null);
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Close “{project.name}” out?</AlertDialogTitle>
                  <AlertDialogDescription>
                    Marks the job complete. It moves to Closed jobs on the home and drops out of the
                    active portfolio and its numbers. Nothing is deleted — you can reopen it
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
            <AlertDialog
              open={confirmAction === "archive"}
              onOpenChange={(o) => {
                if (!o) setConfirmAction(null);
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Archive this project?</AlertDialogTitle>
                  <AlertDialogDescription>
                    “{project.name}” will be hidden from the portfolio. Its data — SOV, exposures,
                    change orders, billing, and reports — stays in the database and can be restored
                    later. No records are deleted.
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
            <AlertDialog
              open={confirmAction === "delete"}
              onOpenChange={(o) => {
                if (!o) setConfirmAction(null);
              }}
            >
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Hide the training project?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This archives Harbor Residence for your whole company while preserving its
                    financial history. It won’t come back on its own; an admin can restore it later.
                  </AlertDialogDescription>
                </AlertDialogHeader>
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
                    {deleteMutation.isPending ? "Hiding…" : "Hide training project"}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
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
                onReviewChangeOrders={() => setProjectTab("change-orders")}
                onAddReserve={() => setProjectTab("risk-tally")}
                onOpenSchedule={() => setProjectTab("schedule")}
              />
            </TabsContent>

            <TabsContent value="schedule" className="mt-0">
              <WorkspaceHeader
                title="Schedule"
                subtitle="Completion forecast, interim milestones, critical path movement, and schedule-linked risk."
              />
              <ScheduleRisk project={project} lastReviewForecast={lastReviewForecast} />
            </TabsContent>

            <TabsContent value="selections" className="mt-0">
              <Suspense
                fallback={
                  <div className="h-48 animate-pulse rounded-xl border border-hairline bg-card" />
                }
              >
                <SelectionsWorkspace projectId={projectId} />
              </Suspense>
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
              <DailyReportsWorkspace
                projectId={projectId}
                project={project}
                buckets={buckets}
                onOpenWipDay={(date) => {
                  // Handoff rule: a report's Work-put-in-place deep-links to
                  // that specific day in Daily WIP (same pattern as the SOV tab).
                  setFocusedWipDate(date);
                  setProjectTab("daily-wip");
                }}
              />
            </TabsContent>

            <TabsContent value="tomorrow-plan" className="mt-0">
              <TomorrowPlanWorkspace
                projectId={projectId}
                buckets={buckets}
                scheduleActivities={scheduleData?.activities ?? []}
                subcontracts={subcontractsQuery.data?.subcontracts ?? []}
                allocations={subcontractsQuery.data?.allocations ?? []}
                actualEntries={dailyWipEntriesQuery.data ?? []}
                initialDate={
                  isHarborDemoProject(project as unknown as Record<string, unknown>)
                    ? HARBOR_DEMO_TOMORROW_PLAN_DATE
                    : undefined
                }
              />
            </TabsContent>

            <TabsContent value="daily-wip" className="mt-0">
              <DailyWipWorkspace
                projectId={projectId}
                buckets={wipProfitBuckets}
                initialMode={search.wipView ?? "daily"}
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
                costActuals={billingWorkspaceQuery.data?.costActuals ?? []}
                subcontractPayments={subcontractsQuery.data?.payments ?? []}
                subcontractChangeOrders={subcontractsQuery.data?.change_orders ?? []}
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
                  onAllocate={(input) => exposureAllocate.mutateAsync(input).then(() => undefined)}
                  onUpdateAllocation={(input) =>
                    exposureAllocationUpdate.mutateAsync(input).then(() => undefined)
                  }
                  onRemoveAllocation={(input) =>
                    exposureAllocationRemove.mutateAsync(input).then(() => undefined)
                  }
                  saving={
                    exposureAllocate.isPending ||
                    exposureAllocationUpdate.isPending ||
                    exposureAllocationRemove.isPending
                  }
                />
              </div>
            </TabsContent>

            <TabsContent value="claims" className="mt-0 space-y-6">
              {/* v2: ClaimsWorkspace carries its own chip + verdict header. */}
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
              {/* v2: DecisionsTable carries its own chip + verdict header. */}
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
              {/* v2: one title row — serif "Budget" + count sub, all three intake
                  actions on the right (was: import in the card, build in a
                  divider row, add-line inside the table). */}
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <WorkspaceHeader
                  title="Budget"
                  subtitle={`${buckets.length} cost code${buckets.length === 1 ? "" : "s"} · you bill from the SOV in Billing`}
                  compact
                />
                <div className="flex flex-wrap items-center gap-2">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={budgetFromEstimate.isPending}
                      >
                        <FileSpreadsheet className="h-3.5 w-3.5" />
                        Build from estimate
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
                          onClick={() => requestBudgetFromEstimate("auto")}
                        >
                          Auto-price from the estimate
                          <span className="ml-1 text-xs opacity-80">
                            (proposes each line's contract from your markup — editable)
                          </span>
                        </AlertDialogAction>
                        <AlertDialogAction
                          className="w-full bg-surface text-foreground hover:bg-surface/80"
                          onClick={() => requestBudgetFromEstimate("unpriced")}
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
                  <ImportSOVSheet
                    existingBuckets={buckets}
                    mappingProfiles={sovMappingProfiles ?? []}
                    onSaveProfile={(profile) =>
                      sovProfileSave.mutateAsync(profile).then(() => undefined)
                    }
                    savingProfile={sovProfileSave.isPending}
                    onImport={async (rows, mode, metadata, operationKey) => {
                      try {
                        const result = await bucketImport.mutateAsync({
                          projectId,
                          rows,
                          mode,
                          metadata,
                          operation_key: operationKey,
                        });
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
                            ? Number((result as { originalCostBudget: number }).originalCostBudget)
                            : rows.reduce((total, row) => total + row.actual_to_date + row.ftc, 0);
                        toast.success("Budget imported", {
                          description: `${imported} created, ${updated} updated. Original cost budget is now ${fmtUSD(budget)}.`,
                        });
                      } catch (err) {
                        toast.error("Budget import did not save", {
                          description: err instanceof Error ? err.message : "Try again.",
                        });
                        throw err;
                      }
                    }}
                    pending={bucketImport.isPending}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={() => {
                      setEditingBucketId(null);
                      setAddingLine(true);
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add line
                  </Button>
                </div>
              </div>
              {/* v2: the old metric-tile grid folds away — Working budget /
                  Projected cost / Position / Margin live in the ledger's dark
                  stat bar; buckets count is in the subtitle; CO exposure + sub
                  totals move to the meta strip below the ledger; actual/FTC are
                  the ledger's own column totals. Nothing is dropped. */}
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
              <p className="text-xs text-muted-foreground">
                Open is remaining committed or forecasted cost. Recognized direct costs relieve it
                automatically. Click any cost-code row to review the calculation or add a PM
                forecast adjustment beyond the automatic subcontract balance.
              </p>
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
                  showStatBar
                  lockedAt={project.budget_locked_at}
                  // The TRUE open-holds figures (sum of remaining exposure for
                  // E-Hold/Both, and the contingency hold) — the same numbers the
                  // dashboard E-Hold line and the portfolio open-holds tile show.
                  // The ledger's own atRisk only sums holds ALLOCATED to a code,
                  // dropping the un-allocated remainder; the bar shows the full
                  // figure so all three surfaces agree.
                  openHoldsAtRisk={rollup.exposureHolds}
                  openHoldsContingency={rollup.contingencyHold}
                />
              </div>
              {/* v2 meta strip: the quiet ledger facts — sub commitments, the
                  CO cost that is NOT in the locked budget, and the import
                  provenance (full audit card one click away). */}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                {subCostTotals.committed > 0 || subCostTotals.paid > 0 ? (
                  <span>
                    Subs: committed{" "}
                    <b className="font-semibold text-foreground">
                      {fmtUSD(subCostTotals.committed)}
                    </b>{" "}
                    · paid{" "}
                    <b className="font-semibold text-foreground">{fmtUSD(subCostTotals.paid)}</b>
                  </span>
                ) : null}
                <span>
                  Pending CO cost (not in budget):{" "}
                  <b className="font-semibold text-foreground">
                    {fmtUSD(rollup.weightedPendingCOCost)}
                  </b>
                </span>
              </div>
              <details className="rounded-md border border-hairline bg-surface px-4 py-2.5">
                <summary className="cursor-pointer text-xs text-muted-foreground transition hover:text-foreground">
                  {sovImports && sovImports.length > 0
                    ? `Import: ${sovImports[0].source_name ?? "budget import"} · ${new Date(
                        sovImports[0].created_at,
                      ).toLocaleDateString("en-US", {
                        month: "short",
                        day: "numeric",
                      })} — Import details →`
                    : "No budget imports yet — import history appears here."}
                </summary>
                <div className="pt-3">
                  <SovImportHistory imports={sovImports ?? []} />
                </div>
              </details>
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
                invoices={drawerInvoices}
                onOpenBilling={() => {
                  setEditingBucketId(null);
                  setAddingLine(false);
                  // Deep-link straight to the Costs ledger (not the default pay-app
                  // stage), where the invoices/recorded costs that make up this
                  // line's actual live. Set before the tab switch so the freshly
                  // mounted workspace reads it.
                  setBillingFocusStage("project-costs");
                  setProjectTab("billing");
                }}
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
                onSave={(id, patch, operationKey, note) =>
                  bucketUpdate.mutateAsync({
                    id,
                    patch,
                    operation_key: operationKey,
                    note,
                  })
                }
                onCreate={(input, operationKey) =>
                  bucketCreate.mutateAsync({
                    projectId,
                    ...input,
                    operation_key: operationKey,
                  })
                }
                onDelete={(id, operationKey) =>
                  bucketDelete.mutateAsync({ projectId, id, operation_key: operationKey })
                }
                saving={bucketUpdate.isPending || bucketCreate.isPending || bucketDelete.isPending}
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
                  focusStage={billingFocusStage}
                  changeOrders={changeOrders}
                  exposures={exposures}
                  buckets={buckets}
                  subCostByBucket={subCostByBucket}
                  selfPerformByBucket={selfPerformByBucket}
                  billingApplications={visibleBillingApplications}
                  billingInvoices={billingInvoices ?? []}
                  billingWorkspace={billingWorkspaceQuery.data}
                  billingWorkspaceLoading={billingWorkspaceQuery.isLoading}
                  billingWorkspaceError={
                    billingWorkspaceQuery.error instanceof Error
                      ? billingWorkspaceQuery.error.message
                      : billingWorkspaceQuery.error
                        ? "Billing detail did not load."
                        : null
                  }
                  onRetryBillingWorkspace={() => void billingWorkspaceQuery.refetch()}
                  savingPayApp={billingCreate.isPending}
                  savingInvoice={invoiceCreate.isPending}
                  savingPayment={paymentRecord.isPending}
                  savingBillingLine={billingLineGenerate.isPending || billingLineUpdate.isPending}
                  savingRetainageRate={billingRetainageRateUpdate.isPending}
                  savingCostActual={
                    costActualCreate.isPending ||
                    costActualUpdate.isPending ||
                    costActualImport.isPending ||
                    costActualVoid.isPending ||
                    costActualSetStatus.isPending
                  }
                  savingBucketBilling={bucketBillingUpdate.isPending}
                  applyingCertifiedSovPosition={certifiedSovBillingApply.isPending}
                  onCreate={handleCreatePayApp}
                  onUpdate={handleUpdatePayApp}
                  onDelete={handleDeletePayApp}
                  onGenerateBillingLines={(billingApplicationId) =>
                    billingLineGenerate.mutate({ projectId, billingApplicationId })
                  }
                  onUpdateBillingLine={(id, patch, expected_updated_at, operation_key) =>
                    billingLineUpdate.mutate({ id, patch, expected_updated_at, operation_key })
                  }
                  onSaveAllBillingLines={(items, operation_key) =>
                    billingLinesUpdateAll.mutate({ items, operation_key })
                  }
                  savingAllBillingLines={billingLinesUpdateAll.isPending}
                  onUpdatePayAppRetainageRate={(billingApplicationId, retainage_pct) =>
                    billingRetainageRateUpdate.mutate({ billingApplicationId, retainage_pct })
                  }
                  onUpdateOutputFormat={(billingApplicationId, output_format) =>
                    handleUpdatePayApp(billingApplicationId, { output_format })
                  }
                  savingOutputFormat={billingUpdate.isPending}
                  onCreateCostActual={(input) =>
                    costActualCreate.mutateAsync({
                      projectId,
                      ...input,
                    })
                  }
                  onImportCostActuals={(input) =>
                    costActualImport.mutateAsync({ projectId, ...input })
                  }
                  onVoidCostActual={(id, notes, operationKey) =>
                    costActualVoid.mutateAsync({ id, notes, operation_key: operationKey })
                  }
                  onUpdateCostActual={(id, input) => {
                    const { status: _status, ...fields } = input;
                    return costActualUpdate.mutateAsync({ id, ...fields });
                  }}
                  onSetCostActualStatus={(id, status, payment) =>
                    costActualSetStatus.mutateAsync({
                      id,
                      status,
                      operation_key: payment?.operation_key ?? `cost:transition:${id}:${status}`,
                      ...(payment ?? {}),
                    })
                  }
                  onUpdateBucketBillingSettings={(id, patch) =>
                    bucketBillingUpdate.mutate({ id, patch })
                  }
                  onApplyCertifiedSovPosition={(certificationId, billingApplicationId) =>
                    certifiedSovBillingApply.mutate({ certificationId, billingApplicationId })
                  }
                  onCreateInvoice={handleCreateInvoice}
                  onUpdateInvoice={handleUpdateInvoice}
                  onDeleteInvoice={handleDeleteInvoice}
                  onRecordPayment={handleRecordPayment}
                  onReconcileInvoice={(invoiceId) => invoiceReconcile.mutate(invoiceId)}
                  reconcilingInvoiceId={reconcilingInvoiceId}
                  onAllocateChangeOrder={(input) =>
                    changeOrderAllocate.mutateAsync(input).then(() => undefined)
                  }
                  onRemoveChangeOrderAllocation={(id) => changeOrderAllocationRemove.mutate({ id })}
                  savingAllocation={
                    changeOrderAllocate.isPending || changeOrderAllocationRemove.isPending
                  }
                />
              </Suspense>
            </TabsContent>

            <TabsContent value="ior-report" className="mt-0 space-y-6">
              {/* v2 verdict hero: mono chip → serif statement → tiles (mock
                  order; "Indicated GP %" folds into the Indicated GP sub). */}
              <div className="flex flex-wrap items-start justify-between gap-3">
                <span className="rounded-md border border-hairline px-2 py-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-clay">
                  Report cycles
                </span>
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
              <div>
                <h2 className="max-w-[26ch] font-serif text-3xl font-normal leading-tight">
                  Lock the narrative each cycle — and keep the record.
                </h2>
                <p className="mt-2 max-w-[64ch] text-sm text-muted-foreground">
                  Each saved report freezes the forecast, the risk posture, and your narrative for
                  that review — the running record the job gets judged against.
                </p>
              </div>
              <div className="grid gap-3 md:grid-cols-4">
                <SovMetric label="Saved reports" value={String(reviews.length)} />
                <SovMetric
                  label="Indicated GP"
                  value={`${fmtUSD(rollup.indicatedGP)} · ${fmtPct(rollup.indicatedGPpct)}`}
                />
                <SovMetric label="GP at risk" value={fmtUSD(rollup.gpAtRisk)} />
                <SovMetric
                  label="Last reviewed"
                  value={lastReviewDays !== null ? `${lastReviewDays}d ago` : "—"}
                />
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
                  onDelete={(review) => {
                    // Best-effort clear the archived PDF, then delete the record.
                    if (review.pdf_path)
                      void supabase.storage.from("ior-reports").remove([review.pdf_path]);
                    reviewDelete.mutate({ id: review.id, projectId });
                  }}
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
                project={project}
                rollup={rollup}
                allocations={changeOrderAllocationsQuery.data ?? []}
                exposures={exposures}
                onOpenClientPortal={() => setProjectTab("client-portal")}
                onSendToClient={(co) => coSendToClient.mutate({ changeOrderId: co.id })}
                sendingClientId={
                  coSendToClient.isPending
                    ? (coSendToClient.variables?.changeOrderId ?? null)
                    : null
                }
                onQuickStatus={handleChangeOrderStatus}
                onCreate={handleCreateChangeOrder}
                onUpdate={handleUpdateChangeOrder}
                onDelete={handleDeleteChangeOrder}
                onCreateRisk={handleCreateRiskFromChangeOrder}
                creatingRiskId={creatingCoRiskId}
                documents={changeOrderDocuments}
                onUploadDocument={uploadCoDocument}
                onViewDocument={viewCoDocument}
                onDeleteDocument={removeCoDocument}
                uploadingDocId={uploadingCoDocId}
              />
            </TabsContent>

            <TabsContent value="subcontractors" className="mt-0">
              <SubcontractorsWorkspace
                projectId={projectId}
                buckets={buckets}
                exposures={exposures}
              />
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
      <AppFooter
        context={
          lastReviewDays !== null
            ? `Financial IOR · Reviewed ${lastReviewDays}d ago`
            : `Financial IOR · ${project.name}`
        }
      />
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
