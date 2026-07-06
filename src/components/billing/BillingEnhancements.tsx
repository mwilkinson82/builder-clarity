import * as Papa from "papaparse";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { AiaApplicationStepper } from "@/components/billing/AiaApplicationStepper";
import { aiaBillingFilename, downloadPdfBytes, generateAiaBillingPdf } from "@/lib/aia-pdf";
import { sendTransactionalEmail } from "@/lib/email/send";
import { toast } from "sonner";
import { overbilledLines } from "@/lib/aia-math";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import { billingDocumentLabel } from "@/lib/billing-labels";
import { fmtPct } from "@/lib/format";
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
import { AlertTriangle, Check, Plus, Save, Trash2, Upload } from "lucide-react";

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
  status: "committed" | "paid";
  notes: string;
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
  onCreateCostActual: (input: CostActualDraft) => void;
  onImportCostActuals: (input: { source_name: string; rows: CostActualImportRow[] }) => void;
  onVoidCostActual: (id: string, notes: string) => void;
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
  onUpdatePayAppRetainageRate,
  onUpdateOutputFormat,
  recipientEmails = [],
  savingLine,
  savingRetainageRate,
  savingOutputFormat,
}: {
  project: ProjectRow;
  payApps: BillingApplicationRow[];
  lineItems: BillingLineItemRow[];
  onGenerateLines: (billingApplicationId: string) => void;
  onUpdateLine: (id: string, patch: LinePatch) => void;
  onUpdatePayAppRetainageRate: (billingApplicationId: string, retainagePct: number) => void;
  onUpdateOutputFormat: (billingApplicationId: string, format: BillingOutputFormat) => void;
  // Client billing contacts (can_view_billing) resolved by the workspace — used
  // to email the finalized package straight from the pay-app flow.
  recipientEmails?: string[];
  savingLine?: boolean;
  savingRetainageRate?: boolean;
  savingOutputFormat?: boolean;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const [emailBusy, setEmailBusy] = useState(false);
  const firstDetailedPayAppId = lineItems[0]?.billing_application_id ?? payApps[0]?.id ?? "";
  const [activePayAppId, setActivePayAppId] = useState(firstDetailedPayAppId);
  const selectedPayAppId = activePayAppId || firstDetailedPayAppId;
  const selectedLines = lineItems.filter(
    (line) => line.billing_application_id === selectedPayAppId,
  );
  const selectedPayApp = payApps.find((app) => app.id === selectedPayAppId);
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
      downloadPdfBytes(bytes, aiaBillingFilename(project, selectedPayApp));
    } catch (error) {
      window.alert(
        error instanceof Error ? error.message : "AIA application package could not be generated.",
      );
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
            {selectedLines.map((line) => (
              <BillingLineItemEditor
                key={line.id}
                line={line}
                saving={savingLine}
                onSave={(patch) => onUpdateLine(line.id, patch)}
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
}: {
  line: BillingLineItemRow;
  saving?: boolean;
  onSave: (patch: LinePatch) => void;
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
          onClick={() =>
            onSave({
              work_completed_this_period: work,
              materials_stored_this_period: stored,
              retainage_pct: parsePercentInput(retainagePct),
              retainage_released: released,
            })
          }
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
  savingCost,
}: {
  projectId: string;
  buckets: BucketRow[];
  costActuals: CostActualRow[];
  onCreateCostActual: (input: CostActualDraft) => void;
  onImportCostActuals: (input: { source_name: string; rows: CostActualImportRow[] }) => void;
  onVoidCostActual: (id: string, notes: string) => void;
  savingCost?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState<CostActualDraft>(() => ({
    cost_bucket_id: buckets[0]?.id ?? null,
    cost_code: buckets[0]?.cost_code ?? "",
    description: "",
    category: "subcontract",
    amount: 0,
    vendor: "",
    reference_number: "",
    cost_date: today(),
    status: "committed",
    notes: "",
  }));
  const activeActuals = costActuals.filter((actual) => actual.status !== "void");
  const totalCommitted = centsToDollars(
    sumDollarsToCents(
      activeActuals
        .filter((actual) => actual.status === "committed")
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
  const costBackupTotal = centsToDollars(
    sumDollarsToCents(activeActuals.map((actual) => actual.amount)),
  );
  const unmatchedActualCount = activeActuals.filter((actual) => !actual.cost_bucket_id).length;
  const backupCentsByBucket = activeActuals.reduce((map, actual) => {
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

  const save = () => {
    onCreateCostActual(draft);
    setOpen(false);
    setDraft({
      cost_bucket_id: buckets[0]?.id ?? null,
      cost_code: buckets[0]?.cost_code ?? "",
      description: "",
      category: "subcontract",
      amount: 0,
      vendor: "",
      reference_number: "",
      cost_date: today(),
      status: "committed",
      notes: "",
    });
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
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" /> Add cost
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle className="font-serif text-2xl">Add cost actual</DialogTitle>
                <DialogDescription>
                  Record cost backup against the same cost codes used by the SOV and WIP.
                </DialogDescription>
              </DialogHeader>
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
                  <div className="space-y-1.5">
                    <Label>Status</Label>
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
                        <SelectItem value="committed">Committed</SelectItem>
                        <SelectItem value="paid">Paid</SelectItem>
                      </SelectContent>
                    </Select>
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
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-1.5">
                    <Label>Vendor</Label>
                    <Input
                      value={draft.vendor}
                      onChange={(event) => setDraft({ ...draft, vendor: event.target.value })}
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
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={save} disabled={savingCost || !draft.description.trim()}>
                  Save cost
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        <BillingMetric
          label="Open commitments"
          value={fmtUSD(totalCommitted)}
          sub="Cost rows not marked paid"
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
          title="Record committed or paid cost"
          body="Use committed for subcontract/vendor obligations and paid when money has gone out."
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
            const forecast = centsToDollars(
              dollarsToCents(bucket.actual_to_date) + dollarsToCents(bucket.ftc),
            );
            const variance = centsToDollars(
              dollarsToCents(bucket.original_budget) - dollarsToCents(forecast),
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
                    value={fmtUSD(bucket.original_budget)}
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
                    label="Projected variance"
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
        {costActuals.length === 0 ? (
          <div className="mt-3 rounded-md border border-hairline bg-card py-8 text-center text-sm text-muted-foreground">
            {totalActual > 0
              ? "No cost ledger rows are attached yet. The bucket actuals above still feed WIP, but there is no transaction-level backup to audit."
              : "No cost ledger rows recorded yet."}
          </div>
        ) : (
          <div className="mt-3 grid gap-3 lg:grid-cols-2">
            {costActuals.map((actual) => (
              <div
                key={actual.id}
                className={`rounded-md border border-hairline bg-card p-4 ${
                  actual.status === "void" ? "opacity-50" : ""
                }`}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {actual.cost_date} · {actual.cost_code || "No code"} · {actual.status} ·{" "}
                      {/* Provenance: imports carry an import_batch_id; manual entries don't. */}
                      {actual.import_batch_id ? "Imported" : "Manual"}
                    </div>
                    <div className="mt-1 font-medium text-foreground">{actual.description}</div>
                    <div className="mt-1 text-xs capitalize text-muted-foreground">
                      {actual.category}
                      {actual.vendor ? ` · ${actual.vendor}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:justify-end">
                    <div className="text-right text-sm tabular font-medium">
                      {fmtUSD(actual.amount)}
                    </div>
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
              </div>
            ))}
          </div>
        )}
      </div>
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
