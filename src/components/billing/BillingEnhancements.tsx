import * as Papa from "papaparse";
import { useMemo, useRef, useState, type ReactNode } from "react";
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
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { aiaBillingFilename, downloadPdfBytes, generateAiaBillingPdf } from "@/lib/aia-pdf";
import { fmtPct, fmtUSD } from "@/lib/format";
import type {
  BillingLineItemRow,
  BillingWorkspaceData,
  CostActualImportRow,
  CostActualRow,
} from "@/lib/billing.functions";
import type { BillingApplicationRow, BucketRow, ProjectRow } from "@/lib/projects.functions";
import { Check, Download, Plus, Save, Trash2, Upload, Wand2 } from "lucide-react";

type LinePatch = {
  work_completed_this_period?: number;
  materials_stored_this_period?: number;
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
  savingCost?: boolean;
  savingBucket?: boolean;
  onGenerateLines: (billingApplicationId: string) => void;
  onUpdateLine: (id: string, patch: LinePatch) => void;
  onCreateCostActual: (input: CostActualDraft) => void;
  onImportCostActuals: (input: { source_name: string; rows: CostActualImportRow[] }) => void;
  onVoidCostActual: (id: string, notes: string) => void;
  onUpdateBucketSettings: (id: string, patch: BucketSettingsPatch) => void;
};

const centsToDollars = (value: number) => value / 100;
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
  savingCost,
  savingBucket,
  onGenerateLines,
  onUpdateLine,
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
      <LineItemsPanel
        project={project}
        payApps={payApps}
        lineItems={workspace.lineItems}
        onGenerateLines={onGenerateLines}
        onUpdateLine={onUpdateLine}
        savingLine={savingLine}
      />
      <CostTrackingPanel
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

