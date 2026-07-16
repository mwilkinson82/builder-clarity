// The billing workspace: the pay-application → invoice → payment pipeline with
// its stage rail (overview / costs / pay apps / WIP) and ledgers (invoices &
// payments / pending COs / A/R). Extracted from the project route during the
// PROJECTDECOMP1 split and lazy-loaded so entering a project doesn't pay for
// the billing tab up front. Verbatim; no behavior change.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, ReceiptText } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { DialogHeaderV2 } from "@/components/ui/dialog-header-v2";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { InvoicePaymentMethodToggles } from "@/components/billing/InvoicePaymentMethodToggles";
import { ReceivablesCockpit } from "@/components/billing/ReceivablesCockpit";
import {
  ChangeOrderAllocationPanel,
  type ChangeOrderAllocationInput,
} from "@/components/billing/ChangeOrderAllocationPanel";
import {
  BillingLineItemsPanel,
  ProjectCostTrackingPanel,
  WipAnalysisPanel,
} from "@/components/billing/BillingEnhancements";
import {
  BillingStageRail,
  type BillingRailLedger,
  type BillingRailStage,
} from "@/components/billing/BillingStageRail";
import {
  billingEventLabel,
  fmtUSDCents,
  formatBillingDate,
  invoiceAgingStatus,
  invoiceStatusLabel,
  payAppAgingStatus,
} from "@/lib/billing-format";
import { billingDocumentLabel, normalizeBillingNumberLabel } from "@/lib/billing-labels";
import {
  centsToDollars,
  dollarsToCents,
  invoiceTotalDueDollars,
  methodAvailability,
  percentOfDollars,
  quantizeDollars,
  resolveEnabledMethods,
  sumDollarsToCents,
} from "@/lib/payments-domain";
import { getPaymentMethodContext, type PaymentMethodContext } from "@/lib/payments.functions";
import {
  getClientPortalManagement,
  type ProjectClientAccessRow,
} from "@/lib/client-portal.functions";
import type { BillingDraft, InvoiceDraft, PaymentDraft } from "@/lib/billing-local-store";
import type { BillingWorkspaceData, CostActualImportRow } from "@/lib/billing.functions";
import type {
  BillingApplicationRow,
  BillingInvoiceRow,
  BillingOutputFormat,
  BucketRow,
  ChangeOrderRow,
  ExposureRow,
  ProjectRow,
} from "@/lib/projects.functions";
import type { Rollup } from "@/lib/ior";
import type { ProjectSubCostByBucket } from "@/lib/project-cost-forecast";

import { BillingApplicationRowEditor } from "./BillingApplicationRowEditor";
import { BillingInvoiceRowEditor } from "./BillingInvoiceRowEditor";
import { BillingSovTable } from "./BillingSovTable";
import { SovMetric } from "./billing-workspace-atoms";

