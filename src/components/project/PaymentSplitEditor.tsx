import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Plus, RotateCcw, X } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import { allocatePaymentAcrossCodes } from "@/lib/subcontract-budget";

interface BucketOption {
  id: string;
  cost_code: string;
  bucket: string;
}

export interface SplitRowDraft {
  cost_bucket_id: string | null;
  amount: number;
}

export interface SavedSplitRow {
  cost_bucket_id: string | null;
  amount: number;
}

const NO_CODE = "__none__";
const cents = (value: number) => Math.round(value * 100);

/**
 * Editable "where this payment goes" (field request 2026-07-09). Starts from
 * the saved explicit split if one exists, else the pro-rata derivation; the
 * user re-codes lines, adds or removes them, and saves once the lines add up
 * to the payment exactly. Reset returns the payment to the automatic split.
 */
export function PaymentSplitEditor({
  paymentAmount,
  buckets,
  allocations,
  savedRows,
  onSave,
  saving = false,
}: {
  paymentAmount: number;
  buckets: BucketOption[];
  allocations: { cost_code: string; description: string; amount: number }[];
  savedRows: SavedSplitRow[];
  onSave: (rows: SplitRowDraft[]) => void;
  saving?: boolean;
}) {
  const bucketByCode = useMemo(
    () => new Map(buckets.map((b) => [b.cost_code, b.id] as const)),
    [buckets],
  );
  const initialRows = useMemo<SplitRowDraft[]>(() => {
    if (savedRows.length > 0) {
      return savedRows.map((row) => ({ cost_bucket_id: row.cost_bucket_id, amount: row.amount }));
    }
    return allocatePaymentAcrossCodes(paymentAmount, allocations).map((split) => ({
      cost_bucket_id: bucketByCode.get(split.cost_code) ?? null,
      amount: split.amount,
    }));
  }, [savedRows, paymentAmount, allocations, bucketByCode]);

  const [rows, setRows] = useState<SplitRowDraft[]>(initialRows);
  const updateRow = (index: number, patch: Partial<SplitRowDraft>) =>
    setRows((current) => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const totalCents = rows.reduce((sum, row) => sum + cents(row.amount), 0);
  const paymentCents = cents(paymentAmount);
  const diffCents = paymentCents - totalCents;
  const balanced = diffCents === 0 && rows.length > 0;

  return (
    <div className="mb-1 ml-4 mt-1 space-y-2 border-l border-hairline pl-3">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-2">
          <Select
            value={row.cost_bucket_id ?? NO_CODE}
            onValueChange={(value) =>
              updateRow(index, { cost_bucket_id: value === NO_CODE ? null : value })
            }
          >
            <SelectTrigger className="h-8 flex-1 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_CODE}>No code</SelectItem>
              {buckets.map((b) => (
                <SelectItem key={b.id} value={b.id}>
                  {b.cost_code ? `${b.cost_code} — ${b.bucket}` : b.bucket}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <MoneyInput
            value={row.amount}
            onValueChange={(amount) => updateRow(index, { amount })}
            align="right"
            className="h-8 w-28 text-xs"
            aria-label="Split amount"
          />
          <button
            type="button"
            className="text-muted-foreground hover:text-danger"
            onClick={() => setRows((current) => current.filter((_, i) => i !== index))}
            aria-label="Remove split line"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}

      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <button
          type="button"
          className="inline-flex items-center gap-1 font-medium text-accent-foreground hover:underline"
          onClick={() => setRows((current) => [...current, { cost_bucket_id: null, amount: 0 }])}
        >
          <Plus className="h-3 w-3" /> Add line
        </button>
        <span className={balanced ? "text-muted-foreground" : "font-medium text-warning"}>
          {balanced
            ? `Splits ${fmtUSD(paymentAmount)} exactly`
            : diffCents > 0
              ? `${fmtUSD(diffCents / 100)} left to code`
              : `${fmtUSD(-diffCents / 100)} over the payment`}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          className="h-7 text-xs"
          disabled={!balanced || saving}
          onClick={() => onSave(rows)}
        >
          {saving ? "Saving…" : "Save split"}
        </Button>
        {savedRows.length > 0 && (
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1 text-xs"
            disabled={saving}
            onClick={() => onSave([])}
          >
            <RotateCcw className="h-3 w-3" /> Reset to automatic
          </Button>
        )}
      </div>
    </div>
  );
}