function LineItemsPanel({
  project,
  payApps,
  lineItems,
  onGenerateLines,
  onUpdateLine,
  savingLine,
}: {
  project: ProjectRow;
  payApps: BillingApplicationRow[];
  lineItems: BillingLineItemRow[];
  onGenerateLines: (billingApplicationId: string) => void;
  onUpdateLine: (id: string, patch: LinePatch) => void;
  savingLine?: boolean;
}) {
  const [pdfBusy, setPdfBusy] = useState(false);
  const firstDetailedPayAppId = lineItems[0]?.billing_application_id ?? payApps[0]?.id ?? "";
  const [activePayAppId, setActivePayAppId] = useState(firstDetailedPayAppId);
  const selectedPayAppId = activePayAppId || firstDetailedPayAppId;
  const selectedLines = lineItems.filter(
    (line) => line.billing_application_id === selectedPayAppId,
  );
  const selectedPayApp = payApps.find((app) => app.id === selectedPayAppId);
  const totals = useMemo(
    () =>
      selectedLines.reduce(
        (sum, line) => {
          sum.scheduled += centsToDollars(line.scheduled_value_cents);
          sum.co += centsToDollars(line.change_order_value_cents);
          sum.previous += centsToDollars(
            line.work_completed_previous_cents + line.materials_stored_previous_cents,
          );
          sum.thisPeriod += centsToDollars(
            line.work_completed_this_period_cents + line.materials_stored_this_period_cents,
          );
          sum.total += centsToDollars(line.total_completed_and_stored_cents);
          sum.balance += centsToDollars(line.balance_to_finish_cents);
          sum.retainage += centsToDollars(
            line.retainage_held_cents - line.retainage_released_cents,
          );
          return sum;
        },
        { scheduled: 0, co: 0, previous: 0, thisPeriod: 0, total: 0, balance: 0, retainage: 0 },
      ),
    [selectedLines],
  );

  const releaseAll = () => {
    if (!selectedLines.length) return;
    const earlyLines = selectedLines.filter((line) => line.billing_percent_complete < 95);
    const message =
      earlyLines.length > 0
        ? `${earlyLines.length} line(s) are below 95% complete. Release all remaining retainage anyway?`
        : "Release all remaining retainage for this pay application?";
    if (!window.confirm(message)) return;
    selectedLines.forEach((line) =>
      onUpdateLine(line.id, {
        retainage_released: centsToDollars(line.retainage_held_cents),
      }),
    );
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
      window.alert(error instanceof Error ? error.message : "AIA PDF could not be generated.");
    } finally {
      setPdfBusy(false);
    }
  };

  return (
    <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Pay application line detail
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            AIA-style continuation detail tied back to the SOV cost buckets.
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Select value={selectedPayAppId} onValueChange={setActivePayAppId}>
            <SelectTrigger className="w-full sm:w-[250px]">
              <SelectValue placeholder="Select pay app" />
            </SelectTrigger>
            <SelectContent>
              {payApps.map((app) => (
                <SelectItem key={app.id} value={app.id}>
                  {app.application_number || app.invoice_number || "Pay app"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={!selectedPayApp || selectedLines.length > 0}
            onClick={() => selectedPayApp && onGenerateLines(selectedPayApp.id)}
          >
            <Wand2 className="h-3.5 w-3.5" /> Generate from SOV
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={pdfBusy || selectedLines.length === 0}
            onClick={downloadAiaPdf}
          >
            <Download className="h-3.5 w-3.5" /> AIA PDF
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="gap-1.5"
            disabled={selectedLines.length === 0}
            onClick={releaseAll}
          >
            <Check className="h-3.5 w-3.5" /> Release retainage
          </Button>
        </div>
      </div>

      <div className="mt-4 space-y-3">
        {selectedLines.length === 0 ? (
          <div className="rounded-md border border-hairline bg-surface py-9 text-center text-sm text-muted-foreground">
            Generate line detail from the SOV to start billing by cost code.
          </div>
        ) : (
          <>
            <div className="rounded-md border border-hairline bg-surface p-4">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Pay app totals
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
                <BillingDetail label="Scheduled" value={fmtUSD(totals.scheduled)} />
                <BillingDetail label="COs" value={fmtUSD(totals.co)} />
                <BillingDetail label="Previous" value={fmtUSD(totals.previous)} />
                <BillingDetail label="This period" value={fmtUSD(totals.thisPeriod)} />
                <BillingDetail label="Total" value={fmtUSD(totals.total)} />
                <BillingDetail label="Balance" value={fmtUSD(totals.balance)} />
                <BillingDetail label="Retainage" value={fmtUSD(totals.retainage)} />
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
  const [released, setReleased] = useState(centsToDollars(line.retainage_released_cents));
  const previous = centsToDollars(
    line.work_completed_previous_cents + line.materials_stored_previous_cents,
  );
  const retainageHeld = centsToDollars(line.retainage_held_cents - line.retainage_released_cents);
  const overbilled = line.balance_to_finish_cents < 0;

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
          <BillingDetail
            label="Total"
            value={fmtUSD(centsToDollars(line.total_completed_and_stored_cents))}
          />
          <BillingDetail label="Complete" value={fmtPct(line.billing_percent_complete)} />
          <BillingDetail
            label="Balance"
            value={fmtUSD(centsToDollars(line.balance_to_finish_cents))}
            tone={overbilled ? "danger" : undefined}
          />
        </div>
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <BillingDetail
          label="Scheduled"
          value={fmtUSD(centsToDollars(line.scheduled_value_cents))}
        />
        <BillingDetail label="COs" value={fmtUSD(centsToDollars(line.change_order_value_cents))} />
        <BillingDetail label="Previous" value={fmtUSD(previous)} />
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            This period
          </Label>
          <MoneyInput value={work} onValueChange={setWork} align="right" />
        </div>
        <div className="space-y-1.5">
          <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            Stored
          </Label>
          <MoneyInput value={stored} onValueChange={setStored} align="right" />
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
          label="Retainage held"
          value={fmtUSD(retainageHeld)}
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

function CostTrackingPanel({
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
  const totalCommitted = activeActuals
    .filter((actual) => actual.status === "committed")
    .reduce((sum, actual) => sum + actual.amount, 0);
  const totalPaid = activeActuals
    .filter((actual) => actual.status === "paid")
    .reduce((sum, actual) => sum + actual.amount, 0);
  const totalBudget = buckets.reduce((sum, bucket) => sum + bucket.original_budget, 0);
  const totalActual = buckets.reduce((sum, bucket) => sum + bucket.actual_to_date, 0);

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
            Cost tracking
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Record subcontractor invoices, commitments, direct costs, and paid actuals by cost code.
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

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <BillingMetric label="Committed" value={fmtUSD(totalCommitted)} />
        <BillingMetric label="Paid actuals" value={fmtUSD(totalPaid)} />
        <BillingMetric label="Budget remaining" value={fmtUSD(totalBudget - totalActual)} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-md border border-hairline bg-surface p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Cost actuals
          </div>
          {costActuals.length === 0 ? (
            <div className="mt-3 rounded-md border border-hairline bg-card py-8 text-center text-sm text-muted-foreground">
              No cost actuals recorded yet.
            </div>
          ) : (
            <div className="mt-3 space-y-3">
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
                        {actual.cost_date} · {actual.cost_code || "No code"} · {actual.status}
                      </div>
                      <div className="mt-1 font-medium text-foreground">{actual.description}</div>
                      <div className="mt-1 text-xs capitalize text-muted-foreground">
                        {actual.category}
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

        <div className="rounded-md border border-hairline bg-surface p-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Cost bucket variance
          </div>
          <div className="mt-3 space-y-3">
            {buckets.map((bucket) => {
              const forecast = bucket.actual_to_date + bucket.ftc;
              const variance = bucket.original_budget - forecast;
              const spentPct =
                bucket.original_budget > 0
                  ? (bucket.actual_to_date / bucket.original_budget) * 100
                  : 0;
              const tone = variance < 0 ? "danger" : spentPct >= 80 ? "warning" : "success";
              return (
                <div key={bucket.id} className="rounded-md border border-hairline bg-card p-4">
                  <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                    {bucket.cost_code || "No code"}
                  </div>
                  <div className="mt-1 font-medium text-foreground">{bucket.bucket}</div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <BillingDetail label="Budget" value={fmtUSD(bucket.original_budget)} />
                    <BillingDetail label="Actual" value={fmtUSD(bucket.actual_to_date)} />
                    <BillingDetail label="FTC" value={fmtUSD(bucket.ftc)} />
                    <BillingDetail label="Variance" value={fmtUSD(variance)} tone={tone} />
                    <BillingDetail label="% spent" value={fmtPct(spentPct)} tone={tone} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function WipAnalysisPanel({
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
  const underBilled = wip.total_over_under < 0;
  const overUnderLabel = underBilled
    ? "Underbilled"
    : wip.total_over_under > 0
      ? "Overbilled"
      : "Current";

  return (
    <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            WIP analysis
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Over/under billing by earned progress, billing, cost, and forecast to complete.
          </p>
        </div>
        <div
          className={`rounded-md border px-3 py-2 text-sm ${
            underBilled
              ? "border-success/30 bg-success/10 text-success"
              : wip.total_over_under > 0
                ? "border-warning/30 bg-warning/10 text-warning"
                : "border-hairline bg-surface text-muted-foreground"
          }`}
        >
          {overUnderLabel}: {fmtUSD(Math.abs(wip.total_over_under))}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-4">
        <BillingMetric label="Total earned" value={fmtUSD(wip.total_earned)} />
        <BillingMetric label="Total billed" value={fmtUSD(wip.total_billed)} />
        <BillingMetric label="Over / under" value={fmtUSD(wip.total_over_under)} />
        <BillingMetric
          label="Est. GP"
          value={fmtUSD(wip.estimated_gross_profit)}
          sub={fmtPct(wip.gross_profit_pct)}
        />
      </div>

      <div className="mt-4 rounded-md border border-hairline bg-surface p-4 text-sm text-muted-foreground">
        {wip.total_over_under < -1
          ? `You are underbilled by ${fmtUSD(Math.abs(wip.total_over_under))}. Consider billing earned work next cycle to keep cash aligned with production.`
          : wip.total_over_under > 1
            ? `You are overbilled by ${fmtUSD(wip.total_over_under)}. Make sure field progress catches up before the next pay application.`
            : "Billing is aligned with earned revenue on the current WIP view."}
      </div>

      <div className="mt-4 space-y-3">
        {wip.buckets.map((bucket) => {
          const editableBucket = bucketById.get(bucket.cost_bucket_id);
          const earnedPct =
            bucket.contract_value > 0 ? (bucket.earned_revenue / bucket.contract_value) * 100 : 0;
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

function WipBucketRow({
  bucket,
  earnedPct,
  editable,
  saving,
  onSave,
}: {
  bucket: NonNullable<BillingWorkspaceData["wip"]>["buckets"][number];
  earnedPct: number;
  editable: boolean;
  saving?: boolean;
  onSave: (earnedPct: number) => void;
}) {
  const [value, setValue] = useState(String(Math.round(earnedPct)));
  const overUnderClass =
    bucket.over_under_billing > 0
      ? "text-warning"
      : bucket.over_under_billing < 0
        ? "text-success"
        : "";
  return (
    <div className="rounded-md border border-hairline bg-card p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {bucket.cost_code || "No code"}
          </div>
          <div className="mt-1 font-medium text-foreground">{bucket.bucket}</div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          {editable ? (
            <div className="flex items-center gap-1.5">
              <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Earned %
              </Label>
              <Input
                value={value}
                inputMode="decimal"
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
            <BillingDetail label="Earned %" value={fmtPct(earnedPct)} />
          )}
        </div>
      </div>
      <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <BillingDetail label="Contract" value={fmtUSD(bucket.contract_value)} />
        <BillingDetail label="Earned" value={fmtUSD(bucket.earned_revenue)} />
        <BillingDetail label="Billed" value={fmtUSD(bucket.billed_to_date)} />
        <BillingDetail
          label="Over / under"
          value={fmtUSD(bucket.over_under_billing)}
          valueClassName={overUnderClass}
        />
        <BillingDetail label="Cost" value={fmtUSD(bucket.cost_to_date)} />
        <BillingDetail label="FTC" value={fmtUSD(bucket.cost_to_complete)} />
        <BillingDetail
          label="GP"
          value={
            <>
              {fmtUSD(bucket.estimated_gross_profit)}
              <span className="ml-1 text-[11px] text-muted-foreground">
                {fmtPct(bucket.gross_profit_pct)}
              </span>
            </>
          }
        />
      </div>
    </div>
  );
}

function BillingDetail({
  label,
  value,
  tone,
  className = "",
  valueClassName = "",
}: {
  label: string;
  value: ReactNode;
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
    </div>
  );
}

function BillingMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="pt-2 text-lg font-medium tabular leading-none text-foreground">{value}</div>
      {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
    </div>
  );
}
