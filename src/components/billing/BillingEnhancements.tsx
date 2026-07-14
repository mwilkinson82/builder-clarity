import * as Papa from "papaparse";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { VendorPicker } from "@/components/billing/VendorPicker";
import {
  CostActualInvoiceAttachmentPicker,
  type CostActualInvoiceAttachment,
} from "@/components/billing/CostActualInvoiceAttachment";
import { CostActualInvoiceAttachmentLink } from "@/components/billing/CostActualInvoiceAttachmentLink";
import { findOrCreateVendor, listVendors, saveVendor } from "@/lib/vendors.functions";
import { listSubcontractors } from "@/lib/subcontractors.functions";
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
import { Textarea } from "@/components/ui/textarea";
import { AiaApplicationStepper } from "@/components/billing/AiaApplicationStepper";
import { aiaBillingFilename, generateAiaBillingPdf } from "@/lib/aia-pdf";
import { bytesToBlob, triggerBlobDownload } from "@/lib/download-file";
import { sendTransactionalEmail } from "@/lib/email/send";
import { toast } from "sonner";
import { overbilledLines } from "@/lib/aia-math";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import { billingDocumentLabel } from "@/lib/billing-labels";
import { prepareAttachmentForUpload } from "@/lib/daily-report-uploads";
import { fmtPct } from "@/lib/format";
import { supabase } from "@/integrations/supabase/client";
import {
  dollarsToCents,
  lineWorkForPercentCents,
  percentOfCents,
  sumDollarsToCents,
} from "@/lib/payments-domain";
import type {
  BillingLineItemRow,
  BillingWorkspaceData,
  CostActualImportRow,
  CostActualRow,
} from "@/lib/billing.functions";
import type {
  BillingApplicationRow,
  BillingOutputFormat,
  BucketRow,
  ProjectRow,
} from "@/lib/projects.functions";
import { AlertTriangle, Check, Plus, Save, Trash2, Upload, Pencil } from "lucide-react";

type LinePatch = {
  work_completed_this_period?: number;
  materials_stored_this_period?: number;
  retainage_pct?: number;
  retainage_released?: number;
};

type CostActualDraft = {
  cost_bucket_id: string | null;
  cost_code: string;
  description: string;
  category: CostActualRow["category"];
  amount: number;
  vendor: string;
  reference_number: string;
  cost_date: string;
  // Payables lifecycle: draft → approved (for payment) → paid. 'committed'
  // predates the approval flow (an obligation on the books) and still counts
  // as job cost; a draft never does.
  status: "draft" | "committed" | "approved" | "paid";
  notes: string;
  // Dollars of daily WIP this line SETTLES — the self-perform lump already in the
  // bucket actual that this vendor invoice covers. Netted out of the WIP rollup so
  // it isn't double-counted. Credits (amount < 0) force 0.
  daily_wip_offset: number;
  invoice_attachment_path: string;
  invoice_attachment_name: string;
  invoice_attachment_type: string;
  invoice_attachment_size: number;
};

// A per-cost-code line for the multi-line "Add cost actual" path — only the
// fields that vary line to line. The shared invoice fields come from the draft.
type ExtraCostLine = {
  cost_bucket_id: string | null;
  cost_code: string;
  description: string;
  amount: number;
  // Per-line daily-WIP settlement (see CostActualDraft.daily_wip_offset).
  daily_wip_offset: number;
  // Once the user hand-edits the offset, stop auto-suggesting it for this line.
  offsetTouched?: boolean;
};

// How a cost was paid, captured when marking it paid (field request 2026-07-10).
export type CostPaymentDetails = {
  payment_method: string; // wire | check | card | ach | other
  payment_reference: string; // check #, wire confirmation, ACH trace
  paid_date: string; // the real-world date money went out (YYYY-MM-DD)
};

// The payment methods a cost can be marked paid with — mirrors the receivables
// manual-payment form, plus 'card' (Darian explicitly asked for wire/check/card).
const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: "wire", label: "Wire" },
  { value: "check", label: "Check" },
  { value: "card", label: "Card" },
  { value: "ach", label: "ACH" },
  { value: "other", label: "Other" },
];
const paymentMethodLabel = (v: string) => PAYMENT_METHODS.find((m) => m.value === v)?.label ?? v;

// Plain-English labels for the lifecycle — shown on entry, rows, and chips.
const COST_STATUS_LABEL: Record<CostActualRow["status"], string> = {
  draft: "Draft — not approved",
  committed: "Committed",
  approved: "Approved for payment",
  paid: "Paid",
  void: "Void",
};

// Scan-at-a-glance color per stage (field request 2026-07-10: "color coding
// ... would help"). House tokens only — no second accent: draft reads clay
// (in progress), approved/committed read warning (money owed, not yet out),
// paid reads success (done), void reads muted.
const COST_STATUS_TONE: Record<CostActualRow["status"], { chip: string; edge: string }> = {
  draft: { chip: "bg-accent/15 text-accent-foreground", edge: "border-l-accent" },
  committed: { chip: "bg-warning/15 text-warning", edge: "border-l-warning" },
  approved: { chip: "bg-warning/15 text-warning", edge: "border-l-warning" },
  paid: { chip: "bg-success/15 text-success", edge: "border-l-success" },
  void: { chip: "bg-muted text-muted-foreground", edge: "border-l-transparent" },
};

type BucketSettingsPatch = {
  earned_percent_complete?: number;
  retainage_pct?: number;
  billing_method?: "percent" | "unit" | "material";
  contract_quantity?: number;
  unit?: string;
};

type BillingEnhancementProps = {
  project: ProjectRow;
  projectId: string;
  payApps: BillingApplicationRow[];
  buckets: BucketRow[];
  workspace?: BillingWorkspaceData;
  isLoading?: boolean;
  savingLine?: boolean;
  savingRetainageRate?: boolean;
  savingCost?: boolean;
  savingBucket?: boolean;
  onGenerateLines: (billingApplicationId: string) => void;
  onUpdateLine: (id: string, patch: LinePatch) => void;
  onUpdatePayAppRetainageRate: (billingApplicationId: string, retainagePct: number) => void;
  onUpdateOutputFormat: (billingApplicationId: string, format: BillingOutputFormat) => void;
  savingOutputFormat?: boolean;
  onCreateCostActual: (input: CostActualDraft) => Promise<unknown>;
  onImportCostActuals: (input: { source_name: string; rows: CostActualImportRow[] }) => void;
  onVoidCostActual: (id: string, notes: string) => void;
  onSetCostActualStatus: (
    id: string,
    status: "approved" | "paid",
    payment?: CostPaymentDetails,
  ) => void;
  onUpdateCostActual: (id: string, input: CostActualDraft) => void | Promise<unknown>;
  onUpdateBucketSettings: (id: string, patch: BucketSettingsPatch) => void;
};

const centsToDollars = (value: number) => value / 100;
const clampPercent = (value: number) => Math.max(0, Math.min(100, value));
const parsePercentInput = (value: string | number) => {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? clampPercent(parsed) : 0;
};
const formatPercentInput = (value: number) =>
  Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
const today = () => new Date().toISOString().slice(0, 10);

const normalizeHeader = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, "");
const getImportCell = (row: Record<string, unknown>, aliases: string[]) => {
  const lookup = new Map(
    Object.entries(row).map(([key, value]) => [normalizeHeader(key), String(value ?? "").trim()]),
  );
  for (const alias of aliases) {
    const value = lookup.get(normalizeHeader(alias));
    if (value) return value;
  }
  return "";
};
const parseImportAmount = (value: string) => {
  const normalized = value.replace(/[,$\s]/g, "").replace(/^\((.*)\)$/, "-$1");
  const amount = Number(normalized);
  return Number.isFinite(amount) ? Math.abs(amount) : 0;
};
const parseImportDate = (value: string) => {
  if (!value) return today();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return today();
  return date.toISOString().slice(0, 10);
};
const normalizeImportCategory = (value: string): CostActualImportRow["category"] => {
  const key = normalizeHeader(value);
  if (key.includes("labor")) return "labor";
  if (key.includes("material")) return "material";
  if (key.includes("equipment")) return "equipment";
  if (key.includes("overhead")) return "overhead";
  if (key.includes("sub")) return "subcontract";
  return "direct";
};
const normalizeImportStatus = (value: string): CostActualImportRow["status"] => {
  const key = normalizeHeader(value);
  return key.includes("paid") || key.includes("cleared") ? "paid" : "committed";
};
const normalizeCostImportRow = (row: Record<string, unknown>): CostActualImportRow | null => {
  const description = getImportCell(row, ["description", "memo", "name", "item", "account"]);
  const amount = parseImportAmount(getImportCell(row, ["amount", "debit", "cost", "total"]));
  if (!description || amount <= 0) return null;
  return {
    cost_code: getImportCell(row, ["cost code", "cost_code", "code", "costcode"]),
    description,
    category: normalizeImportCategory(getImportCell(row, ["category", "type", "cost type"])),
    amount,
    vendor: getImportCell(row, ["vendor", "name", "payee", "supplier"]),
    reference_number: getImportCell(row, ["reference", "ref", "invoice", "invoice #", "check"]),
    cost_date: parseImportDate(getImportCell(row, ["date", "cost date", "transaction date"])),
    status: normalizeImportStatus(getImportCell(row, ["status", "paid status"])),
    notes: getImportCell(row, ["notes", "memo", "class"]),
  };
};

