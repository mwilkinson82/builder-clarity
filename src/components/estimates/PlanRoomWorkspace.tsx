import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  ArrowLeft,
  Check,
  ClipboardList,
  FileUp,
  Image as ImageIcon,
  Link2,
  MousePointer2,
  PencilRuler,
  Plus,
  Ruler,
  Save,
  Square,
  Target,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { fmtUSD } from "@/lib/format";
import {
  createPlanSet,
  createTakeoffMeasurement,
  deleteTakeoffMeasurement,
  planRoomBucket,
  syncTakeoffToEstimateLine,
  updatePlanSheet,
  updateTakeoffMeasurement,
  type PlanSetRow,
  type PlanSheetRow,
  type TakeoffMeasurementRow,
  type TakeoffToolType,
} from "@/lib/plan-room.functions";
import {
  calculateTakeoffQuantity,
  distancePx,
  type PlanRoomPoint,
  type PlanRoomViewSize,
} from "@/lib/plan-room-math";
import type { EstimateLineItemRow, EstimateRow } from "@/lib/estimates.functions";

type ToolMode = "select" | "calibrate" | TakeoffToolType;
type Point = PlanRoomPoint;
type ViewSize = PlanRoomViewSize;

interface PlanRoomWorkspaceProps {
  estimate: EstimateRow;
  lineItems: EstimateLineItemRow[];
  planSets: PlanSetRow[];
  sheets: PlanSheetRow[];
  measurements: TakeoffMeasurementRow[];
  companyName?: string;
  schemaReady?: boolean;
  schemaMessage?: string;
}

const DEFAULT_VIEW_SIZE: ViewSize = { width: 960, height: 620 };
const TAKEOFF_COLORS = ["#1b7a6e", "#b35035", "#946a21", "#375d8a", "#5d5f6f"];

const formatQty = (value: number, unit: string) =>
  `${new Intl.NumberFormat(undefined, {
    maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value)}${unit ? ` ${unit}` : ""}`;

const centsToDollars = (value: number) => Math.round(value) / 100;

const slugFileName = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 160) || "drawing";

function geometryPoints(geometry: unknown): Point[] {
  if (!geometry || typeof geometry !== "object") return [];
  const points = (geometry as { points?: unknown }).points;
  if (!Array.isArray(points)) return [];
  return points
    .map((point) => {
      if (!point || typeof point !== "object") return null;
      const raw = point as { x?: unknown; y?: unknown };
      const x = Number(raw.x);
      const y = Number(raw.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    })
    .filter((point): point is Point => Boolean(point));
}

function calculateQuantity(
  tool: TakeoffToolType,
  points: Point[],
  sheet: PlanSheetRow,
  size: ViewSize,
) {
  return calculateTakeoffQuantity({
    tool,
    points,
    scaleFeetPerPixel: sheet.scale_feet_per_pixel,
    viewSize: size,
  });
}

function unitFor(tool: TakeoffToolType, selectedLine?: EstimateLineItemRow) {
  if (selectedLine?.unit) return selectedLine.unit;
  if (tool === "linear") return "LF";
  if (tool === "area") return "SF";
  return "EA";
}

function toolLabel(tool: ToolMode) {
  if (tool === "select") return "Select";
  if (tool === "calibrate") return "Set Scale";
  if (tool === "linear") return "Linear";
  if (tool === "area") return "Area";
  return "Count";
}

async function getPdfPageCount(file: File) {
  if (file.type !== "application/pdf") return 1;
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  (
    pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }
  ).GlobalWorkerOptions.workerSrc = workerUrl;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  return Math.max(1, pdf.numPages);
}

