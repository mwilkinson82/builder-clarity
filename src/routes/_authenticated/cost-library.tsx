import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  Library,
  Lock,
  Plus,
  Save,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import {
  createCostLibraryItem,
  deleteCostLibraryItem,
  importCostLibraryItems,
  listCostLibraryItems,
  updateCostLibraryItem,
  type CostLibraryItemRow,
} from "@/lib/estimates.functions";
import { getCompanyWorkspaceContext } from "@/lib/team.functions";
import {
  costLibraryTemplateCsv,
  parseCostLibraryRows,
  type CostLibraryImportRow,
} from "@/lib/estimate-import";
import { fmtUSD } from "@/lib/format";
import { parseCsv, parsePaste, parseXlsx } from "@/lib/sov-import";

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

function downloadText(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

type NewItem = {
  csi_division: string;
  csi_code: string;
  category: string;
  description: string;
  unit: string;
  material_cost_cents: number;
  labor_cost_cents: number;
  crew_size: number | null;
  productivity_per_hour: number | null;
};

type LibraryView = "system" | "my";
type CostFocus = "all" | "material" | "labor" | "installed";

const blankItem: NewItem = {
  csi_division: "",
  csi_code: "",
  category: "",
  description: "",
  unit: "EA",
  material_cost_cents: 0,
  labor_cost_cents: 0,
  crew_size: null,
  productivity_per_hour: null,
};

const EMPTY_COST_ITEMS: CostLibraryItemRow[] = [];

const costFocusOptions: Array<{ value: CostFocus; label: string; description: string }> = [
  { value: "all", label: "All Costs", description: "Material, labor, and installed costs." },
  { value: "material", label: "Material", description: "Material price per unit." },
  { value: "labor", label: "Labor", description: "Labor price per unit, with crew assumptions." },
  { value: "installed", label: "Installed", description: "Material and labor in one row." },
];

const getCostProfile = (
  item: Pick<CostLibraryItemRow, "material_cost_cents" | "labor_cost_cents">,
) => {
  const hasMaterial = item.material_cost_cents > 0;
  const hasLabor = item.labor_cost_cents > 0;
  if (hasMaterial && hasLabor) return "installed" as const;
  if (hasLabor) return "labor" as const;
  if (hasMaterial) return "material" as const;
  return "empty" as const;
};

const profileLabel = (profile: ReturnType<typeof getCostProfile>) => {
  if (profile === "installed") return "Installed";
  if (profile === "labor") return "Labor";
  if (profile === "material") return "Material";
  return "No cost";
};

const matchesCostFocus = (item: CostLibraryItemRow, focus: CostFocus) => {
  const profile = getCostProfile(item);
  if (focus === "all") return true;
  if (focus === "installed") return profile === "installed";
  if (focus === "labor") return item.labor_cost_cents > 0;
  return item.material_cost_cents > 0;
};

const unitLabel = (unit: string) => unit.trim().toUpperCase() || "unit";

function CostRateDisplay({
  cents,
  unit,
  kind,
}: {
  cents: number;
  unit: string;
  kind: "Material" | "Labor";
}) {
  const normalizedUnit = unitLabel(unit);
  if (cents <= 0) {
    return (
      <div className="text-right text-xs text-muted-foreground">
        <div className="font-medium">Not priced</div>
        <div>{kind === "Material" ? "No material cost" : "No labor cost"}</div>
      </div>
    );
  }
  return (
    <div className="text-right">
      <div className="font-medium tabular">
        {fmtUSD(cents / 100)}{" "}
        <span className="text-xs text-muted-foreground">/ {normalizedUnit}</span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {kind === "Labor"
          ? `Labor price per ${normalizedUnit}, not per worker`
          : `Material price per ${normalizedUnit}`}
      </div>
    </div>
  );
}

function CostMoneyInput({
  value,
  unit,
  onValueChange,
  ariaLabel,
}: {
  value: number;
  unit: string;
  onValueChange: (value: number) => void;
  ariaLabel: string;
}) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        $
      </span>
      <MoneyInput
        value={value}
        onValueChange={onValueChange}
        align="right"
        aria-label={ariaLabel}
        className="h-8 pl-6 pr-12"
      />
      <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">
        /{unitLabel(unit)}
      </span>
    </div>
  );
}

