import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  Download,
  FileSpreadsheet,
  Lock,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
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
import { AppFooter } from "@/components/layout/AppFooter";
import { PortfolioTopBar } from "@/components/layout/PortfolioTopBar";
import {
  COST_LIBRARY_LABOR_BASES,
  createCostLibraryItem,
  deleteCostLibraryItem,
  importCostLibraryItems,
  listCostLibraryItems,
  resolveLibraryUnitCosts,
  updateCostLibraryItem,
  type CostLibraryItemRow,
  type CostLibraryLaborBasis,
} from "@/lib/estimates.functions";
import { getCompanyWorkspaceContext } from "@/lib/team.functions";
import {
  costLibraryTemplateCsv,
  parseCostLibraryRows,
  type CostLibraryImportRow,
} from "@/lib/estimate-import";
import { fmtUSD } from "@/lib/format";
import { parseCsv, parsePaste, parseXlsx } from "@/lib/sov-import";
import { downloadTextFile } from "@/lib/download-file";
import { cn } from "@/lib/utils";

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

// Delegates to the shared safe download path (delayed blob-URL revoke —
// synchronous revoke cancels the download in Safari/iOS).
function downloadText(filename: string, content: string, type: string) {
  downloadTextFile(filename, content, type);
}

// Unit prices are cents-precise: whole-dollar rounding would turn $0.62 into $1.
// fmtUSD (whole dollars) is right for extended totals, wrong for a rate book.
const fmtUnitUSD = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

const fmtCrew = (value: number) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 });
const fmtProd = (value: number) =>
  Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });

// CSI MasterFormat division names for the sidebar list and group headers. This
// is display-only labelling owned by this route (the schedule module keeps its
// own private copy for its WBS labels).
const CSI_DIVISION_NAMES: Record<string, string> = {
  "01": "General Requirements",
  "02": "Existing Conditions",
  "03": "Concrete",
  "04": "Masonry",
  "05": "Metals",
  "06": "Wood & Composites",
  "07": "Thermal & Moisture",
  "08": "Openings",
  "09": "Finishes",
  "10": "Specialties",
  "11": "Equipment",
  "12": "Furnishings",
  "13": "Special Construction",
  "14": "Conveying Equipment",
  "21": "Fire Suppression",
  "22": "Plumbing",
  "23": "HVAC",
  "25": "Integrated Automation",
  "26": "Electrical",
  "27": "Communications",
  "28": "Electronic Safety & Security",
  "31": "Earthwork",
  "32": "Exterior Improvements",
  "33": "Utilities",
};

const divisionName = (code: string) => {
  const trimmed = code.trim();
  if (!trimmed) return "Uncoded";
  const padded = trimmed.padStart(2, "0");
  return CSI_DIVISION_NAMES[padded] ?? `Division ${trimmed}`;
};

type NewItem = {
  csi_division: string;
  csi_code: string;
  category: string;
  description: string;
  unit: string;
  material_cost_cents: number;
  labor_cost_cents: number;
  // "" means the form has not chosen a basis yet; saving requires a choice.
  labor_basis: CostLibraryLaborBasis | "";
  crew_size: number | null;
  productivity_per_hour: number | null;
};

type LibraryView = "system" | "my";
type CostFocus = "all" | "material" | "labor" | "installed";
type LaborBasisFilter = "all" | CostLibraryLaborBasis;

const blankItem: NewItem = {
  csi_division: "",
  csi_code: "",
  category: "",
  description: "",
  unit: "EA",
  material_cost_cents: 0,
  labor_cost_cents: 0,
  labor_basis: "",
  crew_size: null,
  productivity_per_hour: null,
};

const laborBasisLabel = (basis: CostLibraryLaborBasis) =>
  COST_LIBRARY_LABOR_BASES.find((option) => option.value === basis)?.label ?? "Per Unit";

const EMPTY_COST_ITEMS: CostLibraryItemRow[] = [];

