// Change-order → cost-code allocation (the missing "allocate to bill it"
// control). Each approved change order shows its value, what's allocated,
// and what remains; allocating a slice to an SOV cost code makes it roll
// into that line's contract value on the next application (G702 line 2).
import { useMemo, useState } from "react";
import { AlertTriangle, Check, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fmtUSDCents } from "@/lib/billing-format";
import { billingDocumentLabel } from "@/lib/billing-labels";
import { allocatedContractByChangeOrder, summarizeApprovedCo } from "@/lib/change-order-allocation";
import type { ChangeOrderAllocationRow } from "@/lib/billing.functions";
import type { BucketRow, ChangeOrderRow } from "@/lib/projects.functions";

export interface ChangeOrderAllocationInput {
  changeOrderId: string;
  costBucketId: string;
  contractAmount: number;
}

interface ChangeOrderAllocationPanelProps {
  changeOrders: ChangeOrderRow[];
  buckets: BucketRow[];
  allocations: ChangeOrderAllocationRow[];
  onAllocate: (input: ChangeOrderAllocationInput) => void;
  onRemoveAllocation: (id: string) => void;
  saving?: boolean;
}

function bucketLabel(bucket: BucketRow) {
  return [bucket.cost_code, bucket.bucket].filter(Boolean).join(" · ") || "Uncoded line";
}

function ApprovedCoRow({
  co,
  buckets,
  allocations,
  onAllocate,
  onRemoveAllocation,
  saving,
}: {
  co: ChangeOrderRow;
  buckets: BucketRow[];
  allocations: ChangeOrderAllocationRow[];
  onAllocate: (input: ChangeOrderAllocationInput) => void;
  onRemoveAllocation: (id: string) => void;
  saving?: boolean;
}) {
  const summary = summarizeApprovedCo(co.id, co.contract_amount, allocations);
  const coAllocations = allocations.filter((allocation) => allocation.change_order_id === co.id);
  const [bucketId, setBucketId] = useState("");
  const [amount, setAmount] = useState(0);

  // Only cost-coded buckets are valid allocation targets — an uncoded line
  // can't carry a change order into line 2.
  const codedBuckets = buckets.filter((bucket) => bucket.cost_code.trim());

  const startAllocation = (nextBucketId: string) => {
    setBucketId(nextBucketId);
    // Default the amount to whatever is still unallocated, the common case.
    if (summary.remaining > 0) setAmount(summary.remaining);
  };
  const submit = () => {
    if (!bucketId || amount <= 0) return;
    onAllocate({ changeOrderId: co.id, costBucketId: bucketId, contractAmount: amount });
    setBucketId("");
    setAmount(0);
  };

  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">
              {billingDocumentLabel(co.number, "", "Change order")}
            </span>
            {summary.fullyAllocated ? (
              <span className="inline-flex items-center gap-1 rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-success">
                <Check className="h-3 w-3" /> Allocated
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-warning">
                <AlertTriangle className="h-3 w-3" /> {fmtUSDCents(summary.remaining)} to allocate
              </span>
            )}
          </div>
          {co.description ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">{co.description}</div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular text-muted-foreground">
          <span>Value {fmtUSDCents(co.contract_amount)}</span>
          <span>Allocated {fmtUSDCents(summary.allocated)}</span>
          <span className="font-semibold text-foreground">
            Remaining {fmtUSDCents(summary.remaining)}
          </span>
        </div>
      </div>

      {coAllocations.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {coAllocations.map((allocation) => (
            <div
              key={allocation.id}
              className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-card px-3 py-1.5 text-xs"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium text-foreground">
                  {allocation.cost_code || "Uncoded"}
                </span>
                <span className="text-muted-foreground"> · {allocation.description}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular font-medium">
                  {fmtUSDCents(allocation.contract_amount)}
                </span>
                <button
                  type="button"
                  aria-label="Remove allocation"
                  className="text-muted-foreground hover:text-danger"
                  disabled={saving}
                  onClick={() => onRemoveAllocation(allocation.id)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {summary.remaining > 0 ? (
        codedBuckets.length === 0 ? (
          <p className="mt-3 text-xs text-warning">
            Add cost codes to your SOV lines first — a change order can only be allocated to a coded
            cost line.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1 space-y-1">
              <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Allocate to cost code
              </Label>
              <Select value={bucketId} onValueChange={startAllocation}>
                <SelectTrigger className="h-9">
                  <SelectValue placeholder="Choose a cost code…" />
                </SelectTrigger>
                <SelectContent>
                  {codedBuckets.map((bucket) => (
                    <SelectItem key={bucket.id} value={bucket.id}>
                      {bucketLabel(bucket)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1 sm:w-40">
              <Label className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Amount
              </Label>
              <MoneyInput value={amount} onValueChange={setAmount} align="right" className="h-9" />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5"
              disabled={saving || !bucketId || amount <= 0}
              onClick={submit}
            >
              <Plus className="h-3.5 w-3.5" /> Allocate
            </Button>
          </div>
        )
      ) : null}
    </div>
  );
}

export function ChangeOrderAllocationPanel({
  changeOrders,
  buckets,
  allocations,
  onAllocate,
  onRemoveAllocation,
  saving,
}: ChangeOrderAllocationPanelProps) {
  const approvedCOs = changeOrders.filter((co) => co.status === "Approved");
  const totals = useMemo(() => {
    const allocatedByCo = allocatedContractByChangeOrder(allocations);
    const value = approvedCOs.reduce((sum, co) => sum + co.contract_amount, 0);
    const allocated = approvedCOs.reduce((sum, co) => sum + (allocatedByCo.get(co.id) ?? 0), 0);
    return { value, allocated };
  }, [approvedCOs, allocations]);

  if (approvedCOs.length === 0) {
    return (
      <div className="rounded-md border border-hairline bg-surface p-4 text-sm text-muted-foreground">
        No approved change orders yet. Approve a change order in the Change Orders tab, then
        allocate it to an SOV cost code here to make it billable.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Approved change orders: allocate to bill
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Assign each approved change order's value to the SOV cost code it belongs to. Allocated
            value rolls into that line's contract on the next application (G702 line 2).
          </p>
        </div>
        <div className="text-sm tabular text-muted-foreground">
          Approved {fmtUSDCents(totals.value)} · Allocated {fmtUSDCents(totals.allocated)}
        </div>
      </div>
      {approvedCOs.map((co) => (
        <ApprovedCoRow
          key={co.id}
          co={co}
          buckets={buckets}
          allocations={allocations}
          onAllocate={onAllocate}
          onRemoveAllocation={onRemoveAllocation}
          saving={saving}
        />
      ))}
    </div>
  );
}
