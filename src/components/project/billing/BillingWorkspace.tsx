// The billing workspace: the pay-application → invoice → payment pipeline with
// its stage rail (overview / costs / pay apps / WIP) and ledgers (invoices &
// payments / pending COs / A/R). Extracted from the project route during the
// PROJECTDECOMP1 split and lazy-loaded so entering a project doesn't pay for
// the billing tab up front. Verbatim; no behavior change.
import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Plus, ReceiptText } from "lucide-react";
import { toast } from "sonner";

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
  ProjectRow,
} from "@/lib/projects.functions";
import type { Rollup } from "@/lib/ior";

import { BillingApplicationRowEditor } from "./BillingApplicationRowEditor";
import { BillingInvoiceRowEditor } from "./BillingInvoiceRowEditor";
import { MiniLedgerStat, SovMetric, WorkspaceHeader } from "./billing-workspace-atoms";

export function BillingWorkspace({
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
  onAllocateChangeOrder,
  onRemoveChangeOrderAllocation,
  savingAllocation,
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
  onAllocateChangeOrder: (input: ChangeOrderAllocationInput) => void;
  onRemoveChangeOrderAllocation: (id: string) => void;
  savingAllocation?: boolean;
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
  const [billingStage, setBillingStage] = useState("billing");
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
  const railActiveCostActuals =
    billingWorkspace?.costActuals?.filter((actual) => actual.status !== "void") ?? [];
  const railWip = billingWorkspace?.wip ?? null;
  const railSovLineCount = buckets.length;
  const railPayAppCount = billingApplications.length;
  const railNoSov = railSovLineCount === 0;

  let railWipChip = "Not started";
  let railWipTone: BillingRailStage["tone"] = "empty";
  if (railWip && railWip.bucket_count > 0) {
    if (railWip.assessed_bucket_count >= railWip.bucket_count) {
      railWipChip = "All buckets assessed";
      railWipTone = "complete";
    } else {
      railWipChip = `${railWip.assessed_bucket_count} of ${railWip.bucket_count} assessed`;
      railWipTone = railWip.assessed_bucket_count > 0 ? "progress" : "empty";
    }
  }

  const billingStages: BillingRailStage[] = [
    {
      value: "billing",
      step: 1,
      title: "Overview",
      chip: "Billing position",
      tone: "home",
    },
    {
      value: "project-costs",
      step: 2,
      title: "Costs",
      chip:
        railActiveCostActuals.length > 0
          ? `${railActiveCostActuals.length} cost ${railActiveCostActuals.length === 1 ? "actual" : "actuals"}`
          : "No costs recorded yet",
      tone: railActiveCostActuals.length > 0 ? "complete" : "empty",
    },
    {
      value: "pay-app-detail",
      step: 3,
      title: "Pay Applications",
      chip:
        railPayAppCount > 0
          ? `${railPayAppCount} ${railPayAppCount === 1 ? "application" : "applications"}`
          : "No applications yet",
      tone: railPayAppCount > 0 ? "progress" : "empty",
      ...(railNoSov
        ? {
            blockedReason:
              "Import your schedule of values first — pay apps are built from these lines.",
            routeTo: "project-costs",
          }
        : {}),
    },
    {
      value: "wip-analysis",
      step: 4,
      title: "WIP",
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

  const billingLedgers: BillingRailLedger[] = [
    { value: "invoice-ledger", title: "Invoices & Payments" },
    { value: "pending-cos", title: "Pending COs" },
    { value: "pay-app-ledger", title: "A/R Ledger" },
  ];

  return (
    <section className="space-y-4">
      <Tabs value={billingStage} onValueChange={setBillingStage} className="space-y-4">
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
          <BillingStageRail
            value={billingStage}
            onValueChange={setBillingStage}
            stages={billingStages}
            ledgers={billingLedgers}
          />
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
                Raw {fmtUSDCents(rollup.pendingCOContract)} · likely {fmtUSDCents(weightedPending)}
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