const costFocusOptions: Array<{ value: CostFocus; label: string }> = [
  { value: "all", label: "All" },
  { value: "material", label: "Material" },
  { value: "labor", label: "Labor" },
  { value: "installed", label: "Installed" },
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

// Per-unit material + labor + installed, routed through the app's canonical
// resolver so per-crew-hour rows convert with crew size × production, and
// installed-basis rows keep material folded into the labor price. When a
// per-hour row is missing its crew/production, labor and installed can't be
// priced, so both read "—" rather than a fabricated number.
function deriveUnitCosts(
  item: Pick<
    CostLibraryItemRow,
    | "description"
    | "material_cost_cents"
    | "labor_cost_cents"
    | "labor_basis"
    | "crew_size"
    | "productivity_per_hour"
  >,
): { materialCents: number; laborCents: number | null; installedCents: number | null } {
  const resolution = resolveLibraryUnitCosts(item);
  if (!resolution.ok) {
    return { materialCents: item.material_cost_cents, laborCents: null, installedCents: null };
  }
  return {
    materialCents: resolution.material_cost_cents,
    laborCents: resolution.labor_cost_cents,
    installedCents: resolution.material_cost_cents + resolution.labor_cost_cents,
  };
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
  const [basisFilter, setBasisFilter] = useState<LaborBasisFilter>("all");
  const [newOpen, setNewOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [importRows, setImportRows] = useState<CostLibraryImportRow[]>([]);
  const [importSource, setImportSource] = useState("");
  const [draft, setDraft] = useState<NewItem>(blankItem);
  const [activeView, setActiveView] = useState<LibraryView>("system");
  const [costFocus, setCostFocus] = useState<CostFocus>("all");

  // The whole book loads once (no server-side division/category filter) so the
  // sidebar can count every division client-side; refinement is all local.
  const libraryQuery = useQuery({
    queryKey: ["cost-library"],
    queryFn: () => list({ data: { csi_division: "", category: "" } }),
  });
  const { data: companyContext } = useQuery({
    queryKey: ["company-workspace-context"],
    queryFn: () => loadCompanyContext(),
  });
  const companyName = companyContext?.name || "Company";

  const createMutation = useMutation({
    mutationFn: () => {
      if (!draft.labor_basis) {
        return Promise.reject(new Error("Choose what the labor price means before saving."));
      }
      return create({
        data: {
          ...draft,
          labor_basis: draft.labor_basis,
          unit: draft.unit.toUpperCase(),
          synonyms: [],
          keywords: draft.description
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter(Boolean),
        },
      });
    },
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
          labor_basis: item.labor_basis,
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
    mutationFn: ({ id, patch }: { id: string; patch: Partial<NewItem> }) => {
      const { labor_basis, ...rest } = patch;
      return update({
        data: { id, patch: labor_basis ? { ...rest, labor_basis } : rest },
      });
    },
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

  // Sidebar CSI-division counts: within the active library (Overwatch / My) and
  // the active Views focus only — so "All divisions" always equals the active
  // Views pill count. Search and the popover filters refine the table, not the
  // navigation map.
  const focusItems = useMemo(
    () => sourceItems.filter((item) => matchesCostFocus(item, costFocus)),
    [sourceItems, costFocus],
  );
  const divisionNav = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of focusItems) {
      const key = item.csi_division ?? "";
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return Array.from(counts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, count]) => ({ code, name: divisionName(code), count }));
  }, [focusItems]);
  const divisionTotal = focusItems.length;

  const categories = libraryQuery.data?.categories ?? [];
  const activeFilterCount = (category !== "all" ? 1 : 0) + (basisFilter !== "all" ? 1 : 0);

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase();
    return sourceItems
      .filter((item) => matchesCostFocus(item, costFocus))
      .filter((item) => basisFilter === "all" || item.labor_basis === basisFilter)
      .filter((item) => division === "all" || (item.csi_division ?? "") === division)
      .filter((item) => category === "all" || item.category === category)
      .filter((item) => {
        if (!q) return true;
        return [
          item.description,
          item.category,
          item.csi_code,
          item.csi_division,
          item.unit,
          item.source,
          profileLabel(getCostProfile(item)),
          laborBasisLabel(item.labor_basis),
        ]
          .join(" ")
          .toLowerCase()
          .includes(q);
      });
  }, [basisFilter, category, costFocus, division, search, sourceItems]);

  // Rows are grouped under a clay Division header, divisions ascending and each
  // division's rows by CSI code, matching the mock's price-book layout.
  const groupedVisible = useMemo(() => {
    const groups = new Map<string, CostLibraryItemRow[]>();
    for (const item of visibleItems) {
      const key = item.csi_division ?? "";
      const bucket = groups.get(key);
      if (bucket) bucket.push(item);
      else groups.set(key, [item]);
    }
    return Array.from(groups.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([code, items]) => ({
        code,
        name: divisionName(code),
        items: [...items].sort(
          (x, y) =>
            (x.csi_code || x.csi_division).localeCompare(y.csi_code || y.csi_division) ||
            x.description.localeCompare(y.description),
        ),
      }));
  }, [visibleItems]);

  const priceBookSubhead =
    activeView === "system"
      ? "Material and labor unit costs, with crew & production. Read-only Overwatch pricing — copy a row to edit it."
      : "Your editable price book. These material and labor unit costs are searchable inside master sheets and project estimates.";
  const activeEmptyMessage =
    activeView === "system"
      ? "No Overwatch system costs found for this view."
      : "No personal costs found for this view. Add a custom cost, import your spreadsheet, or copy Overwatch pricing into My Cost Library.";

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
    <div className="flex min-h-screen flex-col bg-background">
      <PortfolioTopBar active="estimates" />

      {/* Detail bar: back-arrow + eyebrow + serif title, Overwatch/My segmented
          toggle (the activeView), and the Import / Add cost actions. */}
      <div className="border-b border-hairline bg-surface">
        <div className="mx-auto flex w-full max-w-[1500px] flex-wrap items-center gap-x-4 gap-y-3 px-5 py-3.5 sm:px-8 lg:px-10">
          <Button
            asChild
            variant="ghost"
            size="icon"
            className="shrink-0"
            title="Back to estimates"
          >
            <Link to="/estimates" aria-label="Back to estimates">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div className="min-w-0">
            <p className="eyebrow truncate">{companyName} · Estimates</p>
            <h1 className="mt-0.5 font-serif text-[26px] leading-tight text-foreground">
              Cost Library
            </h1>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2.5">
            <div
              role="tablist"
              aria-label="Cost library"
              className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-[3px]"
            >
              <SegmentedTab
                active={activeView === "system"}
                label="Overwatch"
                count={systemCount}
                onClick={() => setActiveView("system")}
              />
              <SegmentedTab
                active={activeView === "my"}
                label="My library"
                count={myCount}
                onClick={() => setActiveView("my")}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={() => setImportOpen(true)}
            >
              <Upload className="h-3.5 w-3.5" /> Import
            </Button>
            <Button size="sm" className="gap-1.5" onClick={() => setNewOpen(true)}>
              <Plus className="h-3.5 w-3.5" /> Add cost
            </Button>
          </div>
        </div>
      </div>

      <main className="mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]">
        {/* Left sidebar: Views focus pills + CSI division navigation. */}
        <aside className="border-b border-hairline bg-surface px-3 py-4 lg:border-b-0 lg:border-r">
          <div className="eyebrow px-2 pb-2">Views</div>
          <div className="flex flex-wrap gap-1.5 border-b border-hairline px-1 pb-3.5">
            {costFocusOptions.map((option) => {
              const active = costFocus === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCostFocus(option.value)}
                  aria-pressed={active}
                  className={cn(
                    "whitespace-nowrap rounded-full px-3 py-1.5 text-[11.5px] font-semibold transition-colors",
                    active
                      ? "bg-accent text-accent-foreground"
                      : "border border-hairline text-muted-foreground hover:text-foreground",
                  )}
                >
                  {option.label} {costCounts[option.value]}
                </button>
              );
            })}
          </div>

          <div className="eyebrow px-2 pb-2 pt-3.5">CSI divisions</div>
          <div className="flex flex-col gap-0.5">
            <SidebarDivision
              label="All divisions"
              count={divisionTotal}
              active={division === "all"}
              onClick={() => setDivision("all")}
            />
            {divisionNav.map((entry) => (
              <SidebarDivision
                key={entry.code || "uncoded"}
                label={entry.code ? `${entry.code} · ${entry.name}` : entry.name}
                count={entry.count}
                active={division === entry.code}
                onClick={() => setDivision(entry.code)}
              />
            ))}
          </div>
        </aside>

        {/* Right content: Price book heading, search + filters, price table. */}
        <section className="min-w-0 px-5 py-6 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="font-serif text-[26px] font-normal leading-none text-foreground">
              Price book
            </h2>
            <p className="text-[13px] text-muted-foreground">{priceBookSubhead}</p>
          </div>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search description, CSI, unit, or category"
                className="pl-9"
              />
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="gap-1.5">
                  <SlidersHorizontal className="h-3.5 w-3.5" /> Filters
                  {activeFilterCount > 0 && (
                    <span className="ml-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[10px] font-semibold text-accent-foreground">
                      {activeFilterCount}
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 space-y-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All categories</SelectItem>
                      {categories.map((item) => (
                        <SelectItem key={item} value={item}>
                          {item}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Labor pricing</Label>
                  <Select
                    value={basisFilter}
                    onValueChange={(value) => setBasisFilter(value as LaborBasisFilter)}
                  >
                    <SelectTrigger aria-label="Filter by labor basis">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All labor pricing</SelectItem>
                      {COST_LIBRARY_LABOR_BASES.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {activeFilterCount > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setCategory("all");
                      setBasisFilter("all");
                    }}
                  >
                    Clear filters
                  </Button>
                )}
              </PopoverContent>
            </Popover>
          </div>

          <div className="mt-3.5 overflow-hidden rounded-xl border border-hairline bg-surface">
            <div className="overflow-x-auto">
              <Table className="w-full min-w-[920px]">
                <TableHeader>
                  <TableRow className="bg-muted/60 hover:bg-muted/60 [&>th]:h-auto [&>th]:whitespace-nowrap [&>th]:py-2.5 [&>th]:font-mono [&>th]:text-[9px] [&>th]:font-bold [&>th]:uppercase [&>th]:tracking-[0.12em]">
                    <TableHead>Item</TableHead>
                    <TableHead className="text-center">Unit</TableHead>
                    <TableHead className="text-right">Material $/u</TableHead>
                    <TableHead className="text-right">Labor $/u</TableHead>
                    <TableHead className="text-center">Crew</TableHead>
                    <TableHead className="text-center">Prod/hr</TableHead>
                    <TableHead className="border-l border-hairline text-right">Installed</TableHead>
                    <TableHead className="w-12 text-right">
                      <span className="sr-only">Actions</span>
                    </TableHead>
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
                  ) : groupedVisible.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={8}
                        className="py-10 text-center text-sm text-muted-foreground"
                      >
                        {activeEmptyMessage}
                      </TableCell>
                    </TableRow>
                  ) : (
                    groupedVisible.map((group) => (
                      <Fragment key={group.code || "uncoded"}>
                        <TableRow className="hover:bg-transparent">
                          <TableCell
                            colSpan={8}
                            className="border-t border-hairline bg-background py-2.5 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-clay"
                          >
                            {group.code ? `Division ${group.code} · ${group.name}` : group.name}
                          </TableCell>
                        </TableRow>
                        {group.items.map((item) => (
                          <CostLibraryRow
                            key={item.id}
                            item={item}
                            onSave={(patch) => updateMutation.mutate({ id: item.id, patch })}
                            onDelete={() => deleteMutation.mutate(item.id)}
                            onCopy={() => copyMutation.mutate(item)}
                          />
                        ))}
                      </Fragment>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          </div>
        </section>
      </main>

      <AppFooter context="Cost library" />

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
            <div className="space-y-1.5 sm:col-span-2">
              <Label>What does the labor price mean?</Label>
              <Select
                value={draft.labor_basis}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    labor_basis: value as CostLibraryLaborBasis,
                    material_cost_cents: value === "installed" ? 0 : draft.material_cost_cents,
                  })
                }
              >
                <SelectTrigger aria-label="Labor pricing basis">
                  <SelectValue placeholder="Choose before saving" />
                </SelectTrigger>
                <SelectContent>
                  {COST_LIBRARY_LABOR_BASES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label} — {option.description}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Field label="Material $/Unit">
              {draft.labor_basis === "installed" ? (
                <p className="rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-muted-foreground">
                  Installed pricing keeps material inside the labor price, so this stays $0.
                </p>
              ) : (
                <CostMoneyInput
                  value={centsToDollars(draft.material_cost_cents)}
                  onValueChange={(value) =>
                    setDraft({ ...draft, material_cost_cents: dollarsToCents(value) })
                  }
                  unit={draft.unit}
                  ariaLabel="Material dollars per unit"
                />
              )}
            </Field>
            <Field
              label={
                draft.labor_basis === "per_hour"
                  ? "Labor $ / Crew Hour"
                  : draft.labor_basis === "installed"
                    ? "Installed $/Unit (material + labor)"
                    : "Labor $/Unit (not per worker)"
              }
            >
              <CostMoneyInput
                value={centsToDollars(draft.labor_cost_cents)}
                onValueChange={(value) =>
                  setDraft({ ...draft, labor_cost_cents: dollarsToCents(value) })
                }
                unit={draft.labor_basis === "per_hour" ? "HR" : draft.unit}
                ariaLabel="Labor dollars"
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
                !draft.labor_basis ||
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

function SegmentedTab({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean;
  label: string;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border border-hairline bg-surface-elevated text-foreground shadow-sm"
          : "border border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {label} <span className="font-mono text-[11px] text-muted-foreground">{count}</span>
    </button>
  );
}

function SidebarDivision({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[12.5px] transition-colors",
        active
          ? "bg-muted font-semibold text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
      )}
    >
      <span className="truncate">{label}</span>
      <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
    </button>
  );
}

