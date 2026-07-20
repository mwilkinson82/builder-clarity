// Exposure → cost-code allocation (BUDGETENGINE Phase 1: "At Risk goes live").
// Each IOR exposure — an E-Hold (emergent at-risk) or a C-Hold (contingency) —
// shows its dollar value, what's already spread onto SOV cost codes, and what
// remains as general job risk. Allocating a slice to a cost code is what makes
// the budget ledger's At Risk (E) / Contingency (C) columns live instead of a
// number someone types. Mirrors the change-order allocation panel.
import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, Pencil, Plus, Trash2, X } from "lucide-react";

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
import type { ExposureAllocationRow } from "@/lib/exposure-allocations.functions";
import type { BucketRow, ExposureRow } from "@/lib/projects.functions";

export interface ExposureAllocationInput {
  exposureId: string;
  costBucketId: string;
  amount: number;
  operationKey: string;
}

export interface ExposureAllocationUpdateInput {
  id: string;
  costBucketId: string;
  amount: number;
  expectedVersion: number;
  operationKey: string;
}

export interface ExposureAllocationDeleteInput {
  id: string;
  expectedVersion: number;
  operationKey: string;
}

interface ExposureAllocationPanelProps {
  exposures: ExposureRow[];
  buckets: BucketRow[];
  allocations: ExposureAllocationRow[];
  onAllocate: (input: ExposureAllocationInput) => Promise<void>;
  onUpdateAllocation: (input: ExposureAllocationUpdateInput) => Promise<void>;
  onRemoveAllocation: (input: ExposureAllocationDeleteInput) => Promise<void>;
  saving?: boolean;
}

function bucketLabel(bucket: BucketRow) {
  return [bucket.cost_code, bucket.bucket].filter(Boolean).join(" · ") || "Uncoded line";
}

