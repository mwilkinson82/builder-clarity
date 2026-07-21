// BUDGETCONSOLIDATE1 — the Budget tab's single line editor.
//
// The Budget tab used to be two tables: a read-only ledger and an
// always-editable grid showing the same lines. That was redundant and made the
// editable cells read as a spreadsheet you were meant to fill in. Now the ledger
// is the one table, and you open a line here to edit it — deliberately, with a
// Save button, not per-keystroke.
//
// The framing matters: a line's cost figures are normally DERIVED — budget moves
// only through change orders, actuals roll up from the daily log, and a
// bought-out scope's actual/forecast come from the subcontract ledger. So typing
// a number here is a manual OVERRIDE, and every override is recorded (old -> new)
// so it's never invisible.
import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { LockKeyhole, Trash2 } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import { sovLineForecastWithSubs, type SubBucketCostLite } from "@/lib/sov-rollup";
import type { BucketRow, BudgetOverrideRow } from "@/lib/projects.functions";

type BucketSource = BucketRow["source_type"];

export type BucketPatch = Partial<
  Pick<
    BucketRow,
    | "cost_code"
    | "actual_to_date"
    | "ftc"
    | "contract_value"
    | "original_budget"
    | "bucket"
    | "source_type"
    | "source_date"
    | "source_note"
  >
>;

export type NewBucketInput = {
  cost_code: string;
  bucket: string;
  source_type: BucketSource;
  source_date: string;
  source_note: string;
};

// The four money fields whose manual edits count as an override worth logging.
export type OverrideField = "actual_to_date" | "ftc" | "contract_value" | "original_budget";

const SOURCE_LABEL: Record<BucketSource, string> = {
  original_sov: "Original budget",
  change_order: "Change Order",
  added_cost: "Added Cost",
};

const OVERRIDE_LABEL: Record<OverrideField, string> = {
  actual_to_date: "Actual to date",
  ftc: "Forecast to complete",
  contract_value: "Contract value",
  original_budget: "Budget",
};

const newBudgetOperationKey = (intent: string) => `${intent}:${crypto.randomUUID()}`;

// A labeled field row inside the drawer — label + helper on the left, control on
// the right — so the editor reads as a form, not a grid.
function Field({
  label,
  help,
  children,
}: {
  label: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] items-start gap-3 py-2.5">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        {help ? <div className="mt-0.5 text-xs text-muted-foreground">{help}</div> : null}
      </div>
      <div className="min-w-[9rem] text-right">{children}</div>
    </div>
  );
}

// A read-only money value with a lock icon and a "why" line — used for figures
// that are driven elsewhere (change orders, the subcontract ledger).
function DrivenValue({ value, note }: { value: string; note: string }) {
  return (
    <div>
      <div className="inline-flex items-center justify-end gap-1.5 font-medium tabular text-foreground">
        <LockKeyhole className="h-3 w-3 opacity-50" />
        {value}
      </div>
      <div className="mt-0.5 max-w-[12rem] text-[11px] font-normal leading-snug text-muted-foreground">
        {note}
      </div>
    </div>
  );
}