export function BillingEnhancementPanels({
  project,
  projectId,
  payApps,
  buckets,
  workspace,
  isLoading,
  savingLine,
  savingRetainageRate,
  savingCost,
  savingBucket,
  onGenerateLines,
  onUpdateLine,
  onUpdatePayAppRetainageRate,
  onUpdateOutputFormat,
  savingOutputFormat,
  onCreateCostActual,
  onImportCostActuals,
  onVoidCostActual,
  onSetCostActualStatus,
  onUpdateCostActual,
  onUpdateBucketSettings,
}: BillingEnhancementProps) {
  if (isLoading) {
    return (
      <div className="rounded-md border border-hairline bg-surface p-5 text-sm text-muted-foreground">
        Loading enhanced billing detail...
      </div>
    );
  }

  if (!workspace?.schemaReady) {
    return (
      <div className="rounded-md border border-warning/30 bg-warning/10 p-5 text-sm text-warning">
        Enhanced billing tables are not available yet. Apply the Billing and WIP foundation
        migration, then refresh this project.
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <BillingLineItemsPanel
        project={project}
        payApps={payApps}
        lineItems={workspace.lineItems}
        onGenerateLines={onGenerateLines}
        onUpdateLine={onUpdateLine}
        onUpdatePayAppRetainageRate={onUpdatePayAppRetainageRate}
        onUpdateOutputFormat={onUpdateOutputFormat}
        savingLine={savingLine}
        savingRetainageRate={savingRetainageRate}
        savingOutputFormat={savingOutputFormat}
      />
      <ProjectCostTrackingPanel
        projectId={projectId}
        buckets={buckets}
        costActuals={workspace.costActuals}
        onCreateCostActual={onCreateCostActual}
        onImportCostActuals={onImportCostActuals}
        onVoidCostActual={onVoidCostActual}
        onSetCostActualStatus={onSetCostActualStatus}
        onUpdateCostActual={onUpdateCostActual}
        savingCost={savingCost}
      />
      <WipAnalysisPanel
        buckets={buckets}
        workspace={workspace}
        onUpdateBucketSettings={onUpdateBucketSettings}
        savingBucket={savingBucket}
      />
    </div>
  );
}

export function BillingLineItemsPanel({
  project,
  payApps,
  lineItems,
  onGenerateLines,
  onUpdateLine,
  onSaveAllLines,
  onUpdatePayAppRetainageRate,
  onUpdateOutputFormat,
  onCreateInvoiceForApp,
  invoicedApplicationIds = [],
  recipientEmails = [],
  savingLine,
  savingAllLines,
  savingRetainageRate,
  savingOutputFormat,
  savingInvoice,
}: {
  project: ProjectRow;
  payApps: BillingApplicationRow[];
  lineItems: BillingLineItemRow[];
  onGenerateLines: (billingApplicationId: string) => void;
  onUpdateLine: (id: string, patch: LinePatch) => void;
  // Save-all: commit every changed line in one action. The field report was
  // that per-line saves were the only way work reached the rollup, so unsaved
  // lines silently never counted. Optional so consumers that don't wire it just
  // keep the per-line Save buttons.
  onSaveAllLines?: (items: { id: string; patch: LinePatch }[]) => void;
  onUpdatePayAppRetainageRate: (billingApplicationId: string, retainagePct: number) => void;
  onUpdateOutputFormat: (billingApplicationId: string, format: BillingOutputFormat) => void;
  // Close the loop: turn the generated application into a client invoice so it
  // posts to Receivables. The workspace builds the pre-filled draft from the app.
  onCreateInvoiceForApp?: (app: BillingApplicationRow) => void;
  // Application ids that already have an active invoice (persisted link) — drives
  // the "Invoiced" done state so the bill step is idempotent across reloads.
  invoicedApplicationIds?: string[];
  // Client billing contacts (can_view_billing) resolved by the workspace — used
  // to email the finalized package straight from the pay-app flow.
  recipientEmails?: string[];
  savingLine?: boolean;
  savingAllLines?: boolean;
  savingRetainageRate?: boolean;
  savingOutputFormat?: boolean;
  savingInvoice?: boolean;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  // Applications whose package was generated (downloaded/emailed) this session —
  // ephemeral; the durable "billed" milestone is the persisted invoice link.
  const [generatedAppIds, setGeneratedAppIds] = useState<string[]>([]);
  const firstDetailedPayAppId = lineItems[0]?.billing_application_id ?? payApps[0]?.id ?? "";
  const [activePayAppId, setActivePayAppId] = useState(firstDetailedPayAppId);
  const selectedPayAppId = activePayAppId || firstDetailedPayAppId;
  const selectedLines = lineItems.filter(
    (line) => line.billing_application_id === selectedPayAppId,
  );
  const selectedPayApp = payApps.find((app) => app.id === selectedPayAppId);
  const markGenerated = (appId: string) =>
    setGeneratedAppIds((prev) => (prev.includes(appId) ? prev : [...prev, appId]));
  const hasGeneratedSelected = generatedAppIds.includes(selectedPayAppId);
  const hasInvoiceSelected = invoicedApplicationIds.includes(selectedPayAppId);
  // Save-all needs each line editor's live draft. Editors report their current
  // patch + whether it differs from what's saved; the ref holds the latest
  // patch per line without re-rendering on each keystroke, and dirtyCount (only
  // re-set when the set of dirty lines changes) drives the button. Reset when
  // the application changes so drafts from another app never leak in.
  const lineDraftsRef = useRef<Map<string, LinePatch>>(new Map());
  const [dirtyCount, setDirtyCount] = useState(0);
  useEffect(() => {
    lineDraftsRef.current.clear();
    setDirtyCount(0);
  }, [selectedPayAppId]);
  const handleLineDraft = useCallback((id: string, patch: LinePatch, dirty: boolean) => {
    const drafts = lineDraftsRef.current;
    if (dirty) drafts.set(id, patch);
    else drafts.delete(id);
    setDirtyCount((prev) => (prev === drafts.size ? prev : drafts.size));
  }, []);
  const saveAllLines = () => {
    if (!onSaveAllLines) return;
    const items = Array.from(lineDraftsRef.current.entries()).map(([id, patch]) => ({ id, patch }));
    if (items.length > 0) onSaveAllLines(items);
  };
  // The application right before this one is where the carried-forward "previous"
  // numbers come from — naming it makes the memory trustworthy to the biller.
  const priorApp = useMemo(() => {
    const ordered = [...payApps].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
    const idx = ordered.findIndex((app) => app.id === selectedPayAppId);
    return idx > 0 ? ordered[idx - 1] : null;
  }, [payApps, selectedPayAppId]);
  const defaultRetainagePct = project.default_retainage_pct ?? 10;
  const selectedRetainagePct = selectedLines[0]?.retainage_pct ?? defaultRetainagePct;
  const hasMixedRetainagePct = selectedLines.some(
    (line) => Math.abs(line.retainage_pct - selectedRetainagePct) > 0.01,
  );
  const [retainagePctDraft, setRetainagePctDraft] = useState(
    formatPercentInput(selectedRetainagePct),
  );
  useEffect(() => {
    setRetainagePctDraft(formatPercentInput(selectedRetainagePct));
  }, [selectedPayAppId, selectedRetainagePct]);
  // Application totals sum in integer cents and convert once at the edge —
  // never accumulate float dollars on the money path.
  const totals = useMemo(() => {
    const cents = selectedLines.reduce(
      (sum, line) => {
        sum.scheduled += line.scheduled_value_cents;
        sum.co += line.change_order_value_cents;
        sum.previous += line.work_completed_previous_cents + line.materials_stored_previous_cents;
        sum.thisPeriod +=
          line.work_completed_this_period_cents + line.materials_stored_this_period_cents;
        sum.total += line.total_completed_and_stored_cents;
        sum.balance += line.balance_to_finish_cents;
        sum.retainage += line.retainage_held_cents - line.retainage_released_cents;
        return sum;
      },
      { scheduled: 0, co: 0, previous: 0, thisPeriod: 0, total: 0, balance: 0, retainage: 0 },
    );
    return {
      scheduled: centsToDollars(cents.scheduled),
      co: centsToDollars(cents.co),
      previous: centsToDollars(cents.previous),
      thisPeriod: centsToDollars(cents.thisPeriod),
      total: centsToDollars(cents.total),
      balance: centsToDollars(cents.balance),
      retainage: centsToDollars(cents.retainage),
    };
  }, [selectedLines]);
  const showRetainageAmounts = selectedLines.some(
    (line) =>
      Math.abs(line.retainage_pct) > 0.01 ||
      Math.abs(line.retainage_held_cents - line.retainage_released_cents) > 0 ||
      line.retainage_released_cents > 0,
  );
  // Overbilled lines (G > C) drive the soft lender-rejection warning at
  // entry and the confirm at generation. BillingLineItemRow carries every
  // field the G703 math needs, so the live lines feed it directly.
  const overbilled = useMemo(() => overbilledLines(selectedLines), [selectedLines]);
  const linesWithActivity = selectedLines.filter(
    (line) =>
      line.work_completed_this_period_cents > 0 || line.materials_stored_this_period_cents > 0,
  ).length;
  const builderSnapshot = {
    outputFormat: (selectedPayApp?.output_format ?? "invoice") as "invoice" | "aia_g702",
    lineCount: selectedLines.length,
    linesWithActivity,
    overbilledCount: overbilled.length,
    hasGenerated: hasGeneratedSelected,
    hasInvoice: hasInvoiceSelected,
  };

  const releaseAll = () => {
    if (!selectedLines.length) return;
    const earlyLines = selectedLines.filter((line) => line.billing_percent_complete < 95);
    const message =
      earlyLines.length > 0
        ? `${earlyLines.length} line(s) are below 95% complete. Release all remaining retainage anyway?`
        : "Release all remaining retainage for this application?";
    if (!window.confirm(message)) return;
    selectedLines.forEach((line) =>
      onUpdateLine(line.id, {
        retainage_released: centsToDollars(line.retainage_held_cents),
      }),
    );
  };

  const applyRetainageRate = () => {
    if (!selectedPayApp) return;
    const nextPct = parsePercentInput(retainagePctDraft);
    setRetainagePctDraft(formatPercentInput(nextPct));
    onUpdatePayAppRetainageRate(selectedPayApp.id, nextPct);
  };

  const downloadAiaPdf = async () => {
    if (!selectedPayApp || selectedLines.length === 0) return;
    setPdfBusy(true);
    try {
      const bytes = await generateAiaBillingPdf({
        project,
        payApp: selectedPayApp,
        lineItems: selectedLines,
      });
      const filename = aiaBillingFilename(project, selectedPayApp);
      // Build the blob once and download it two ways. The automatic trigger
      // works in browsers that honor a programmatic click after an await
      // (Chrome). Safari/iOS silently drop the user-gesture across the await
      // above and suppress that click — which is why the package "wouldn't
      // download" in the field even after the blob-revoke fix. The toast's
      // Download action is a real user tap, so it always downloads; the same
      // blob backs both, so there is nothing left to go stale.
      const blob = bytesToBlob(bytes, "application/pdf");
      triggerBlobDownload(blob, filename);
      markGenerated(selectedPayApp.id);
      toast.success("AIA package ready", {
        description: "Your download should start automatically. If it didn't, tap Download.",
        action: { label: "Download", onClick: () => triggerBlobDownload(blob, filename) },
        duration: 12_000,
      });
    } catch (error) {
      toast.error("AIA package could not be generated", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setPdfBusy(false);
    }
  };

  // Email the finalized application to the client — the same proven path invoices
  // already use (transactional send → invoice-notification template → a secure
  // portal link where the client reviews and downloads the G702/G703). PDF
  // attachment is the planned follow-up.
  const emailPackage = async () => {
    if (!selectedPayApp) return;
    // Every billing contact gets it — the owner rep, the lender, the architect —
    // not just whoever happens to be first in the list.
    const recipients = Array.from(
      new Set(recipientEmails.map((email) => email.trim().toLowerCase()).filter(Boolean)),
    );
    if (recipients.length === 0) {
      toast.error("No client billing contact yet", {
        description:
          "Add a client contact who can view billing in the Client Portal tab, then email the application.",
      });
      return;
    }
    setEmailBusy(true);
    try {
      const portalUrl =
        typeof window === "undefined"
          ? `/client/projects/${project.id}`
          : `${window.location.origin}/client/projects/${project.id}`;
      const appLabel = billingDocumentLabel(
        selectedPayApp.application_number,
        selectedPayApp.invoice_number,
      );
      for (const recipient of recipients) {
        await sendTransactionalEmail({
          templateName: "invoice-notification",
          recipientEmail: recipient,
          idempotencyKey: `payapp:${selectedPayApp.id}:${recipient}:${Date.now()}`,
          templateData: {
            projectName: project.name,
            clientName: project.client,
            jobNumber: project.job_number,
            invoiceNumber: appLabel,
            invoiceTitle: appLabel,
            invoiceStatus: "Sent",
            portalUrl,
            paymentUrl: "",
            notes: "Your pay application is ready to review in the Overwatch client portal.",
          },
        });
      }
      markGenerated(selectedPayApp.id);
      toast.success("Application emailed", {
        description:
          recipients.length === 1
            ? `${appLabel} sent to ${recipients[0]} with a secure portal link.`
            : `${appLabel} sent to ${recipients.length} billing contacts with a secure portal link.`,
      });
    } catch (error) {
      toast.error("Email could not be sent", {
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      setEmailBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Applications: progress billing
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter percent complete or stored materials by SOV line. Overwatch calculates current
            work, retainage, totals, and the AIA continuation sheet.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={selectedPayAppId} onValueChange={setActivePayAppId}>
            <SelectTrigger className="w-full sm:w-[250px]">
              <SelectValue placeholder="Select application" />
            </SelectTrigger>
            <SelectContent>
              {payApps.map((app) => (
                <SelectItem key={app.id} value={app.id}>
                  {billingDocumentLabel(app.application_number, app.invoice_number)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1.5"
            disabled={selectedLines.length === 0 || !showRetainageAmounts}
            onClick={releaseAll}
          >
            <Check className="h-3.5 w-3.5" /> Release retainage
          </Button>
        </div>
      </div>

      {/* The memory, named: this bill starts from the last one, so the biller
          trusts what's carried and only touches this period (BILLING P1a). */}
      {selectedPayApp ? (
        <div className="mt-3 rounded-md border border-hairline bg-surface px-3 py-2 text-xs leading-relaxed text-muted-foreground">
          {priorApp ? (
            <>
              <span className="font-medium text-foreground">
                Carried forward from{" "}
                {billingDocumentLabel(priorApp.application_number, priorApp.invoice_number)}:
              </span>{" "}
              {fmtUSD(totals.previous)} already certified. Enter only{" "}
              <span className="font-medium text-foreground">this period&rsquo;s</span> work below —
              Overwatch remembers the rest.
            </>
          ) : (
            <>
              This is the first application — nothing to carry forward yet. Enter this
              period&rsquo;s work below.
            </>
          )}
        </div>
      ) : null}

      {/* Always-visible progression: format, SOV import, entries, generate —
          each actionable or disabled-with-reason, never hidden (GP3 Task 0). */}
      {selectedPayApp ? (
        <div className="mt-4">
          <AiaApplicationStepper
            snapshot={builderSnapshot}
            overbilled={overbilled}
            canImport={Boolean(selectedPayApp)}
            generating={pdfBusy}
            savingFormat={savingOutputFormat}
            emailing={emailBusy}
            onSetOutputFormat={(format) => onUpdateOutputFormat(selectedPayApp.id, format)}
            onImportSov={() => onGenerateLines(selectedPayApp.id)}
            onGenerate={downloadAiaPdf}
            onEmail={emailPackage}
            invoiceExists={hasInvoiceSelected}
            billableAmountLabel={fmtUSD(selectedPayApp.amount_billed ?? 0)}
            savingInvoice={savingInvoice}
            onBillOwner={
              onCreateInvoiceForApp ? () => onCreateInvoiceForApp(selectedPayApp) : undefined
            }
          />
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
        {selectedLines.length === 0 ? (
          <div className="rounded-md border border-hairline bg-surface py-9 text-center text-sm text-muted-foreground">
            Use step 2 above to import your schedule of values, then enter percent complete and
            stored materials by cost code. Approved change orders allocated to a cost code are added
            to the matching line.
          </div>
        ) : (
          <>
            <div className="rounded-md border border-hairline bg-surface p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Application totals
              </div>
              <div
                className={`mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${
                  showRetainageAmounts ? "xl:grid-cols-7" : "xl:grid-cols-6"
                }`}
              >
                <BillingDetail label="Original SOV" value={fmtUSD(totals.scheduled)} />
                <BillingDetail
                  label="Approved COs included"
                  value={fmtUSD(totals.co)}
                  sub="Added to line contract values"
                  tone={totals.co > 0 ? "warning" : undefined}
                />
                <BillingDetail label="Previous certified" value={fmtUSD(totals.previous)} />
                <BillingDetail label="Current work" value={fmtUSD(totals.thisPeriod)} />
                <BillingDetail label="Total complete/stored" value={fmtUSD(totals.total)} />
                <BillingDetail label="Balance to finish" value={fmtUSD(totals.balance)} />
                {showRetainageAmounts ? (
                  <BillingDetail label="Retainage" value={fmtUSD(totals.retainage)} />
                ) : null}
              </div>
            </div>
            <ApplicationChangeOrderBridge selectedLines={selectedLines} />
            <div className="rounded-md border border-hairline bg-surface p-4">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    Retainage / retention rate
                  </div>
                  <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                    Enter the retainage percentage for this application. Withheld retainage is
                    calculated from completed work and stored materials. Use 0% when the job does
                    not hold retainage.
                  </p>
                  {hasMixedRetainagePct ? (
                    <p className="mt-1 text-xs text-warning">
                      This application has mixed line rates. Apply a rate to make every line match,
                      or edit individual lines below.
                    </p>
                  ) : null}
                </div>
                <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[270px] sm:flex-row sm:items-end">
                  <div className="space-y-1.5 sm:w-28">
                    <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                      Retainage %
                    </Label>
                    <div className="relative">
                      <Input
                        value={retainagePctDraft}
                        inputMode="decimal"
                        className="h-9 pr-7 text-right tabular"
                        onChange={(event) => setRetainagePctDraft(event.target.value)}
                      />
                      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                        %
                      </span>
                    </div>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-9 gap-1.5"
                    disabled={savingRetainageRate || selectedLines.length === 0}
                    onClick={applyRetainageRate}
                  >
                    <Save className="h-3.5 w-3.5" />
                    {savingRetainageRate ? "Applying..." : "Apply rate"}
                  </Button>
                </div>
              </div>
            </div>
            {onSaveAllLines ? (
              <div className="flex flex-col gap-2 rounded-md border border-hairline bg-surface p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-xs text-muted-foreground">
                  {dirtyCount > 0 ? (
                    <>
                      <span className="font-medium text-foreground">
                        {dirtyCount} line{dirtyCount === 1 ? "" : "s"}
                      </span>{" "}
                      with unsaved entries — save all at once so the application totals roll up.
                    </>
                  ) : (
                    "Every line entry is saved."
                  )}
                </div>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5 sm:w-auto"
                  disabled={dirtyCount === 0 || savingAllLines}
                  onClick={saveAllLines}
                >
                  <Save className="h-3.5 w-3.5" />
                  {savingAllLines
                    ? "Saving all…"
                    : dirtyCount > 0
                      ? `Save all lines (${dirtyCount})`
                      : "Save all lines"}
                </Button>
              </div>
            ) : null}
            {selectedLines.map((line) => (
              <BillingLineItemEditor
                key={line.id}
                line={line}
                saving={savingLine}
                onSave={(patch) => onUpdateLine(line.id, patch)}
                onDraftChange={handleLineDraft}
              />
            ))}
          </>
        )}
      </div>
    </section>
  );
}

function ApplicationChangeOrderBridge({ selectedLines }: { selectedLines: BillingLineItemRow[] }) {
  const originalSov = centsToDollars(
    selectedLines.reduce((sum, line) => sum + line.scheduled_value_cents, 0),
  );
  const approvedCoTotal = centsToDollars(
    selectedLines.reduce((sum, line) => sum + line.change_order_value_cents, 0),
  );
  const coLines = selectedLines.filter((line) => line.change_order_value_cents > 0);

  return (
    <div className="rounded-md border border-accent/25 bg-accent/5 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Change orders in this application
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Approved change orders become billable here only after they are allocated to an SOV cost
            code. Each application line uses{" "}
            <span className="font-medium text-foreground">Original SOV + approved COs</span> as the
            contract value. Pending or unallocated COs stay out of the application.
          </p>
        </div>
        <div className="grid min-w-0 gap-2 sm:grid-cols-3 lg:min-w-[480px]">
          <BillingDetail label="Original SOV" value={fmtUSD(originalSov)} />
          <BillingDetail
            label="Approved COs"
            value={fmtUSD(approvedCoTotal)}
            tone={approvedCoTotal > 0 ? "warning" : undefined}
          />
          <BillingDetail label="Revised contract" value={fmtUSD(originalSov + approvedCoTotal)} />
        </div>
      </div>

      {coLines.length === 0 ? (
        <div className="mt-3 rounded-md border border-hairline bg-card px-3 py-3 text-sm text-muted-foreground">
          No approved and allocated change-order value is included in this application yet. Approve
          the CO, allocate it to the correct cost code, then pull the next application from the SOV
          so it becomes billable.
        </div>
      ) : (
        <div className="mt-3 grid gap-3 lg:grid-cols-2">
          {coLines.map((line) => {
            const original = centsToDollars(line.scheduled_value_cents);
            const approvedCo = centsToDollars(line.change_order_value_cents);
            return (
              <div key={line.id} className="rounded-md border border-hairline bg-card p-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                  {line.cost_code || "No code"}
                </div>
                <div className="mt-1 text-sm font-medium text-foreground">{line.description}</div>
                <div className="mt-3 grid gap-2 sm:grid-cols-3">
                  <BillingDetail label="Original SOV" value={fmtUSD(original)} />
                  <BillingDetail label="Approved COs" value={fmtUSD(approvedCo)} tone="warning" />
                  <BillingDetail
                    label="Billable line value"
                    value={fmtUSD(original + approvedCo)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function BillingLineItemEditor({
  line,
  saving,
  onSave,
  onDraftChange,
}: {
  line: BillingLineItemRow;
  saving?: boolean;
  onSave: (patch: LinePatch) => void;
  // Reports this line's current draft + whether it differs from what's saved,
  // so the parent's "Save all lines" can commit every changed line at once.
  onDraftChange?: (id: string, patch: LinePatch, dirty: boolean) => void;
}) {
  const [work, setWork] = useState(centsToDollars(line.work_completed_this_period_cents));
  const [stored, setStored] = useState(centsToDollars(line.materials_stored_this_period_cents));
  const [retainagePct, setRetainagePct] = useState(formatPercentInput(line.retainage_pct));
  const [released, setReleased] = useState(centsToDollars(line.retainage_released_cents));
  const [targetCompletePct, setTargetCompletePct] = useState(
    formatPercentInput(line.billing_percent_complete),
  );
  const [entryMode, setEntryMode] = useState<"percent" | "dollars">("percent");
  useEffect(() => {
    setWork(centsToDollars(line.work_completed_this_period_cents));
    setStored(centsToDollars(line.materials_stored_this_period_cents));
    setRetainagePct(formatPercentInput(line.retainage_pct));
    setReleased(centsToDollars(line.retainage_released_cents));
    setTargetCompletePct(formatPercentInput(line.billing_percent_complete));
    setEntryMode("percent");
  }, [
    line.id,
    line.work_completed_this_period_cents,
    line.materials_stored_this_period_cents,
    line.retainage_pct,
    line.retainage_released_cents,
    line.billing_percent_complete,
  ]);
  // The patch this line would save, and whether it differs from what's stored.
  // Reported up (below) so "Save all lines" can commit every changed line at
  // once — a line whose draft equals its saved values is not resent.
  const draftPatch = useMemo<LinePatch>(
    () => ({
      work_completed_this_period: work,
      materials_stored_this_period: stored,
      retainage_pct: parsePercentInput(retainagePct),
      retainage_released: released,
    }),
    [work, stored, retainagePct, released],
  );
  const dirty =
    dollarsToCents(work) !== line.work_completed_this_period_cents ||
    dollarsToCents(stored) !== line.materials_stored_this_period_cents ||
    Math.abs(parsePercentInput(retainagePct) - line.retainage_pct) > 1e-9 ||
    dollarsToCents(released) !== line.retainage_released_cents;
  useEffect(() => {
    onDraftChange?.(line.id, draftPatch, dirty);
  }, [line.id, draftPatch, dirty, onDraftChange]);
  // All draft math runs in integer cents; dollars exist only at the edges so
  // the value the contractor sees is exactly the value that saves.
  const previousCents = line.work_completed_previous_cents + line.materials_stored_previous_cents;
  const previous = centsToDollars(previousCents);
  const contractCents = line.scheduled_value_cents + line.change_order_value_cents;
  const contractValue = centsToDollars(contractCents);
  const draftCompletedStoredCents = previousCents + dollarsToCents(work) + dollarsToCents(stored);
  const draftCompletedStored = centsToDollars(draftCompletedStoredCents);
  const draftBalance = centsToDollars(contractCents - draftCompletedStoredCents);
  const draftCompletePct =
    contractCents > 0 ? clampPercent((draftCompletedStoredCents / contractCents) * 100) : 0;
  // Unclamped, so the overbilling warning can name the true overage (e.g.
  // 108.8%) instead of the display-capped 100%.
  const draftCompletePctRaw =
    contractCents > 0 ? (draftCompletedStoredCents / contractCents) * 100 : 0;
  const draftRetainageHeld = centsToDollars(
    Math.max(
      0,
      percentOfCents(draftCompletedStoredCents, parsePercentInput(retainagePct)) -
        dollarsToCents(released),
    ),
  );
  const overbilled = draftBalance < 0;
  const workForPercent = (pctValue: number, storedValue = stored) =>
    centsToDollars(
      lineWorkForPercentCents({
        contractCents,
        targetPercent: clampPercent(pctValue),
        previousCents,
        storedCents: dollarsToCents(storedValue),
      }),
    );
  const updateCompletePct = (value: string) => {
    setEntryMode("percent");
    setTargetCompletePct(value);
    setWork(workForPercent(parsePercentInput(value)));
  };
  const updateStored = (value: number) => {
    setStored(value);
    if (entryMode === "percent") {
      setWork(workForPercent(parsePercentInput(targetCompletePct), value));
    }
  };
  const updateWork = (value: number) => {
    setEntryMode("dollars");
    setWork(value);
    const nextPct =
      contractCents > 0
        ? ((previousCents + dollarsToCents(value) + dollarsToCents(stored)) / contractCents) * 100
        : 0;
    setTargetCompletePct(formatPercentInput(clampPercent(nextPct)));
  };

  return (
    <div
      className={`rounded-md border border-hairline bg-card p-4 ${overbilled ? "border-danger/30 bg-danger/5" : ""}`}
    >
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {line.cost_code || "No code"} · {line.billing_method}
          </div>
          <div className="mt-1 font-medium text-foreground">{line.description}</div>
        </div>
        <div className="grid gap-2 sm:grid-cols-3 lg:w-full xl:max-w-[420px]">
          <BillingDetail label="Total complete/stored" value={fmtUSD(draftCompletedStored)} />
          <BillingDetail label="Complete to date" value={fmtPct(draftCompletePct)} />
          <BillingDetail
            label="Balance to finish"
            value={fmtUSD(draftBalance)}
            tone={overbilled ? "danger" : undefined}
          />
        </div>
      </div>
      {/* Overbilling guardrail at entry (GP3 Task 1): soft warning naming the
          line and its overage — a flag the estimator decides on, not a block. */}
      {overbilled ? (
        <div className="mt-3 flex items-start gap-1.5 rounded-md border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {line.description || line.cost_code || "This line"} bills to{" "}
            {fmtPct(draftCompletePctRaw)} of scheduled value — lenders typically reject lines over
            100%; reallocate via change order or adjust.
          </span>
        </div>
      ) : null}
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <BillingDetail label="Contract value" value={fmtUSD(contractValue)} />
        <BillingDetail label="Previous" value={fmtUSD(previous)} />
        <div className="space-y-1.5 rounded-md border border-accent/25 bg-accent/5 px-3 py-2">
          <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Complete to date %
          </Label>
          <div className="relative">
            <Input
              value={targetCompletePct}
              inputMode="decimal"
              className="h-9 pr-7 text-right tabular"
              onChange={(event) => updateCompletePct(event.target.value)}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              %
            </span>
          </div>
          <div className="text-right text-[11px] text-muted-foreground">
            Draft {fmtPct(draftCompletePct)}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Current work
          </Label>
          <MoneyInput value={work} onValueChange={updateWork} align="right" />
          <div className="text-right text-[11px] text-muted-foreground">
            {entryMode === "percent" ? "Calculated from %" : "Manual override"}
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Stored
          </Label>
          <MoneyInput value={stored} onValueChange={updateStored} align="right" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Retainage %
          </Label>
          <div className="relative">
            <Input
              value={retainagePct}
              inputMode="decimal"
              className="h-9 pr-7 text-right tabular"
              onChange={(event) => setRetainagePct(event.target.value)}
            />
            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
              %
            </span>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Retainage release
          </Label>
          <MoneyInput value={released} onValueChange={setReleased} align="right" />
        </div>
      </div>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <BillingDetail
          label="Draft retainage held"
          value={fmtUSD(draftRetainageHeld)}
          className="sm:w-[180px]"
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-9 gap-1.5 sm:w-auto"
          disabled={saving}
          onClick={() => onSave(draftPatch)}
        >
          <Save className="h-3.5 w-3.5" /> Save line
        </Button>
      </div>
    </div>
  );
}

export function ProjectCostTrackingPanel({
  projectId,
  buckets,
  costActuals,
  onCreateCostActual,
  onImportCostActuals,
  onVoidCostActual,
  onSetCostActualStatus,
  onUpdateCostActual,
  savingCost,
  selfPerformByBucket,
}: {
  projectId: string;
  buckets: BucketRow[];
  costActuals: CostActualRow[];
  onCreateCostActual: (input: CostActualDraft) => Promise<unknown>;
  onImportCostActuals: (input: { source_name: string; rows: CostActualImportRow[] }) => void;
  onVoidCostActual: (id: string, notes: string) => void;
  onSetCostActualStatus: (
    id: string,
    status: "approved" | "paid",
    payment?: CostPaymentDetails,
  ) => void;
  onUpdateCostActual: (id: string, input: CostActualDraft) => void | Promise<unknown>;
  savingCost?: boolean;
  // Self-perform daily WIP folded into each bucket's actual (id → dollars, NET of
  // already-settled offsets). Drives the per-line "Settles daily WIP" suggestion
  // so a vendor invoice can displace the lump it covers instead of double-counting.
  selfPerformByBucket?: ReadonlyMap<string, number>;
}) {
  const [open, setOpen] = useState(false);
  // When set, the dialog is editing this existing row instead of adding.
  const [editingCostId, setEditingCostId] = useState<string | null>(null);
  // Mark-paid capture (field request 2026-07-10): the cost being marked paid,
  // plus the "how was this paid" draft. Both mark-paid entry points open this.
  const [payingCost, setPayingCost] = useState<CostActualRow | null>(null);
  const [payDraft, setPayDraft] = useState<CostPaymentDetails>({
    payment_method: "check",
    payment_reference: "",
    paid_date: today(),
  });
  const openPayDialog = (actual: CostActualRow) => {
    setPayDraft({ payment_method: "check", payment_reference: "", paid_date: today() });
    setPayingCost(actual);
  };
  const confirmPaid = () => {
    if (!payingCost) return;
    onSetCostActualStatus(payingCost.id, "paid", payDraft);
    setPayingCost(null);
  };
  // Read-at-a-glance controls for the backup list (field request 2026-07-10):
  // filter by stage, search by name/vendor/reference.
  const [costStatusFilter, setCostStatusFilter] = useState<"all" | CostActualRow["status"]>("all");
  const [costSearch, setCostSearch] = useState("");
  // The "Add a new vendor" details window (name prefilled from the picker).
  const [vendorDraft, setVendorDraft] = useState<{
    name: string;
    trade: string;
    contact_name: string;
    contact_email: string;
    contact_phone: string;
    address: string;
  } | null>(null);
  const [savingVendor, setSavingVendor] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [invoiceFile, setInvoiceFile] = useState<File | null>(null);
  const [uploadingInvoice, setUploadingInvoice] = useState(false);
  // The Vendor field is a pick-or-add over BOTH org directories (vendors +
  // subs) — a cost's payee is one or the other. Self-contained queries, like
  // DailyWipWorkspace; both degrade to empty before their migrations.
  const queryClient = useQueryClient();
  const listVendorsFn = useServerFn(listVendors);
  const listSubsFn = useServerFn(listSubcontractors);
  const findOrCreateVendorFn = useServerFn(findOrCreateVendor);
  const saveVendorFn = useServerFn(saveVendor);
  const vendorsQuery = useQuery({
    queryKey: ["vendors-directory"],
    queryFn: () => listVendorsFn(),
    staleTime: 30_000,
  });
  const subsQuery = useQuery({
    queryKey: ["subcontractors-directory"],
    queryFn: () => listSubsFn(),
    staleTime: 30_000,
  });
  const vendorNames = (vendorsQuery.data ?? []).map((vendor) => vendor.name);
  const subNames = (subsQuery.data ?? []).map((sub) => sub.name);
  // Enrolling a new name in the vendor directory is best-effort: the cost row
  // is the real record and saves regardless; a directory hiccup stays silent.
  const enrollVendor = useMutation({
    mutationFn: (name: string) => findOrCreateVendorFn({ data: { name } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["vendors-directory"] }),
    onError: () => {},
  });

  // New invoices land as a draft (field request 2026-07-09) — nothing hits job
  // cost until someone approves the spend or marks it paid.
  const [draft, setDraft] = useState<CostActualDraft>(() => ({
    cost_bucket_id: buckets[0]?.id ?? null,
    cost_code: buckets[0]?.cost_code ?? "",
    description: "",
    category: "subcontract",
    amount: 0,
    vendor: "",
    reference_number: "",
    cost_date: today(),
    status: "draft",
    notes: "",
    daily_wip_offset: 0,
    invoice_attachment_path: "",
    invoice_attachment_name: "",
    invoice_attachment_type: "",
    invoice_attachment_size: 0,
  }));
  // Once the user hand-edits the PRIMARY line's offset, stop auto-suggesting it.
  const [primaryOffsetTouched, setPrimaryOffsetTouched] = useState(false);
  // Multi-line cost entry (field feedback 2026-07-13): extra cost-code lines on
  // the SAME invoice. Each shares the invoice-level fields on `draft` (vendor,
  // reference #, date, category, stage, notes); only the cost code, description,
  // and amount vary. Create-path only — editing an existing cost stays single.
  const [extraLines, setExtraLines] = useState<ExtraCostLine[]>([]);
  const addExtraLine = () =>
    setExtraLines((lines) => [
      ...lines,
      {
        cost_bucket_id: buckets[0]?.id ?? null,
        cost_code: buckets[0]?.cost_code ?? "",
        description: "",
        amount: 0,
        daily_wip_offset: 0,
        offsetTouched: false,
      },
    ]);
  const updateExtraLine = (index: number, patch: Partial<ExtraCostLine>) =>
    setExtraLines((lines) => lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  const removeExtraLine = (index: number) =>
    setExtraLines((lines) => lines.filter((_, i) => i !== index));
  const chooseExtraLineBucket = (index: number, bucketId: string) => {
    const bucket = bucketId === "unmatched" ? undefined : buckets.find((b) => b.id === bucketId);
    updateExtraLine(index, {
      cost_bucket_id: bucket?.id ?? null,
      cost_code: bucket?.cost_code ?? "",
    });
  };
  // An added line "counts" once it carries an amount or a description; a blank
  // one is ignored on save. Every counted line still needs a description (the
  // server requires one), which gates the Save button.
  const activeExtraLines = extraLines.filter(
    (line) => line.amount !== 0 || line.description.trim() !== "",
  );
  const extraLinesValid = activeExtraLines.every((line) => line.description.trim() !== "");
  // The details window's save: build the vendor out in the directory, then
  // select it into the cost being entered.
  const editingCost = editingCostId
    ? (costActuals.find((actual) => actual.id === editingCostId) ?? null)
    : null;
  const currentInvoiceAttachment: CostActualInvoiceAttachment | null = draft.invoice_attachment_path
    ? {
        path: draft.invoice_attachment_path,
        name: draft.invoice_attachment_name,
        type: draft.invoice_attachment_type,
        size: draft.invoice_attachment_size,
      }
    : null;
  const costSaveBusy = Boolean(savingCost || uploadingInvoice);

  // ── Daily-WIP settlement (field feedback 2026-07-13) ──────────────────────
  // A self-perform daily-WIP lump is folded into a bucket's actual at read time;
  // when the vendor invoice for it is later recorded as a cost it would hit the
  // SAME bucket actual again (a DB trigger) → double-counted. Each cost LINE can
  // "settle" the daily WIP it covers; the settled dollars are netted out of the
  // WIP rollup at the server chokepoint (buildSelfPerformByBucket), floored at 0.
  //
  // `selfPerformByBucket` here is ALREADY NET of every RECOGNIZED recorded
  // offset, so that value IS the daily WIP still unsettled for a bucket — we do
  // NOT re-subtract recorded offsets (that would double-count the netting). When
  // editing a row, add back its own stored offset so an edit never clamps below
  // the value the PM already saved. Cents-safe, floored at 0.
  const unsettledWip = (bucketId: string | null, addBackOwn = 0): number => {
    if (!bucketId) return 0;
    const netCents = dollarsToCents(selfPerformByBucket?.get(bucketId) ?? 0);
    return centsToDollars(Math.max(0, netCents + dollarsToCents(Math.max(0, addBackOwn))));
  };
  // Clamp an offset to 0..min(amount, unsettled). A credit (amount < 0) can never
  // settle daily WIP, so it forces 0. Cents-safe.
  const clampOffset = (offset: number, amount: number, unsettled: number): number => {
    if (amount < 0) return 0;
    return centsToDollars(
      Math.max(
        0,
        Math.min(dollarsToCents(offset), dollarsToCents(amount), dollarsToCents(unsettled)),
      ),
    );
  };
  // The offset a line actually submits: auto-suggested to min(amount, unsettled)
  // until the user hand-edits it (`touched`), then the clamped hand-set value.
  const effectiveOffset = (
    bucketId: string | null,
    amount: number,
    storedOffset: number,
    touched: boolean,
    addBackOwn = 0,
  ): number => {
    const unsettled = unsettledWip(bucketId, addBackOwn);
    return touched
      ? clampOffset(storedOffset, amount, unsettled)
      : clampOffset(unsettled, amount, unsettled);
  };
  // The editing row's own stored offset (added back to its headroom on edit).
  const primaryOffsetAddBack = editingCostId ? (editingCost?.daily_wip_offset ?? 0) : 0;
  const primaryUnsettled = unsettledWip(draft.cost_bucket_id, primaryOffsetAddBack);
  const primaryOffsetValue = effectiveOffset(
    draft.cost_bucket_id,
    draft.amount,
    draft.daily_wip_offset,
    primaryOffsetTouched,
    primaryOffsetAddBack,
  );
  const showPrimaryOffset = draft.amount >= 0 && primaryUnsettled > 0;
  // The backup list after the stage filter + search — used by the grid AND the
  // "nothing matches" empty state so they can never disagree.
  const visibleCostActuals = costActuals
    .filter((actual) => costStatusFilter === "all" || actual.status === costStatusFilter)
    .filter((actual) => {
      const query = costSearch.trim().toLowerCase();
      if (!query) return true;
      return [actual.description, actual.vendor, actual.reference_number, actual.cost_code]
        .join(" ")
        .toLowerCase()
        .includes(query);
    });
  const saveVendorDetails = async () => {
    if (!vendorDraft || !vendorDraft.name.trim()) return;
    setSavingVendor(true);
    try {
      const saved = await saveVendorFn({ data: vendorDraft });
      queryClient.invalidateQueries({ queryKey: ["vendors-directory"] });
      setDraft((current) => ({ ...current, vendor: saved.name }));
      setVendorDraft(null);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Could not save the vendor.");
    } finally {
      setSavingVendor(false);
    }
  };
  const activeActuals = costActuals.filter((actual) => actual.status !== "void");
  // Drafts are logged but unvetted — they sit in the approval queue, not in any
  // cost number. Everything else non-void is incurred cost.
  const draftActuals = activeActuals.filter((actual) => actual.status === "draft");
  const approvedActuals = activeActuals.filter((actual) => actual.status === "approved");
  const costedActuals = activeActuals.filter((actual) => actual.status !== "draft");
  const totalDraft = centsToDollars(sumDollarsToCents(draftActuals.map((actual) => actual.amount)));
  const totalApproved = centsToDollars(
    sumDollarsToCents(approvedActuals.map((actual) => actual.amount)),
  );
  const totalCommitted = centsToDollars(
    sumDollarsToCents(
      activeActuals
        .filter((actual) => actual.status === "committed" || actual.status === "approved")
        .map((actual) => actual.amount),
    ),
  );
  const totalPaid = centsToDollars(
    sumDollarsToCents(
      activeActuals.filter((actual) => actual.status === "paid").map((actual) => actual.amount),
    ),
  );
  const totalBudget = centsToDollars(
    sumDollarsToCents(buckets.map((bucket) => bucket.original_budget)),
  );
  const totalActual = centsToDollars(
    sumDollarsToCents(buckets.map((bucket) => bucket.actual_to_date)),
  );
  const totalFtc = centsToDollars(sumDollarsToCents(buckets.map((bucket) => bucket.ftc)));
  const projectedCost = centsToDollars(dollarsToCents(totalActual) + dollarsToCents(totalFtc));
  const budgetVariance = centsToDollars(
    dollarsToCents(totalBudget) - dollarsToCents(projectedCost),
  );
  // Ledger backup compares against bucket actual_to_date, which excludes
  // drafts — so drafts stay out of the backup sums too.
  const costBackupTotal = centsToDollars(
    sumDollarsToCents(costedActuals.map((actual) => actual.amount)),
  );
  const unmatchedActualCount = activeActuals.filter((actual) => !actual.cost_bucket_id).length;
  const backupCentsByBucket = costedActuals.reduce((map, actual) => {
    if (!actual.cost_bucket_id) return map;
    map.set(
      actual.cost_bucket_id,
      (map.get(actual.cost_bucket_id) ?? 0) + dollarsToCents(actual.amount),
    );
    return map;
  }, new Map<string, number>());

  const chooseBucket = (bucketId: string) => {
    const bucket = buckets.find((item) => item.id === bucketId);
    setDraft({
      ...draft,
      cost_bucket_id: bucket?.id ?? null,
      cost_code: bucket?.cost_code ?? "",
    });
  };

  const startEditCost = (actual: CostActualRow) => {
    setExtraLines([]);
    // Editing carries the stored offset through; treat it as user-set so we never
    // auto-suggest over what the PM already chose on this row.
    setPrimaryOffsetTouched(true);
    setDraft({
      cost_bucket_id: actual.cost_bucket_id,
      cost_code: actual.cost_code,
      description: actual.description,
      category: actual.category,
      amount: actual.amount,
      vendor: actual.vendor,
      reference_number: actual.reference_number,
      cost_date: actual.cost_date,
      status: "draft",
      notes: actual.notes,
      daily_wip_offset: actual.daily_wip_offset ?? 0,
      invoice_attachment_path: actual.invoice_attachment_path,
      invoice_attachment_name: actual.invoice_attachment_name,
      invoice_attachment_type: actual.invoice_attachment_type,
      invoice_attachment_size: actual.invoice_attachment_size,
    });
    setEditingCostId(actual.id);
    setOpen(true);
  };

  const resetCostForm = () => {
    setOpen(false);
    setEditingCostId(null);
    setExtraLines([]);
    setPrimaryOffsetTouched(false);
    setInvoiceFile(null);
    setDraft({
      cost_bucket_id: buckets[0]?.id ?? null,
      cost_code: buckets[0]?.cost_code ?? "",
      description: "",
      category: "subcontract",
      amount: 0,
      vendor: "",
      reference_number: "",
      cost_date: today(),
      status: "draft",
      notes: "",
      daily_wip_offset: 0,
      invoice_attachment_path: "",
      invoice_attachment_name: "",
      invoice_attachment_type: "",
      invoice_attachment_size: 0,
    });
  };

  // Pick-or-add: a typed vendor name neither directory knows becomes a vendor
  // (best-effort — the cost row is the real record). Called on every path that
  // commits the form. (This call was dropped from save() during #266's rebase;
  // without it a brand-new vendor never reached the directory.)
  const enrollTypedVendor = () => {
    const vendorName = draft.vendor.trim();
    if (!vendorName) return;
    const known = [...vendorNames, ...subNames].some(
      (name) => name.toLowerCase() === vendorName.toLowerCase(),
    );
    if (!known) enrollVendor.mutate(vendorName);
  };

  const save = async () => {
    let uploadedPath = "";
    let savedRows = 0;
    let nextDraft = { ...draft, daily_wip_offset: primaryOffsetValue };

    if (invoiceFile) {
      setUploadingInvoice(true);
      try {
        const prepared = await prepareAttachmentForUpload(invoiceFile);
        const safeName = prepared.uploadName.replace(/[^a-zA-Z0-9._-]+/g, "-") || "invoice";
        uploadedPath = `${projectId}/cost-actuals/${crypto.randomUUID()}-${safeName}`;
        const { error } = await supabase.storage
          .from("project-docs")
          .upload(uploadedPath, prepared.blob, {
            contentType: prepared.contentType,
            upsert: false,
          });
        if (error) throw new Error(error.message);
        nextDraft = {
          ...nextDraft,
          invoice_attachment_path: uploadedPath,
          invoice_attachment_name: invoiceFile.name,
          invoice_attachment_type: prepared.contentType,
          invoice_attachment_size: prepared.bytes,
        };
      } catch (error) {
        toast.error("Invoice did not upload", {
          description: error instanceof Error ? error.message : "Try again.",
        });
        setUploadingInvoice(false);
        return;
      }
    }

    try {
      if (editingCostId) {
        // Await the edit: if the server refuses (row went paid under us, or the
        // network dropped), the mutation's own toast explains why and the dialog
        // stays open with the typed changes intact.
        await onUpdateCostActual(editingCostId, nextDraft);
        savedRows = 1;
      } else {
        await onCreateCostActual(nextDraft);
        savedRows += 1;
        // Extra cost-code lines on the same invoice inherit every shared field
        // from the draft, including the same invoice attachment. Each line's
        // offset is the clamped effective value.
        for (const line of activeExtraLines) {
          await onCreateCostActual({
            ...nextDraft,
            cost_bucket_id: line.cost_bucket_id,
            cost_code: line.cost_code,
            description: line.description,
            amount: line.amount,
            daily_wip_offset: effectiveOffset(
              line.cost_bucket_id,
              line.amount,
              line.daily_wip_offset,
              !!line.offsetTouched,
            ),
          });
          savedRows += 1;
        }
      }
    } catch {
      // If no cost row accepted the uploaded object, remove it so a failed save
      // does not leave invisible bytes behind. A multi-line partial save keeps
      // the shared file because the first accepted row still references it.
      if (uploadedPath && savedRows === 0) {
        await supabase.storage.from("project-docs").remove([uploadedPath]);
      }
      setUploadingInvoice(false);
      return;
    }

    setUploadingInvoice(false);
    enrollTypedVendor();
    resetCostForm();
  };

  // Advance an open draft straight from the edit dialog (field request 2026-07-09:
  // "no button to approve or mark paid" from the editor). Persist any pending
  // edits FIRST so nothing typed is lost, and AWAIT that save so the row is still
  // a draft when the status change lands (updateCostActual only accepts drafts).
  const advanceDraft = async (status: "approved" | "paid") => {
    if (!editingCostId) return;
    const row = editingCost;
    try {
      await onUpdateCostActual(editingCostId, { ...draft, daily_wip_offset: primaryOffsetValue });
    } catch {
      return; // the update's own error toast already fired — don't advance
    }
    enrollTypedVendor();
    // Marking paid asks HOW it was paid — persist the edits, close the editor,
    // then open the payment-details dialog. Approving stays a direct transition.
    if (status === "paid" && row) {
      resetCostForm();
      openPayDialog(row);
      return;
    }
    onSetCostActualStatus(editingCostId, status);
    resetCostForm();
  };

  const importCsv = (file: File) => {
    Papa.parse<Record<string, unknown>>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (result) => {
        const rows = result.data
          .map(normalizeCostImportRow)
          .filter((row): row is CostActualImportRow => Boolean(row));
        if (rows.length === 0) {
          window.alert(
            "No valid cost rows were found. Check the CSV headers and amount/date fields.",
          );
          return;
        }
        onImportCostActuals({ source_name: file.name, rows });
      },
      error: (error) => {
        window.alert(error.message || "Cost CSV could not be parsed.");
      },
    });
  };

  return (
    <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Cost ledger: job-cost backup
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">
              This is where vendor bills, subcontract commitments, labor, material, and paid costs
              are tracked.
            </span>{" "}
            The SOV says what the owner can be billed. The Cost Ledger says what the job is costing
            you. WIP compares the two.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) importCsv(file);
              event.currentTarget.value = "";
            }}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={savingCost}
            onClick={() => importInputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" /> Import CSV
          </Button>
          <Dialog
            open={open}
            onOpenChange={(next) => {
              if (next) setOpen(true);
              else resetCostForm();
            }}
          >
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add cost
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-3xl">
              <DialogHeaderV2
                eyebrow="Cost"
                title={
                  editingCostId
                    ? editingCost?.status === "draft"
                      ? "Edit draft cost"
                      : "Edit cost"
                    : "Add cost actual"
                }
                description={
                  editingCostId
                    ? editingCost?.status === "draft"
                      ? "This invoice is still a draft — nothing has hit job cost, so every field is editable. Approve or mark it paid below."
                      : "This cost already counts in the job — changes here update the job-cost totals the moment you save."
                    : "Record cost backup against the same cost codes used by the SOV and WIP."
                }
              />
              <div className="grid gap-4 py-2">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label>Cost code</Label>
                    <Select
                      value={draft.cost_bucket_id ?? "unmatched"}
                      onValueChange={chooseBucket}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unmatched">Unmatched</SelectItem>
                        {buckets.map((bucket) => (
                          <SelectItem key={bucket.id} value={bucket.id}>
                            {bucket.cost_code ? `${bucket.cost_code} - ` : ""}
                            {bucket.bucket}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Category</Label>
                    <Select
                      value={draft.category}
                      onValueChange={(category) =>
                        setDraft({ ...draft, category: category as CostActualRow["category"] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="subcontract">Subcontract</SelectItem>
                        <SelectItem value="material">Material</SelectItem>
                        <SelectItem value="labor">Labor</SelectItem>
                        <SelectItem value="equipment">Equipment</SelectItem>
                        <SelectItem value="overhead">Overhead</SelectItem>
                        <SelectItem value="direct">Direct</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className={editingCostId ? "hidden" : "space-y-1.5"}>
                    <Label>Stage</Label>
                    <Select
                      value={draft.status}
                      onValueChange={(status) =>
                        setDraft({ ...draft, status: status as CostActualDraft["status"] })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft — needs approval</SelectItem>
                        <SelectItem value="approved">Approved for payment</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                        <SelectItem value="committed">Committed (obligation)</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-[11px] text-muted-foreground">
                      A draft doesn&apos;t count as job cost until it&apos;s approved or paid.
                    </p>
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-[1fr_150px_150px]">
                  <div className="space-y-1.5">
                    <Label>Description</Label>
                    <Input
                      value={draft.description}
                      onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Amount</Label>
                    <MoneyInput
                      value={draft.amount}
                      onValueChange={(amount) => setDraft({ ...draft, amount })}
                      align="right"
                      // Credits & refunds (field feedback 2026-07-13): a negative
                      // amount records a supplier credit and reduces this code's
                      // actuals.
                      allowNegative
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Date</Label>
                    <Input
                      type="date"
                      value={draft.cost_date}
                      onChange={(event) => setDraft({ ...draft, cost_date: event.target.value })}
                    />
                  </div>
                </div>
                <p className="-mt-1 text-[11px] text-muted-foreground">
                  Got money back? Enter a{" "}
                  <span className="font-medium text-foreground">negative amount</span> to record a
                  supplier credit or refund against this cost code.
                </p>
                {/* Settles daily WIP (field feedback 2026-07-13): if this cost
                    code already carries self-perform daily WIP folded into its
                    actual, settle the portion this invoice covers so the same
                    dollars aren't counted twice. Auto-suggested to the amount (up
                    to what's unsettled); editable down to 0. Hidden for credits. */}
                {showPrimaryOffset ? (
                  <div className="grid gap-3 rounded-md border border-hairline bg-surface/60 p-3 md:grid-cols-[1fr_150px] md:items-end">
                    <p className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {fmtUSD(primaryUnsettled)}
                      </span>{" "}
                      in daily WIP is logged on this cost code — settle what this invoice covers so
                      it isn&apos;t double-counted.
                    </p>
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Settles daily WIP</Label>
                      <MoneyInput
                        value={primaryOffsetValue}
                        onValueChange={(value) => {
                          setPrimaryOffsetTouched(true);
                          setDraft({
                            ...draft,
                            daily_wip_offset: clampOffset(value, draft.amount, primaryUnsettled),
                          });
                        }}
                        align="right"
                      />
                    </div>
                  </div>
                ) : null}
                {/* Multi-line entry (field feedback 2026-07-13): one supplier
                    invoice can span several cost codes. Add extra lines here —
                    each shares the vendor, reference #, date, category, and stage
                    below — instead of re-keying the whole form per code. Create
                    only; editing an existing cost stays single-line. */}
                {!editingCostId ? (
                  <div className="space-y-2.5 rounded-md border border-hairline bg-surface/60 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          More cost codes on this invoice
                        </div>
                        <p className="text-[11px] text-muted-foreground">
                          Split one invoice across codes — each line shares the vendor, reference #,
                          date, and stage.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-1.5"
                        onClick={addExtraLine}
                      >
                        <Plus className="h-3.5 w-3.5" /> Add line
                      </Button>
                    </div>
                    {extraLines.map((line, index) => {
                      const lineUnsettled = unsettledWip(line.cost_bucket_id);
                      const lineOffsetValue = effectiveOffset(
                        line.cost_bucket_id,
                        line.amount,
                        line.daily_wip_offset,
                        !!line.offsetTouched,
                      );
                      const showLineOffset = line.amount >= 0 && lineUnsettled > 0;
                      return (
                        <div key={index} className="space-y-1.5">
                          <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_150px_auto] md:items-end">
                            <div className="space-y-1">
                              <Label className="text-[11px]">Cost code</Label>
                              <Select
                                value={line.cost_bucket_id ?? "unmatched"}
                                onValueChange={(value) => chooseExtraLineBucket(index, value)}
                              >
                                <SelectTrigger>
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="unmatched">Unmatched</SelectItem>
                                  {buckets.map((bucket) => (
                                    <SelectItem key={bucket.id} value={bucket.id}>
                                      {bucket.cost_code ? `${bucket.cost_code} - ` : ""}
                                      {bucket.bucket}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px]">Description</Label>
                              <Input
                                value={line.description}
                                onChange={(event) =>
                                  updateExtraLine(index, { description: event.target.value })
                                }
                              />
                            </div>
                            <div className="space-y-1">
                              <Label className="text-[11px]">Amount</Label>
                              <MoneyInput
                                value={line.amount}
                                onValueChange={(amount) => updateExtraLine(index, { amount })}
                                align="right"
                                allowNegative
                              />
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:text-danger"
                              onClick={() => removeExtraLine(index)}
                              aria-label="Remove line"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                          {showLineOffset ? (
                            <div className="grid gap-2 md:grid-cols-[1fr_150px] md:items-end">
                              <p className="text-[11px] text-muted-foreground">
                                <span className="font-medium text-foreground">
                                  {fmtUSD(lineUnsettled)}
                                </span>{" "}
                                in daily WIP on this code — settle to avoid double-counting.
                              </p>
                              <div className="space-y-1">
                                <Label className="text-[11px]">Settles daily WIP</Label>
                                <MoneyInput
                                  value={lineOffsetValue}
                                  onValueChange={(value) =>
                                    updateExtraLine(index, {
                                      daily_wip_offset: clampOffset(
                                        value,
                                        line.amount,
                                        lineUnsettled,
                                      ),
                                      offsetTouched: true,
                                    })
                                  }
                                  align="right"
                                />
                              </div>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                    {extraLines.length > 0 && !extraLinesValid ? (
                      <p className="text-[11px] text-danger">
                        Every added line needs a description before you can save.
                      </p>
                    ) : null}
                  </div>
                ) : null}
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Vendor</Label>
                    <VendorPicker
                      value={draft.vendor}
                      vendors={vendorNames}
                      subcontractors={subNames}
                      onAddNew={(name) =>
                        setVendorDraft({
                          name,
                          trade: "",
                          contact_name: "",
                          contact_email: "",
                          contact_phone: "",
                          address: "",
                        })
                      }
                      onChange={(name, isSub) =>
                        setDraft({
                          ...draft,
                          vendor: name,
                          // Picking a sub as the payee defaults the category —
                          // still changeable above.
                          ...(isSub ? { category: "subcontract" as const } : {}),
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Reference #</Label>
                    <Input
                      value={draft.reference_number}
                      onChange={(event) =>
                        setDraft({ ...draft, reference_number: event.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Textarea
                    rows={3}
                    value={draft.notes}
                    onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                  />
                </div>
                <CostActualInvoiceAttachmentPicker
                  attachment={currentInvoiceAttachment}
                  pendingFile={invoiceFile}
                  onPendingFileChange={setInvoiceFile}
                  disabled={costSaveBusy}
                />
              </div>
              <DialogFooter className="gap-2 sm:items-center sm:justify-between">
                {editingCostId ? (
                  <div className="flex items-center gap-2">
                    {editingCost?.status === "draft" ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={costSaveBusy || Boolean(invoiceFile)}
                        onClick={() => advanceDraft("approved")}
                      >
                        Approve for payment
                      </Button>
                    ) : null}
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={costSaveBusy || Boolean(invoiceFile)}
                      onClick={() => advanceDraft("paid")}
                    >
                      Mark paid
                    </Button>
                  </div>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  {/* Programmatic close skips Radix's onOpenChange, so Cancel
                      must clear the edit state itself — otherwise the next
                      "Add cost" reopens armed on the canceled row and Save
                      overwrites it. */}
                  <Button variant="ghost" onClick={resetCostForm}>
                    Cancel
                  </Button>
                  <Button
                    onClick={save}
                    disabled={costSaveBusy || !draft.description.trim() || !extraLinesValid}
                  >
                    {uploadingInvoice
                      ? "Uploading invoice…"
                      : editingCostId
                        ? "Save changes"
                        : activeExtraLines.length > 0
                          ? `Save ${activeExtraLines.length + 1} costs`
                          : "Save cost"}
                  </Button>
                </div>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          {/* "Add a new vendor" details window (field request 2026-07-10):
              opened from the Vendor picker's Add item; builds the vendor out
              in the directory, then selects it into the cost being entered. */}
          <Dialog
            open={vendorDraft !== null}
            onOpenChange={(next) => {
              if (!next) setVendorDraft(null);
            }}
          >
            <DialogContent className="sm:max-w-2xl">
              <DialogHeaderV2
                eyebrow="Vendor"
                title="Add a new vendor"
                description="Build this vendor out in your directory — next time they're one pick away. Only the name is required."
              />
              {vendorDraft ? (
                <div className="grid gap-3 py-2 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Vendor name</Label>
                    <Input
                      value={vendorDraft.name}
                      onChange={(event) =>
                        setVendorDraft({ ...vendorDraft, name: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Trade / what they supply</Label>
                    <Input
                      value={vendorDraft.trade}
                      placeholder="e.g. Equipment rental"
                      onChange={(event) =>
                        setVendorDraft({ ...vendorDraft, trade: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Contact name</Label>
                    <Input
                      value={vendorDraft.contact_name}
                      onChange={(event) =>
                        setVendorDraft({ ...vendorDraft, contact_name: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Email</Label>
                    <Input
                      type="email"
                      value={vendorDraft.contact_email}
                      onChange={(event) =>
                        setVendorDraft({ ...vendorDraft, contact_email: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Phone</Label>
                    <Input
                      value={vendorDraft.contact_phone}
                      onChange={(event) =>
                        setVendorDraft({ ...vendorDraft, contact_phone: event.target.value })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Address</Label>
                    <Input
                      value={vendorDraft.address}
                      placeholder="123 Main St, Miami FL 33101"
                      onChange={(event) =>
                        setVendorDraft({ ...vendorDraft, address: event.target.value })
                      }
                    />
                  </div>
                </div>
              ) : null}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setVendorDraft(null)}>
                  Cancel
                </Button>
                <Button
                  onClick={saveVendorDetails}
                  disabled={savingVendor || !vendorDraft?.name.trim()}
                >
                  {savingVendor ? "Saving…" : "Save vendor"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {draftActuals.length > 0 || approvedActuals.length > 0 ? (
        <div className="mt-4 rounded-md border border-accent/30 bg-accent/5 px-4 py-3 text-sm">
          <span className="font-semibold text-foreground">Approval queue:</span>{" "}
          <span className="text-muted-foreground">
            {draftActuals.length > 0
              ? `${draftActuals.length} draft ${draftActuals.length === 1 ? "invoice" : "invoices"} (${fmtUSD(totalDraft)}) waiting for approval`
              : null}
            {draftActuals.length > 0 && approvedActuals.length > 0 ? " · " : null}
            {approvedActuals.length > 0
              ? `${approvedActuals.length} approved for payment (${fmtUSD(totalApproved)}) — not paid yet`
              : null}
            . Approve or mark rows paid in the list below.
          </span>
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <BillingMetric
          label="Open commitments"
          value={fmtUSD(totalCommitted)}
          sub="Committed or approved, not paid"
        />
        <BillingMetric label="Paid costs" value={fmtUSD(totalPaid)} sub="Paid cost rows" />
        <BillingMetric
          label="Cost to date"
          value={fmtUSD(totalActual)}
          sub="Bucket actuals used by WIP"
        />
        <BillingMetric label="FTC" value={fmtUSD(totalFtc)} sub="Forecast to complete" />
        <BillingMetric
          label="Projected cost"
          value={fmtUSD(projectedCost)}
          sub="Cost to date + FTC"
        />
        <BillingMetric
          label="Budget variance"
          value={fmtUSD(budgetVariance)}
          sub="Positive means under projected cost"
          tone={budgetVariance < 0 ? "danger" : "success"}
        />
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <CostFlowStep
          step="1"
          title="Match the cost code"
          body="Every cost row should point to the same cost code used in the SOV/application."
        />
        <CostFlowStep
          step="2"
          title="Draft, approve, then pay"
          body="Log an invoice as a draft, approve it for payment, and mark it paid when money goes out. Drafts never count as job cost."
        />
        <CostFlowStep
          step="3"
          title="WIP uses the forecast"
          body="WIP compares contract value against cost to date plus forecast to complete."
        />
      </div>

      <div className="mt-4 rounded-md border border-hairline bg-surface p-4">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Cost code health
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              This is the job-cost view by SOV cost code. It shows whether each code has cost backup
              and whether the current cost forecast is above or below the contract value.
            </p>
          </div>
          <div className="text-xs tabular text-muted-foreground">
            Cost backup rows {fmtUSD(costBackupTotal)}
            {unmatchedActualCount > 0 ? ` · ${unmatchedActualCount} unmatched` : ""}
          </div>
        </div>
        <div className="mt-4 grid gap-3">
          {buckets.map((bucket) => {
            // BUDGETVSCONTRACT1: cost-code health is contract value vs projected
            // cost (the margin the code realizes). The basis is the line's
            // contract_value — the owner-facing SOV value — falling back to the
            // cost budget only for unpriced legacy lines (mirrors the costBasis in
            // billing.functions). Reading original_budget here made "Contract
            // value" mirror projected cost and pinned every variance to $0.
            const contractBasis =
              bucket.contract_value > 0 ? bucket.contract_value : bucket.original_budget;
            const forecast = centsToDollars(
              dollarsToCents(bucket.actual_to_date) + dollarsToCents(bucket.ftc),
            );
            const variance = centsToDollars(
              dollarsToCents(contractBasis) - dollarsToCents(forecast),
            );
            const spentPct =
              bucket.original_budget > 0
                ? (bucket.actual_to_date / bucket.original_budget) * 100
                : 0;
            const backupTotal = centsToDollars(backupCentsByBucket.get(bucket.id) ?? 0);
            const tone = variance < 0 ? "danger" : spentPct >= 80 ? "warning" : "success";
            return (
              <div key={bucket.id} className="rounded-md border border-hairline bg-card p-4">
                <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {bucket.cost_code || "No code"}
                    </div>
                    <div className="mt-1 font-medium text-foreground">{bucket.bucket}</div>
                  </div>
                  <div
                    className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
                      variance < 0
                        ? "border-danger/30 bg-danger/10 text-danger"
                        : "border-success/30 bg-success/10 text-success"
                    }`}
                  >
                    {variance < 0
                      ? `Projected over by ${fmtUSD(Math.abs(variance))}`
                      : `Projected under by ${fmtUSD(variance)}`}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-6">
                  <BillingDetail
                    label="Contract value"
                    value={fmtUSD(contractBasis)}
                    sub="Owner-facing SOV value"
                  />
                  <BillingDetail
                    label="Cost to date"
                    value={fmtUSD(bucket.actual_to_date)}
                    sub="Actual cost carried in bucket"
                  />
                  <BillingDetail
                    label="FTC"
                    value={fmtUSD(bucket.ftc)}
                    sub="Forecast to complete"
                  />
                  <BillingDetail
                    label="Projected cost"
                    value={fmtUSD(forecast)}
                    sub="Cost to date + FTC"
                  />
                  <BillingDetail
                    label="Projected margin"
                    value={fmtUSD(variance)}
                    tone={tone}
                    sub="Contract less projected cost"
                  />
                  <BillingDetail
                    label="Ledger backup"
                    value={fmtUSD(backupTotal)}
                    sub="Committed/paid rows attached"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-4 rounded-md border border-hairline bg-surface p-4">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Cost transaction backup
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          These are the individual vendor, subcontractor, labor, material, and direct-cost rows that
          support the cost-code totals above.
        </p>
        {costActuals.length > 0 ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {(
              [
                ["all", "All"],
                ["draft", "Draft"],
                ["approved", "Approved for payment"],
                ["committed", "Committed"],
                ["paid", "Paid"],
                ["void", "Void"],
              ] as const
            ).map(([value, label]) => {
              const count =
                value === "all"
                  ? costActuals.length
                  : costActuals.filter((actual) => actual.status === value).length;
              // Never unmount the ACTIVE pill: approving the last draft while
              // filtered to Draft would otherwise strand an invisible filter
              // over a blank list.
              if (value !== "all" && count === 0 && costStatusFilter !== value) return null;
              const active = costStatusFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => setCostStatusFilter(value)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-accent bg-accent text-accent-foreground"
                      : "border-hairline bg-surface text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {label}
                  <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
                </button>
              );
            })}
            <Input
              value={costSearch}
              onChange={(event) => setCostSearch(event.target.value)}
              placeholder="Search by name, vendor, reference…"
              className="h-8 w-64 max-w-full"
            />
          </div>
        ) : null}
        {costActuals.length === 0 ? (
          <div className="mt-3 rounded-md border border-hairline bg-card py-8 text-center text-sm text-muted-foreground">
            {totalActual > 0
              ? "No cost ledger rows are attached yet. The bucket actuals above still feed WIP, but there is no transaction-level backup to audit."
              : "No cost ledger rows recorded yet."}
          </div>
        ) : visibleCostActuals.length === 0 ? (
          <div className="mt-3 rounded-md border border-dashed border-hairline bg-card py-8 text-center text-sm text-muted-foreground">
            No costs match the current filter{costSearch.trim() ? " and search" : ""}.{" "}
            <button
              type="button"
              className="font-medium text-accent-foreground hover:underline"
              onClick={() => {
                setCostStatusFilter("all");
                setCostSearch("");
              }}
            >
              Show all
            </button>
          </div>
        ) : (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {visibleCostActuals.map((actual) => (
              <div
                key={actual.id}
                className={`rounded-md border border-hairline border-l-4 bg-card p-4 ${
                  COST_STATUS_TONE[actual.status]?.edge ?? "border-l-transparent"
                } ${actual.status === "void" ? "opacity-50" : ""}`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      <span>
                        {actual.cost_date} · {actual.cost_code || "No code"}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 ${COST_STATUS_TONE[actual.status]?.chip ?? ""}`}
                      >
                        {COST_STATUS_LABEL[actual.status] ?? actual.status}
                      </span>
                      {/* Provenance: imports carry an import_batch_id; manual entries don't. */}
                      <span>{actual.import_batch_id ? "Imported" : "Manual"}</span>
                    </div>
                    <div className="mt-1 font-medium text-foreground">{actual.description}</div>
                    <div className="mt-1 text-xs capitalize text-muted-foreground">
                      {actual.category}
                      {actual.vendor ? ` · ${actual.vendor}` : ""}
                    </div>
                    {actual.status === "draft" ||
                    actual.status === "approved" ||
                    actual.status === "committed" ? (
                      <div className="mt-2.5 flex items-center gap-2">
                        {actual.status === "draft" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-7 px-2.5 text-xs"
                            onClick={() => onSetCostActualStatus(actual.id, "approved")}
                          >
                            Approve for payment
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-7 px-2.5 text-xs"
                          onClick={() => openPayDialog(actual)}
                        >
                          Mark paid
                        </Button>
                      </div>
                    ) : null}
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="text-right text-sm tabular font-medium">
                      {fmtUSD(actual.amount)}
                    </div>
                    {(actual.status === "draft" ||
                      actual.status === "approved" ||
                      actual.status === "committed") && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                        title={
                          actual.status === "draft"
                            ? "Edit this draft"
                            : "Edit this cost — changes update job cost"
                        }
                        onClick={() => startEditCost(actual)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                    {actual.status !== "void" && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 w-8 p-0 text-muted-foreground hover:text-danger"
                        onClick={() => {
                          if (
                            !window.confirm(
                              "Void this cost actual? The linked bucket actuals will update.",
                            )
                          ) {
                            return;
                          }
                          onVoidCostActual(actual.id, "Voided from cost tracking.");
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <BillingDetail label="Vendor" value={actual.vendor || "-"} />
                  <BillingDetail label="Reference" value={actual.reference_number || "-"} />
                </div>
                {actual.invoice_attachment_path ? (
                  <div className="mt-2">
                    <CostActualInvoiceAttachmentLink
                      attachment={{
                        path: actual.invoice_attachment_path,
                        name: actual.invoice_attachment_name,
                        type: actual.invoice_attachment_type,
                        size: actual.invoice_attachment_size,
                      }}
                    />
                  </div>
                ) : null}
                {actual.status === "paid" &&
                (actual.payment_method || actual.payment_reference || actual.paid_date) ? (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-success">
                    <span className="font-semibold">Paid</span>
                    {actual.payment_method ? (
                      <span>by {paymentMethodLabel(actual.payment_method)}</span>
                    ) : null}
                    {actual.payment_reference ? <span>· {actual.payment_reference}</span> : null}
                    {actual.paid_date ? <span>· {actual.paid_date}</span> : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Mark-paid: capture HOW it was paid (field request 2026-07-10) */}
      <Dialog open={payingCost !== null} onOpenChange={(open) => !open && setPayingCost(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeaderV2
            eyebrow="Payment"
            title="Mark cost paid"
            description={
              payingCost
                ? `${fmtUSD(payingCost.amount)}${payingCost.vendor ? ` to ${payingCost.vendor}` : ""} — record how it was paid.`
                : ""
            }
          />
          <div className="grid gap-3 py-2 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Date paid</Label>
              <Input
                type="date"
                value={payDraft.paid_date}
                onChange={(event) =>
                  setPayDraft({ ...payDraft, paid_date: event.target.value || today() })
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label>How paid</Label>
              <Select
                value={payDraft.payment_method}
                onValueChange={(payment_method) => setPayDraft({ ...payDraft, payment_method })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Check # / reference</Label>
              <Input
                value={payDraft.payment_reference}
                placeholder="Check #, wire confirmation, ACH trace"
                onChange={(event) =>
                  setPayDraft({ ...payDraft, payment_reference: event.target.value })
                }
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPayingCost(null)}>
              Cancel
            </Button>
            <Button onClick={confirmPaid}>Mark paid</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function CostFlowStep({ step, title, body }: { step: string; title: string; body: string }) {
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

export function WipAnalysisPanel({
  buckets,
  workspace,
  onUpdateBucketSettings,
  savingBucket,
}: {
  buckets: BucketRow[];
  workspace: BillingWorkspaceData;
  onUpdateBucketSettings: (id: string, patch: BucketSettingsPatch) => void;
  savingBucket?: boolean;
}) {
  const wip = workspace.wip;
  const bucketById = new Map(buckets.map((bucket) => [bucket.id, bucket]));
  if (!wip) {
    return (
      <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
        <p className="text-sm text-muted-foreground">
          WIP analysis is not available for this project yet.
        </p>
      </section>
    );
  }
  const fullyAssessed = wip.assessed_bucket_count >= wip.bucket_count;
  const overbilled = wip.total_over_under > 1;
  const underbilled = wip.total_over_under < -1;
  const projectedCost = wip.total_cost + wip.total_cost_to_complete;
  const projectedLoss = wip.estimated_gross_profit < -1;
  const projectedProfit = wip.estimated_gross_profit > 1;
  const projectedGpTone = projectedLoss ? "danger" : projectedProfit ? "success" : undefined;
  // Don't show a confident over/under color when earned totals are built from only some
  // buckets — a partial number reading as "Overbilled" would repeat the very lie we fixed.
  const billingPositionTone = !fullyAssessed
    ? undefined
    : overbilled
      ? "danger"
      : underbilled
        ? "success"
        : undefined;

  return (
    <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            WIP review (Work in Progress)
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            WIP answers two questions: have we billed ahead of or behind earned field progress, and
            will each cost code make money after actual cost plus forecast to complete?
          </p>
        </div>
        <div className="flex flex-col gap-2 md:items-end">
          <div
            className={`rounded-md border px-3 py-2 text-sm font-semibold ${
              projectedLoss
                ? "border-danger/35 bg-danger/10 text-danger"
                : projectedProfit
                  ? "border-success/35 bg-success/10 text-success"
                  : "border-hairline bg-surface text-muted-foreground"
            }`}
          >
            {projectedMarginLabel(wip.estimated_gross_profit)}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[11px] font-medium text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-success" />
              Underbilled / projected profit
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-danger" />
              Overbilled / projected loss
            </span>
          </div>
        </div>
      </div>

      {!fullyAssessed ? (
        <div className="mt-4 rounded-md border border-warning/35 bg-warning/10 px-3 py-2 text-xs font-medium text-warning">
          {wip.assessed_bucket_count} of {wip.bucket_count} buckets assessed. Earned and
          billing-position totals below reflect only the assessed buckets — unassessed buckets
          contribute nothing until you set their earned %. Update each bucket below to complete the
          picture.
        </div>
      ) : null}

      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        <div className="rounded-md border border-hairline bg-surface p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Revenue timing
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Earned to date equals contract value multiplied by earned percent complete. Billing
            position equals billed to date minus earned to date.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <BillingDetail label="Formula" value="Contract x earned %" />
            <BillingDetail label="Underbilled" value="Earned work not billed" tone="success" />
            <BillingDetail label="Overbilled" value="Billed ahead of work" tone="danger" />
          </div>
        </div>
        <div className="rounded-md border border-hairline bg-surface p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Profit forecast
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Projected GP equals contract value minus cost to date and forecast to complete. That is
            separate from overbilling or underbilling.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <BillingDetail label="Formula" value="Contract - projected cost" />
            <BillingDetail label="Projected profit" value="Green" tone="success" />
            <BillingDetail label="Projected loss" value="Red" tone="danger" />
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <BillingMetric
          label="Earned to date"
          value={fmtUSD(wip.total_earned)}
          sub={
            fullyAssessed
              ? "Contract x earned %"
              : `Contract x earned % · ${wip.assessed_bucket_count}/${wip.bucket_count} assessed`
          }
        />
        <BillingMetric
          label="Billed to date"
          value={fmtUSD(wip.total_billed)}
          sub="Applications completed/stored"
        />
        <BillingMetric
          label="Billing position"
          value={billingTimingLabel(wip.total_over_under)}
          sub={fullyAssessed ? "Billed minus earned" : "Partial — some buckets not assessed"}
          tone={billingPositionTone}
        />
        <BillingMetric
          label="Projected GP"
          value={projectedMarginLabel(wip.estimated_gross_profit)}
          sub={`${fmtUSD(projectedCost)} projected cost`}
          tone={projectedGpTone}
        />
      </div>

      <div className="mt-4 rounded-md border border-hairline bg-surface p-4 text-sm text-muted-foreground">
        {projectedLoss
          ? `Projected cost is ${fmtUSD(projectedCost)}, creating a projected loss of ${fmtUSD(Math.abs(wip.estimated_gross_profit))}. Review cost-to-date and FTC before the next application.`
          : projectedProfit
            ? `Projected cost is ${fmtUSD(projectedCost)}, leaving projected gross profit of ${fmtUSD(wip.estimated_gross_profit)}. ${underbilled ? "Earned work is ahead of billings, so the next application can improve cash position." : overbilled ? "Billings are ahead of earned production; watch field progress before submitting the next application." : "Earned revenue and billings are currently aligned."}`
            : "Projected cost is aligned with contract value. Review cost-to-date and FTC before submitting the next application."}
      </div>

      <div className="mt-4 space-y-3">
        {wip.buckets.map((bucket) => {
          const editableBucket = bucketById.get(bucket.cost_bucket_id);
          // null earned % = not assessed; render as such rather than a fabricated 0.
          const earnedPct =
            bucket.assessed && bucket.earned_revenue != null && bucket.contract_value > 0
              ? (bucket.earned_revenue / bucket.contract_value) * 100
              : null;
          return (
            <WipBucketRow
              key={bucket.cost_bucket_id}
              bucket={bucket}
              earnedPct={earnedPct}
              editable={Boolean(editableBucket)}
              saving={savingBucket}
              onSave={(nextPct) =>
                editableBucket &&
                onUpdateBucketSettings(editableBucket.id, {
                  earned_percent_complete: nextPct,
                })
              }
            />
          );
        })}
      </div>
    </section>
  );
}

function billingTimingLabel(value: number | null) {
  if (value == null) return "Not assessed";
  if (value > 1) return `Overbilled ${fmtUSD(value)}`;
  if (value < -1) return `Underbilled ${fmtUSD(Math.abs(value))}`;
  return "Aligned";
}

function billingTimingTone(value: number | null) {
  if (value == null) return undefined;
  if (value > 1) return "danger" as const;
  if (value < -1) return "success" as const;
  return undefined;
}

function projectedMarginLabel(value: number) {
  if (value > 1) return `Projected GP ${fmtUSD(value)}`;
  if (value < -1) return `Projected loss ${fmtUSD(Math.abs(value))}`;
  return "Break-even";
}

function WipBucketRow({
  bucket,
  earnedPct,
  editable,
  saving,
  onSave,
}: {
  bucket: NonNullable<BillingWorkspaceData["wip"]>["buckets"][number];
  earnedPct: number | null;
  editable: boolean;
  saving?: boolean;
  onSave: (earnedPct: number) => void;
}) {
  const assessed = bucket.assessed;
  // Leave the input empty for an unassessed bucket so the user sees "no value entered",
  // not a fabricated 0 they might mistake for a real assessment.
  const [value, setValue] = useState(earnedPct == null ? "" : String(Math.round(earnedPct)));
  const projectedLoss = bucket.estimated_gross_profit < -1;
  const projectedProfit = bucket.estimated_gross_profit > 1;
  const projectedRowClass = projectedLoss
    ? "border-danger/30 bg-danger/5"
    : projectedProfit
      ? "border-success/30 bg-success/5"
      : "bg-card";
  const projectedCost = bucket.cost_to_date + bucket.cost_to_complete;
  const projectedGpTone = projectedLoss ? "danger" : projectedProfit ? "success" : undefined;
  const billingTone = billingTimingTone(bucket.over_under_billing);
  return (
    <div className={`rounded-md border border-hairline p-4 ${projectedRowClass}`}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {bucket.cost_code || "No code"}
          </div>
          <div className="mt-1 font-medium text-foreground">{bucket.bucket}</div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div
            className={`rounded-md border px-2.5 py-1 text-xs font-semibold ${
              billingTone === "danger"
                ? "border-danger/30 bg-danger/10 text-danger"
                : billingTone === "success"
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-hairline bg-card text-muted-foreground"
            }`}
          >
            {billingTimingLabel(bucket.over_under_billing)}
          </div>
          {editable ? (
            <div className="flex items-center gap-1.5">
              <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Earned complete %
              </Label>
              <Input
                value={value}
                inputMode="decimal"
                placeholder="Not set"
                className="h-8 w-16 text-right tabular"
                onChange={(event) => setValue(event.target.value)}
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 w-8 p-0"
                disabled={saving}
                onClick={() => onSave(Math.max(0, Math.min(100, Number(value) || 0)))}
              >
                <Save className="h-3.5 w-3.5" />
              </Button>
            </div>
          ) : (
            <BillingDetail
              label="Earned %"
              value={earnedPct == null ? "Not assessed" : fmtPct(earnedPct)}
            />
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-3 xl:grid-cols-2">
        <div className="rounded-md border border-hairline bg-card/80 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Revenue timing
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <BillingDetail label="Contract value" value={fmtUSD(bucket.contract_value)} />
            <BillingDetail
              label="Earned to date"
              value={bucket.earned_revenue == null ? "Not assessed" : fmtUSD(bucket.earned_revenue)}
              sub={
                earnedPct == null ? "Set earned % to compute" : `${fmtPct(earnedPct)} of contract`
              }
            />
            <BillingDetail label="Billed to date" value={fmtUSD(bucket.billed_to_date)} />
            <BillingDetail
              label="Billing position"
              value={billingTimingLabel(bucket.over_under_billing)}
              tone={billingTone}
              sub={assessed ? "Billed minus earned" : "Needs earned %"}
            />
          </div>
        </div>
        <div className="rounded-md border border-hairline bg-card/80 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Profit forecast
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <BillingDetail label="Cost to date" value={fmtUSD(bucket.cost_to_date)} />
            <BillingDetail label="FTC" value={fmtUSD(bucket.cost_to_complete)} />
            <BillingDetail
              label="Projected cost"
              value={fmtUSD(projectedCost)}
              sub="Cost to date + FTC"
            />
            <BillingDetail
              label="Projected GP"
              tone={projectedGpTone}
              value={
                <>
                  {projectedMarginLabel(bucket.estimated_gross_profit)}
                  <span className="ml-1 text-[11px] text-muted-foreground">
                    {fmtPct(bucket.gross_profit_pct)}
                  </span>
                </>
              }
              sub="Contract less projected cost"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function BillingDetail({
  label,
  value,
  sub,
  tone,
  className = "",
  valueClassName = "",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "success" | "warning" | "danger";
  className?: string;
  valueClassName?: string;
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
    <div className={`rounded-md border border-hairline bg-card px-3 py-2 ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1 text-sm font-medium tabular ${toneClass} ${valueClassName}`}>
        {value}
      </div>
      {sub ? (
        <div className="mt-1 text-[11px] leading-snug text-muted-foreground">{sub}</div>
      ) : null}
    </div>
  );
}

function BillingMetric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "success" | "danger";
}) {
  const toneClass =
    tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-foreground";
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className={`pt-2 text-lg font-semibold tabular leading-none ${toneClass}`}>{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