export function BillingWorkspace({
  project,
  rollup,
  changeOrders,
  exposures,
  buckets,
  subCostByBucket,
  selfPerformByBucket,
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
  applyingCertifiedSovPosition,
  onCreate,
  onUpdate,
  onDelete,
  onGenerateBillingLines,
  onUpdateBillingLine,
  onSaveAllBillingLines,
  savingAllBillingLines,
  onUpdatePayAppRetainageRate,
  onUpdateOutputFormat,
  savingOutputFormat,
  onCreateCostActual,
  onImportCostActuals,
  onVoidCostActual,
  onSetCostActualStatus,
  onUpdateCostActual,
  onUpdateBucketBillingSettings,
  onApplyCertifiedSovPosition,
  onCreateInvoice,
  onUpdateInvoice,
  onDeleteInvoice,
  onRecordPayment,
  onReconcileInvoice,
  reconcilingInvoiceId,
  onAllocateChangeOrder,
  onRemoveChangeOrderAllocation,
  savingAllocation,
  focusStage,
}: {
  project: ProjectRow;
  rollup: Rollup;
  changeOrders: ChangeOrderRow[];
  exposures: ExposureRow[];
  buckets: BucketRow[];
  subCostByBucket?: ProjectSubCostByBucket;
  selfPerformByBucket?: ReadonlyMap<string, number>;
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
  applyingCertifiedSovPosition?: boolean;
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
  onSaveAllBillingLines?: (
    items: {
      id: string;
      patch: {
        work_completed_this_period?: number;
        materials_stored_this_period?: number;
        retainage_pct?: number;
        retainage_released?: number;
      };
    }[],
  ) => void;
  savingAllBillingLines?: boolean;
  onUpdatePayAppRetainageRate: (billingApplicationId: string, retainagePct: number) => void;
  onUpdateOutputFormat: (billingApplicationId: string, format: BillingOutputFormat) => void;
  savingOutputFormat?: boolean;
  onCreateCostActual: Parameters<typeof ProjectCostTrackingPanel>[0]["onCreateCostActual"];
  onImportCostActuals: (input: { source_name: string; rows: CostActualImportRow[] }) => void;
  onVoidCostActual: (id: string, notes: string) => void;
  onSetCostActualStatus: (
    id: string,
    status: "approved" | "paid",
    payment?: { payment_method: string; payment_reference: string; paid_date: string },
  ) => void;
  onUpdateCostActual: (
    id: string,
    input: Parameters<Parameters<typeof ProjectCostTrackingPanel>[0]["onUpdateCostActual"]>[1],
  ) => void | Promise<unknown>;
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
  onApplyCertifiedSovPosition?: (certificationId: string, billingApplicationId: string) => void;
  onCreateInvoice: (input: InvoiceDraft) => Promise<void>;
  onUpdateInvoice: (id: string, patch: Partial<BillingInvoiceRow>) => void;
  onDeleteInvoice: (id: string) => void;
  onRecordPayment: (input: PaymentDraft) => void;
  onReconcileInvoice: (invoiceId: string) => void;
  reconcilingInvoiceId: string | null;
  onAllocateChangeOrder: (input: ChangeOrderAllocationInput) => void;
  onRemoveChangeOrderAllocation: (id: string) => void;
  savingAllocation?: boolean;
  // Deep-link the workspace to a specific billing stage (e.g. "project-costs" so
  // the Budget drawer's "Invoices & recorded costs" row lands on the Costs ledger
  // instead of the default pay-app view). Applied on change via an effect below.
  focusStage?: string;
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
  // Applications that already have an active (non-void) client invoice — the
  // pay-app "Bill the owner" step reads this to show the "Invoiced" done state
  // and stay idempotent (createBillingInvoice also blocks a second invoice).
  const invoicedApplicationIds = useMemo(
    () =>
      billingInvoices
        .filter((invoice) => invoice.billing_application_id && invoice.status !== "void")
        .map((invoice) => invoice.billing_application_id as string),
    [billingInvoices],
  );
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
      platformLimitCents: paymentMethodContext.stripePaymentLimitCents,
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
  // Default landing is the mock's Pay applications. But pay-app-detail is a
  // blocked stage until the SOV exists (railNoSov), so with no schedule of
  // values we land on the SOV instead — always safe, and stage 1 is exactly
  // where the contract schedule is reviewed. No blocked/crash on first paint.
  const [billingStage, setBillingStage] = useState(() =>
    buckets.length === 0 ? "budget" : "pay-app-detail",
  );
  // Deep-link: when the route asks to focus a stage (the Budget drawer's
  // "Invoices & recorded costs" row → "project-costs"), jump there. The route
  // re-sets the token on every click so re-clicks re-fire even to the same stage.
  useEffect(() => {
    if (focusStage) setBillingStage(focusStage);
  }, [focusStage]);
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

  // Stage state for the billing rail (BILLINGRAIL1). Honest chips from live data — never
  // painted complete off a project-level roll-up. SOV lines are the cost buckets; pay apps
  // and WIP are built from them, so both block-with-reason until the SOV exists.
  const railWip = billingWorkspace?.wip ?? null;
  const railSovLineCount = buckets.length;
  const railPayAppCount = billingApplications.length;
  const railNoSov = railSovLineCount === 0;

  // WIP rail sub-line: the live over/under (mock "Underbilled $42,000").
  let railWipChip = "Not started";
  let railWipTone: BillingRailStage["tone"] = "empty";
  if (railWip && railWip.bucket_count > 0 && railWip.assessed_bucket_count > 0) {
    const overUnder = railWip.total_over_under;
    if (overUnder > 0) {
      railWipChip = `Overbilled ${fmtUSDCents(overUnder)}`;
      railWipTone = "progress";
    } else if (overUnder < 0) {
      railWipChip = `Underbilled ${fmtUSDCents(Math.abs(overUnder))}`;
      railWipTone = "progress";
    } else {
      railWipChip = "Balanced";
      railWipTone = "complete";
    }
  }

  // The current application drives the G702 certificate summary and the rail's
  // pay-app sub-line. "Current" = the latest application in the ledger.
  const currentApp =
    billingApplications.length > 0
      ? billingApplications[billingApplications.length - 1]
      : undefined;
  const priorApps = billingApplications.slice(0, -1);
  const payAppRailChip =
    railPayAppCount === 0
      ? "No applications yet"
      : currentApp && (currentApp.status === "draft" || currentApp.status === "submitted")
        ? `${normalizeBillingNumberLabel(currentApp.application_number)} ready to certify`
        : `${railPayAppCount} ${railPayAppCount === 1 ? "application" : "applications"}`;
  // G702 face figures, all integer-cents, bound to the existing pay-app fields
  // (never the mock's dollars, never a fresh float rollup): line 3 = this
  // application's contract + approved COs; line 4 = cumulative billed to date;
  // line 5 = retainage held; line 6 = 4 − 5; line 7 = prior applications'
  // earned-less-retainage; line 8 = 6 − 7. Reconciles by construction.
  const g702ContractSumToDateCents = currentApp
    ? sumDollarsToCents([currentApp.contract_amount, currentApp.change_order_amount])
    : 0;
  const g702TotalCompletedStoredCents = totalBilledCents;
  const g702RetainageHeldCents = sumDollarsToCents(billingApplications.map((app) => app.retainage));
  const g702EarnedLessRetainageCents = Math.max(
    0,
    g702TotalCompletedStoredCents - g702RetainageHeldCents,
  );
  const g702PreviousCertificatesCents = Math.max(
    0,
    sumDollarsToCents(priorApps.map((app) => app.amount_billed)) -
      sumDollarsToCents(priorApps.map((app) => app.retainage)),
  );
  const g702CurrentPaymentDueCents = Math.max(
    0,
    g702EarnedLessRetainageCents - g702PreviousCertificatesCents,
  );
  const g702RetainagePct =
    currentApp && currentApp.amount_billed > 0
      ? Math.round((currentApp.retainage / currentApp.amount_billed) * 100)
      : defaultRetainagePct;

  // Primary numbered stages (the mock's four notebook steps). Values are the
  // underlying Tabs keys / reroute targets — never renamed, only relabeled.
  const billingStages: BillingRailStage[] = [
    {
      value: "budget",
      step: 1,
      title: "SOV",
      chip:
        railSovLineCount > 0
          ? `${railSovLineCount} SOV ${railSovLineCount === 1 ? "line" : "lines"}`
          : "Schedule of values",
      tone: "complete",
    },
    {
      value: "pay-app-detail",
      step: 2,
      title: "Pay applications",
      chip: payAppRailChip,
      tone: "progress",
      ...(railNoSov
        ? {
            blockedReason:
              "Import your schedule of values first — pay apps are built from these lines.",
            routeTo: "project-costs",
          }
        : {}),
    },
    {
      value: "invoice-ledger",
      step: 3,
      title: "Invoices & A/R",
      chip: `${fmtUSDCents(openReceivable)} open`,
      tone: "empty",
    },
    {
      value: "wip-analysis",
      step: 4,
      title: "WIP / over-under",
      chip: railWipChip,
      tone: railWipTone,
      ...(railNoSov
        ? {
            blockedReason: "Import your schedule of values first — WIP is built from these lines.",
            routeTo: "project-costs",
          }
        : {}),
    },
  ];

  // Secondary surfaces — still one Tabs each, values unchanged, demoted to the
  // "More views" chip row below the numbered rail.
  const billingLedgers: BillingRailLedger[] = [
    { value: "billing", title: "Billing position" },
    { value: "project-costs", title: "Costs" },
    { value: "pending-cos", title: "Pending COs" },
    { value: "pay-app-ledger", title: "A/R ledger" },
  ];

  // Per-stage notebook panel header: serif H1 + muted sub. The primary action
  // (New pay application / Create invoice) is wired into the header in render.
  const stageHeaders: Record<string, { title: string; sub: string }> = {
    budget: {
      title: "Schedule of values",
      sub: "The owner-facing contract schedule every pay application bills against.",
    },
    "pay-app-detail": {
      title: "Pay applications",
      sub: currentApp
        ? `Build a requisition from the schedule of values. ${normalizeBillingNumberLabel(
            currentApp.application_number,
          )} — ${fmtUSDCents(centsToDollars(g702CurrentPaymentDueCents))} due this cycle.`
        : "Build a requisition from the schedule of values, then certify it for payment.",
    },
    "invoice-ledger": {
      title: "Invoices & A/R",
      sub: `Client-facing invoices and open receivables. ${fmtUSDCents(invoiceOpenBalance)} open across ${
        billingInvoices.length
      } ${billingInvoices.length === 1 ? "invoice" : "invoices"}.`,
    },
    "wip-analysis": {
      title: "WIP / over-under",
      sub: "Earned revenue against billed to date, cost code by cost code.",
    },
    billing: {
      title: "Billing position",
      sub: "Where this job stands — unbilled earned, open A/R, retainage, and client payment readiness.",
    },
    "project-costs": {
      title: "Costs",
      sub: "The job-cost ledger backing every application: committed, approved, and paid actuals.",
    },
    "pending-cos": {
      title: "Pending change orders",
      sub: "Forecast exposure only — a pending CO enters an application once approved and allocated.",
    },
    "pay-app-ledger": {
      title: "A/R ledger",
      sub: "The accounting register for application balances, linked invoices, and aging.",
    },
  };
  const activeHeader = stageHeaders[billingStage] ?? stageHeaders.billing;

  return (
    <section className="space-y-4">
      <Tabs value={billingStage} onValueChange={setBillingStage} className="space-y-4">
        {/* v2 dark stat strip (SovMetric dark variant): the seven headline
            figures as a slim dark band above the notebook rail. Placement:
            a persistent strip above the rail, so the numbers frame every
            billing stage rather than living only on the Overview surface. */}
        <div className="rounded-xl bg-dark-panel px-4 py-3.5 shadow-card">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-7">
            <SovMetric
              variant="dark"
              label="Forecasted contract"
              value={fmtUSDCents(rollup.forecastedFinalContract)}
            />
            <SovMetric variant="dark" label="Earned to date" value={fmtUSDCents(earnedToDate)} />
            <SovMetric variant="dark" label="Billed to date" value={fmtUSDCents(totalBilled)} />
            <SovMetric
              variant="dark"
              label="Remaining to bill"
              value={fmtUSDCents(contractRemaining)}
            />
            <SovMetric variant="dark" label="Paid to date" value={fmtUSDCents(paidToDate)} />
            <SovMetric variant="dark" label="Open A/R" value={fmtUSDCents(openReceivable)} />
            <SovMetric variant="dark" label="Retainage" value={fmtUSDCents(retainage)} />
          </div>
        </div>

        {/* New pay application dialog — controlled; its trigger lives in the Pay
            applications panel header (v2). Rendered here so it stays mounted. */}
        <Dialog open={payAppOpen} onOpenChange={setPayAppOpen}>
          <DialogContent className="sm:max-w-3xl">
            <DialogHeaderV2
              eyebrow="Billing"
              title="New pay application"
              description="Start the billing cycle, then enter SOV progress in Applications."
            />
            <div className="grid gap-4 py-2">
              <div className="rounded-md border border-accent/25 bg-accent/5 px-3 py-2 text-sm text-muted-foreground">
                Create the application shell here. After it is saved, open Applications to enter
                percent complete by SOV line; Overwatch will calculate the current work, retainage,
                and application amount. Approved change orders only become billable when they are
                allocated to an SOV cost code and pulled into the application lines.
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
                    onChange={(e) => setDraft({ ...draft, submitted_date: e.target.value || null })}
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

        {/* Notebook layout: numbered rail on the left, the active stage's panel
            on the right (the active card connects into it on desktop). */}
        <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:gap-0">
          <BillingStageRail
            value={billingStage}
            onValueChange={setBillingStage}
            stages={billingStages}
            ledgers={billingLedgers}
          />
          <div className="min-w-0 flex-1 rounded-xl border border-hairline bg-surface p-5 shadow-card lg:p-6">
            <div className="mb-5 flex flex-col gap-3 border-b border-hairline pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h1 className="font-serif text-2xl leading-tight text-foreground">
                  {activeHeader.title}
                </h1>
                <p className="mt-1.5 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
                  {activeHeader.sub}
                </p>
              </div>
              {billingStage === "pay-app-detail" ? (
                <Button onClick={openPayAppDialog} className="shrink-0 gap-1.5">
                  <Plus className="h-3.5 w-3.5" /> New pay application
                </Button>
              ) : null}
              {billingStage === "invoice-ledger" ? (
                <Button onClick={() => openInvoiceDialog()} className="shrink-0 gap-1.5">
                  <ReceiptText className="h-3.5 w-3.5" /> Create invoice
                </Button>
              ) : null}
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
                    <SovMetric
                      label="Payable online"
                      value={String(onlinePayReadyInvoices.length)}
                    />
                    <SovMetric label="Payable balance" value={fmtUSDCents(onlinePayReadyBalance)} />
                    <SovMetric label="Invoice open" value={fmtUSDCents(invoiceOpenBalance)} />
                  </div>
                </div>
              </div>
            </TabsContent>

            <TabsContent value="pay-app-detail" className="mt-0 space-y-4">
              {currentApp ? (
                <div className="grid gap-4 lg:grid-cols-2">
                  {/* G702 certificate summary — every figure bound to the pay-app
                  rollup via the cents helpers (no hardcoded mock dollars). */}
                  <div className="rounded-xl border border-hairline bg-surface p-5">
                    <div className="eyebrow">
                      {normalizeBillingNumberLabel(currentApp.application_number)} · G702
                      certificate
                    </div>
                    <div className="mt-3 flex items-baseline justify-between border-t border-hairline py-2">
                      <span className="text-xs font-semibold text-foreground">
                        Contract sum to date
                      </span>
                      <span className="font-serif text-base text-foreground">
                        {fmtUSDCents(centsToDollars(g702ContractSumToDateCents))}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between border-t border-hairline py-2">
                      <span className="text-xs text-muted-foreground">
                        Total completed &amp; stored
                      </span>
                      <span className="font-serif text-[15px] text-foreground">
                        {fmtUSDCents(centsToDollars(g702TotalCompletedStoredCents))}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between border-t border-hairline py-2">
                      <span className="text-xs text-muted-foreground">
                        Less retainage ({g702RetainagePct}%)
                      </span>
                      <span className="font-serif text-[15px] text-danger">
                        −{fmtUSDCents(centsToDollars(g702RetainageHeldCents))}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between border-t border-hairline py-2">
                      <span className="text-xs font-semibold text-foreground">
                        Total earned less retainage
                      </span>
                      <span className="font-serif text-base text-foreground">
                        {fmtUSDCents(centsToDollars(g702EarnedLessRetainageCents))}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between border-t border-hairline py-2">
                      <span className="text-xs text-muted-foreground">
                        Less previous certificates
                      </span>
                      <span className="font-serif text-[15px] text-muted-foreground">
                        −{fmtUSDCents(centsToDollars(g702PreviousCertificatesCents))}
                      </span>
                    </div>
                    <div className="mt-3 flex items-center justify-between rounded-xl bg-dark-panel px-4 py-3 text-dark-panel-foreground">
                      {/* on-dark amber tint (THEMING dark-panel exception, matches
                      ScheduleSnapshotTimeline): --warn goes muddy on dark. */}
                      <div className="font-mono text-[9px] font-bold uppercase tracking-[0.14em] text-[#C09A56]">
                        Current payment due
                      </div>
                      <span className="font-serif text-[26px] leading-none">
                        {fmtUSDCents(centsToDollars(g702CurrentPaymentDueCents))}
                      </span>
                    </div>
                  </div>

                  {/* Pay applications list — restyle of the existing application set. */}
                  <div className="rounded-xl border border-hairline bg-surface px-5 pb-3 pt-1.5">
                    <div className="py-3 text-[13px] font-semibold text-foreground">
                      Pay applications
                    </div>
                    {[...billingApplications].reverse().map((app) => {
                      const appOpenCents = Math.max(
                        0,
                        dollarsToCents(app.amount_billed) -
                          dollarsToCents(app.paid_to_date) -
                          dollarsToCents(app.retainage),
                      );
                      const aging = payAppAgingStatus(app, centsToDollars(appOpenCents));
                      const paid =
                        app.status === "paid" || (appOpenCents === 0 && app.paid_to_date > 0);
                      const monthLabel = app.submitted_date
                        ? new Date(`${app.submitted_date}T12:00:00`).toLocaleDateString("en-US", {
                            month: "short",
                          })
                        : "";
                      const pillClass = paid
                        ? "text-success"
                        : appOpenCents > 0
                          ? "text-warning"
                          : "text-muted-foreground";
                      const pillLabel = paid ? "Paid" : appOpenCents > 0 ? "Open A/R" : "Draft";
                      return (
                        <div
                          key={app.id}
                          className="flex items-center gap-3 border-t border-hairline py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-[13px] font-semibold text-foreground">
                              {normalizeBillingNumberLabel(app.application_number)}
                              {monthLabel ? (
                                <span className="font-normal text-muted-foreground">
                                  {" "}
                                  · {monthLabel}
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                              {aging.label}
                            </div>
                          </div>
                          <span className="ml-auto shrink-0 font-serif text-[15px] text-foreground">
                            {fmtUSDCents(app.amount_billed)}
                          </span>
                          <span
                            className={`shrink-0 rounded-full border border-current px-2 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.08em] ${pillClass}`}
                          >
                            {pillLabel}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              <p className="text-xs leading-relaxed text-muted-foreground">
                The G703 continuation sheet — one line per SOV cost code — is the editable grid
                below.{" "}
                <button
                  type="button"
                  onClick={() =>
                    document.getElementById("billing-continuation-sheet")?.scrollIntoView()
                  }
                  className="font-semibold text-foreground underline-offset-2 hover:underline"
                >
                  Open continuation sheet →
                </button>
              </p>

              <div id="billing-continuation-sheet">
                {renderEnhancedBillingPanel((workspace) => (
                  <BillingLineItemsPanel
                    project={project}
                    payApps={billingApplications}
                    lineItems={workspace.lineItems}
                    onGenerateLines={onGenerateBillingLines}
                    onUpdateLine={onUpdateBillingLine}
                    onSaveAllLines={onSaveAllBillingLines}
                    onUpdatePayAppRetainageRate={onUpdatePayAppRetainageRate}
                    onUpdateOutputFormat={onUpdateOutputFormat}
                    onCreateInvoiceForApp={(app) => {
                      const draft = buildInvoiceDraft(app);
                      // "Bill the owner" issues a real, open, client-visible receivable
                      // so it ages on the A/R dashboard immediately. A draft invoice is
                      // hidden from the receivables aging (ReceivablesCockpit filters
                      // status !== "draft") — that was the "billed but hasn't carried on
                      // the dashboard" report. A fresh pay app is status "draft", so its
                      // invoice would inherit "draft"; promote that to a sent, visible
                      // invoice. (An already paid/partially-paid draft keeps its status.)
                      const issued =
                        draft.status === "draft"
                          ? { ...draft, status: "sent" as const, client_visible: true }
                          : draft;
                      // Fire-and-forget: invoiceCreate's onError surfaces failures.
                      void onCreateInvoice(issued).catch(() => undefined);
                    }}
                    invoicedApplicationIds={invoicedApplicationIds}
                    recipientEmails={invoiceRecipients.map((access) => access.email)}
                    savingLine={savingBillingLine}
                    savingAllLines={savingAllBillingLines}
                    savingRetainageRate={savingRetainageRate}
                    savingOutputFormat={savingOutputFormat}
                    savingInvoice={savingInvoice}
                    certifiedSovHandoffReady={workspace.certifiedSovHandoffReady}
                    certifiedSovPositions={workspace.certifiedSovPositions}
                    certifiedSovHandoffs={workspace.certifiedSovHandoffs}
                    onApplyCertifiedSovPosition={onApplyCertifiedSovPosition}
                    applyingCertifiedSovPosition={applyingCertifiedSovPosition}
                  />
                ))}
              </div>
            </TabsContent>

            <TabsContent value="project-costs" className="mt-0">
              {renderEnhancedBillingPanel((workspace) => (
                <ProjectCostTrackingPanel
                  projectId={project.id}
                  buckets={buckets}
                  changeOrders={changeOrders}
                  changeOrderAllocations={workspace.changeOrderAllocations}
                  subCostByBucket={subCostByBucket}
                  exposures={exposures}
                  costActuals={workspace.costActuals}
                  onCreateCostActual={onCreateCostActual}
                  onImportCostActuals={onImportCostActuals}
                  onVoidCostActual={onVoidCostActual}
                  onSetCostActualStatus={onSetCostActualStatus}
                  onUpdateCostActual={onUpdateCostActual}
                  savingCost={savingCostActual}
                  selfPerformByBucket={selfPerformByBucket}
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

            <TabsContent value="budget" className="mt-0">
              <BillingSovTable
                buckets={buckets}
                changeOrders={changeOrders}
                changeOrderAllocations={billingWorkspace?.changeOrderAllocations ?? []}
              />
            </TabsContent>

            <TabsContent value="invoice-ledger" className="mt-0">
              <div className="rounded-lg border border-hairline bg-card p-6 shadow-card xl:col-span-2">
                <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                      Invoices & payments
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Client-facing invoices created from applications or direct billing items.
                      Send, enable online pay, and record deposits here.
                    </p>
                  </div>
                  {/* Create-invoice trigger moved to the panel header (v2); the
                  dialog stays controlled here so its write path is unchanged. */}
                  <Dialog
                    open={invoiceOpen}
                    onOpenChange={(open) => {
                      setInvoiceOpen(open);
                      if (!open) setInvoiceError("");
                    }}
                  >
                    <DialogContent className="sm:max-w-3xl">
                      <DialogHeaderV2
                        eyebrow="Billing"
                        title="Create invoice"
                        description="Build the client-facing invoice from an application or a direct billing item."
                      />
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
                                      {billingDocumentLabel(
                                        app.application_number,
                                        app.invoice_number,
                                      )}
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
                                setInvoiceDraft({
                                  ...invoiceDraft,
                                  issue_date: e.target.value || null,
                                })
                              }
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>Due date</Label>
                            <Input
                              type="date"
                              value={invoiceDraft.due_date ?? ""}
                              onChange={(e) =>
                                setInvoiceDraft({
                                  ...invoiceDraft,
                                  due_date: e.target.value || null,
                                })
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
                      No invoices logged yet. Create one from an application when it is ready for
                      client billing.
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

            <TabsContent value="pending-cos" className="mt-0 space-y-4">
              {/* Approved change orders become billable here: allocate each to an
              SOV cost code so it rolls into the next application's line 2. */}
              <div className="rounded-lg border border-hairline bg-card p-6 shadow-card xl:col-span-2">
                <ChangeOrderAllocationPanel
                  changeOrders={changeOrders}
                  buckets={buckets}
                  allocations={billingWorkspace?.changeOrderAllocations ?? []}
                  onAllocate={onAllocateChangeOrder}
                  onRemoveAllocation={onRemoveChangeOrderAllocation}
                  saving={savingAllocation}
                />
              </div>
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
                    Raw {fmtUSDCents(rollup.pendingCOContract)} · likely{" "}
                    {fmtUSDCents(weightedPending)}
                  </div>
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
                      Accounting register for application balances, linked invoices, open
                      receivables, and aging. Edit SOV progress in Applications; send or collect in
                      Invoices & Payments.
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
          </div>
        </div>
      </Tabs>
    </section>
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
