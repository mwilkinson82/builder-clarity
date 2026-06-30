import { useMemo, useState } from "react";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { fmtPct, fmtUSD } from "@/lib/format";
import type {
  BillingLineItemRow,
  BillingWorkspaceData,
  CostActualRow,
} from "@/lib/billing.functions";
import type { BillingApplicationRow, BucketRow } from "@/lib/projects.functions";
import { Check, Plus, Save, Trash2, Wand2 } from "lucide-react";

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
  onVoidCostActual: (id: string, notes: string) => void;
  onUpdateBucketSettings: (id: string, patch: BucketSettingsPatch) => void;
};

const centsToDollars = (value: number) => value / 100;
const today = () => new Date().toISOString().slice(0, 10);

export function BillingEnhancementPanels({
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
  payApps,
  lineItems,
  onGenerateLines,
  onUpdateLine,
  savingLine,
}: {
  payApps: BillingApplicationRow[];
  lineItems: BillingLineItemRow[];
  onGenerateLines: (billingApplicationId: string) => void;
  onUpdateLine: (id: string, patch: LinePatch) => void;
  savingLine?: boolean;
}) {
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
    if (!window.confirm("Release all remaining retainage for this pay application?")) return;
    selectedLines.forEach((line) =>
      onUpdateLine(line.id, {
        retainage_released: centsToDollars(line.retainage_held_cents),
      }),
    );
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
            variant="ghost"
            className="gap-1.5"
            disabled={selectedLines.length === 0}
            onClick={releaseAll}
          >
            <Check className="h-3.5 w-3.5" /> Release retainage
          </Button>
        </div>
      </div>

      <div className="mt-4 overflow-hidden rounded-md border border-hairline">
        <Table className="min-w-[1400px]">
          <TableHeader>
            <TableRow className="bg-surface text-[10px] uppercase tracking-[0.12em]">
              <TableHead className="w-[90px]">Code</TableHead>
              <TableHead className="w-[250px]">Description</TableHead>
              <TableHead className="text-right">Scheduled</TableHead>
              <TableHead className="text-right">CO</TableHead>
              <TableHead className="text-right">Previous</TableHead>
              <TableHead className="w-[150px] text-right">This period</TableHead>
              <TableHead className="w-[150px] text-right">Stored</TableHead>
              <TableHead className="text-right">Total</TableHead>
              <TableHead className="text-right">%</TableHead>
              <TableHead className="text-right">Balance</TableHead>
              <TableHead className="w-[150px] text-right">Retainage release</TableHead>
              <TableHead className="text-right">Held</TableHead>
              <TableHead className="w-[92px]" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {selectedLines.length === 0 ? (
              <TableRow>
                <TableCell colSpan={13} className="py-9 text-center text-sm text-muted-foreground">
                  Generate line detail from the SOV to start billing by cost code.
                </TableCell>
              </TableRow>
            ) : (
              selectedLines.map((line) => (
                <BillingLineItemEditor
                  key={line.id}
                  line={line}
                  saving={savingLine}
                  onSave={(patch) => onUpdateLine(line.id, patch)}
                />
              ))
            )}
            {selectedLines.length > 0 && (
              <TableRow className="bg-surface font-medium">
                <TableCell colSpan={2}>Totals</TableCell>
                <TableCell className="text-right tabular">{fmtUSD(totals.scheduled)}</TableCell>
                <TableCell className="text-right tabular">{fmtUSD(totals.co)}</TableCell>
                <TableCell className="text-right tabular">{fmtUSD(totals.previous)}</TableCell>
                <TableCell className="text-right tabular">{fmtUSD(totals.thisPeriod)}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular">{fmtUSD(totals.total)}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular">{fmtUSD(totals.balance)}</TableCell>
                <TableCell />
                <TableCell className="text-right tabular">{fmtUSD(totals.retainage)}</TableCell>
                <TableCell />
              </TableRow>
            )}
          </TableBody>
        </Table>
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
    <TableRow className={overbilled ? "bg-danger/5" : ""}>
      <TableCell className="tabular text-muted-foreground">{line.cost_code || "-"}</TableCell>
      <TableCell>
        <div className="font-medium text-foreground">{line.description}</div>
        <div className="text-[11px] text-muted-foreground">{line.billing_method}</div>
      </TableCell>
      <TableCell className="text-right tabular">
        {fmtUSD(centsToDollars(line.scheduled_value_cents))}
      </TableCell>
      <TableCell className="text-right tabular">
        {fmtUSD(centsToDollars(line.change_order_value_cents))}
      </TableCell>
      <TableCell className="text-right tabular">{fmtUSD(previous)}</TableCell>
      <TableCell>
        <MoneyInput value={work} onValueChange={setWork} align="right" />
      </TableCell>
      <TableCell>
        <MoneyInput value={stored} onValueChange={setStored} align="right" />
      </TableCell>
      <TableCell className="text-right tabular">
        {fmtUSD(centsToDollars(line.total_completed_and_stored_cents))}
      </TableCell>
      <TableCell className="text-right tabular">{fmtPct(line.billing_percent_complete)}</TableCell>
      <TableCell className={`text-right tabular ${overbilled ? "text-danger" : ""}`}>
        {fmtUSD(centsToDollars(line.balance_to_finish_cents))}
      </TableCell>
      <TableCell>
        <MoneyInput value={released} onValueChange={setReleased} align="right" />
      </TableCell>
      <TableCell className="text-right tabular">{fmtUSD(retainageHeld)}</TableCell>
      <TableCell>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5"
          disabled={saving}
          onClick={() =>
            onSave({
              work_completed_this_period: work,
              materials_stored_this_period: stored,
              retainage_released: released,
            })
          }
        >
          <Save className="h-3.5 w-3.5" /> Save
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CostTrackingPanel({
  projectId,
  buckets,
  costActuals,
  onCreateCostActual,
  onVoidCostActual,
  savingCost,
}: {
  projectId: string;
  buckets: BucketRow[];
  costActuals: CostActualRow[];
  onCreateCostActual: (input: CostActualDraft) => void;
  onVoidCostActual: (id: string, notes: string) => void;
  savingCost?: boolean;
}) {
  const [open, setOpen] = useState(false);
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
                  <Select value={draft.cost_bucket_id ?? "unmatched"} onValueChange={chooseBucket}>
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

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <BillingMetric label="Committed" value={fmtUSD(totalCommitted)} />
        <BillingMetric label="Paid actuals" value={fmtUSD(totalPaid)} />
        <BillingMetric label="Budget remaining" value={fmtUSD(totalBudget - totalActual)} />
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="overflow-hidden rounded-md border border-hairline">
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableRow className="bg-surface text-[10px] uppercase tracking-[0.12em]">
                <TableHead>Date</TableHead>
                <TableHead>Code</TableHead>
                <TableHead>Description</TableHead>
                <TableHead>Vendor</TableHead>
                <TableHead>Reference</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead className="w-[76px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {costActuals.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-8 text-center text-sm text-muted-foreground">
                    No cost actuals recorded yet.
                  </TableCell>
                </TableRow>
              ) : (
                costActuals.map((actual) => (
                  <TableRow
                    key={actual.id}
                    className={actual.status === "void" ? "opacity-50" : ""}
                  >
                    <TableCell className="whitespace-nowrap tabular">{actual.cost_date}</TableCell>
                    <TableCell className="tabular text-muted-foreground">
                      {actual.cost_code || "-"}
                    </TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{actual.description}</div>
                      <div className="text-[11px] capitalize text-muted-foreground">
                        {actual.category}
                      </div>
                    </TableCell>
                    <TableCell>{actual.vendor || "-"}</TableCell>
                    <TableCell>{actual.reference_number || "-"}</TableCell>
                    <TableCell className="capitalize">{actual.status}</TableCell>
                    <TableCell className="text-right tabular">{fmtUSD(actual.amount)}</TableCell>
                    <TableCell>
                      {actual.status !== "void" && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-8 w-8 p-0 text-muted-foreground hover:text-danger"
                          onClick={() => onVoidCostActual(actual.id, "Voided from cost tracking.")}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="overflow-hidden rounded-md border border-hairline">
          <Table className="min-w-[720px]">
            <TableHeader>
              <TableRow className="bg-surface text-[10px] uppercase tracking-[0.12em]">
                <TableHead>Cost code</TableHead>
                <TableHead>Bucket</TableHead>
                <TableHead className="text-right">Budget</TableHead>
                <TableHead className="text-right">Actual</TableHead>
                <TableHead className="text-right">FTC</TableHead>
                <TableHead className="text-right">Variance</TableHead>
                <TableHead className="text-right">% Spent</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {buckets.map((bucket) => {
                const forecast = bucket.actual_to_date + bucket.ftc;
                const variance = bucket.original_budget - forecast;
                const spentPct =
                  bucket.original_budget > 0
                    ? (bucket.actual_to_date / bucket.original_budget) * 100
                    : 0;
                const tone =
                  variance < 0 ? "text-danger" : spentPct >= 80 ? "text-warning" : "text-success";
                return (
                  <TableRow key={bucket.id}>
                    <TableCell className="tabular text-muted-foreground">
                      {bucket.cost_code || "-"}
                    </TableCell>
                    <TableCell>{bucket.bucket}</TableCell>
                    <TableCell className="text-right tabular">
                      {fmtUSD(bucket.original_budget)}
                    </TableCell>
                    <TableCell className="text-right tabular">
                      {fmtUSD(bucket.actual_to_date)}
                    </TableCell>
                    <TableCell className="text-right tabular">{fmtUSD(bucket.ftc)}</TableCell>
                    <TableCell className={`text-right tabular ${tone}`}>
                      {fmtUSD(variance)}
                    </TableCell>
                    <TableCell className={`text-right tabular ${tone}`}>
                      {fmtPct(spentPct)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
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

      <div className="mt-4 overflow-hidden rounded-md border border-hairline">
        <Table className="min-w-[1180px]">
          <TableHeader>
            <TableRow className="bg-surface text-[10px] uppercase tracking-[0.12em]">
              <TableHead>Code</TableHead>
              <TableHead>Description</TableHead>
              <TableHead className="w-[120px] text-right">Earned %</TableHead>
              <TableHead className="text-right">Contract</TableHead>
              <TableHead className="text-right">Earned</TableHead>
              <TableHead className="text-right">Billed</TableHead>
              <TableHead className="text-right">Over / under</TableHead>
              <TableHead className="text-right">Cost</TableHead>
              <TableHead className="text-right">FTC</TableHead>
              <TableHead className="text-right">GP</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {wip.buckets.map((bucket) => {
              const editableBucket = bucketById.get(bucket.cost_bucket_id);
              const earnedPct =
                bucket.contract_value > 0
                  ? (bucket.earned_revenue / bucket.contract_value) * 100
                  : 0;
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
          </TableBody>
        </Table>
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
    <TableRow>
      <TableCell className="tabular text-muted-foreground">{bucket.cost_code || "-"}</TableCell>
      <TableCell>{bucket.bucket}</TableCell>
      <TableCell>
        {editable ? (
          <div className="flex items-center justify-end gap-1.5">
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
          <div className="text-right tabular">{fmtPct(earnedPct)}</div>
        )}
      </TableCell>
      <TableCell className="text-right tabular">{fmtUSD(bucket.contract_value)}</TableCell>
      <TableCell className="text-right tabular">{fmtUSD(bucket.earned_revenue)}</TableCell>
      <TableCell className="text-right tabular">{fmtUSD(bucket.billed_to_date)}</TableCell>
      <TableCell className={`text-right tabular ${overUnderClass}`}>
        {fmtUSD(bucket.over_under_billing)}
      </TableCell>
      <TableCell className="text-right tabular">{fmtUSD(bucket.cost_to_date)}</TableCell>
      <TableCell className="text-right tabular">{fmtUSD(bucket.cost_to_complete)}</TableCell>
      <TableCell className="text-right tabular">
        {fmtUSD(bucket.estimated_gross_profit)}
        <div className="text-[11px] text-muted-foreground">{fmtPct(bucket.gross_profit_pct)}</div>
      </TableCell>
    </TableRow>
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
