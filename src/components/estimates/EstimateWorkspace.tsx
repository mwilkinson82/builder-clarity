import { Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Fragment, useEffect, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Copy,
  Download,
  FileDown,
  FileSpreadsheet,
  GripVertical,
  Library,
  PencilRuler,
  Plus,
  Save,
  Send,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  calculateEstimateTotals,
  createBlankLineItems,
  convertEstimateToProject,
  convertEstimateToSOV,
  deleteEstimate,
  deleteLineItem,
  duplicateEstimate,
  ESTIMATE_FOLDERS,
  importEstimateLineItems,
  reorderLineItems,
  resolveLibraryUnitCosts,
  saveEstimateMarkupDefaults,
  searchCostLibrary,
  updateEstimate,
  updateLineItem,
  type CostLibraryItemRow,
  type EstimateFolder,
  type EstimateLineItemRow,
  type EstimateRow,
  type EstimateStatus,
  type EstimateTotalsBreakdown,
} from "@/lib/estimates.functions";
import {
  estimateLineTemplateCsv,
  estimateLineTemplateRows,
  parseEstimateLineRows,
  type EstimateLineImportRow,
} from "@/lib/estimate-import";
import { downloadPdfBytes, generateEstimatePdf } from "@/lib/estimate-pdf";
import { downloadTextFile } from "@/lib/download-file";
import type { EstimateRegion } from "@/lib/estimate-seed-data";
import { fmtUSD } from "@/lib/format";
import { getEstimatePlanSetSummary } from "@/lib/plan-room.functions";
import { parseCsv, parsePaste, parseXlsx } from "@/lib/sov-import";
import { Textarea } from "@/components/ui/textarea";
import { AppFooter } from "@/components/layout/AppFooter";
import { FlagIssueButton } from "@/components/estimates/FlagIssueButton";
import {
  EstimateFirstRunLauncher,
  readFirstRunLauncherDone,
  writeFirstRunLauncherDone,
} from "@/components/estimates/EstimateFirstRunLauncher";

type EstimatePatch = Partial<
  Pick<
    EstimateRow,
    | "name"
    | "description"
    | "opportunity_id"
    | "project_id"
    | "project_type"
    | "region"
    | "region_multiplier"
    | "status"
    | "folder"
    | "overhead_pct"
    | "profit_pct"
    | "contingency_pct"
    | "bond_pct"
    | "tax_pct"
    | "general_conditions_pct"
    | "custom_markups"
  >
>;
type UpdateEstimatePayload = { id: string; patch: EstimatePatch };
type LinePatch = Partial<
  Pick<
    EstimateLineItemRow,
    | "csi_division"
    | "cost_code"
    | "description"
    | "unit"
    | "quantity"
    | "material_unit_cost_cents"
    | "labor_unit_cost_cents"
    | "library_item_id"
    | "scope_group"
    | "notes"
  >
>;
type UpdateLinePayload = { id: string; patch: LinePatch };

type GridCellProps = {
  "data-estimate-grid-cell": true;
  "data-row-index": number;
  "data-col-index": number;
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
};
type CostApplyMode = "row" | "material" | "labor";

interface EstimateWorkspaceProps {
  estimate: EstimateRow;
  lineItems: EstimateLineItemRow[];
  totals: EstimateTotalsBreakdown;
  regions: EstimateRegion[];
  companyName?: string;
}

const estimateFolderLabel = (folder: EstimateFolder) =>
  ESTIMATE_FOLDERS.find((item) => item.value === folder)?.label ?? "Sales Process";

const pctToNumber = (basisPoints: number) => Number((basisPoints / 100).toFixed(2));
const numberToPct = (value: number) => Math.round(value * 100);
const dollarsToCents = (value: number) => Math.round(value * 100);
const centsToDollars = (value: number) => Math.round(value) / 100;

const costProfileLabel = (item: CostLibraryItemRow) => {
  if (item.labor_basis === "installed") return "Installed";
  if (item.labor_basis === "per_hour") return "Crew Hour Rate";
  const hasMaterial = item.display_material_cost_cents > 0;
  const hasLabor = item.display_labor_cost_cents > 0;
  if (hasMaterial && hasLabor) return "Installed";
  if (hasLabor) return "Labor";
  if (hasMaterial) return "Material";
  return "No cost";
};

const shouldReplacePlaceholderDescription = (value: string) =>
  !value.trim() || /^new estimate item$/i.test(value.trim());

const safeFileName = (value: string, ext: string) =>
  `${
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "estimate"
  }.${ext}`;

// Delegates to the shared safe download path (delayed blob-URL revoke —
// synchronous revoke cancels the download in Safari/iOS).
function downloadText(filename: string, content: string, type: string) {
  downloadTextFile(filename, content, type);
}

function toCsvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const ESTIMATE_GRID_COLUMNS = 7;

function focusEstimateGridCell(root: ParentNode, rowIndex: number, colIndex: number) {
  const next = root.querySelector<HTMLElement>(
    `[data-estimate-grid-cell][data-row-index="${rowIndex}"][data-col-index="${colIndex}"]`,
  );
  if (!next) return false;
  next.focus();
  if (next instanceof HTMLInputElement) {
    window.setTimeout(() => next.select(), 0);
  }
  return true;
}

function buildEstimateCsv(estimate: EstimateRow, lines: EstimateLineItemRow[]) {
  const rows = [
    [
      "Cost Code",
      "CSI Division",
      "Description",
      "Unit",
      "Qty",
      "Material $/Unit",
      "Labor $/Unit",
      "Material Extended",
      "Labor Extended",
      "Total Extended",
    ],
    ...lines.map((line) => [
      line.cost_code,
      line.csi_division,
      line.description,
      line.unit,
      line.quantity,
      centsToDollars(line.material_unit_cost_cents),
      centsToDollars(line.labor_unit_cost_cents),
      centsToDollars(line.material_extended_cents * estimate.region_multiplier),
      centsToDollars(line.labor_extended_cents * estimate.region_multiplier),
      centsToDollars(line.total_extended_cents * estimate.region_multiplier),
    ]),
  ];
  return rows.map((row) => row.map(toCsvCell).join(",")).join("\n");
}

async function downloadMasterEstimateWorkbook() {
  const { utils, writeFile } = await import("xlsx");
  const workbook = utils.book_new();
  const instructions = [
    ["Overwatch Master Sheet Import Format"],
    [""],
    ["What this file is", "A column guide and example file for getting your costs into Overwatch."],
    [
      "What this file is not",
      "It is not the saved master sheet. Your saved master sheet lives inside Overwatch after you import or add rows.",
    ],
    [""],
    ["Use the Master Estimate tab as the format for a master sheet or project estimate import."],
    ["Keep the header row exactly as shown so Overwatch can match your columns."],
    ["Required columns", "Description", "Unit", "Qty"],
    [
      "Recommended columns",
      "Cost Code",
      "CSI Division",
      "Group",
      "Material $/Unit",
      "Labor $/Unit",
    ],
    ["Cost rule", "Put material and labor as unit costs. Overwatch multiplies them by Qty."],
    [
      "Import rule",
      "Append adds the uploaded lines. Replace swaps the worksheet with the uploaded sheet.",
    ],
    [""],
    ["Example", "Rough framing package", "LS", "1", "185000", "62000"],
  ];
  utils.book_append_sheet(workbook, utils.aoa_to_sheet(instructions), "How to use this");
  utils.book_append_sheet(
    workbook,
    utils.aoa_to_sheet(estimateLineTemplateRows),
    "Master Estimate",
  );
  writeFile(workbook, "overwatch-master-sheet-import-format.xlsx");
}