function newOperationKey(exposureId: string, action: "create" | "update" | "delete") {
  const nonce = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  return `exposure-allocation:${exposureId}:${action}:${nonce}`;
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
  onUpdateAllocation,
  onRemoveAllocation,
  saving,
}: {
  exposure: ExposureRow;
  buckets: BucketRow[];
  allocations: ExposureAllocationRow[];
  onAllocate: (input: ExposureAllocationInput) => Promise<void>;
  onUpdateAllocation: (input: ExposureAllocationUpdateInput) => Promise<void>;
  onRemoveAllocation: (input: ExposureAllocationDeleteInput) => Promise<void>;
  saving?: boolean;
}) {
  const summary = summarizeExposure(exposure.id, exposure.dollar_exposure, allocations);
  const rowAllocations = allocations.filter((allocation) => allocation.exposure_id === exposure.id);
  const [bucketId, setBucketId] = useState("");
  const [amount, setAmount] = useState(0);
  const [operationKey, setOperationKey] = useState(() => newOperationKey(exposure.id, "create"));
  const [submitError, setSubmitError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editBucketId, setEditBucketId] = useState("");
  const [editAmount, setEditAmount] = useState(0);
  const [editOperationKey, setEditOperationKey] = useState(() =>
    newOperationKey(exposure.id, "update"),
  );
  const [editError, setEditError] = useState("");
  const [editing, setEditing] = useState(false);
  const [deleteErrors, setDeleteErrors] = useState<Record<string, string>>({});
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const deleteOperationKeys = useRef(new Map<string, string>());
  const busy = Boolean(saving || submitting || editing || deletingId);

  // Only cost-coded buckets are valid targets — an uncoded line can't carry
  // risk into the At Risk / Contingency column.
  const codedBuckets = buckets.filter((bucket) => bucket.cost_code.trim());

  const startAllocation = (nextBucketId: string) => {
    setBucketId(nextBucketId);
    setOperationKey(newOperationKey(exposure.id, "create"));
    setSubmitError("");
    if (summary.remaining > 0) setAmount(summary.remaining);
  };

  const changeAmount = (nextAmount: number) => {
    setAmount(nextAmount);
    setOperationKey(newOperationKey(exposure.id, "create"));
    setSubmitError("");
  };

  const submit = async () => {
    if (busy || !bucketId || amount <= 0) return;
    setSubmitError("");
    setSubmitting(true);
    try {
      await onAllocate({
        exposureId: exposure.id,
        costBucketId: bucketId,
        amount,
        operationKey,
      });
      setBucketId("");
      setAmount(0);
      setOperationKey(newOperationKey(exposure.id, "create"));
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : "Allocation did not save.");
    } finally {
      setSubmitting(false);
    }
  };

  const beginEdit = (allocation: ExposureAllocationRow) => {
    setEditingId(allocation.id);
    setEditBucketId(allocation.cost_bucket_id);
    setEditAmount(allocation.amount);
    setEditOperationKey(newOperationKey(exposure.id, "update"));
    setEditError("");
  };

  const cancelEdit = () => {
    if (editing) return;
    setEditingId(null);
    setEditError("");
  };

  const changeEditBucket = (nextBucketId: string) => {
    setEditBucketId(nextBucketId);
    setEditOperationKey(newOperationKey(exposure.id, "update"));
    setEditError("");
  };

  const changeEditAmount = (nextAmount: number) => {
    setEditAmount(nextAmount);
    setEditOperationKey(newOperationKey(exposure.id, "update"));
    setEditError("");
  };

  const submitEdit = async (allocation: ExposureAllocationRow) => {
    if (busy || editAmount <= 0 || !editBucketId) return;
    setEditError("");
    setEditing(true);
    try {
      await onUpdateAllocation({
        id: allocation.id,
        costBucketId: editBucketId,
        amount: editAmount,
        expectedVersion: allocation.version,
        operationKey: editOperationKey,
      });
      setEditingId(null);
      setEditError("");
      setEditOperationKey(newOperationKey(exposure.id, "update"));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Allocation did not update.");
    } finally {
      setEditing(false);
    }
  };

  const remove = async (allocation: ExposureAllocationRow) => {
    if (busy) return;
    const existingKey = deleteOperationKeys.current.get(allocation.id);
    const key = existingKey ?? newOperationKey(exposure.id, "delete");
    deleteOperationKeys.current.set(allocation.id, key);
    setDeleteErrors((current) => ({ ...current, [allocation.id]: "" }));
    setDeletingId(allocation.id);
    try {
      await onRemoveAllocation({
        id: allocation.id,
        expectedVersion: allocation.version,
        operationKey: key,
      });
      deleteOperationKeys.current.delete(allocation.id);
      setDeleteErrors((current) => {
        const next = { ...current };
        delete next[allocation.id];
        return next;
      });
    } catch (error) {
      setDeleteErrors((current) => ({
        ...current,
        [allocation.id]: error instanceof Error ? error.message : "Allocation did not remove.",
      }));
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="rounded-md border border-hairline bg-surface p-4">
      <div className="flex flex-col gap-2 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-foreground">{exposure.title || "Untitled risk"}</span>
            <span className="inline-flex items-center whitespace-nowrap rounded-full border border-accent/40 bg-accent/5 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.06em] text-clay">
              {exposure.hold_class} · {holdColumn(exposure.hold_class).toLowerCase()}
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
          <span>
            Value <span className="font-serif">{fmtUSD(exposure.dollar_exposure)}</span>
          </span>
          <span>
            Allocated <span className="font-serif">{fmtUSD(summary.allocated)}</span>
          </span>
          <span className="font-semibold text-foreground">
            General <span className="font-serif">{fmtUSD(summary.remaining)}</span>
          </span>
        </div>
      </div>

      {rowAllocations.length > 0 ? (
        <div className="mt-3 space-y-1.5">
          {rowAllocations.map((allocation) => {
            const isEditing = editingId === allocation.id;
            return (
              <div
                key={allocation.id}
                className="rounded-md border border-hairline bg-card px-3 py-2 text-xs"
              >
                {isEditing ? (
                  <div className="space-y-2">
                    <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto] sm:items-end">
                      <div className="space-y-1">
                        <Label className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                          Cost code
                        </Label>
                        <Select
                          value={editBucketId}
                          onValueChange={changeEditBucket}
                          disabled={busy}
                        >
                          <SelectTrigger className="h-8">
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
                      <div className="space-y-1">
                        <Label className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                          Amount
                        </Label>
                        <MoneyInput
                          value={editAmount}
                          onValueChange={changeEditAmount}
                          align="right"
                          className="h-8"
                          disabled={busy}
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          size="sm"
                          className="h-8"
                          disabled={busy || !editBucketId || editAmount <= 0}
                          onClick={() => void submitEdit(allocation)}
                        >
                          Save
                        </Button>
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          aria-label="Cancel allocation edit"
                          disabled={editing}
                          onClick={cancelEdit}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                    {editError ? (
                      <p role="alert" className="text-xs text-danger">
                        {editError}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-2">
                      <span className="min-w-0 truncate">
                        <span className="font-medium text-foreground">
                          {allocation.cost_code || "Uncoded"}
                        </span>
                        <span className="text-muted-foreground">
                          {" "}
                          · {holdColumn(exposure.hold_class)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="mr-1 tabular font-medium">
                          {fmtUSD(allocation.amount)}
                        </span>
                        <button
                          type="button"
                          aria-label="Edit allocation"
                          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                          disabled={busy}
                          onClick={() => beginEdit(allocation)}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          aria-label="Remove allocation"
                          className="rounded p-1 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                          disabled={busy}
                          onClick={() => void remove(allocation)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </span>
                    </div>
                    {deleteErrors[allocation.id] ? (
                      <p role="alert" className="mt-1 text-xs text-danger">
                        {deleteErrors[allocation.id]}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            );
          })}
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
              <Label className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Allocate to cost code
              </Label>
              <Select value={bucketId} onValueChange={startAllocation} disabled={busy}>
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
              <Label className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Amount
              </Label>
              <MoneyInput
                value={amount}
                onValueChange={changeAmount}
                align="right"
                className="h-9"
                disabled={busy}
              />
            </div>
            <Button
              type="button"
              size="sm"
              className="h-9 gap-1.5"
              disabled={busy || !bucketId || amount <= 0}
              onClick={() => void submit()}
            >
              <Plus className="h-3.5 w-3.5" /> Allocate
            </Button>
            {submitError ? (
              <p role="alert" className="text-xs text-danger sm:basis-full">
                {submitError}
              </p>
            ) : null}
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
  onUpdateAllocation,
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
          <div className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
            Risk holds: allocate to cost codes
          </div>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Spread each E-Hold (At Risk) and C-Hold (Contingency) onto the cost codes it threatens.
            Whatever you don't allocate stays as general job risk. This is what makes the budget's
            At Risk column live — not a number someone typed.
          </p>
        </div>
        <div className="text-sm tabular text-muted-foreground">
          Holds <span className="font-serif text-foreground">{fmtUSD(totals.value)}</span> ·
          Allocated <span className="font-serif text-foreground">{fmtUSD(totals.allocated)}</span>
        </div>
      </div>
      {activeExposures.map((exposure) => (
        <ExposureRowCard
          key={exposure.id}
          exposure={exposure}
          buckets={buckets}
          allocations={allocations}
          onAllocate={onAllocate}
          onUpdateAllocation={onUpdateAllocation}
          onRemoveAllocation={onRemoveAllocation}
          saving={saving}
        />
      ))}
    </div>
  );
}