export function PlanRoomWorkspace({
  estimate,
  lineItems,
  planSets,
  sheets,
  measurements,
  companyName = "Company",
  schemaReady = true,
  schemaMessage = "",
}: PlanRoomWorkspaceProps) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const createPlanSetFn = useServerFn(createPlanSet);
  const createMeasurementFn = useServerFn(createTakeoffMeasurement);
  const updateSheetFn = useServerFn(updatePlanSheet);
  const updateMeasurementFn = useServerFn(updateTakeoffMeasurement);
  const deleteMeasurementFn = useServerFn(deleteTakeoffMeasurement);
  const syncLineFn = useServerFn(syncTakeoffToEstimateLine);

  const [selectedSheetId, setSelectedSheetId] = useState<string>("");
  const [tool, setTool] = useState<ToolMode>("select");
  const [selectedLineId, setSelectedLineId] = useState<string>("unlinked");
  const [measurementLabel, setMeasurementLabel] = useState("");
  const [takeoffColor, setTakeoffColor] = useState(TAKEOFF_COLORS[0]);
  const [pendingPoints, setPendingPoints] = useState<Point[]>([]);
  const [viewSize, setViewSize] = useState<ViewSize>(DEFAULT_VIEW_SIZE);
  const [calibrationFeet, setCalibrationFeet] = useState("25");
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [uploading, setUploading] = useState(false);

  const currentSheet = useMemo(
    () => sheets.find((sheet) => sheet.id === selectedSheetId) ?? sheets[0] ?? null,
    [selectedSheetId, sheets],
  );
  const currentPlanSet = currentSheet
    ? (planSets.find((planSet) => planSet.id === currentSheet.plan_set_id) ?? null)
    : null;
  const selectedLine = lineItems.find((line) => line.id === selectedLineId);
  const sheetMeasurements = measurements.filter(
    (measurement) => measurement.plan_sheet_id === currentSheet?.id,
  );

  useEffect(() => {
    if (!selectedSheetId && sheets[0]) setSelectedSheetId(sheets[0].id);
  }, [selectedSheetId, sheets]);

  useEffect(() => {
    if (selectedLine && !measurementLabel.trim()) {
      setMeasurementLabel(selectedLine.description);
    }
  }, [measurementLabel, selectedLine]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["plan-room", estimate.id] });
    qc.invalidateQueries({ queryKey: ["estimate", estimate.id] });
    qc.invalidateQueries({ queryKey: ["estimates"] });
  };

  const createSetMutation = useMutation({
    mutationFn: (file: File) => uploadDrawingSet(file),
    onSuccess: () => {
      toast.success("Drawing set uploaded");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Drawing set did not upload"),
  });

  const createMeasurementMutation = useMutation({
    mutationFn: async ({
      measurementTool,
      points,
    }: {
      measurementTool: TakeoffToolType;
      points: Point[];
    }) => {
      if (!currentSheet) throw new Error("Choose a plan sheet first.");
      const line = selectedLineId === "unlinked" ? undefined : selectedLine;
      const quantity = calculateQuantity(measurementTool, points, currentSheet, viewSize);
      if (quantity <= 0) {
        throw new Error(
          measurementTool === "count"
            ? "Click the plan to place a count."
            : "Set the drawing scale before measuring this takeoff.",
        );
      }
      return createMeasurementFn({
        data: {
          estimate_id: estimate.id,
          plan_sheet_id: currentSheet.id,
          estimate_line_item_id: line?.id ?? null,
          library_item_id: line?.library_item_id ?? null,
          tool_type: measurementTool,
          label:
            measurementLabel.trim() || line?.description || `${toolLabel(measurementTool)} takeoff`,
          unit: unitFor(measurementTool, line),
          quantity,
          waste_pct: 0,
          color: takeoffColor,
          geometry: { points, view_size: viewSize },
          notes: line ? "Quantity produced from Plan Room takeoff." : "",
        },
      });
    },
    onSuccess: (_result, variables) => {
      toast.success(selectedLine ? "Takeoff saved and estimate row updated" : "Takeoff saved");
      setPendingPoints([]);
      if (variables.measurementTool !== "count") setTool("select");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Takeoff did not save"),
  });

  const updateSheetMutation = useMutation({
    mutationFn: (patch: Parameters<typeof updateSheetFn>[0]["data"]["patch"]) => {
      if (!currentSheet) throw new Error("Choose a plan sheet first.");
      return updateSheetFn({ data: { sheet_id: currentSheet.id, patch } });
    },
    onSuccess: () => {
      toast.success("Sheet updated");
      setCalibrationPoints([]);
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Sheet did not save"),
  });

  const updateMeasurementMutation = useMutation({
    mutationFn: ({
      id,
      patch,
    }: {
      id: string;
      patch: Parameters<typeof updateMeasurementFn>[0]["data"]["patch"];
    }) => updateMeasurementFn({ data: { id, patch } }),
    onSuccess: () => {
      toast.success("Takeoff updated");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Takeoff did not save"),
  });

  const deleteMeasurementMutation = useMutation({
    mutationFn: (id: string) => deleteMeasurementFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Takeoff deleted");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Takeoff did not delete"),
  });

  const syncLineMutation = useMutation({
    mutationFn: (lineId: string) =>
      syncLineFn({ data: { estimate_id: estimate.id, estimate_line_item_id: lineId } }),
    onSuccess: (result) => {
      toast.success(`Estimate quantity updated to ${formatQty(result.sync.quantity, "")}`);
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Estimate row did not update"),
  });

  const uploadDrawingSet = async (file: File) => {
    setUploading(true);
    try {
      const pageCount = await getPdfPageCount(file);
      const path = `${estimate.id}/${crypto.randomUUID()}-${slugFileName(file.name)}`;
      const { error: uploadError } = await supabase.storage
        .from(planRoomBucket)
        .upload(path, file, {
          upsert: false,
          contentType: file.type || "application/octet-stream",
        });
      if (uploadError) throw uploadError;
      return await createPlanSetFn({
        data: {
          estimate_id: estimate.id,
          name: file.name.replace(/\.[^.]+$/, ""),
          description: "Uploaded drawing set for Plan Room takeoff.",
          source_file_name: file.name,
          file_path: path,
          file_mime_type: file.type || "application/octet-stream",
          file_size_bytes: file.size,
          page_count: pageCount,
        },
      });
    } finally {
      setUploading(false);
    }
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    createSetMutation.mutate(file);
  };

  const onCanvasPoint = (point: Point) => {
    if (!currentSheet || tool === "select") return;

    if (tool === "calibrate") {
      const next = [...calibrationPoints, point].slice(-2);
      setCalibrationPoints(next);
      if (next.length === 2) {
        toast.info("Enter the known distance, then save scale.");
      }
      return;
    }

    if (tool === "linear" || tool === "count") {
      const next = tool === "count" ? [point] : [...pendingPoints, point].slice(-2);
      if (tool === "count" || next.length === 2) {
        createMeasurementMutation.mutate({ measurementTool: tool, points: next });
      } else {
        setPendingPoints(next);
      }
      return;
    }

    setPendingPoints((current) => [...current, point]);
  };

  const finishArea = () => {
    if (tool !== "area" || pendingPoints.length < 3) {
      toast.warning("Click at least three corners before finishing an area.");
      return;
    }
    createMeasurementMutation.mutate({ measurementTool: "area", points: pendingPoints });
  };

  const saveScale = () => {
    if (!currentSheet || calibrationPoints.length !== 2) {
      toast.warning("Click two points on a known distance first.");
      return;
    }
    const feet = Number(calibrationFeet);
    if (!Number.isFinite(feet) || feet <= 0) {
      toast.warning("Enter the real distance in feet.");
      return;
    }
    const px = distancePx(calibrationPoints, viewSize);
    if (px <= 0) {
      toast.warning("The calibration line is too short.");
      return;
    }
    updateSheetMutation.mutate({
      scale_feet_per_pixel: feet / px,
      scale_label: `${feet} ft calibration`,
      width_px: Math.round(viewSize.width),
      height_px: Math.round(viewSize.height),
    });
  };

  const lineTotals = useMemo(() => {
    const totals = new Map<string, { quantity: number; count: number }>();
    for (const measurement of measurements) {
      if (!measurement.estimate_line_item_id) continue;
      const current = totals.get(measurement.estimate_line_item_id) ?? { quantity: 0, count: 0 };
      current.quantity += measurement.quantity;
      current.count += 1;
      totals.set(measurement.estimate_line_item_id, current);
    }
    return totals;
  }, [measurements]);

  const totalMeasured = measurements.reduce((sum, measurement) => sum + measurement.quantity, 0);
  const linkedCount = measurements.filter(
    (measurement) => measurement.estimate_line_item_id,
  ).length;
  const backendReady = schemaReady !== false;

  return (
    <div className="min-h-screen bg-background" data-testid="plan-room-workspace">
      <header className="border-b border-hairline bg-surface-elevated">
        <div className="mx-auto flex max-w-[1800px] flex-col gap-4 px-5 py-4 lg:px-8">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <Button asChild variant="ghost" size="icon" title="Back to estimate">
                <Link to="/estimates/$estimateId" params={{ estimateId: estimate.id }}>
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
                  {companyName}
                </p>
                <h1 className="mt-1 font-serif text-3xl text-foreground">Plan Room</h1>
                <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
                  {estimate.name}. Measure the plans once, link the takeoff to an estimate row, and
                  Overwatch updates the worksheet quantity.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              <Badge variant="outline">{planSets.length} drawing sets</Badge>
              <Badge variant="outline">{sheets.length} sheets</Badge>
              <Badge variant={linkedCount === measurements.length ? "secondary" : "outline"}>
                {linkedCount}/{measurements.length} linked
              </Badge>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="application/pdf,image/png,image/jpeg,image/webp"
                onChange={onFileChange}
              />
              <Button
                size="sm"
                className="gap-1.5"
                onClick={() => fileInputRef.current?.click()}
                disabled={!backendReady || uploading || createSetMutation.isPending}
              >
                <FileUp className="h-3.5 w-3.5" />
                Upload Plans
              </Button>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1800px] gap-5 px-5 py-6 xl:grid-cols-[220px_minmax(0,1fr)_300px] 2xl:grid-cols-[280px_minmax(0,1fr)_390px] lg:px-8">
        {!backendReady && (
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 xl:col-span-3">
            <p className="font-medium">Plan Room backend is still coming online</p>
            <p className="mt-1 text-amber-900">
              {schemaMessage ||
                "Lovable needs to apply the Plan Room migration and refresh the Supabase schema cache before uploads and takeoff saves are available."}
            </p>
          </section>
        )}

        <aside className="min-w-0 space-y-4">
          <section className="rounded-lg border border-hairline bg-card shadow-card">
            <div className="border-b border-hairline bg-surface px-4 py-3">
              <h2 className="font-serif text-xl">Drawing Sets</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Open a sheet, set scale, then take off quantities.
              </p>
            </div>
            <div className="max-h-[680px] space-y-2 overflow-y-auto p-3">
              {sheets.length === 0 ? (
                <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
                  Upload a PDF or image plan set to start measuring this estimate.
                </div>
              ) : (
                planSets.map((planSet) => (
                  <div key={planSet.id} className="rounded-md border border-hairline bg-background">
                    <div className="border-b border-hairline px-3 py-2">
                      <p className="truncate text-sm font-medium">{planSet.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {planSet.page_count} pages
                      </p>
                    </div>
                    <div className="p-1.5">
                      {sheets
                        .filter((sheet) => sheet.plan_set_id === planSet.id)
                        .map((sheet) => (
                          <button
                            key={sheet.id}
                            type="button"
                            onClick={() => {
                              setSelectedSheetId(sheet.id);
                              setPendingPoints([]);
                              setCalibrationPoints([]);
                            }}
                            className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition ${
                              sheet.id === currentSheet?.id
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-surface"
                            }`}
                          >
                            <ImageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                            <span className="min-w-0">
                              <span className="block truncate font-medium">
                                {sheet.sheet_number || `Page ${sheet.page_number}`}
                              </span>
                              <span className="block truncate text-xs opacity-75">
                                {sheet.sheet_name || "Unnamed sheet"}
                              </span>
                            </span>
                          </button>
                        ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="rounded-lg border border-hairline bg-card p-4 shadow-card">
            <div className="flex items-center gap-2 text-sm font-medium">
              <ClipboardList className="h-4 w-4" /> Estimate Rows
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Pick the worksheet row before measuring to push the quantity automatically.
            </p>
            <Select value={selectedLineId} onValueChange={setSelectedLineId}>
              <SelectTrigger className="mt-3" data-testid="plan-room-estimate-row-select">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unlinked">Do not link yet</SelectItem>
                {lineItems.map((line) => (
                  <SelectItem key={line.id} value={line.id}>
                    {line.cost_code ? `${line.cost_code} · ` : ""}
                    {line.description.slice(0, 70)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedLine && (
              <div className="mt-3 rounded-md border border-hairline bg-surface p-3 text-xs">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{selectedLine.description}</p>
                    <p className="mt-1 text-muted-foreground">
                      Current estimate qty: {formatQty(selectedLine.quantity, selectedLine.unit)}
                    </p>
                  </div>
                  <Badge variant="outline">{selectedLine.scope_group || "Row"}</Badge>
                </div>
                <p className="mt-2 text-muted-foreground">
                  Unit cost: {fmtUSD(centsToDollars(selectedLine.material_unit_cost_cents))} mat /{" "}
                  {fmtUSD(centsToDollars(selectedLine.labor_unit_cost_cents))} labor
                </p>
              </div>
            )}
          </section>
        </aside>

        <section className="min-w-0 overflow-hidden rounded-lg border border-hairline bg-card shadow-card">
          <div className="flex flex-col gap-3 border-b border-hairline bg-surface px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <h2 className="font-serif text-2xl leading-tight">
                {currentSheet
                  ? `${currentSheet.sheet_number} ${currentSheet.sheet_name}`.trim()
                  : "No sheet selected"}
              </h2>
              <p className="text-xs text-muted-foreground">
                {currentSheet?.scale_feet_per_pixel
                  ? `Scale set: ${currentSheet.scale_label || `${currentSheet.scale_feet_per_pixel.toFixed(4)} ft/px`}`
                  : "Set scale before linear or area takeoff."}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {[
                { value: "select", icon: MousePointer2 },
                { value: "calibrate", icon: Ruler },
                { value: "linear", icon: PencilRuler },
                { value: "area", icon: Square },
                { value: "count", icon: Plus },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <Button
                    key={item.value}
                    type="button"
                    size="sm"
                    variant={tool === item.value ? "default" : "outline"}
                    className="gap-1.5"
                    data-testid={`takeoff-tool-${item.value}`}
                    disabled={!backendReady}
                    onClick={() => {
                      setTool(item.value as ToolMode);
                      setPendingPoints([]);
                      if (item.value !== "calibrate") setCalibrationPoints([]);
                    }}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {toolLabel(item.value as ToolMode)}
                  </Button>
                );
              })}
              {tool === "area" && (
                <Button size="sm" className="gap-1.5" onClick={finishArea} disabled={!backendReady}>
                  <Check className="h-3.5 w-3.5" /> Finish Area
                </Button>
              )}
            </div>
          </div>

          <PlanCanvas
            planSet={currentPlanSet}
            sheet={currentSheet}
            measurements={sheetMeasurements}
            pendingPoints={pendingPoints}
            calibrationPoints={calibrationPoints}
            tool={tool}
            viewSize={viewSize}
            onViewSizeChange={setViewSize}
            onPoint={onCanvasPoint}
          />
        </section>

        <aside className="min-w-0 space-y-4">
          <section className="rounded-lg border border-hairline bg-card p-4 shadow-card">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl">Takeoff Setup</h2>
                <p className="text-xs text-muted-foreground">
                  Label each measurement so the source is obvious later.
                </p>
              </div>
              <Target className="h-4 w-4 text-muted-foreground" />
            </div>
            <div className="mt-4 space-y-3">
              <div className="space-y-1.5">
                <Label>Takeoff label</Label>
                <Input
                  value={measurementLabel}
                  onChange={(event) => setMeasurementLabel(event.target.value)}
                  placeholder="e.g. Slab-on-grade area"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Markup color</Label>
                <div className="flex gap-2">
                  {TAKEOFF_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      title={color}
                      onClick={() => setTakeoffColor(color)}
                      className={`h-8 w-8 rounded border ${
                        takeoffColor === color ? "border-foreground" : "border-hairline"
                      }`}
                      style={{ backgroundColor: color }}
                    />
                  ))}
                </div>
              </div>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label>Set drawing scale</Label>
                  {currentSheet?.scale_feet_per_pixel ? (
                    <Badge variant="secondary">Ready</Badge>
                  ) : (
                    <Badge variant="outline">Needed</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Click two points on a known distance, type the real distance, then save.
                </p>
                <div className="grid grid-cols-[1fr_auto] gap-2">
                  <Input
                    type="number"
                    min={0}
                    value={calibrationFeet}
                    onChange={(event) => setCalibrationFeet(event.target.value)}
                    aria-label="Known distance in feet"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-1.5"
                    onClick={saveScale}
                    disabled={!backendReady || updateSheetMutation.isPending}
                  >
                    <Save className="h-3.5 w-3.5" /> Save
                  </Button>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-hairline bg-card shadow-card">
            <div className="border-b border-hairline bg-surface px-4 py-3">
              <h2 className="font-serif text-xl">Takeoff Worksheet</h2>
              <p className="text-xs text-muted-foreground">
                {measurements.length} takeoffs. Total measured quantity:{" "}
                {new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
                  totalMeasured,
                )}
              </p>
            </div>
            <div className="max-h-[520px] space-y-3 overflow-y-auto p-3">
              {measurements.length === 0 ? (
                <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
                  No takeoffs yet. Choose a tool, click the plan, and link the result to an estimate
                  row.
                </div>
              ) : (
                measurements.map((measurement) => {
                  const linkedLine = lineItems.find(
                    (line) => line.id === measurement.estimate_line_item_id,
                  );
                  return (
                    <div key={measurement.id} className="rounded-md border border-hairline p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: measurement.color }}
                            />
                            <p className="truncate text-sm font-medium">{measurement.label}</p>
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {toolLabel(measurement.tool_type)} ·{" "}
                            {formatQty(measurement.quantity, measurement.unit)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Delete takeoff"
                          onClick={() => deleteMeasurementMutation.mutate(measurement.id)}
                        >
                          <Trash2 className="h-4 w-4 text-danger" />
                        </Button>
                      </div>
                      <div className="mt-3 space-y-2">
                        <Select
                          value={measurement.estimate_line_item_id ?? "unlinked"}
                          onValueChange={(lineId) =>
                            updateMeasurementMutation.mutate({
                              id: measurement.id,
                              patch: {
                                estimate_line_item_id: lineId === "unlinked" ? null : lineId,
                              },
                            })
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="unlinked">Not linked to estimate</SelectItem>
                            {lineItems.map((line) => (
                              <SelectItem key={line.id} value={line.id}>
                                {line.cost_code ? `${line.cost_code} · ` : ""}
                                {line.description.slice(0, 70)}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {linkedLine ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="w-full gap-1.5"
                            onClick={() => syncLineMutation.mutate(linkedLine.id)}
                          >
                            <Link2 className="h-3.5 w-3.5" />
                            Send Total Qty to Estimate
                          </Button>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            Link this takeoff to an estimate row before sending quantity.
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </section>

          <section className="rounded-lg border border-hairline bg-card p-4 shadow-card">
            <h2 className="font-serif text-xl">Estimate Sync</h2>
            <div className="mt-3 space-y-2">
              {lineItems
                .filter((line) => lineTotals.has(line.id))
                .slice(0, 8)
                .map((line) => {
                  const total = lineTotals.get(line.id);
                  return (
                    <div
                      key={line.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-surface px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <p className="truncate font-medium">{line.description}</p>
                        <p className="text-muted-foreground">
                          {total?.count ?? 0} takeoffs ·{" "}
                          {formatQty(total?.quantity ?? 0, line.unit)}
                        </p>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => syncLineMutation.mutate(line.id)}
                      >
                        Sync
                      </Button>
                    </div>
                  );
                })}
              {lineTotals.size === 0 && (
                <p className="text-sm text-muted-foreground">
                  Linked takeoffs will show here so you can confirm the rows feeding the estimate.
                </p>
              )}
            </div>
          </section>
        </aside>
      </main>
    </div>
  );
}

function PlanCanvas({
  planSet,
  sheet,
  measurements,
  pendingPoints,
  calibrationPoints,
  tool,
  viewSize,
  onViewSizeChange,
  onPoint,
}: {
  planSet: PlanSetRow | null;
  sheet: PlanSheetRow | null;
  measurements: TakeoffMeasurementRow[];
  pendingPoints: Point[];
  calibrationPoints: Point[];
  tool: ToolMode;
  viewSize: ViewSize;
  onViewSizeChange: (size: ViewSize) => void;
  onPoint: (point: Point) => void;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [signedUrl, setSignedUrl] = useState("");
  const [renderError, setRenderError] = useState("");

  useEffect(() => {
    let active = true;
    setSignedUrl("");
    setRenderError("");
    if (!planSet?.file_path) return;
    supabase.storage
      .from(planRoomBucket)
      .createSignedUrl(planSet.file_path, 60 * 30)
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setRenderError(error.message);
        else setSignedUrl(data?.signedUrl ?? "");
      });
    return () => {
      active = false;
    };
  }, [planSet?.file_path]);

  useEffect(() => {
    let cancelled = false;
    const renderPdf = async () => {
      if (!signedUrl || planSet?.file_mime_type !== "application/pdf" || !canvasRef.current) return;
      try {
        const pdfjs = await import("pdfjs-dist");
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        (
          pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }
        ).GlobalWorkerOptions.workerSrc = workerUrl;
        const pdf = await pdfjs.getDocument({ url: signedUrl }).promise;
        const page = await pdf.getPage(sheet?.page_number ?? 1);
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(1100 / viewport.width, 720 / viewport.height);
        const scaled = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.round(scaled.width);
        canvas.height = Math.round(scaled.height);
        onViewSizeChange({ width: canvas.width, height: canvas.height });
        await page.render({
          canvas,
          canvasContext: canvas.getContext("2d")!,
          viewport: scaled,
        }).promise;
      } catch (error) {
        if (!cancelled) {
          setRenderError(error instanceof Error ? error.message : "PDF page did not render.");
        }
      }
    };
    renderPdf();
    return () => {
      cancelled = true;
    };
  }, [onViewSizeChange, planSet?.file_mime_type, sheet?.page_number, signedUrl]);

  const pointFromEvent = (event: ReactMouseEvent<SVGSVGElement>): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const handleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    const point = pointFromEvent(event);
    if (point) onPoint(point);
  };

  const viewBox = `0 0 ${viewSize.width} ${viewSize.height}`;

  return (
    <div className="bg-background p-4">
      <div className="relative mx-auto max-w-full overflow-auto rounded-md border border-hairline bg-white shadow-inner">
        <div
          className="relative mx-auto"
          style={{
            width: `${viewSize.width}px`,
            maxWidth: "100%",
            aspectRatio: `${viewSize.width} / ${viewSize.height}`,
          }}
        >
          {planSet?.sample_key === "harbor-residence" || !planSet?.file_path ? (
            <SamplePlanBackground sheet={sheet} viewSize={viewSize} />
          ) : planSet.file_mime_type === "application/pdf" ? (
            <canvas ref={canvasRef} className="absolute inset-0 h-full w-full bg-white" />
          ) : signedUrl ? (
            <img
              ref={imageRef}
              src={signedUrl}
              alt={sheet?.sheet_name || "Plan sheet"}
              className="absolute inset-0 h-full w-full object-contain"
              onLoad={() => {
                const img = imageRef.current;
                if (!img) return;
                const ratio = img.naturalWidth / Math.max(1, img.naturalHeight);
                const width = 960;
                onViewSizeChange({ width, height: Math.round(width / ratio) });
              }}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center bg-surface text-sm text-muted-foreground">
              Loading drawing...
            </div>
          )}

          {renderError && (
            <div className="absolute inset-x-8 top-8 z-10 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
              {renderError}
            </div>
          )}

          <svg
            ref={svgRef}
            viewBox={viewBox}
            className={`absolute inset-0 h-full w-full ${
              tool === "select" ? "cursor-default" : "cursor-crosshair"
            }`}
            data-testid="plan-canvas"
            onClick={handleClick}
          >
            <rect x="0" y="0" width={viewSize.width} height={viewSize.height} fill="transparent" />
            {measurements.map((measurement) => (
              <MeasurementShape
                key={measurement.id}
                measurement={measurement}
                viewSize={viewSize}
              />
            ))}
            <DraftShape
              points={pendingPoints}
              viewSize={viewSize}
              color="#1b7a6e"
              dashed
              closed={tool === "area"}
            />
            <DraftShape
              points={calibrationPoints}
              viewSize={viewSize}
              color="#111827"
              dashed
              closed={false}
            />
          </svg>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>
          {tool === "calibrate"
            ? "Set Scale: click two points on a known distance."
            : tool === "area"
              ? "Area: click each corner, then Finish Area."
              : tool === "linear"
                ? "Linear: click start and end."
                : tool === "count"
                  ? "Count: click each item."
                  : "Select a tool to start measuring."}
        </span>
        <span>
          View {Math.round(viewSize.width)} x {Math.round(viewSize.height)}
        </span>
      </div>
    </div>
  );
}

function SamplePlanBackground({
  sheet,
  viewSize,
}: {
  sheet: PlanSheetRow | null;
  viewSize: ViewSize;
}) {
  const title = `${sheet?.sheet_number || "A1.1"} ${sheet?.sheet_name || "Sample Plan"}`.trim();
  return (
    <svg
      viewBox={`0 0 ${viewSize.width} ${viewSize.height}`}
      className="absolute inset-0 h-full w-full bg-white"
    >
      <defs>
        <pattern id="plan-grid" width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#e8e2d7" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width={viewSize.width} height={viewSize.height} fill="#fffefa" />
      <rect width={viewSize.width} height={viewSize.height} fill="url(#plan-grid)" />
      <rect
        x={viewSize.width * 0.14}
        y={viewSize.height * 0.18}
        width={viewSize.width * 0.7}
        height={viewSize.height * 0.58}
        fill="none"
        stroke="#28231d"
        strokeWidth="3"
      />
      <rect
        x={viewSize.width * 0.2}
        y={viewSize.height * 0.3}
        width={viewSize.width * 0.56}
        height={viewSize.height * 0.34}
        fill="none"
        stroke="#28231d"
        strokeWidth="2"
      />
      <line
        x1={viewSize.width * 0.48}
        y1={viewSize.height * 0.18}
        x2={viewSize.width * 0.48}
        y2={viewSize.height * 0.76}
        stroke="#928779"
        strokeDasharray="8 8"
        strokeWidth="1.5"
      />
      <line
        x1={viewSize.width * 0.14}
        y1={viewSize.height * 0.47}
        x2={viewSize.width * 0.84}
        y2={viewSize.height * 0.47}
        stroke="#928779"
        strokeDasharray="8 8"
        strokeWidth="1.5"
      />
      <text
        x="32"
        y="42"
        fill="#28231d"
        fontFamily="Inter, sans-serif"
        fontSize="18"
        fontWeight="700"
      >
        {title}
      </text>
      <text x="32" y="66" fill="#7d7469" fontFamily="Inter, sans-serif" fontSize="12">
        Sample drawing for Plan Room takeoff training
      </text>
      <rect
        x={viewSize.width - 260}
        y={viewSize.height - 92}
        width="220"
        height="58"
        fill="none"
        stroke="#28231d"
      />
      <text
        x={viewSize.width - 244}
        y={viewSize.height - 62}
        fill="#28231d"
        fontFamily="Inter, sans-serif"
        fontSize="12"
        fontWeight="700"
      >
        HARBOR RESIDENCE
      </text>
      <text
        x={viewSize.width - 244}
        y={viewSize.height - 42}
        fill="#7d7469"
        fontFamily="Inter, sans-serif"
        fontSize="11"
      >
        Overwatch sample plan sheet
      </text>
    </svg>
  );
}

function MeasurementShape({
  measurement,
  viewSize,
}: {
  measurement: TakeoffMeasurementRow;
  viewSize: ViewSize;
}) {
  const points = geometryPoints(measurement.geometry);
  if (points.length === 0) return null;
  const scaled = points.map((point) => ({
    x: point.x * viewSize.width,
    y: point.y * viewSize.height,
  }));
  const labelPoint = scaled[0];

  if (measurement.tool_type === "area" && scaled.length >= 3) {
    return (
      <g>
        <polygon
          points={scaled.map((point) => `${point.x},${point.y}`).join(" ")}
          fill={`${measurement.color}22`}
          stroke={measurement.color}
          strokeWidth="3"
        />
        <MeasurementLabel
          x={labelPoint.x}
          y={labelPoint.y}
          color={measurement.color}
          text={formatQty(measurement.quantity, measurement.unit)}
        />
      </g>
    );
  }

  if (measurement.tool_type === "count") {
    return (
      <g>
        {scaled.map((point, index) => (
          <g key={`${point.x}-${point.y}-${index}`}>
            <circle cx={point.x} cy={point.y} r="11" fill={measurement.color} />
            <text
              x={point.x}
              y={point.y + 4}
              textAnchor="middle"
              fill="white"
              fontSize="11"
              fontWeight="700"
            >
              {index + 1}
            </text>
          </g>
        ))}
        <MeasurementLabel
          x={labelPoint.x + 14}
          y={labelPoint.y - 14}
          color={measurement.color}
          text={formatQty(measurement.quantity, measurement.unit)}
        />
      </g>
    );
  }

  return (
    <g>
      <polyline
        points={scaled.map((point) => `${point.x},${point.y}`).join(" ")}
        fill="none"
        stroke={measurement.color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {scaled.map((point, index) => (
        <circle key={index} cx={point.x} cy={point.y} r="5" fill={measurement.color} />
      ))}
      <MeasurementLabel
        x={labelPoint.x + 10}
        y={labelPoint.y - 10}
        color={measurement.color}
        text={formatQty(measurement.quantity, measurement.unit)}
      />
    </g>
  );
}

function DraftShape({
  points,
  viewSize,
  color,
  dashed,
  closed,
}: {
  points: Point[];
  viewSize: ViewSize;
  color: string;
  dashed?: boolean;
  closed?: boolean;
}) {
  if (points.length === 0) return null;
  const scaled = points.map((point) => ({
    x: point.x * viewSize.width,
    y: point.y * viewSize.height,
  }));
  const pointText = scaled.map((point) => `${point.x},${point.y}`).join(" ");
  return (
    <g>
      {closed && scaled.length >= 3 ? (
        <polygon
          points={pointText}
          fill={`${color}14`}
          stroke={color}
          strokeWidth="3"
          strokeDasharray={dashed ? "8 8" : undefined}
        />
      ) : (
        <polyline
          points={pointText}
          fill="none"
          stroke={color}
          strokeWidth="3"
          strokeDasharray={dashed ? "8 8" : undefined}
          strokeLinecap="round"
        />
      )}
      {scaled.map((point, index) => (
        <circle key={index} cx={point.x} cy={point.y} r="5" fill={color} />
      ))}
    </g>
  );
}

function MeasurementLabel({
  x,
  y,
  color,
  text,
}: {
  x: number;
  y: number;
  color: string;
  text: string;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y - 18}
        width={Math.max(76, text.length * 7)}
        height="22"
        rx="4"
        fill="white"
      />
      <rect
        x={x}
        y={y - 18}
        width={Math.max(76, text.length * 7)}
        height="22"
        rx="4"
        fill={`${color}18`}
        stroke={color}
      />
      <text x={x + 8} y={y - 3} fill="#28231d" fontSize="11" fontWeight="700">
        {text}
      </text>
    </g>
  );
}
