// Exposure → cost-code allocation (BUDGETENGINE Phase 1: "At Risk goes live").
// Each IOR exposure — an E-Hold (emergent at-risk) or a C-Hold (contingency) —
// shows its dollar value, what's already spread onto SOV cost codes, and what
// remains as general job risk. Allocating a slice to a cost code is what makes
// the budget ledger's At Risk (E) / Contingency (C) columns live instead of a
// number someone types. Mirrors the change-order allocation panel.
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
import { StatusChip } from "@/components/ui/status-chip";
import { fmtUSD } from "@/lib/format";
import { allocatedByExposure, summarizeExposure } from "@/lib/exposure-allocation";
import type { BucketRow, ExposureAllocationRow, ExposureRow } from "@/lib/projects.functions";

export interface ExposureAllocationInput {
  exposureId: string;
  costBucketId: string;
  amount: number;
}

interface ExposureAllocationPanelProps {
  exposures: ExposureRow[];
  buckets: BucketRow[];
  allocations: ExposureAllocationRow[];
  onAllocate: (input: ExposureAllocationInput) => void;
  onRemoveAllocation: (id: string) => void;
  saving?: boolean;
}

function bucketLabel(bucket: BucketRow) {
  return [bucket.cost_code, bucket.bucket].filter(Boolean).join(" · ") || "Uncoded line";
}

// E-Holds feed At Risk, C-Holds feed Contingency — name the column each risk
// rolls into so the allocation reads the same as the ledger.
function holdColumn(holdClass: ExposureRow["hold_class"]) {
  return holdClass === "C-Hold" ? "Contingency" : "At Risk";
}

function ExposureRowCard({
  exposure,
  buckets,
  allocations,
  onAllocate,
  onRemoveAllocation,
  saving,
}: {
  exposure: ExposureRow;
  buckets: BucketRow[];
  allocations: ExposureAllocationRow[];
  onAllocate: (input: ExposureAllocationInput) => void;
  onRemoveAllocation: (id: string) => void;
  saving?: boolean;
}) {
  const summary = summarizeExposure(exposure.id, exposure.dollar_exposure, allocations);
  const rowAllocations = allocations.filter((allocation) => allocation.exposure_id === exposure.id);
  const [bucketId, setBucketId] = useState("");
  const [amount, setAmount] = useState(0);

  // Only cost-coded buckets are valid targets — an uncoded line can't carry
  // risk into the At Risk / Contingency column.
  const codedBuckets = buckets.filter((bucket) => bucket.cost_code.trim());

  const startAllocation = (nextBucketId: string) => {
    setBucketId(nextBucketId);
    if (summary.remaining > 0) setAmount(summary.remaining);
  };
  const submit = () => {
    if (!bucketId || amount <= 0) return;
    onAllocate({ exposureId: exposure.id, costBucketId: bucketId, amount });
    setBucketId("");
    setAmount(0);
  };

  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{exposure.title || "Untitled risk"}</span>
            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {exposure.hold_class} · {holdColumn(exposure.hold_class)}
            </span>
            {summary.fullyAllocated ? (
              <StatusChip tone="complete" icon={Check}>
                Allocated
              </StatusChip>
            ) : (
              <StatusChip tone="blocked" icon={AlertTriangle}>
                {fmtUSD(summary.remaining)} general risk
              </StatusChip>
            )}
          </div>
          {exposure.description ? (
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {exposure.description}
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs tabular text-muted-foreground">
          <span>Value {fmtUSD(exposure.dollar_exposure)}</span>
          <span>Allocated {fmtUSD(summary.allocated)}</span>
          <span className="font-semibold text-foreground">General {fmtUSD(summary.remaining)}</span>
        </div>
      </div>

      {rowAllocations.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {rowAllocations.map((allocation) => (
            <div
              key={allocation.id}
              className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-card px-3 py-1.5 text-xs"
            >
              <span className="min-w-0 truncate">
                <span className="font-medium text-foreground">
                  {allocation.cost_code || "Uncoded"}
                </span>
                <span className="text-muted-foreground"> · {holdColumn(exposure.hold_class)}</span>
              </span>
              <span className="flex items-center gap-2">
                <span className="tabular font-medium">{fmtUSD(allocation.amount)}</span>
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
            Add cost codes to your budget lines first — risk can only be allocated to a coded cost
            line.
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

export function ExposureAllocationPanel({
  exposures,
  buckets,
  allocations,
  onAllocate,
  onRemoveAllocation,
  saving,
}: ExposureAllocationPanelProps) {
  // Only live holds carry risk; recovered/eliminated/released ones no longer
  // threaten the budget (matches the IOR's active-exposure definition).
  const activeExposures = exposures.filter(
    (exposure) =>
      (exposure.status === "active" || exposure.status === "escalated") &&
      exposure.dollar_exposure > 0,
  );
  const totals = useMemo(() => {
    const allocatedByExp = allocatedByExposure(allocations);
    const value = activeExposures.reduce((sum, exposure) => sum + exposure.dollar_exposure, 0);
    const allocated = activeExposures.reduce(
      (sum, exposure) => sum + (allocatedByExp.get(exposure.id) ?? 0),
      0,
    );
    return { value, allocated };
  }, [activeExposures, allocations]);

  if (activeExposures.length === 0) {
    return (
      <div className="rounded-md border border-hairline bg-surface p-4 text-sm text-muted-foreground">
        No live risk holds yet. Add exposures in the Risk Tally, then allocate each to the SOV cost
        codes it threatens so the budget's At Risk and Contingency columns stay live.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-1 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Risk holds: allocate to cost codes
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Spread each E-Hold (At Risk) and C-Hold (Contingency) onto the cost codes it threatens.
            Whatever you don't allocate stays as general job risk. This is what makes the budget's
            At Risk column live — not a number someone typed.
          </p>
        </div>
        <div className="text-sm tabular text-muted-foreground">
          Holds {fmtUSD(totals.value)} · Allocated {fmtUSD(totals.allocated)}
        </div>
      </div>
      {activeExposures.map((exposure) => (
        <ExposureRowCard
          key={exposure.id}
          exposure={exposure}
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