export function BudgetLineDrawer({
  open,
  onOpenChange,
  mode,
  bucket,
  subCost,
  selfPerformWip = 0,
  wipDays = [],
  subPayments = [],
  invoices = [],
  onOpenWipDay,
  onOpenSubcontractors,
  onOpenBilling,
  budgetLocked,
  overrides,
  onSave,
  onCreate,
  onDelete,
  saving = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "edit" | "create";
  /** The line being edited. Null in create mode. */
  bucket: BucketRow | null;
  subCost?: SubBucketCostLite;
  /** Self-perform daily WIP cost folded into this line's actual on the ledger. The
   * field below edits the manual base; this is added on top from the daily log. */
  selfPerformWip?: number;
  /** The daily-log work behind that WIP figure, one row per logged line (newest
   * first) — the "which days is that?" answer. Click-through via onOpenWipDay. */
  wipDays?: { date: string; activity: string; amount: number }[];
  /** Subcontractor payments' pro-rata share on this line (the closest thing to
   * invoices in the actual today). Click-through via onOpenSubcontractors. */
  subPayments?: { id: string; date: string; label: string; amount: number }[];
  /** The invoices/costs recorded in Billing job costs on this line — a DB
   * trigger already folded them into actual_to_date, so this itemizes what's
   * inside the recorded base. Click-through via onOpenBilling. */
  invoices?: { id: string; date: string; label: string; amount: number }[];
  /** Jump to the Daily WIP tab on a specific day (closes the drawer). */
  onOpenWipDay?: (date: string) => void;
  /** Jump to the Billing tab (closes the drawer). */
  onOpenBilling?: () => void;
  /** Jump to the Subcontractors tab (closes the drawer). */
  onOpenSubcontractors?: () => void;
  budgetLocked: boolean;
  /** Override history for this line, newest first. */
  overrides: BudgetOverrideRow[];
  onSave: (id: string, patch: BucketPatch, operationKey: string, note: string) => Promise<unknown>;
  onCreate: (input: NewBucketInput, operationKey: string) => Promise<unknown>;
  onDelete?: (id: string, operationKey: string) => Promise<unknown>;
  saving?: boolean;
}) {
  const isCreate = mode === "create";

  // Draft state — reset whenever the drawer opens on a different line.
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [source, setSource] = useState<BucketSource>("added_cost");
  const [contractValue, setContractValue] = useState(0);
  const [budget, setBudget] = useState(0);
  const [actual, setActual] = useState(0);
  const [ftc, setFtc] = useState(0);
  const [operationKey, setOperationKey] = useState(() => newBudgetOperationKey("budget-line"));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setCode(bucket?.cost_code ?? "");
    setName(bucket?.bucket ?? "");
    setSource(bucket?.source_type ?? "added_cost");
    setContractValue(bucket?.contract_value ?? 0);
    setBudget(bucket?.original_budget ?? 0);
    setActual(bucket?.actual_to_date ?? 0);
    setFtc(bucket?.ftc ?? 0);
    setOperationKey(newBudgetOperationKey(isCreate ? "budget-line-create" : "budget-line-update"));
    setError(null);
  }, [open, bucket, isCreate]);

  // A bought-out line's actual and minimum remaining commitment are driven by
  // the subcontract ledger. The PM may still carry ADDITIONAL forecast beyond
  // that commitment through the bucket FTC field.
  const hasSub = Boolean(subCost && ((subCost.paid ?? 0) > 0 || (subCost.committed ?? 0) > 0));
  const { fac } = bucket ? sovLineForecastWithSubs(bucket, subCost) : { fac: 0 };
  const actualInclusive = (bucket?.actual_to_date ?? 0) + (subCost?.paid ?? 0);
  const forecastInclusive = fac - actualInclusive;
  const subEarned = subCost?.earned ?? 0;

  const dirty = useMemo(() => {
    if (isCreate) return name.trim().length > 0;
    if (!bucket) return false;
    return (
      code.trim() !== bucket.cost_code ||
      name.trim() !== bucket.bucket ||
      source !== bucket.source_type ||
      (!budgetLocked && contractValue !== bucket.contract_value) ||
      (!budgetLocked && budget !== bucket.original_budget) ||
      (!hasSub && actual !== bucket.actual_to_date) ||
      ftc !== bucket.ftc
    );
  }, [
    isCreate,
    bucket,
    code,
    name,
    source,
    budgetLocked,
    contractValue,
    budget,
    hasSub,
    actual,
    ftc,
  ]);

  const today = new Date().toISOString().slice(0, 10);

  const handleSave = async () => {
    setError(null);
    setSubmitting(true);
    try {
      if (isCreate) {
        const n = name.trim();
        if (!n) return;
        await onCreate(
          {
            cost_code: code.trim(),
            bucket: n,
            source_type: source,
            source_date: today,
            source_note: SOURCE_LABEL[source],
          },
          operationKey,
        );
        onOpenChange(false);
        return;
      }
      if (!bucket) return;

      const patch: BucketPatch = {};
      if (code.trim() !== bucket.cost_code) patch.cost_code = code.trim();
      if (name.trim() && name.trim() !== bucket.bucket) patch.bucket = name.trim();
      if (source !== bucket.source_type) patch.source_type = source;

      // The atomic database command records every changed money field in the
      // same transaction as this patch; there is no second audit request.
      if (!budgetLocked && contractValue !== bucket.contract_value) {
        patch.contract_value = contractValue;
      }
      if (!budgetLocked && budget !== bucket.original_budget) {
        patch.original_budget = budget;
      }
      if (!hasSub && actual !== bucket.actual_to_date) {
        patch.actual_to_date = actual;
      }
      if (ftc !== bucket.ftc) patch.ftc = ftc;

      if (Object.keys(patch).length === 0) {
        onOpenChange(false);
        return;
      }
      await onSave(bucket.id, patch, operationKey, "Manual budget line edit");
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Budget line did not commit.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!bucket || !onDelete || !confirm(`Delete budget line "${bucket.bucket}"?`)) return;
    setError(null);
    setSubmitting(true);
    try {
      await onDelete(bucket.id, operationKey.replace("update", "delete"));
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Budget line was not deleted.");
    } finally {
      setSubmitting(false);
    }
  };

  const lineOverrides = bucket
    ? overrides.filter((o) => o.cost_bucket_id === bucket.id).slice(0, 8)
    : [];

  return (
    <Sheet open={open} onOpenChange={(next) => !submitting && !saving && onOpenChange(next)}>
      <SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader className="text-left">
          <div className="eyebrow">Budget</div>
          <SheetTitle className="font-serif text-2xl font-normal">
            {isCreate
              ? "Add a budget line"
              : `${bucket?.cost_code || "—"} · ${bucket?.bucket ?? ""}`}
          </SheetTitle>
          <SheetDescription>
            {isCreate
              ? "Add a manual cost line — an allowance, a CO-cost holdback, permits. Budget and cost stay at zero until entered or a change order lands."
              : "Budget moves through change orders; actuals roll up from the daily log; a bought-out scope comes from the subcontract ledger. Edit here only to override, and every override is recorded."}
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 divide-y divide-hairline">
          {/* Identity */}
          <div className="py-1">
            <Field label="Cost code">
              <Input
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="e.g. 03-8011"
                className="h-9 w-36 text-right font-mono text-xs"
              />
            </Field>
            <Field label="Description">
              <Textarea
                value={name}
                onChange={(e) => setName(e.target.value)}
                rows={2}
                placeholder="Line description"
                className="min-h-[44px] w-56 resize-y text-sm"
              />
            </Field>
            <Field label="Source">
              <Select value={source} onValueChange={(v) => setSource(v as BucketSource)}>
                <SelectTrigger className="h-9 w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="original_sov">Original budget</SelectItem>
                  <SelectItem value="change_order">Change Order</SelectItem>
                  <SelectItem value="added_cost">Added Cost</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          {/* Baseline (contract value + budget) */}
          {!isCreate ? (
            <div className="py-1">
              <div className="pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Baseline
              </div>
              <Field
                label="Contract value"
                help="What the owner pays for this line — your SOV price."
              >
                {budgetLocked ? (
                  <DrivenValue
                    value={contractValue > 0 ? fmtUSD(contractValue) : "—"}
                    note="Locked. Changes come through change orders."
                  />
                ) : (
                  <MoneyInput
                    value={contractValue}
                    onValueChange={setContractValue}
                    align="right"
                    className="h-9 w-36"
                  />
                )}
              </Field>
              <Field label="Budget" help="Your internal cost baseline for this line.">
                {budgetLocked ? (
                  <DrivenValue
                    value={fmtUSD(budget)}
                    note="Locked. Changes come through change orders."
                  />
                ) : (
                  <MoneyInput
                    value={budget}
                    onValueChange={setBudget}
                    align="right"
                    className="h-9 w-36"
                  />
                )}
              </Field>
            </div>
          ) : null}

          {/* Cost to date */}
          {!isCreate ? (
            <div className="py-1">
              <div className="pt-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Cost
              </div>
              <Field
                label="Actual to date"
                help={
                  hasSub
                    ? undefined
                    : "Normally rolls up from the daily log. Enter a figure only to override."
                }
              >
                {hasSub ? (
                  <div>
                    <DrivenValue
                      value={fmtUSD(actualInclusive)}
                      note={`Recorded cost invoices plus ${fmtUSD(subCost?.paid ?? 0)} of subcontract payments not already represented by linked actuals.`}
                    />
                    {subEarned > (subCost?.paid ?? 0) ? (
                      <div className="mt-1 text-[11px] text-muted-foreground">
                        {fmtUSD(subEarned)} earned
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <div>
                    <MoneyInput
                      value={actual}
                      onValueChange={setActual}
                      align="right"
                      className="h-9 w-36"
                    />
                    {selfPerformWip > 0 ? (
                      <div className="mt-1 max-w-[12rem] text-[11px] leading-snug text-muted-foreground">
                        + {fmtUSD(selfPerformWip)} from daily WIP (added on the ledger; edit this
                        field only to adjust the manual base).
                      </div>
                    ) : null}
                  </div>
                )}
              </Field>
              <Field
                label="Forecast to complete"
                help={hasSub ? undefined : "Remaining cost you expect on this line."}
              >
                {hasSub ? (
                  <div className="space-y-2 text-right">
                    <DrivenValue
                      value={fmtUSD(forecastInclusive)}
                      note={`Remaining commitment on the buyout — ${fmtUSD(subCost?.committed ?? 0)} committed, less paid and linked recognized actuals.`}
                    />
                    <div className="space-y-1">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                        PM forecast adjustment
                      </div>
                      <MoneyInput
                        value={Math.max(0, ftc - (subCost?.committed ?? 0))}
                        onValueChange={(value) =>
                          setFtc(Math.max(0, subCost?.committed ?? 0) + Math.max(0, value))
                        }
                        align="right"
                        className="ml-auto h-9 w-36"
                      />
                      <div className="max-w-[13rem] text-[11px] leading-snug text-muted-foreground">
                        Add only cost still expected beyond the automatic unpaid subcontract
                        balance. This is the PM&apos;s manual forecast layer.
                      </div>
                    </div>
                  </div>
                ) : (
                  <MoneyInput
                    value={ftc}
                    onValueChange={setFtc}
                    align="right"
                    className="h-9 w-36"
                  />
                )}
              </Field>
            </div>
          ) : null}

          {/* Where the actual comes from — the roll-up, itemized (field request
              2026-07-09: "we'd like to see where that number's coming from").
              Every row is a real record: a day's logged work line, or a sub
              payment's share on this code. */}
          {!isCreate &&
          bucket &&
          (wipDays.length > 0 || subPayments.length > 0 || invoices.length > 0) ? (
            <div className="py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Where actual to date comes from
              </div>
              <div className="mt-1 flex items-baseline justify-between gap-2 text-xs">
                <span className="text-muted-foreground">On the ledger</span>
                <span className="tabular font-medium text-foreground">
                  {fmtUSD(bucket.actual_to_date + selfPerformWip + (subCost?.paid ?? 0))}
                </span>
              </div>
              <ul className="mt-2 space-y-1">
                {invoices.length > 0 ? (
                  <li>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-medium text-foreground">
                        Invoices &amp; recorded costs ({invoices.length})
                      </span>
                      <span className="tabular font-medium text-foreground">
                        {fmtUSD(invoices.reduce((sum, invoice) => sum + invoice.amount, 0))}
                      </span>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {invoices.slice(0, 8).map((invoice) => (
                        <li key={invoice.id}>
                          <button
                            type="button"
                            className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-surface hover:text-foreground"
                            onClick={() => onOpenBilling?.()}
                            title="Open Billing — job costs"
                          >
                            <span className="min-w-0 truncate">
                              <span className="tabular">{invoice.date}</span> · {invoice.label}
                            </span>
                            <span className="shrink-0 tabular">{fmtUSD(invoice.amount)}</span>
                          </button>
                        </li>
                      ))}
                      {invoices.length > 8 ? (
                        <li className="px-1 text-[11px] text-muted-foreground/70">
                          + {invoices.length - 8} more in Billing → job costs
                        </li>
                      ) : null}
                    </ul>
                  </li>
                ) : null}
                {(() => {
                  // Whatever part of the recorded base the invoices DON'T
                  // explain is hand-entered (an override, or history from
                  // before job costs were used) — shown so the pieces always
                  // add up to the line's actual, never a silent gap.
                  const invoicedTotal = invoices.reduce((sum, invoice) => sum + invoice.amount, 0);
                  const handEntered =
                    Math.round((bucket.actual_to_date - invoicedTotal) * 100) / 100;
                  if (Math.abs(handEntered) < 0.005) return null;
                  return (
                    <li className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">
                        {invoices.length > 0
                          ? "Hand-entered adjustments"
                          : "Recorded costs & manual entries"}
                        <span className="block text-[10px] text-muted-foreground/70">
                          {invoices.length > 0
                            ? "the part of the base not tied to an invoice"
                            : "invoices logged in Billing job costs, plus any hand-set base"}
                        </span>
                      </span>
                      <span className="tabular text-foreground">
                        {handEntered < 0 ? "−" : ""}
                        {fmtUSD(Math.abs(handEntered))}
                      </span>
                    </li>
                  );
                })()}
                {wipDays.length > 0 ? (
                  <li className="pt-1">
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="font-medium text-foreground">
                        From the daily log ({wipDays.length}{" "}
                        {wipDays.length === 1 ? "line" : "lines"})
                      </span>
                      <span className="tabular font-medium text-foreground">
                        {fmtUSD(selfPerformWip)}
                      </span>
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {wipDays.slice(0, 8).map((day, index) => (
                        <li key={`${day.date}-${index}`}>
                          <button
                            type="button"
                            className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-surface hover:text-foreground"
                            onClick={() => onOpenWipDay?.(day.date)}
                            title="Open this day in the Daily WIP tab"
                          >
                            <span className="min-w-0 truncate">
                              <span className="tabular">{day.date}</span>
                              {day.activity ? ` · ${day.activity}` : ""}
                            </span>
                            <span className="shrink-0 tabular">{fmtUSD(day.amount)}</span>
                          </button>
                        </li>
                      ))}
                      {wipDays.length > 8 ? (
                        <li className="px-1 text-[11px] text-muted-foreground/70">
                          + {wipDays.length - 8} more in the Daily WIP tab
                        </li>
                      ) : null}
                    </ul>
                  </li>
                ) : null}
                {subPayments.length > 0 ? (
                  <li className="pt-1">
                    <div className="text-xs font-medium text-foreground">
                      Subcontractor payments on this code
                    </div>
                    <ul className="mt-1 space-y-0.5">
                      {subPayments.slice(0, 8).map((payment) => (
                        <li key={payment.id}>
                          <button
                            type="button"
                            className="flex w-full items-baseline justify-between gap-2 rounded px-1 py-0.5 text-left text-xs text-muted-foreground hover:bg-surface hover:text-foreground"
                            onClick={() => onOpenSubcontractors?.()}
                            title="Open the Subcontractors tab"
                          >
                            <span className="min-w-0 truncate">
                              <span className="tabular">{payment.date}</span> · {payment.label}
                            </span>
                            <span className="shrink-0 tabular">{fmtUSD(payment.amount)}</span>
                          </button>
                        </li>
                      ))}
                      {subPayments.length > 8 ? (
                        <li className="px-1 text-[11px] text-muted-foreground/70">
                          + {subPayments.length - 8} more in the Subcontractors tab
                        </li>
                      ) : null}
                    </ul>
                    <p className="mt-1 px-1 text-[11px] leading-snug text-muted-foreground/80">
                      A payment covering several codes shows only this code's share here, rounded to
                      the cent — the list can differ from the ledger total by a cent or two.
                    </p>
                  </li>
                ) : null}
              </ul>
            </div>
          ) : null}

          {/* Override history */}
          {lineOverrides.length > 0 ? (
            <div className="py-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Recent changes
              </div>
              <ul className="mt-2 space-y-1.5">
                {lineOverrides.map((o) => (
                  <li key={o.id} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {OVERRIDE_LABEL[o.field as OverrideField] ?? o.field}
                    </span>{" "}
                    {fmtUSD(o.old_value)} → {fmtUSD(o.new_value)}
                    <span className="text-muted-foreground/70">
                      {" · "}
                      {new Date(o.created_at).toLocaleDateString(undefined, {
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-3 rounded-md border border-danger/30 bg-danger/5 p-3 text-sm text-danger"
          >
            {error}
          </div>
        ) : null}

        <SheetFooter className="mt-2 flex-row items-center justify-between gap-2 border-t border-hairline pt-4">
          {!isCreate && onDelete && bucket ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              onClick={handleDelete}
              disabled={saving || submitting}
            >
              <Trash2 className="mr-1.5 h-3.5 w-3.5" /> Delete line
            </Button>
          ) : (
            <span />
          )}
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={saving || submitting}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSave} disabled={saving || submitting || !dirty}>
              {isCreate
                ? submitting
                  ? "Adding…"
                  : "Add line"
                : saving || submitting
                  ? "Saving…"
                  : "Save changes"}
            </Button>
          </div>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
