import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Lock, Plus, Save, Search, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  createCostLibraryItem,
  deleteCostLibraryItem,
  listCostLibraryItems,
  updateCostLibraryItem,
  type CostLibraryItemRow,
} from "@/lib/estimates.functions";
import { fmtUSD } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/cost-library")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Cost Library — Overwatch" },
      {
        name: "description",
        content: "Overwatch estimating cost library.",
      },
    ],
  }),
  component: CostLibraryPage,
});

const centsToDollars = (value: number) => Math.round(value) / 100;
const dollarsToCents = (value: number) => Math.round(value * 100);

type NewItem = {
  csi_division: string;
  csi_code: string;
  category: string;
  description: string;
  unit: string;
  material_cost_cents: number;
  labor_cost_cents: number;
};

const blankItem: NewItem = {
  csi_division: "",
  csi_code: "",
  category: "",
  description: "",
  unit: "EA",
  material_cost_cents: 0,
  labor_cost_cents: 0,
};

function CostLibraryPage() {
  const qc = useQueryClient();
  const list = useServerFn(listCostLibraryItems);
  const create = useServerFn(createCostLibraryItem);
  const update = useServerFn(updateCostLibraryItem);
  const remove = useServerFn(deleteCostLibraryItem);
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState("all");
  const [category, setCategory] = useState("all");
  const [newOpen, setNewOpen] = useState(false);
  const [draft, setDraft] = useState<NewItem>(blankItem);

  const libraryQuery = useQuery({
    queryKey: ["cost-library", division, category],
    queryFn: () =>
      list({
        data: {
          csi_division: division === "all" ? "" : division,
          category: category === "all" ? "" : category,
        },
      }),
  });

  const createMutation = useMutation({
    mutationFn: () =>
      create({
        data: {
          ...draft,
          unit: draft.unit.toUpperCase(),
          synonyms: [],
          keywords: draft.description
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean),
        },
      }),
    onSuccess: () => {
      toast.success("Custom item added");
      setNewOpen(false);
      setDraft(blankItem);
      qc.invalidateQueries({ queryKey: ["cost-library"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Item did not save"),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<NewItem> }) =>
      update({ data: { id, patch } }),
    onSuccess: () => {
      toast.success("Item updated");
      qc.invalidateQueries({ queryKey: ["cost-library"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Item did not update"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => remove({ data: { id } }),
    onSuccess: () => {
      toast.success("Item deleted");
      qc.invalidateQueries({ queryKey: ["cost-library"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Item did not delete"),
  });

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (libraryQuery.data?.items ?? []).filter((item) => {
      if (!q) return true;
      return [
        item.description,
        item.category,
        item.csi_code,
        item.csi_division,
        item.unit,
        item.source,
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [libraryQuery.data, search]);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-hairline bg-surface-elevated">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-6 py-5 lg:px-10">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <Button asChild variant="ghost" size="icon" title="Back to estimates">
                <Link to="/estimates">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  Estimating
                </p>
                <h1 className="mt-1 font-serif text-3xl text-foreground">Cost Library</h1>
              </div>
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add Custom Item
            </Button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 px-6 py-8 lg:px-10">
        <div className="grid gap-3 rounded-lg border border-hairline bg-card p-4 shadow-card lg:grid-cols-[1fr_180px_220px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search description, CSI, unit, category, or source"
              className="pl-9"
            />
          </div>
          <Select value={division} onValueChange={setDivision}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All divisions</SelectItem>
              {(libraryQuery.data?.divisions ?? []).map((item) => (
                <SelectItem key={item} value={item}>
                  CSI {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={category} onValueChange={setCategory}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {(libraryQuery.data?.categories ?? []).map((item) => (
                <SelectItem key={item} value={item}>
                  {item}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-hidden rounded-lg border border-hairline bg-card shadow-card">
          <Table className="min-w-[1150px]">
            <TableHeader>
              <TableRow className="bg-surface [&>th]:whitespace-nowrap">
                <TableHead className="w-[96px]">Source</TableHead>
                <TableHead className="w-[90px]">CSI</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[110px]">Category</TableHead>
                <TableHead className="w-[80px]">Unit</TableHead>
                <TableHead className="w-[130px] text-right">Material</TableHead>
                <TableHead className="w-[130px] text-right">Labor</TableHead>
                <TableHead className="w-[104px]" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {libraryQuery.isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Loading...
                  </TableCell>
                </TableRow>
              ) : libraryQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={8} className="py-10 text-center text-sm text-danger">
                    {libraryQuery.error instanceof Error
                      ? libraryQuery.error.message
                      : "Cost library did not load"}
                  </TableCell>
                </TableRow>
              ) : visibleItems.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={8}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    No library items found.
                  </TableCell>
                </TableRow>
              ) : (
                visibleItems.map((item) => (
                  <CostLibraryRow
                    key={item.id}
                    item={item}
                    onSave={(patch) => updateMutation.mutate({ id: item.id, patch })}
                    onDelete={() => deleteMutation.mutate(item.id)}
                  />
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </main>

      <Dialog open={newOpen} onOpenChange={setNewOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Custom Item</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="CSI Division">
              <Input
                value={draft.csi_division}
                onChange={(event) => setDraft({ ...draft, csi_division: event.target.value })}
              />
            </Field>
            <Field label="CSI Code">
              <Input
                value={draft.csi_code}
                onChange={(event) => setDraft({ ...draft, csi_code: event.target.value })}
              />
            </Field>
            <Field label="Description">
              <Input
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
              />
            </Field>
            <Field label="Category">
              <Input
                value={draft.category}
                onChange={(event) => setDraft({ ...draft, category: event.target.value })}
              />
            </Field>
            <Field label="Unit">
              <Input
                value={draft.unit}
                onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
                className="uppercase"
              />
            </Field>
            <Field label="Material $/Unit">
              <MoneyInput
                value={centsToDollars(draft.material_cost_cents)}
                onValueChange={(value) =>
                  setDraft({ ...draft, material_cost_cents: dollarsToCents(value) })
                }
              />
            </Field>
            <Field label="Labor $/Unit">
              <MoneyInput
                value={centsToDollars(draft.labor_cost_cents)}
                onValueChange={(value) =>
                  setDraft({ ...draft, labor_cost_cents: dollarsToCents(value) })
                }
              />
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => createMutation.mutate()}
              disabled={
                !draft.csi_division.trim() ||
                !draft.description.trim() ||
                !draft.unit.trim() ||
                createMutation.isPending
              }
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function CostLibraryRow({
  item,
  onSave,
  onDelete,
}: {
  item: CostLibraryItemRow;
  onSave: (patch: Partial<NewItem>) => void;
  onDelete: () => void;
}) {
  const editable = item.source !== "system";
  const [draft, setDraft] = useState<NewItem>({
    csi_division: item.csi_division,
    csi_code: item.csi_code,
    category: item.category,
    description: item.description,
    unit: item.unit,
    material_cost_cents: item.material_cost_cents,
    labor_cost_cents: item.labor_cost_cents,
  });
  useEffect(() => {
    setDraft({
      csi_division: item.csi_division,
      csi_code: item.csi_code,
      category: item.category,
      description: item.description,
      unit: item.unit,
      material_cost_cents: item.material_cost_cents,
      labor_cost_cents: item.labor_cost_cents,
    });
  }, [item]);

  return (
    <TableRow className="[&>td]:py-3">
      <TableCell>
        <Badge variant="outline" className="gap-1 capitalize">
          {item.source === "system" && <Lock className="h-3 w-3" />}
          {item.source}
        </Badge>
      </TableCell>
      <TableCell>
        {editable ? (
          <Input
            value={draft.csi_division}
            onChange={(event) => setDraft({ ...draft, csi_division: event.target.value })}
            className="h-8"
          />
        ) : (
          <span className="tabular">{item.csi_code || item.csi_division}</span>
        )}
      </TableCell>
      <TableCell>
        {editable ? (
          <Input
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            className="h-8"
          />
        ) : (
          <div>
            <div className="font-medium">{item.description}</div>
            <div className="text-xs text-muted-foreground">{item.csi_code}</div>
          </div>
        )}
      </TableCell>
      <TableCell>
        {editable ? (
          <Input
            value={draft.category}
            onChange={(event) => setDraft({ ...draft, category: event.target.value })}
            className="h-8"
          />
        ) : (
          item.category
        )}
      </TableCell>
      <TableCell>
        {editable ? (
          <Input
            value={draft.unit}
            onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
            className="h-8 uppercase"
          />
        ) : (
          item.unit
        )}
      </TableCell>
      <TableCell className="text-right">
        {editable ? (
          <MoneyInput
            value={centsToDollars(draft.material_cost_cents)}
            onValueChange={(value) =>
              setDraft({ ...draft, material_cost_cents: dollarsToCents(value) })
            }
            align="right"
            className="h-8"
          />
        ) : (
          <span className="tabular">{fmtUSD(item.material_cost_cents / 100)}</span>
        )}
      </TableCell>
      <TableCell className="text-right">
        {editable ? (
          <MoneyInput
            value={centsToDollars(draft.labor_cost_cents)}
            onValueChange={(value) =>
              setDraft({ ...draft, labor_cost_cents: dollarsToCents(value) })
            }
            align="right"
            className="h-8"
          />
        ) : (
          <span className="tabular">{fmtUSD(item.labor_cost_cents / 100)}</span>
        )}
      </TableCell>
      <TableCell>
        {editable && (
          <div className="flex justify-end gap-1">
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => onSave(draft)}>
              <Save className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onDelete}>
              <Trash2 className="h-4 w-4 text-danger" />
            </Button>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}
