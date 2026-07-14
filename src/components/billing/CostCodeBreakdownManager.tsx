import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
import { fmtUSDCents } from "@/lib/billing-format";
import {
  deleteCostBudgetItem,
  saveCostBudgetItem,
  type CostBudgetItemRow,
} from "@/lib/billing.functions";
import type { BucketRow } from "@/lib/projects.functions";
import { cn } from "@/lib/utils";

type ItemCategory = CostBudgetItemRow["category"];

const CATEGORY_LABEL: Record<ItemCategory, string> = {
  labor: "Labor",
  material: "Material",
  equipment: "Equipment",
  subcontract: "Subcontract",
  other: "Other",
};

const emptyDraft = () => ({
  description: "",
  category: "material" as ItemCategory,
  planned_amount: 0,
});

export function CostCodeBreakdownManager({
  projectId,
  buckets,
  items,
  ready,
}: {
  projectId: string;
  buckets: BucketRow[];
  items: CostBudgetItemRow[];
  ready: boolean;
}) {
  const queryClient = useQueryClient();
  const saveItemFn = useServerFn(saveCostBudgetItem);
  const deleteItemFn = useServerFn(deleteCostBudgetItem);
  const [openBucketId, setOpenBucketId] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<
    Record<string, { description: string; category: ItemCategory; planned_amount: number }>
  >({});

  const itemsByBucket = useMemo(() => {
    const result = new Map<string, CostBudgetItemRow[]>();
    for (const item of items) {
      const list = result.get(item.cost_bucket_id) ?? [];
      list.push(item);
      result.set(item.cost_bucket_id, list);
    }
    return result;
  }, [items]);

  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["cost-ledger-details", projectId] });

  const saveMutation = useMutation({
    mutationFn: (input: {
      cost_bucket_id: string;
      description: string;
      category: ItemCategory;
      planned_amount: number;
      sort_order: number;
    }) => saveItemFn({ data: { projectId, ...input } }),
    onSuccess: (_saved, variables) => {
      setDrafts((current) => ({ ...current, [variables.cost_bucket_id]: emptyDraft() }));
      refresh();
      toast.success("Budget sub-cost added");
    },
    onError: (error) =>
      toast.error("Sub-cost did not save", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteItemFn({ data: { id, projectId } }),
    onSuccess: () => {
      refresh();
      toast.success("Budget sub-cost removed");
    },
    onError: (error) =>
      toast.error("Sub-cost did not delete", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  return (
    <section className="mt-5 border-t border-hairline pt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="eyebrow">Cost plan</div>
          <h3 className="mt-1 font-serif text-xl font-normal text-foreground">
            What makes up each budget code?
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Break a code into concrete, labor, rebar, equipment, or other planned costs. The
            breakdown explains the budget; it does not change the locked code total.
          </p>
        </div>
        {!ready ? <span className="text-xs text-warning">Database update pending</span> : null}
      </div>

      <div className="mt-4 divide-y divide-hairline border-y border-hairline">
        {buckets.map((bucket) => {
          const bucketItems = itemsByBucket.get(bucket.id) ?? [];
          const plannedCents = bucketItems.reduce(
            (sum, item) => sum + item.planned_amount_cents,
            0,
          );
          const plannedAmount = plannedCents / 100;
          const budgetAmount = bucket.original_budget;
          const remainingAmount = budgetAmount - plannedAmount;
          const open = openBucketId === bucket.id;
          const draft = drafts[bucket.id] ?? emptyDraft();

          return (
            <div key={bucket.id}>
              <button
                type="button"
                className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-3 text-left transition-colors hover:bg-muted/35"
                onClick={() => setOpenBucketId(open ? null : bucket.id)}
              >
                <span className="flex min-w-0 items-center gap-3">
                  {open ? (
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="min-w-0">
                    <span className="block font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                      {bucket.cost_code || "No code"}
                    </span>
                    <span className="mt-0.5 block truncate text-sm font-medium text-foreground">
                      {bucket.bucket}
                    </span>
                  </span>
                </span>
                <span className="text-right">
                  <span className="block font-serif text-base tabular text-foreground">
                    {fmtUSDCents(plannedAmount)} / {fmtUSDCents(budgetAmount)}
                  </span>
                  <span
                    className={cn(
                      "block text-[11px]",
                      remainingAmount < 0 ? "text-danger" : "text-muted-foreground",
                    )}
                  >
                    {remainingAmount < 0
                      ? `${fmtUSDCents(Math.abs(remainingAmount))} over the code budget`
                      : `${fmtUSDCents(remainingAmount)} left to plan`}
                  </span>
                </span>
              </button>

              {open ? (
                <div className="pb-4 pl-7 sm:pl-10">
                  {bucketItems.length > 0 ? (
                    <div className="divide-y divide-hairline border-y border-hairline">
                      {bucketItems.map((item) => (
                        <div
                          key={item.id}
                          className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="truncate text-sm text-foreground">
                              {item.description}
                            </div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              {CATEGORY_LABEL[item.category]}
                            </div>
                          </div>
                          <div className="font-medium tabular text-foreground">
                            {fmtUSDCents(item.planned_amount_cents / 100)}
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-danger"
                            disabled={deleteMutation.isPending}
                            onClick={() => deleteMutation.mutate(item.id)}
                            aria-label={`Remove ${item.description}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-3 text-sm text-muted-foreground">
                      No sub-costs yet. Add the first item below.
                    </p>
                  )}

                  <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_150px_150px_auto] sm:items-end">
                    <div className="space-y-1.5">
                      <Label>Description</Label>
                      <Input
                        value={draft.description}
                        placeholder="Concrete labor, rebar, epoxy…"
                        disabled={!ready}
                        onChange={(event) =>
                          setDrafts((current) => ({
                            ...current,
                            [bucket.id]: { ...draft, description: event.target.value },
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label>Type</Label>
                      <Select
                        value={draft.category}
                        disabled={!ready}
                        onValueChange={(category) =>
                          setDrafts((current) => ({
                            ...current,
                            [bucket.id]: { ...draft, category: category as ItemCategory },
                          }))
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                            <SelectItem key={value} value={value}>
                              {label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Planned cost</Label>
                      <MoneyInput
                        value={draft.planned_amount}
                        disabled={!ready}
                        align="right"
                        onValueChange={(planned_amount) =>
                          setDrafts((current) => ({
                            ...current,
                            [bucket.id]: { ...draft, planned_amount },
                          }))
                        }
                      />
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      disabled={!ready || saveMutation.isPending || !draft.description.trim()}
                      onClick={() =>
                        saveMutation.mutate({
                          cost_bucket_id: bucket.id,
                          description: draft.description.trim(),
                          category: draft.category,
                          planned_amount: draft.planned_amount,
                          sort_order: bucketItems.length,
                        })
                      }
                    >
                      <Plus className="h-3.5 w-3.5" /> Add
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