function CrewProductionDisplay({
  item,
}: {
  item: Pick<CostLibraryItemRow, "crew_size" | "productivity_per_hour" | "unit">;
}) {
  const crew = item.crew_size
    ? `${Number(item.crew_size).toLocaleString("en-US", {
        maximumFractionDigits: 1,
      })}-person crew`
    : "";
  const production = item.productivity_per_hour
    ? `${Number(item.productivity_per_hour).toLocaleString("en-US", {
        maximumFractionDigits: 2,
      })} ${unitLabel(item.unit)}/hr production`
    : "";
  if (!crew && !production) return <span className="text-muted-foreground">No assumption</span>;
  return (
    <div className="text-xs">
      {crew && <div className="font-medium text-foreground">{crew}</div>}
      {production && <div className="text-muted-foreground">{production}</div>}
    </div>
  );
}

function CostLibraryPage() {
  const qc = useQueryClient();
  const list = useServerFn(listCostLibraryItems);
  const create = useServerFn(createCostLibraryItem);
  const bulkImport = useServerFn(importCostLibraryItems);
  const update = useServerFn(updateCostLibraryItem);
  const remove = useServerFn(deleteCostLibraryItem);
  const loadCompanyContext = useServerFn(getCompanyWorkspaceContext);
  const [search, setSearch] = useState("");
  const [division, setDivision] = useState("all");
  const [category, setCategory] = useState("all");
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [importRows, setImportRows] = useState<CostLibraryImportRow[]>([]);
  const [importSource, setImportSource] = useState("");
  const [draft, setDraft] = useState<NewItem>(blankItem);
  const [activeView, setActiveView] = useState<LibraryView>("system");
  const [costFocus, setCostFocus] = useState<CostFocus>("all");

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
  const { data: companyContext } = useQuery({
    queryKey: ["company-workspace-context"],
    queryFn: () => loadCompanyContext(),
  });
  const companyName = companyContext?.name || "Company";

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
    onSuccess: (result) => {
      toast.success("Custom item added to My Cost Library");
      setNewOpen(false);
      setDraft(blankItem);
      setActiveView("my");
      setSearch(result.item.description);
      qc.invalidateQueries({ queryKey: ["cost-library"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Item did not save"),
  });

  const copyMutation = useMutation({
    mutationFn: (item: CostLibraryItemRow) =>
      create({
        data: {
          csi_division: item.csi_division,
          csi_code: item.csi_code,
          category: item.category,
          description: `${item.description} (custom)`.slice(0, 500),
          unit: item.unit,
          material_cost_cents: item.material_cost_cents,
          labor_cost_cents: item.labor_cost_cents,
          crew_size: item.crew_size,
          productivity_per_hour: item.productivity_per_hour,
          synonyms: item.synonyms.map(String).slice(0, 40),
          keywords: item.keywords.map(String).slice(0, 60),
        },
      }),
    onSuccess: (result) => {
      toast.success("Added to My Cost Library");
      setActiveView("my");
      setSearch(result.item.description);
      qc.invalidateQueries({ queryKey: ["cost-library"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Copy did not save"),
  });

  const importableRows = importRows.filter((row) => row.valid);

  const importMutation = useMutation({
    mutationFn: () =>
      bulkImport({
        data: {
          items: importableRows.map((row) => ({
            csi_division: row.csi_division,
            csi_code: row.csi_code,
            category: row.category,
            description: row.description,
            unit: row.unit,
            material_cost_cents: row.material_cost_cents,
            labor_cost_cents: row.labor_cost_cents,
            crew_size: row.crew_size,
            productivity_per_hour: row.productivity_per_hour,
            synonyms: [],
            keywords: row.keywords,
          })),
        },
      }),
    onSuccess: (result) => {
      const updated = result.updated_count ?? 0;
      toast.success(
        updated > 0
          ? `${result.created_count} cost items added, ${updated} updated`
          : `${result.created_count} cost items imported`,
      );
      setImportOpen(false);
      setImportRows([]);
      setPasteText("");
      setImportSource("");
      setActiveView("my");
      setSearch("");
      qc.invalidateQueries({ queryKey: ["cost-library"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Cost import did not save"),
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

  const allItems = libraryQuery.data?.items ?? EMPTY_COST_ITEMS;
  const systemCount = allItems.filter((item) => item.source === "system").length;
  const myCount = allItems.length - systemCount;
  const sourceItems = useMemo(
    () =>
      allItems.filter((item) =>
        activeView === "system" ? item.source === "system" : item.source !== "system",
      ),
    [activeView, allItems],
  );
  const costCounts = useMemo(
    () => ({
      all: sourceItems.length,
      material: sourceItems.filter((item) => item.material_cost_cents > 0).length,
      labor: sourceItems.filter((item) => item.labor_cost_cents > 0).length,
      installed: sourceItems.filter((item) => getCostProfile(item) === "installed").length,
    }),
    [sourceItems],
  );

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sourceFiltered = sourceItems.filter((item) => matchesCostFocus(item, costFocus));
    const searched = sourceFiltered.filter((item) => {
      if (!q) return true;
      return [
        item.description,
        item.category,
        item.csi_code,
        item.csi_division,
        item.unit,
        item.source,
        profileLabel(getCostProfile(item)),
      ]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
    if (activeView === "system") return searched;
    return [...searched].sort(
      (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
    );
  }, [activeView, costFocus, search, sourceItems]);

  const activeEmptyMessage =
    activeView === "system"
      ? "No Overwatch system costs found for this view."
      : "No personal costs found for this view. Add a custom cost, import your spreadsheet, or copy Overwatch pricing into My Cost Library.";
  const activeViewDescription =
    activeView === "system"
      ? "Read-only Overwatch starter pricing. Use the labor view for crew-based labor items, then copy useful rows into My Cost Library before editing them."
      : "Your editable material and labor price book. These saved costs are searchable inside master sheets and project estimates.";

  const resetImport = () => {
    setImportRows([]);
    setPasteText("");
    setImportSource("");
  };

  const stageImportRows = (matrix: string[][], hasHeader: boolean, source: string) => {
    const rows = parseCostLibraryRows(matrix, hasHeader);
    setImportRows(rows);
    setImportSource(source);
    if (rows.length === 0) {
      toast.warning("No cost rows found");
      return;
    }
    const valid = rows.filter((row) => row.valid).length;
    toast.success(`${valid} cost rows staged`);
  };

  const handleFile = async (file: File) => {
    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      const parsed =
        extension === "xlsx" || extension === "xls" ? await parseXlsx(file) : await parseCsv(file);
      stageImportRows(
        parsed.matrix,
        parsed.hasHeader,
        `${parsed.source.toUpperCase()}${parsed.sheetName ? ` · ${parsed.sheetName}` : ""}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "File did not parse");
    }
  };

  const handlePaste = () => {
    const parsed = parsePaste(pasteText);
    stageImportRows(parsed.matrix, parsed.hasHeader, "Pasted rows");
  };

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
                  {companyName}
                </p>
                <h1 className="mt-1 font-serif text-3xl text-foreground">Cost Library</h1>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                title="Download the CSV column guide for importing costs"
                onClick={() =>
                  downloadText(
                    "overwatch-cost-library-import-format.csv",
                    costLibraryTemplateCsv,
                    "text/csv",
                  )
                }
              >
                <Download className="h-3.5 w-3.5" /> Download Import Format
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setImportOpen(true)}
              >
                <Upload className="h-3.5 w-3.5" /> Import My Costs
              </Button>
              <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
                <Plus className="h-3.5 w-3.5" /> Add Custom Cost
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] space-y-5 px-6 py-8 lg:px-10">
        <section className="rounded-lg border border-hairline bg-card p-4 shadow-card">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-3xl">
              <div className="flex items-center gap-2 font-medium">
                <Library className="h-4 w-4" />
                Build your estimating price book
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Start from Overwatch material and labor pricing, import your spreadsheet, or add
                costs by hand. My Cost Library is the editable price book used by master sheets and
                project estimates.
              </p>
            </div>
            <Tabs
              value={activeView}
              onValueChange={(value) => setActiveView(value as LibraryView)}
              className="w-full lg:w-auto"
            >
              <TabsList className="grid w-full grid-cols-2 lg:w-[390px]">
                <TabsTrigger value="system">Overwatch Library ({systemCount})</TabsTrigger>
                <TabsTrigger value="my">My Cost Library ({myCount})</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto] lg:items-end">
            <div className="grid gap-2 sm:grid-cols-4">
              {costFocusOptions.map((option) => {
                const active = costFocus === option.value;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setCostFocus(option.value)}
                    className={`rounded-md border px-3 py-2 text-left transition ${
                      active
                        ? "border-foreground bg-foreground text-background"
                        : "border-hairline bg-surface hover:bg-muted"
                    }`}
                  >
                    <span className="block text-sm font-medium">
                      {option.label} ({costCounts[option.value]})
                    </span>
                    <span
                      className={`mt-0.5 block text-xs ${
                        active ? "text-background/75" : "text-muted-foreground"
                      }`}
                    >
                      {option.description}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="text-xs text-muted-foreground lg:max-w-sm">{activeViewDescription}</p>
          </div>
          <div className="mt-4 grid gap-2 rounded-lg border border-hairline bg-surface p-3 md:grid-cols-3">
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Material $/Unit
              </div>
              <p className="mt-1 text-sm text-foreground">
                The material price for one unit, like one LF, SF, EA, or MO.
              </p>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Labor $/Unit
              </div>
              <p className="mt-1 text-sm text-foreground">
                The labor price for one unit. It is not multiplied by crew size.
              </p>
            </div>
            <div>
              <div className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                Crew / Production
              </div>
              <p className="mt-1 text-sm text-foreground">
                The crew and speed assumption behind the labor price.
              </p>
            </div>
          </div>
        </section>

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
          <Table className="min-w-[1480px]">
            <TableHeader>
              <TableRow className="bg-surface [&>th]:whitespace-nowrap">
                <TableHead className="w-[110px]">Source</TableHead>
                <TableHead className="w-[110px]">Type</TableHead>
                <TableHead className="w-[120px]">CSI</TableHead>
                <TableHead>Description</TableHead>
                <TableHead className="w-[110px]">Category</TableHead>
                <TableHead className="w-[80px]">Unit</TableHead>
                <TableHead className="w-[150px] text-right">Material $/Unit</TableHead>
                <TableHead className="w-[170px] text-right">Labor $/Unit</TableHead>
                <TableHead className="w-[190px]">Crew / Production</TableHead>
                <TableHead className="w-[190px] text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {libraryQuery.isLoading ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    Loading...
                  </TableCell>
                </TableRow>
              ) : libraryQuery.isError ? (
                <TableRow>
                  <TableCell colSpan={10} className="py-10 text-center text-sm text-danger">
                    {libraryQuery.error instanceof Error
                      ? libraryQuery.error.message
                      : "Cost library did not load"}
                  </TableCell>
                </TableRow>
              ) : visibleItems.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="py-10 text-center text-sm text-muted-foreground"
                  >
                    {activeEmptyMessage}
                  </TableCell>
                </TableRow>
              ) : (
                visibleItems.map((item) => (
                  <CostLibraryRow
                    key={item.id}
                    item={item}
                    onSave={(patch) => updateMutation.mutate({ id: item.id, patch })}
                    onDelete={() => deleteMutation.mutate(item.id)}
                    onCopy={() => copyMutation.mutate(item)}
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
            <DialogTitle>Add Custom Cost</DialogTitle>
            <DialogDescription>
              Save one editable cost to My Cost Library. It will appear in master sheet and estimate
              line-item search.
            </DialogDescription>
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
              <CostMoneyInput
                value={centsToDollars(draft.material_cost_cents)}
                onValueChange={(value) =>
                  setDraft({ ...draft, material_cost_cents: dollarsToCents(value) })
                }
                unit={draft.unit}
                ariaLabel="Material dollars per unit"
              />
            </Field>
            <Field label="Labor $/Unit (not per worker)">
              <CostMoneyInput
                value={centsToDollars(draft.labor_cost_cents)}
                onValueChange={(value) =>
                  setDraft({ ...draft, labor_cost_cents: dollarsToCents(value) })
                }
                unit={draft.unit}
                ariaLabel="Labor dollars per unit"
              />
            </Field>
            <Field label="Crew Size">
              <Input
                type="number"
                min={0}
                step="0.1"
                value={draft.crew_size ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    crew_size: event.target.value === "" ? null : Number(event.target.value),
                  })
                }
              />
            </Field>
            <Field label="Production / Hour">
              <Input
                type="number"
                min={0}
                step="0.01"
                value={draft.productivity_per_hour ?? ""}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    productivity_per_hour:
                      event.target.value === "" ? null : Number(event.target.value),
                  })
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
              Save to My Cost Library
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CostImportDialog
        open={importOpen}
        rows={importRows}
        source={importSource}
        pasteText={pasteText}
        saving={importMutation.isPending}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) resetImport();
        }}
        onPasteTextChange={setPasteText}
        onPaste={handlePaste}
        onFile={handleFile}
        onReset={resetImport}
        onImport={() => importMutation.mutate()}
      />
    </div>
  );
}

function CostLibraryRow({
  item,
  onSave,
  onDelete,
  onCopy,
}: {
  item: CostLibraryItemRow;
  onSave: (patch: Partial<NewItem>) => void;
  onDelete: () => void;
  onCopy: () => void;
}) {
  const editable = item.source !== "system";
  const sourceLabel =
    item.source === "system" ? "Overwatch" : item.source === "imported" ? "Imported" : "Custom";
  const profile = getCostProfile(item);
  const [draft, setDraft] = useState<NewItem>({
    csi_division: item.csi_division,
    csi_code: item.csi_code,
    category: item.category,
    description: item.description,
    unit: item.unit,
    material_cost_cents: item.material_cost_cents,
    labor_cost_cents: item.labor_cost_cents,
    crew_size: item.crew_size,
    productivity_per_hour: item.productivity_per_hour,
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
      crew_size: item.crew_size,
      productivity_per_hour: item.productivity_per_hour,
    });
  }, [item]);

  return (
    <TableRow className="[&>td]:py-3">
      <TableCell>
        <Badge variant="outline" className="gap-1 capitalize">
          {item.source === "system" && <Lock className="h-3 w-3" />}
          {sourceLabel}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant={profile === "labor" ? "default" : "outline"} className="capitalize">
          {profileLabel(profile)}
        </Badge>
      </TableCell>
      <TableCell>
        {editable ? (
          <Input
            value={draft.csi_code || draft.csi_division}
            onChange={(event) => setDraft({ ...draft, csi_code: event.target.value })}
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
          <CostMoneyInput
            value={centsToDollars(draft.material_cost_cents)}
            onValueChange={(value) =>
              setDraft({ ...draft, material_cost_cents: dollarsToCents(value) })
            }
            unit={draft.unit}
            ariaLabel="Material dollars per unit"
          />
        ) : (
          <CostRateDisplay cents={item.material_cost_cents} unit={item.unit} kind="Material" />
        )}
      </TableCell>
      <TableCell className="text-right">
        {editable ? (
          <CostMoneyInput
            value={centsToDollars(draft.labor_cost_cents)}
            onValueChange={(value) =>
              setDraft({ ...draft, labor_cost_cents: dollarsToCents(value) })
            }
            unit={draft.unit}
            ariaLabel="Labor dollars per unit"
          />
        ) : (
          <CostRateDisplay cents={item.labor_cost_cents} unit={item.unit} kind="Labor" />
        )}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {editable ? (
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              min={0}
              step="0.1"
              value={draft.crew_size ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  crew_size: event.target.value === "" ? null : Number(event.target.value),
                })
              }
              className="h-8"
              aria-label="Crew size"
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              value={draft.productivity_per_hour ?? ""}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  productivity_per_hour:
                    event.target.value === "" ? null : Number(event.target.value),
                })
              }
              className="h-8"
              aria-label="Production per hour"
            />
          </div>
        ) : (
          <CrewProductionDisplay item={item} />
        )}
      </TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {editable ? (
            <>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={() => onSave(draft)}
                title="Save cost"
                aria-label="Save cost"
              >
                <Save className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8"
                onClick={onDelete}
                title="Delete cost"
                aria-label="Delete cost"
              >
                <Trash2 className="h-4 w-4 text-danger" />
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1.5 whitespace-nowrap"
              onClick={onCopy}
              title="Add to My Cost Library"
              aria-label="Add to My Cost Library"
            >
              <Copy className="h-3.5 w-3.5" /> Add to My Cost Library
            </Button>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function CostImportDialog({
  open,
  rows,
  source,
  pasteText,
  saving,
  onOpenChange,
  onPasteTextChange,
  onPaste,
  onFile,
  onReset,
  onImport,
}: {
  open: boolean;
  rows: CostLibraryImportRow[];
  source: string;
  pasteText: string;
  saving: boolean;
  onOpenChange: (open: boolean) => void;
  onPasteTextChange: (value: string) => void;
  onPaste: () => void;
  onFile: (file: File) => void;
  onReset: () => void;
  onImport: () => void;
}) {
  const validRows = rows.filter((row) => row.valid);
  const warningCount = rows.reduce(
    (sum, row) => sum + row.issues.filter((issue) => issue.level === "warning").length,
    0,
  );
  const errorCount = rows.reduce(
    (sum, row) => sum + row.issues.filter((issue) => issue.level === "error").length,
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-5xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import My Costs</DialogTitle>
          <DialogDescription>
            Bring in your own price list from pasted rows, CSV, or Excel. Use Download Import Format
            for the column guide; imported rows save to My Cost Library. Labor $/Unit is the unit
            price used in estimates. Crew Size and Production / Hour are assumptions behind that
            price.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <Tabs defaultValue="paste" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="paste">Paste Rows</TabsTrigger>
              <TabsTrigger value="csv">CSV</TabsTrigger>
              <TabsTrigger value="xlsx">Excel</TabsTrigger>
            </TabsList>

            <TabsContent value="paste" className="space-y-3">
              <Label>Spreadsheet rows</Label>
              <Textarea
                rows={12}
                value={pasteText}
                onChange={(event) => onPasteTextChange(event.target.value)}
                placeholder={
                  "CSI Division\tCSI Code\tDescription\tCategory\tUnit\tMaterial $/Unit\tLabor $/Unit\tCrew Size\tProduction / Hour\n06\t06 10 00\tCustom framing crew rate\tframing\tHR\t0\t82.50\t3\t1\n09\t09 91 00\tInterior paint - owner standard\tpaint\tSF\t0.58\t1.35\t2\t600"
                }
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={onPaste}
                disabled={!pasteText.trim()}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Stage Rows
              </Button>
            </TabsContent>

            <TabsContent value="csv" className="space-y-3">
              <Label>CSV file</Label>
              <Input
                type="file"
                accept=".csv,text/csv"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onFile(file);
                }}
              />
            </TabsContent>

            <TabsContent value="xlsx" className="space-y-3">
              <Label>Excel file</Label>
              <Input
                type="file"
                accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) onFile(file);
                }}
              />
            </TabsContent>
          </Tabs>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-hairline bg-surface px-3 py-2 text-sm">
              <span className="inline-flex items-center gap-1.5 font-medium">
                <FileSpreadsheet className="h-4 w-4" /> {source || "Import preview"}
              </span>
              <span className="inline-flex items-center gap-1.5 text-success">
                <CheckCircle2 className="h-4 w-4" /> {validRows.length} ready
              </span>
              {warningCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-warning">
                  <AlertTriangle className="h-4 w-4" /> {warningCount} warnings
                </span>
              )}
              {errorCount > 0 && (
                <span className="inline-flex items-center gap-1.5 text-danger">
                  <AlertTriangle className="h-4 w-4" /> {errorCount} errors
                </span>
              )}
              <Button size="sm" variant="ghost" className="ml-auto" onClick={onReset}>
                Start over
              </Button>
            </div>

            <div className="max-h-[420px] overflow-auto rounded-lg border border-hairline">
              <Table className="min-w-[1120px]">
                <TableHeader>
                  <TableRow className="bg-surface">
                    <TableHead className="w-[70px]">Row</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[90px]">CSI</TableHead>
                    <TableHead className="w-[110px]">Category</TableHead>
                    <TableHead className="w-[80px]">Unit</TableHead>
                    <TableHead className="w-[140px] text-right">Material $/Unit</TableHead>
                    <TableHead className="w-[150px] text-right">Labor $/Unit</TableHead>
                    <TableHead className="w-[150px]">Crew / Production</TableHead>
                    <TableHead className="w-[190px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 100).map((row) => (
                    <TableRow key={row.rowNumber} className={!row.valid ? "bg-danger/5" : ""}>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.rowNumber}
                      </TableCell>
                      <TableCell className="font-medium">{row.description || "-"}</TableCell>
                      <TableCell>{row.csi_code || row.csi_division}</TableCell>
                      <TableCell>{row.category || "-"}</TableCell>
                      <TableCell>{row.unit}</TableCell>
                      <TableCell className="text-right tabular">
                        {row.material_cost_cents > 0
                          ? `${fmtUSD(row.material_cost_cents / 100)} / ${unitLabel(row.unit)}`
                          : "Not priced"}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {row.labor_cost_cents > 0
                          ? `${fmtUSD(row.labor_cost_cents / 100)} / ${unitLabel(row.unit)}`
                          : "Not priced"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        <CrewProductionDisplay
                          item={{
                            crew_size: row.crew_size,
                            productivity_per_hour: row.productivity_per_hour,
                            unit: row.unit,
                          }}
                        />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.issues.length === 0
                          ? "Ready"
                          : row.issues.map((issue) => issue.message).join("; ")}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={onImport} disabled={validRows.length === 0 || saving}>
            {saving ? "Importing..." : `Import ${validRows.length} to My Cost Library`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