function ReadOnlyMoney({ cents }: { cents: number | null }) {
  if (cents == null || cents <= 0) {
    return <span className="text-muted-foreground">—</span>;
  }
  return <span className="font-serif text-sm text-foreground">{fmtUnitUSD(cents)}</span>;
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
  const [draft, setDraft] = useState<NewItem>({
    csi_division: item.csi_division,
    csi_code: item.csi_code,
    category: item.category,
    description: item.description,
    unit: item.unit,
    material_cost_cents: item.material_cost_cents,
    labor_cost_cents: item.labor_cost_cents,
    labor_basis: item.labor_basis,
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
      labor_basis: item.labor_basis,
      crew_size: item.crew_size,
      productivity_per_hour: item.productivity_per_hour,
    });
  }, [item]);

  if (editable) {
    const draftInstalled = deriveUnitCosts({
      description: draft.description,
      material_cost_cents: draft.material_cost_cents,
      labor_cost_cents: draft.labor_cost_cents,
      labor_basis: (draft.labor_basis || "per_unit") as CostLibraryLaborBasis,
      crew_size: draft.crew_size,
      productivity_per_hour: draft.productivity_per_hour,
    });
    return (
      <TableRow className="[&>td]:align-top [&>td]:py-3">
        <TableCell>
          <div className="flex items-start gap-2">
            <span
              aria-hidden="true"
              className="mt-2 inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-clay"
            />
            <div className="min-w-0 flex-1 space-y-2">
              <Input
                value={draft.description}
                onChange={(event) => setDraft({ ...draft, description: event.target.value })}
                className="h-8"
                aria-label="Cost description"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={draft.csi_code}
                  onChange={(event) => setDraft({ ...draft, csi_code: event.target.value })}
                  className="h-8 font-mono text-xs"
                  aria-label="CSI code"
                  placeholder="CSI code"
                />
                <Input
                  value={draft.category}
                  onChange={(event) => setDraft({ ...draft, category: event.target.value })}
                  className="h-8"
                  aria-label="Category"
                  placeholder="Category"
                />
              </div>
              <Select
                value={draft.labor_basis || "per_unit"}
                onValueChange={(value) =>
                  setDraft({
                    ...draft,
                    labor_basis: value as CostLibraryLaborBasis,
                    material_cost_cents: value === "installed" ? 0 : draft.material_cost_cents,
                  })
                }
              >
                <SelectTrigger className="h-8" aria-label="Labor pricing basis">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {COST_LIBRARY_LABOR_BASES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <Input
            value={draft.unit}
            onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
            className="h-8 w-16 uppercase"
            aria-label="Unit"
          />
        </TableCell>
        <TableCell>
          {draft.labor_basis === "installed" ? (
            <p className="text-[11px] text-muted-foreground">In the installed price</p>
          ) : (
            <CostMoneyInput
              value={centsToDollars(draft.material_cost_cents)}
              onValueChange={(value) =>
                setDraft({ ...draft, material_cost_cents: dollarsToCents(value) })
              }
              unit={draft.unit}
              ariaLabel="Material dollars per unit"
            />
          )}
        </TableCell>
        <TableCell>
          <CostMoneyInput
            value={centsToDollars(draft.labor_cost_cents)}
            onValueChange={(value) =>
              setDraft({ ...draft, labor_cost_cents: dollarsToCents(value) })
            }
            unit={draft.labor_basis === "per_hour" ? "HR" : draft.unit}
            ariaLabel="Labor dollars"
          />
        </TableCell>
        <TableCell>
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
            className="h-8 w-16"
            aria-label="Crew size"
          />
        </TableCell>
        <TableCell>
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
            className="h-8 w-20"
            aria-label="Production per hour"
          />
        </TableCell>
        <TableCell className="border-l border-hairline text-right">
          {draftInstalled.installedCents == null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="font-serif text-[15px] font-semibold text-foreground">
              {fmtUnitUSD(draftInstalled.installedCents)}
            </span>
          )}
        </TableCell>
        <TableCell>
          <div className="flex justify-end gap-1">
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
          </div>
        </TableCell>
      </TableRow>
    );
  }

  const derived = deriveUnitCosts(item);
  return (
    <TableRow className="[&>td]:py-3 [&>td]:align-middle [&>td]:tabular">
      <TableCell>
        <div className="flex items-center gap-2.5">
          <Lock
            className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
            aria-label="Overwatch — read-only"
          />
          <div className="min-w-0">
            <div className="text-[13px] font-semibold leading-snug text-foreground">
              {item.description}
            </div>
            <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
              {item.csi_code || item.csi_division}
            </div>
          </div>
        </div>
      </TableCell>
      <TableCell className="text-center text-xs text-muted-foreground">
        {unitLabel(item.unit)}
      </TableCell>
      <TableCell className="text-right">
        <ReadOnlyMoney cents={derived.materialCents} />
      </TableCell>
      <TableCell className="text-right">
        <ReadOnlyMoney cents={derived.laborCents} />
      </TableCell>
      <TableCell className="text-center text-xs text-muted-foreground">
        {item.crew_size ? fmtCrew(item.crew_size) : "—"}
      </TableCell>
      <TableCell className="text-center text-xs text-muted-foreground">
        {item.productivity_per_hour
          ? `${fmtProd(item.productivity_per_hour)} ${unitLabel(item.unit)}`
          : "—"}
      </TableCell>
      <TableCell className="border-l border-hairline text-right">
        {derived.installedCents == null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <span className="font-serif text-[15px] font-semibold text-foreground">
            {fmtUnitUSD(derived.installedCents)}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 text-muted-foreground"
          onClick={onCopy}
          title="Add to My Cost Library"
          aria-label="Add to My Cost Library"
        >
          <Copy className="h-4 w-4" />
        </Button>
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
            Bring in your own price list from pasted rows, CSV, or Excel. Download the column guide
            for the exact format; imported rows save to My Cost Library. Labor $/Unit is the unit
            price used in estimates. Crew Size and Production / Hour are assumptions behind that
            price.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <Tabs defaultValue="paste" className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <TabsList className="grid grid-cols-3">
                <TabsTrigger value="paste">Paste Rows</TabsTrigger>
                <TabsTrigger value="csv">CSV</TabsTrigger>
                <TabsTrigger value="xlsx">Excel</TabsTrigger>
              </TabsList>
              <Button
                size="sm"
                variant="ghost"
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
                <Download className="h-3.5 w-3.5" /> Download import format
              </Button>
            </div>

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