export function EstimateWorkspace({
  estimate,
  lineItems,
  totals,
  regions,
  companyName = "Company",
}: EstimateWorkspaceProps) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const updateEstimateFn = useServerFn(updateEstimate);
  const deleteEstimateFn = useServerFn(deleteEstimate);
  const createBlankLinesFn = useServerFn(createBlankLineItems);
  const updateLineFn = useServerFn(updateLineItem);
  const deleteLineFn = useServerFn(deleteLineItem);
  const reorderLineFn = useServerFn(reorderLineItems);
  const importLinesFn = useServerFn(importEstimateLineItems);
  const duplicateFn = useServerFn(duplicateEstimate);
  const convertToSovFn = useServerFn(convertEstimateToSOV);
  const convertToProjectFn = useServerFn(convertEstimateToProject);
  const saveDefaultsFn = useServerFn(saveEstimateMarkupDefaults);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(estimate.name);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const [pasteText, setPasteText] = useState("");
  const [importRows, setImportRows] = useState<EstimateLineImportRow[]>([]);
  const [importSource, setImportSource] = useState("");
  const [pendingGridFocus, setPendingGridFocus] = useState<{
    rowIndex: number;
    colIndex: number;
  } | null>(null);
  const isMasterSheet = estimate.kind === "master_sheet";
  const titleRows = Math.min(3, Math.max(1, Math.ceil(Math.max(nameDraft.length, 1) / 42)));

  useEffect(() => setNameDraft(estimate.name), [estimate.name]);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["estimate", estimate.id] });

  const updateEstimateMutation = useMutation({
    mutationFn: (payload: UpdateEstimatePayload) => updateEstimateFn({ data: payload }),
    onSuccess: invalidate,
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Estimate did not save"),
  });

  const deleteEstimateMutation = useMutation({
    mutationFn: () => deleteEstimateFn({ data: { id: estimate.id } }),
    onSuccess: () => {
      toast.success(isMasterSheet ? "Master sheet deleted" : "Estimate deleted");
      navigate({ to: isMasterSheet ? "/estimate-masters" : "/estimates" });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Estimate did not delete"),
  });

  const createLinesMutation = useMutation({
    mutationFn: (count: number) =>
      createBlankLinesFn({
        data: {
          estimate_id: estimate.id,
          count,
        },
      }),
    onSuccess: (result, count) => {
      if (count > 1) toast.success(`${result.created_count} blank rows added`);
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Blank rows did not save"),
  });

  const updateLineMutation = useMutation({
    mutationFn: (payload: UpdateLinePayload) => updateLineFn({ data: payload }),
    onSuccess: invalidate,
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Line item did not save"),
  });

  const deleteLineMutation = useMutation({
    mutationFn: (id: string) => deleteLineFn({ data: { id } }),
    onSuccess: invalidate,
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Line item did not delete"),
  });

  const reorderMutation = useMutation({
    mutationFn: (item_ids: string[]) =>
      reorderLineFn({ data: { estimate_id: estimate.id, item_ids } }),
    onSuccess: invalidate,
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Rows did not reorder"),
  });

  const importableRows = importRows.filter((row) => row.valid);

  const importMutation = useMutation({
    mutationFn: () =>
      importLinesFn({
        data: {
          estimate_id: estimate.id,
          mode: importMode,
          rows: importableRows.map((row) => ({
            csi_division: row.csi_division,
            cost_code: row.cost_code,
            description: row.description,
            unit: row.unit,
            quantity: row.quantity,
            material_unit_cost_cents: row.material_unit_cost_cents,
            labor_unit_cost_cents: row.labor_unit_cost_cents,
            scope_group: row.scope_group,
            notes: row.notes,
          })),
        },
      }),
    onSuccess: (result) => {
      toast.success(`${result.created_count} estimate rows imported`);
      setImportOpen(false);
      setImportRows([]);
      setImportSource("");
      setPasteText("");
      setImportMode("append");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Estimate rows did not import"),
  });

  const duplicateMutation = useMutation({
    mutationFn: (asProjectEstimate: boolean) =>
      duplicateFn({ data: { id: estimate.id, as_project_estimate: asProjectEstimate } }),
    onSuccess: (result, asProjectEstimate) => {
      toast.success(
        asProjectEstimate
          ? "Estimate created from master"
          : isMasterSheet
            ? "Master sheet copied"
            : "Estimate duplicated",
      );
      navigate({ to: "/estimates/$estimateId", params: { estimateId: result.id } });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Estimate did not duplicate"),
  });

  const pushMutation = useMutation({
    mutationFn: async () => {
      if (estimate.project_id) {
        const confirmed = window.confirm(
          "Push this estimate into the linked project and replace its current cost buckets?",
        );
        if (!confirmed) return { project_id: estimate.project_id };
        await convertToSovFn({
          data: { estimate_id: estimate.id, project_id: estimate.project_id },
        });
        return { project_id: estimate.project_id };
      }
      const result = await convertToProjectFn({ data: { estimate_id: estimate.id } });
      return result;
    },
    onSuccess: (result) => {
      if (!result?.project_id) return;
      toast.success("Estimate pushed to project");
      navigate({ to: "/projects/$projectId", params: { projectId: result.project_id } });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Estimate did not push"),
  });

  const saveDefaultsMutation = useMutation({
    mutationFn: () =>
      saveDefaultsFn({
        data: {
          overhead_pct: estimate.overhead_pct,
          profit_pct: estimate.profit_pct,
          contingency_pct: estimate.contingency_pct,
          bond_pct: estimate.bond_pct,
          tax_pct: estimate.tax_pct,
          general_conditions_pct: estimate.general_conditions_pct,
          custom_markups: estimate.custom_markups,
          default_region: estimate.region,
          default_region_multiplier: estimate.region_multiplier,
        },
      }),
    onSuccess: () => toast.success("Defaults saved"),
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Defaults did not save"),
  });

  const orderedLines = useMemo(
    () => [...lineItems].sort((a, b) => a.sort_order - b.sort_order),
    [lineItems],
  );

  useEffect(() => {
    if (!pendingGridFocus) return;
    const frame = window.requestAnimationFrame(() => {
      if (focusEstimateGridCell(document, pendingGridFocus.rowIndex, pendingGridFocus.colIndex)) {
        setPendingGridFocus(null);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [orderedLines.length, pendingGridFocus]);

  const liveTotals = useMemo(
    () => calculateEstimateTotals(estimate, orderedLines),
    [estimate, orderedLines],
  );

  // Scope-group subtotals are a display pass over the flat, sort_order line
  // array — persistence, reorder semantics, and the totals math are untouched.
  // We keep drag within the flat order (dragging never rewrites scope_group;
  // to move a row between groups you edit its Group field). Groups are the
  // contiguous runs of the flat order, so each subtotal is exactly the sum of
  // the rows shown beneath its header, and the grand-total footer is unchanged.
  // Row index stays the FLAT index so keyboard grid-nav and add-row focus keep
  // working; the header rows carry no grid cells and are skipped by nav.
  const groupedRuns = useMemo(() => {
    const runs: {
      key: string;
      label: string;
      rows: { line: EstimateLineItemRow; index: number }[];
      subtotalCents: number;
    }[] = [];
    orderedLines.forEach((line, index) => {
      const label = line.scope_group?.trim() || "Ungrouped";
      const rowTotalCents =
        Math.round(line.quantity * line.material_unit_cost_cents * estimate.region_multiplier) +
        Math.round(line.quantity * line.labor_unit_cost_cents * estimate.region_multiplier);
      const last = runs[runs.length - 1];
      if (last && last.label === label) {
        last.rows.push({ line, index });
        last.subtotalCents += rowTotalCents;
      } else {
        runs.push({
          key: `${label}::${index}`,
          label,
          rows: [{ line, index }],
          subtotalCents: rowTotalCents,
        });
      }
    });
    return runs;
  }, [orderedLines, estimate.region_multiplier]);

  // Don't burden estimates that never use scope groups with a lone "Ungrouped"
  // banner; show headers once there is real grouping (a named group or 2+ runs).
  const showGroupHeaders =
    groupedRuns.length > 1 || (groupedRuns.length === 1 && groupedRuns[0].label !== "Ungrouped");

  // First-run launcher (Phase 4 Task 5): only while the estimate has zero
  // line items AND zero real plan sets, and only until either ever exists.
  const loadPlanSetSummaryFn = useServerFn(getEstimatePlanSetSummary);
  const firstRunDone = readFirstRunLauncherDone(estimate.id);
  const planSetSummaryQuery = useQuery({
    queryKey: ["estimate-plan-set-summary", estimate.id],
    queryFn: () => loadPlanSetSummaryFn({ data: { estimate_id: estimate.id } }),
    enabled: !isMasterSheet && orderedLines.length === 0 && !firstRunDone,
  });
  const realPlanSetCount = planSetSummaryQuery.data?.real_plan_set_count ?? null;
  const showFirstRunLauncher =
    !isMasterSheet && !firstRunDone && orderedLines.length === 0 && realPlanSetCount === 0;

  // The moment the estimate has any content, the cards are gone for good —
  // even if every row is later deleted.
  useEffect(() => {
    if (isMasterSheet) return;
    if (orderedLines.length > 0 || (realPlanSetCount ?? 0) > 0) {
      writeFirstRunLauncherDone(estimate.id);
    }
  }, [estimate.id, isMasterSheet, orderedLines.length, realPlanSetCount]);

  const updateEstimatePatch = (patch: UpdateEstimatePayload["patch"]) =>
    updateEstimateMutation.mutate({ id: estimate.id, patch });

  const addBlankRows = (count: number, colIndex = 2) => {
    if (createLinesMutation.isPending) return;
    setPendingGridFocus({ rowIndex: orderedLines.length, colIndex });
    createLinesMutation.mutate(count);
  };

  const onDropRow = (targetId: string) => {
    if (!draggingId || draggingId === targetId) return;
    const next = [...orderedLines];
    const from = next.findIndex((line) => line.id === draggingId);
    const to = next.findIndex((line) => line.id === targetId);
    if (from === -1 || to === -1) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    reorderMutation.mutate(next.map((line) => line.id));
    setDraggingId(null);
  };

  const resetImport = () => {
    setImportRows([]);
    setImportSource("");
    setPasteText("");
    setImportMode("append");
  };

  const stageImportRows = (matrix: string[][], hasHeader: boolean, source: string) => {
    const rows = parseEstimateLineRows(matrix, hasHeader);
    setImportRows(rows);
    setImportSource(source);
    if (rows.length === 0) {
      toast.warning("No estimate rows found");
      return;
    }
    const valid = rows.filter((row) => row.valid).length;
    toast.success(`${valid} estimate rows staged`);
  };

  const handleImportFile = async (file: File) => {
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

  const handleImportPaste = () => {
    const parsed = parsePaste(pasteText);
    stageImportRows(parsed.matrix, parsed.hasHeader, "Pasted rows");
  };

  const exportCsv = () => {
    downloadText(
      safeFileName(estimate.name, "csv"),
      buildEstimateCsv(estimate, orderedLines),
      "text/csv",
    );
  };

  const exportPdf = async () => {
    const bytes = await generateEstimatePdf({
      estimate,
      lineItems: orderedLines,
      totals: liveTotals,
    });
    downloadPdfBytes(bytes, safeFileName(estimate.name, "pdf"));
  };

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-hairline bg-surface-elevated">
        <div className="mx-auto flex max-w-[1800px] flex-col gap-4 px-5 py-4 lg:px-8">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Button
                asChild
                variant="outline"
                size="icon"
                className="h-8 w-8 shrink-0 rounded-lg text-muted-foreground"
                title={isMasterSheet ? "Back to master sheets" : "Back to estimates"}
              >
                <Link to={isMasterSheet ? "/estimate-masters" : "/estimates"}>
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div className="min-w-0 flex-1">
                <p className="mb-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                  {companyName} · {isMasterSheet ? "Master Sheet" : "Estimate"}
                </p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                  <Textarea
                    rows={titleRows}
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onBlur={() => {
                      if (nameDraft.trim() && nameDraft !== estimate.name) {
                        updateEstimateMutation.mutate({
                          id: estimate.id,
                          patch: { name: nameDraft },
                        });
                      }
                    }}
                    className="min-h-[2rem] w-full max-w-[560px] resize-none overflow-hidden border-0 bg-transparent p-0 font-serif text-[26px] leading-tight shadow-none focus-visible:ring-0"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <Select
                      value={estimate.status}
                      onValueChange={(status) =>
                        updateEstimatePatch({ status: status as EstimateStatus })
                      }
                    >
                      <SelectTrigger
                        className="h-7 w-auto gap-1.5 rounded-full border-hairline px-3 text-xs capitalize"
                        aria-label="Estimate status"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="draft">Draft</SelectItem>
                        <SelectItem value="final">Final</SelectItem>
                        <SelectItem value="awarded">Awarded</SelectItem>
                        <SelectItem value="lost">Lost</SelectItem>
                      </SelectContent>
                    </Select>
                    {!isMasterSheet && (
                      <Select
                        value={estimate.folder}
                        onValueChange={(folder) =>
                          updateEstimatePatch({ folder: folder as EstimateFolder })
                        }
                      >
                        <SelectTrigger
                          className="h-7 w-auto gap-1.5 rounded-full border-hairline px-3 text-xs text-clay"
                          aria-label="Estimate folder"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ESTIMATE_FOLDERS.map((folder) => (
                            <SelectItem key={folder.value} value={folder.value}>
                              {folder.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {estimate.project_name && (
                      <span className="text-xs text-muted-foreground">
                        Project: {estimate.project_name}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <div className="flex items-center gap-1">
                <FlagIssueButton
                  getContext={() => ({
                    estimate_id: estimate.id,
                    estimate_status: estimate.status,
                    is_master_sheet: isMasterSheet,
                  })}
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => duplicateMutation.mutate(false)}
                  disabled={duplicateMutation.isPending}
                >
                  <Copy className="h-3.5 w-3.5" /> {isMasterSheet ? "Copy Master" : "Duplicate"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-danger hover:text-danger"
                  onClick={() => setDeleteOpen(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {isMasterSheet ? "Delete Master" : "Delete"}
                </Button>
              </div>
              <Separator orientation="vertical" className="hidden h-6 xl:block" />
              <Button variant="outline" size="sm" className="gap-1.5" asChild>
                <Link to="/estimates/$estimateId/plan-room" params={{ estimateId: estimate.id }}>
                  <PencilRuler className="h-3.5 w-3.5" /> Plan Room
                </Link>
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="gap-1.5">
                    <Download className="h-3.5 w-3.5" /> Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={exportCsv}>
                    <FileDown className="h-4 w-4" /> CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={exportPdf}>
                    <FileDown className="h-4 w-4" /> PDF
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                className="gap-1.5"
                title={
                  isMasterSheet ? "Create a project estimate from this master sheet" : undefined
                }
                onClick={() =>
                  isMasterSheet ? duplicateMutation.mutate(true) : pushMutation.mutate()
                }
                disabled={
                  isMasterSheet
                    ? duplicateMutation.isPending
                    : pushMutation.isPending || orderedLines.length === 0
                }
              >
                <Send className="h-3.5 w-3.5" />
                {isMasterSheet ? "Create Estimate From Master" : "Push to Project"}
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1800px] gap-5 px-5 py-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:px-8">
        <section className="min-w-0 overflow-hidden rounded-lg border border-hairline bg-card shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-hairline bg-surface px-4 py-3">
            <div>
              <h2 className="font-serif text-2xl">
                {isMasterSheet ? "Master Sheet Lines" : "Line Items"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {isMasterSheet
                  ? `${orderedLines.length} rows. This saved master sheet is the reusable worksheet; the download is only the Excel/CSV import format.`
                  : `${orderedLines.length} rows. Import a master sheet, then replace or append this estimate.`}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-1.5">
                    <Download className="h-3.5 w-3.5" /> Download Import Format
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={downloadMasterEstimateWorkbook}>
                    <FileSpreadsheet className="h-4 w-4" /> Excel example + instructions
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={() =>
                      downloadText(
                        "overwatch-master-sheet-import-format.csv",
                        estimateLineTemplateCsv,
                        "text/csv",
                      )
                    }
                  >
                    <FileDown className="h-4 w-4" /> CSV format
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setImportOpen(true)}
              >
                <Upload className="h-3.5 w-3.5" /> Import Master Sheet
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" className="gap-1.5" disabled={createLinesMutation.isPending}>
                    <Plus className="h-3.5 w-3.5" /> Add Rows
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {[1, 5, 10, 15].map((count) => (
                    <DropdownMenuItem key={count} onClick={() => addBlankRows(count)}>
                      {count === 1 ? "1 blank row" : `${count} blank rows`}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {showFirstRunLauncher ? (
            <EstimateFirstRunLauncher
              onTakeoff={() =>
                navigate({
                  to: "/estimates/$estimateId/plan-room",
                  params: { estimateId: estimate.id },
                  search: { upload: true },
                })
              }
              onImportMasterSheet={() => setImportOpen(true)}
              onBuildByHand={() => addBlankRows(1)}
              disabled={createLinesMutation.isPending}
            />
          ) : (
            <div className="overflow-x-auto">
              <Table data-estimate-grid className="min-w-[1450px] table-fixed">
                <TableHeader>
                  <TableRow className="bg-surface [&>th]:whitespace-nowrap">
                    <TableHead className="w-[44px]" />
                    <TableHead className="w-[56px]">#</TableHead>
                    <TableHead className="w-[120px]">Cost Code</TableHead>
                    <TableHead className="w-[150px]">Group</TableHead>
                    <TableHead className="w-[340px]">Description</TableHead>
                    <TableHead className="w-[86px]">Unit</TableHead>
                    <TableHead className="w-[128px] text-right">Qty</TableHead>
                    <TableHead className="w-[150px] text-right">Mat $/Unit</TableHead>
                    <TableHead className="w-[150px] text-right">Labor $/Unit</TableHead>
                    <TableHead className="w-[170px] border-l border-hairline text-right">
                      Extended
                    </TableHead>
                    <TableHead className="w-[56px]" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {orderedLines.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={11}
                        className="py-12 text-center text-sm text-muted-foreground"
                        data-testid="estimate-grid-empty"
                      >
                        Measure it in the Plan Room, price it from your Cost Library, or import your
                        master sheet — start wherever you like.
                      </TableCell>
                    </TableRow>
                  ) : (
                    groupedRuns.map((run) => (
                      <Fragment key={run.key}>
                        {showGroupHeaders && (
                          <TableRow className="border-t border-hairline bg-background hover:bg-background">
                            <TableCell colSpan={11} className="px-3 py-2.5">
                              <div className="flex items-center gap-2.5">
                                <span className="eyebrow">{run.label}</span>
                                <span className="text-[11px] text-muted-foreground">
                                  {run.rows.length} {run.rows.length === 1 ? "item" : "items"}
                                </span>
                                <span className="flex-1" />
                                <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                                  Subtotal
                                </span>
                                <span className="font-serif text-[15px]">
                                  {fmtUSD(run.subtotalCents / 100)}
                                </span>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                        {run.rows.map(({ line, index }) => (
                          <EstimateLineRow
                            key={line.id}
                            estimate={estimate}
                            line={line}
                            index={index}
                            onUpdate={(patch) => updateLineMutation.mutate({ id: line.id, patch })}
                            onDelete={() => deleteLineMutation.mutate(line.id)}
                            onDragStart={() => setDraggingId(line.id)}
                            onDrop={() => onDropRow(line.id)}
                            onCreateNextRow={(colIndex) => {
                              addBlankRows(1, colIndex);
                            }}
                          />
                        ))}
                      </Fragment>
                    ))
                  )}
                  <TableRow className="border-t-2 border-foreground bg-surface font-medium">
                    <TableCell colSpan={9} className="text-sm">
                      Grand subtotal
                    </TableCell>
                    <TableCell className="border-l border-hairline text-right align-top">
                      <div className="font-serif text-[15px] leading-tight">
                        {fmtUSD(liveTotals.direct_cents / 100)}
                      </div>
                      <div className="mt-0.5 text-[10px] tabular text-muted-foreground">
                        {fmtUSD(liveTotals.material_cents / 100)} mat ·{" "}
                        {fmtUSD(liveTotals.labor_cents / 100)} lab
                      </div>
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </section>

        <EstimateSummaryPanel
          estimate={estimate}
          totals={liveTotals}
          regions={regions}
          onPatch={updateEstimatePatch}
          onSaveDefaults={() => saveDefaultsMutation.mutate()}
          savingDefaults={saveDefaultsMutation.isPending}
        />
      </main>

      <AppFooter
        context={`${isMasterSheet ? "Master sheet" : "Estimate"} · ${fmtUSD(
          liveTotals.total_cents / 100,
        )} · ${liveTotals.indicated_gp_pct.toFixed(1)}% GP`}
      />

      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isMasterSheet ? "Delete Master Sheet?" : "Delete Estimate?"}</DialogTitle>
            <DialogDescription>
              This permanently removes "{estimate.name}" and all of its worksheet rows from
              Overwatch. This does not move it to Archived. Use the Archived folder instead if you
              want to keep the record out of the way.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteOpen(false)}
              disabled={deleteEstimateMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteEstimateMutation.mutate()}
              disabled={deleteEstimateMutation.isPending}
            >
              {isMasterSheet ? "Delete Master Sheet" : "Delete Estimate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <EstimateLineImportDialog
        open={importOpen}
        rows={importRows}
        source={importSource}
        pasteText={pasteText}
        mode={importMode}
        saving={importMutation.isPending}
        existingRowCount={orderedLines.length}
        onOpenChange={(open) => {
          setImportOpen(open);
          if (!open) resetImport();
        }}
        onPasteTextChange={setPasteText}
        onModeChange={setImportMode}
        onPaste={handleImportPaste}
        onFile={handleImportFile}
        onReset={resetImport}
        onImport={() => importMutation.mutate()}
      />
    </div>
  );
}

function EstimateLineRow({
  estimate,
  line,
  index,
  onUpdate,
  onDelete,
  onDragStart,
  onDrop,
  onCreateNextRow,
}: {
  estimate: EstimateRow;
  line: EstimateLineItemRow;
  index: number;
  onUpdate: (patch: UpdateLinePayload["patch"]) => void;
  onDelete: () => void;
  onDragStart: () => void;
  onDrop: () => void;
  onCreateNextRow: (colIndex: number) => void;
}) {
  const [draft, setDraft] = useState(line);
  useEffect(() => setDraft(line), [line]);
  const materialExt = Math.round(
    draft.quantity * draft.material_unit_cost_cents * estimate.region_multiplier,
  );
  const laborExt = Math.round(
    draft.quantity * draft.labor_unit_cost_cents * estimate.region_multiplier,
  );

  const commit = (patch: UpdateLinePayload["patch"]) => onUpdate(patch);
  const handleGridKeyDown = (colIndex: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const grid = event.currentTarget.closest("[data-estimate-grid]");
    if (!grid) return;

    let nextRow = index;
    let nextCol = colIndex;
    const valueLength = event.currentTarget.value.length;
    const hasSelection =
      typeof event.currentTarget.selectionStart === "number" &&
      typeof event.currentTarget.selectionEnd === "number";
    const atStart = !hasSelection || event.currentTarget.selectionStart === 0;
    const atEnd = !hasSelection || event.currentTarget.selectionEnd === valueLength;

    if (event.key === "Tab") {
      nextCol += event.shiftKey ? -1 : 1;
      if (nextCol < 0) {
        nextRow -= 1;
        nextCol = ESTIMATE_GRID_COLUMNS - 1;
      } else if (nextCol >= ESTIMATE_GRID_COLUMNS) {
        nextRow += 1;
        nextCol = 0;
      }
    } else if (event.key === "Enter") {
      nextRow += 1;
    } else if (event.key === "ArrowDown") {
      nextRow += 1;
    } else if (event.key === "ArrowUp") {
      nextRow -= 1;
    } else if (event.key === "ArrowLeft" && atStart) {
      nextCol -= 1;
    } else if (event.key === "ArrowRight" && atEnd) {
      nextCol += 1;
    } else {
      return;
    }

    if (nextCol < 0 || nextRow < 0) return;
    if (nextCol >= ESTIMATE_GRID_COLUMNS) {
      nextRow += 1;
      nextCol = 0;
    }

    if (focusEstimateGridCell(grid, nextRow, nextCol)) {
      event.preventDefault();
      return;
    }

    if (!event.shiftKey && nextRow > index) {
      event.preventDefault();
      onCreateNextRow(nextCol);
    }
  };
  const gridCellProps = (colIndex: number): GridCellProps => ({
    "data-estimate-grid-cell": true,
    "data-row-index": index,
    "data-col-index": colIndex,
    onKeyDown: handleGridKeyDown(colIndex),
  });
  const selectLibraryItem = (item: CostLibraryItemRow, mode: CostApplyMode) => {
    // Material-only pulls skip the labor conversion, so they never block.
    const resolved =
      mode === "material"
        ? { ok: true as const, material_cost_cents: item.material_cost_cents, labor_cost_cents: 0 }
        : resolveLibraryUnitCosts(item);
    if (!resolved.ok) {
      toast.error(resolved.message);
      return;
    }
    const sharedPatch = {
      unit: item.unit,
      csi_division: item.csi_division,
      library_item_id: item.id,
      ...(mode === "row" || shouldReplacePlaceholderDescription(draft.description)
        ? { description: item.description }
        : {}),
    };
    const patch =
      mode === "material"
        ? {
            ...sharedPatch,
            material_unit_cost_cents: resolved.material_cost_cents,
          }
        : mode === "labor"
          ? {
              ...sharedPatch,
              labor_unit_cost_cents: resolved.labor_cost_cents,
            }
          : {
              ...sharedPatch,
              material_unit_cost_cents: resolved.material_cost_cents,
              labor_unit_cost_cents: resolved.labor_cost_cents,
            };
    setDraft((current) => ({ ...current, ...patch }));
    onUpdate(patch);
  };

  return (
    <TableRow
      draggable
      onDragStart={onDragStart}
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      className="[&>td]:px-2 [&>td]:py-2"
    >
      <TableCell>
        <Button variant="ghost" size="icon" className="h-8 w-8 cursor-grab" title="Drag row">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
        </Button>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{index + 1}</TableCell>
      <TableCell>
        <Input
          {...gridCellProps(0)}
          value={draft.cost_code}
          onChange={(event) => setDraft({ ...draft, cost_code: event.target.value })}
          onBlur={() => commit({ cost_code: draft.cost_code })}
          className="h-8 w-full min-w-0"
        />
      </TableCell>
      <TableCell>
        <Input
          {...gridCellProps(1)}
          value={draft.scope_group}
          onChange={(event) => setDraft({ ...draft, scope_group: event.target.value })}
          onBlur={() => commit({ scope_group: draft.scope_group })}
          className="h-8 w-full min-w-0"
        />
      </TableCell>
      <TableCell>
        <CostLibraryAutocomplete
          value={draft.description}
          csiDivision={draft.csi_division}
          regionMultiplier={estimate.region_multiplier}
          onChange={(description) => setDraft({ ...draft, description })}
          onBlur={() => commit({ description: draft.description })}
          onSelect={selectLibraryItem}
          gridCell={gridCellProps(2)}
        />
      </TableCell>
      <TableCell>
        <Input
          {...gridCellProps(3)}
          value={draft.unit}
          onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
          onBlur={() => commit({ unit: draft.unit })}
          className="h-8 w-full min-w-0 uppercase"
        />
      </TableCell>
      <TableCell>
        <Input
          {...gridCellProps(4)}
          type="number"
          min={0}
          step="0.01"
          value={draft.quantity}
          onChange={(event) => setDraft({ ...draft, quantity: Number(event.target.value) || 0 })}
          onBlur={() => commit({ quantity: draft.quantity })}
          className="h-8 w-full min-w-0 text-right tabular"
        />
        {line.quantity_source === "takeoff" && (
          <Link
            to="/estimates/$estimateId/plan-room"
            params={{ estimateId: estimate.id }}
            search={{ line: line.id }}
            className="mt-1 flex items-center justify-end gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            title="This quantity came from the Plan Room takeoff. Open its sheet and measurement."
            data-testid="line-takeoff-link"
          >
            <PencilRuler className="h-3 w-3" /> Takeoff
          </Link>
        )}
      </TableCell>
      <TableCell>
        <MoneyInput
          {...gridCellProps(5)}
          value={centsToDollars(draft.material_unit_cost_cents)}
          onValueChange={(value) =>
            setDraft({ ...draft, material_unit_cost_cents: dollarsToCents(value) })
          }
          onBlur={() => commit({ material_unit_cost_cents: draft.material_unit_cost_cents })}
          align="right"
          className="h-8 w-full min-w-0"
        />
      </TableCell>
      <TableCell>
        <MoneyInput
          {...gridCellProps(6)}
          value={centsToDollars(draft.labor_unit_cost_cents)}
          onValueChange={(value) =>
            setDraft({ ...draft, labor_unit_cost_cents: dollarsToCents(value) })
          }
          onBlur={() => commit({ labor_unit_cost_cents: draft.labor_unit_cost_cents })}
          align="right"
          className="h-8 w-full min-w-0"
        />
      </TableCell>
      <TableCell className="border-l border-hairline text-right align-middle tabular">
        {draft.material_unit_cost_cents === 0 && draft.labor_unit_cost_cents === 0 ? (
          <Badge
            variant="outline"
            className="border-warning/50 bg-warning/10"
            title="This row came in without pricing. Add material or labor unit costs."
            data-testid="line-needs-pricing"
          >
            Needs pricing
          </Badge>
        ) : (
          <div title={`Material ${fmtUSD(materialExt / 100)} · Labor ${fmtUSD(laborExt / 100)}`}>
            <div className="font-serif text-[15px] leading-tight">
              {fmtUSD((materialExt + laborExt) / 100)}
            </div>
            <div className="mt-0.5 text-[10px] text-muted-foreground">
              {fmtUSD(materialExt / 100)} mat · {fmtUSD(laborExt / 100)} lab
            </div>
          </div>
        )}
      </TableCell>
      <TableCell>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onDelete}
          title="Delete row"
        >
          <Trash2 className="h-4 w-4 text-danger" />
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CostLibraryAutocomplete({
  value,
  csiDivision,
  regionMultiplier,
  onChange,
  onBlur,
  onSelect,
  gridCell,
}: {
  value: string;
  csiDivision: string;
  regionMultiplier: number;
  onChange: (value: string) => void;
  onBlur: () => void;
  onSelect: (item: CostLibraryItemRow, mode: CostApplyMode) => void;
  gridCell?: GridCellProps;
}) {
  const search = useServerFn(searchCostLibrary);
  const [open, setOpen] = useState(false);
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), 300);
    return () => window.clearTimeout(timer);
  }, [value]);
  const query = useQuery({
    queryKey: ["cost-library-search", debounced, csiDivision, regionMultiplier],
    queryFn: () =>
      search({
        data: {
          query: debounced,
          csi_division: "",
          region_multiplier: regionMultiplier,
          limit: 8,
        },
      }),
    enabled: debounced.trim().length >= 2,
  });
  const items = query.data?.items ?? [];
  return (
    <div className="relative">
      <Input
        {...gridCell}
        value={value}
        onFocus={() => setOpen(true)}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
        }}
        onBlur={() => {
          window.setTimeout(() => setOpen(false), 120);
          onBlur();
        }}
        className="h-8 w-full min-w-0"
      />
      {open && items.length > 0 && (
        <div className="absolute left-0 top-9 z-40 w-[520px] overflow-hidden rounded-md border border-hairline bg-popover shadow-elevated">
          <div className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-xs text-muted-foreground">
            <Library className="h-3.5 w-3.5" /> Cost Library matches for {debounced}
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {items.map((item) => (
              <div
                key={item.id}
                className="grid w-full grid-cols-[1fr_52px_86px_86px_210px] gap-2 rounded-sm px-2 py-2 text-left text-xs hover:bg-surface"
                onMouseDown={(event) => event.preventDefault()}
              >
                <button
                  type="button"
                  className="min-w-0 text-left"
                  onClick={() => {
                    onSelect(item, "row");
                    setOpen(false);
                  }}
                >
                  <span className="block truncate text-sm text-foreground">{item.description}</span>
                  <span className="block truncate text-[11px] text-muted-foreground">
                    {costProfileLabel(item)} · {item.csi_code || item.csi_division}
                  </span>
                </button>
                <span className="text-muted-foreground">{item.unit}</span>
                <span className="text-right tabular">
                  {fmtUSD(item.display_material_cost_cents / 100)}
                </span>
                <span className="text-right tabular">
                  {fmtUSD(item.display_labor_cost_cents / 100)}
                </span>
                <span className="flex justify-end gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-[11px]"
                    onClick={() => {
                      onSelect(item, "row");
                      setOpen(false);
                    }}
                  >
                    Use row
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    disabled={item.display_material_cost_cents <= 0}
                    onClick={() => {
                      onSelect(item, "material");
                      setOpen(false);
                    }}
                  >
                    Mat only
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2 text-[11px]"
                    disabled={item.display_labor_cost_cents <= 0}
                    onClick={() => {
                      onSelect(item, "labor");
                      setOpen(false);
                    }}
                  >
                    Labor only
                  </Button>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function EstimateLineImportDialog({
  open,
  rows,
  source,
  pasteText,
  mode,
  saving,
  existingRowCount,
  onOpenChange,
  onPasteTextChange,
  onModeChange,
  onPaste,
  onFile,
  onReset,
  onImport,
}: {
  open: boolean;
  rows: EstimateLineImportRow[];
  source: string;
  pasteText: string;
  mode: "append" | "replace";
  saving: boolean;
  existingRowCount: number;
  onOpenChange: (open: boolean) => void;
  onPasteTextChange: (value: string) => void;
  onModeChange: (mode: "append" | "replace") => void;
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
  const materialTotal = validRows.reduce(
    (sum, row) => sum + row.quantity * row.material_unit_cost_cents,
    0,
  );
  const laborTotal = validRows.reduce(
    (sum, row) => sum + row.quantity * row.labor_unit_cost_cents,
    0,
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[86vh] max-w-6xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import Master Sheet</DialogTitle>
          <DialogDescription>
            Paste or upload a spreadsheet into this worksheet. The download is only the import
            format/example file; your saved master sheet is the worksheet inside Overwatch. Accepted
            columns include Cost Code, CSI Division, Description, Group, Unit, Qty, Material $/Unit,
            Labor $/Unit, and Notes.
          </DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <Tabs defaultValue="paste" className="space-y-4">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="paste">Copy / Paste</TabsTrigger>
              <TabsTrigger value="csv">Upload CSV</TabsTrigger>
              <TabsTrigger value="xlsx">Upload Excel</TabsTrigger>
            </TabsList>

            <TabsContent value="paste" className="space-y-3">
              <Label>Paste from Excel, Google Sheets, or your estimating workbook</Label>
              <Textarea
                rows={12}
                value={pasteText}
                onChange={(event) => onPasteTextChange(event.target.value)}
                placeholder={
                  "Cost Code\tCSI Division\tDescription\tGroup\tUnit\tQty\tMaterial $/Unit\tLabor $/Unit\tNotes\n06-100\t06\tRough framing package\tStructure\tLS\t1\t185000\t62000\t\n09-510\t09\tInterior paint\tFinishes\tSF\t18500\t0.58\t1.35\t"
                }
                className="font-mono text-xs"
              />
              <Button
                variant="outline"
                className="gap-1.5"
                onClick={onPaste}
                disabled={!pasteText.trim()}
              >
                <FileSpreadsheet className="h-3.5 w-3.5" /> Preview Master Sheet
              </Button>
            </TabsContent>

            <TabsContent value="csv" className="space-y-3">
              <Label>CSV master estimate file</Label>
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
              <Label>Excel master estimate file</Label>
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
              <span className="ml-auto tabular">
                {fmtUSD((materialTotal + laborTotal) / 100)} direct
              </span>
            </div>

            <div className="grid gap-3 rounded-lg border border-hairline bg-card p-3 md:grid-cols-[220px_1fr_auto] md:items-center">
              <div className="space-y-1.5">
                <Label>What should Overwatch do?</Label>
                <Select
                  value={mode}
                  onValueChange={(value) => onModeChange(value as "append" | "replace")}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="append">Add to this worksheet</SelectItem>
                    <SelectItem value="replace">Replace this worksheet</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="text-sm text-muted-foreground">
                {mode === "replace" && existingRowCount > 0
                  ? `${existingRowCount} existing rows will be removed first.`
                  : `${validRows.length} lines will be added to this estimate.`}
              </div>
              <Button size="sm" variant="ghost" onClick={onReset}>
                Start over
              </Button>
            </div>

            <div className="max-h-[420px] overflow-auto rounded-lg border border-hairline">
              <Table className="min-w-[1180px]">
                <TableHeader>
                  <TableRow className="bg-surface">
                    <TableHead className="w-[62px]">Row</TableHead>
                    <TableHead className="w-[110px]">Code</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[130px]">Group</TableHead>
                    <TableHead className="w-[72px]">Unit</TableHead>
                    <TableHead className="w-[90px] text-right">Qty</TableHead>
                    <TableHead className="w-[118px] text-right">Material</TableHead>
                    <TableHead className="w-[118px] text-right">Labor</TableHead>
                    <TableHead className="w-[190px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.slice(0, 100).map((row) => (
                    <TableRow key={row.rowNumber} className={!row.valid ? "bg-danger/5" : ""}>
                      <TableCell className="text-xs text-muted-foreground">
                        {row.rowNumber}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{row.cost_code || "-"}</TableCell>
                      <TableCell className="font-medium">{row.description || "-"}</TableCell>
                      <TableCell>{row.scope_group || "-"}</TableCell>
                      <TableCell>{row.unit}</TableCell>
                      <TableCell className="text-right tabular">{row.quantity}</TableCell>
                      <TableCell className="text-right tabular">
                        {fmtUSD(row.material_unit_cost_cents / 100)}
                      </TableCell>
                      <TableCell className="text-right tabular">
                        {fmtUSD(row.labor_unit_cost_cents / 100)}
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
            {saving ? "Importing..." : `Import ${validRows.length} Lines`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EstimateSummaryPanel({
  estimate,
  totals,
  regions,
  onPatch,
  onSaveDefaults,
  savingDefaults,
}: {
  estimate: EstimateRow;
  totals: EstimateTotalsBreakdown;
  regions: EstimateRegion[];
  onPatch: (patch: UpdateEstimatePayload["patch"]) => void;
  onSaveDefaults: () => void;
  savingDefaults: boolean;
}) {
  const [adjustOpen, setAdjustOpen] = useState(false);

  const patchPct =
    (
      field: keyof Pick<
        EstimateRow,
        | "overhead_pct"
        | "profit_pct"
        | "contingency_pct"
        | "bond_pct"
        | "tax_pct"
        | "general_conditions_pct"
      >,
    ) =>
    (value: number) =>
      onPatch({ [field]: numberToPct(value) } as UpdateEstimatePayload["patch"]);

  const selectedRegion = regions.find((region) => region.code === estimate.region);

  // Donut gauge geometry. Arc fills clockwise from 12 o'clock to the indicated
  // gross-profit share of the total bid. GP dollars = total bid − adjusted
  // direct cost (the same numerator the totals fn divides to get the pct).
  const gpPct = Math.max(0, Math.min(100, totals.indicated_gp_pct));
  const gpCents = totals.total_cents - totals.adjusted_direct_cents;
  const RADIUS = 30;
  const CIRC = 2 * Math.PI * RADIUS;
  const dashOffset = CIRC * (1 - gpPct / 100);

  // Composition bar: material / labor / all markups, as a share of their sum.
  const markupCents =
    totals.overhead_cents +
    totals.profit_cents +
    totals.contingency_cents +
    totals.bond_cents +
    totals.tax_cents +
    totals.general_conditions_cents +
    totals.custom_markup_cents;
  const barSum = totals.material_cents + totals.labor_cents + markupCents;
  const share = (value: number) => (barSum > 0 ? (value / barSum) * 100 : 0);
  const materialSwatch = "color-mix(in srgb, var(--dark-panel-foreground) 55%, transparent)";
  const laborSwatch = "color-mix(in srgb, var(--dark-panel-foreground) 30%, transparent)";

  return (
    <aside className="h-max overflow-hidden rounded-lg border border-hairline bg-card shadow-card lg:sticky lg:top-4">
      <div className="bg-dark-panel px-5 py-5 text-dark-panel-foreground">
        <div className="flex items-center gap-4">
          <svg
            width="84"
            height="84"
            viewBox="0 0 82 82"
            className="shrink-0"
            role="img"
            aria-label={`Indicated gross profit ${gpPct.toFixed(1)} percent`}
          >
            <circle
              cx="41"
              cy="41"
              r={RADIUS}
              fill="none"
              stroke="var(--dark-panel-foreground)"
              strokeOpacity={0.18}
              strokeWidth="7"
            />
            <circle
              cx="41"
              cy="41"
              r={RADIUS}
              fill="none"
              stroke="var(--clay)"
              strokeWidth="7"
              strokeLinecap="round"
              strokeDasharray={CIRC}
              strokeDashoffset={dashOffset}
              transform="rotate(-90 41 41)"
            />
            <text
              x="41"
              y="46"
              textAnchor="middle"
              className="font-serif"
              fontSize="16"
              fill="var(--dark-panel-foreground)"
            >
              {gpPct.toFixed(1)}%
            </text>
          </svg>
          <div className="min-w-0">
            <div className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-dark-panel-foreground/60">
              Indicated gross profit
            </div>
            <div className="mt-1 font-serif text-[26px] leading-none">{fmtUSD(gpCents / 100)}</div>
            <div className="mt-1 text-[11.5px] text-dark-panel-foreground/60">
              on {fmtUSD(totals.total_cents / 100)} total bid
            </div>
          </div>
        </div>
        <div className="mt-4 flex h-2.5 gap-px overflow-hidden rounded-full">
          <div
            style={{ width: `${share(totals.material_cents)}%`, backgroundColor: materialSwatch }}
          />
          <div style={{ width: `${share(totals.labor_cents)}%`, backgroundColor: laborSwatch }} />
          <div style={{ width: `${share(markupCents)}%`, backgroundColor: "var(--clay)" }} />
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[8.5px] font-bold uppercase tracking-[0.06em] text-dark-panel-foreground/60">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: materialSwatch }} />
            Material
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px]" style={{ backgroundColor: laborSwatch }} />
            Labor
          </span>
          <span className="flex items-center gap-1.5 text-clay">
            <span className="h-2 w-2 rounded-[2px] bg-accent" />
            Markup
          </span>
        </div>
      </div>

      <div className="p-4">
        <div className="font-mono text-[8.5px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
          Bid build-up
        </div>
        <div className="mt-1.5 space-y-0.5 text-sm">
          <SummaryRow label="Direct cost · material" value={totals.material_cents} />
          <SummaryRow label="Direct cost · labor" value={totals.labor_cents} />
          {totals.regional_adjustment_cents !== 0 && (
            <SummaryRow
              label={`Regional adjustment (${(selectedRegion?.multiplier_decimal ?? estimate.region_multiplier).toFixed(2)}x)`}
              value={totals.regional_adjustment_cents}
            />
          )}
          <Separator className="my-1.5" />
          <SummaryRow
            label="Overhead"
            value={totals.overhead_cents}
            badge={`${pctToNumber(estimate.overhead_pct)}%`}
          />
          <SummaryRow
            label="Profit"
            value={totals.profit_cents}
            badge={`${pctToNumber(estimate.profit_pct)}%`}
          />
          <SummaryRow
            label="Contingency"
            value={totals.contingency_cents}
            badge={`${pctToNumber(estimate.contingency_pct)}%`}
          />
          <SummaryRow
            label="General conditions"
            value={totals.general_conditions_cents}
            badge={`${pctToNumber(estimate.general_conditions_pct)}%`}
          />
          <SummaryRow
            label="Bond"
            value={totals.bond_cents}
            badge={`${pctToNumber(estimate.bond_pct)}%`}
          />
          <SummaryRow
            label="Tax (materials)"
            value={totals.tax_cents}
            badge={`${pctToNumber(estimate.tax_pct)}%`}
          />
          {totals.custom_markup_cents > 0 && (
            <SummaryRow label="Custom markups" value={totals.custom_markup_cents} />
          )}
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-3 border-t-2 border-foreground pt-3">
          <span className="text-[13px] font-bold">Total bid</span>
          <span className="font-serif text-[26px] text-accent">
            {fmtUSD(totals.total_cents / 100)}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
          <span>Indicated GP</span>
          <span className="font-semibold text-foreground">{gpPct.toFixed(1)}%</span>
        </div>

        <div className="mt-4 space-y-1.5">
          <Label>Region</Label>
          <Select
            value={estimate.region || "national"}
            onValueChange={(regionCode) => {
              const region = regions.find((item) => item.code === regionCode);
              onPatch({
                region: regionCode === "national" ? "" : regionCode,
                region_multiplier: region?.multiplier_decimal ?? 1,
              });
            }}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {regions.map((region) => (
                <SelectItem key={region.code} value={region.code}>
                  {region.name} ({region.multiplier_decimal.toFixed(2)}x)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="mt-4 border-t border-hairline pt-3">
          <button
            type="button"
            onClick={() => setAdjustOpen((open) => !open)}
            aria-expanded={adjustOpen}
            className="flex w-full items-center justify-between gap-2 text-left text-sm font-medium"
          >
            <span>Adjust markup</span>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground transition-transform ${
                adjustOpen ? "rotate-180" : ""
              }`}
            />
          </button>
          {adjustOpen && (
            <div className="mt-3 space-y-3">
              <PctField
                label="Overhead"
                value={pctToNumber(estimate.overhead_pct)}
                onCommit={patchPct("overhead_pct")}
              />
              <PctField
                label="Profit"
                value={pctToNumber(estimate.profit_pct)}
                onCommit={patchPct("profit_pct")}
              />
              <PctField
                label="Contingency"
                value={pctToNumber(estimate.contingency_pct)}
                onCommit={patchPct("contingency_pct")}
              />
              <PctField
                label="Bond"
                value={pctToNumber(estimate.bond_pct)}
                onCommit={patchPct("bond_pct")}
              />
              <PctField
                label="Tax"
                value={pctToNumber(estimate.tax_pct)}
                onCommit={patchPct("tax_pct")}
              />
              <PctField
                label="General Conditions"
                value={pctToNumber(estimate.general_conditions_pct)}
                onCommit={patchPct("general_conditions_pct")}
              />
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5"
                onClick={onSaveDefaults}
                disabled={savingDefaults}
                title="Save these markups and region as your defaults"
              >
                <Save className="h-3.5 w-3.5" /> Save as defaults
              </Button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function PctField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <div className="grid grid-cols-[1fr_96px] items-center gap-3">
      <Label>{label}</Label>
      <div className="relative">
        <Input
          type="number"
          min={0}
          step="0.01"
          value={draft}
          onChange={(event) => setDraft(Number(event.target.value) || 0)}
          onBlur={() => onCommit(draft)}
          className="h-8 pr-7 text-right tabular"
        />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
          %
        </span>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, badge }: { label: string; value: number; badge?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-0.5">
      <span className="flex items-center gap-2 text-muted-foreground">
        {label}
        {badge && (
          <span className="rounded-[5px] border border-hairline px-1.5 py-px font-mono text-[9px] text-muted-foreground">
            {badge}
          </span>
        )}
      </span>
      <span className="font-serif text-[14px] tabular text-foreground">{fmtUSD(value / 100)}</span>
    </div>
  );
}
