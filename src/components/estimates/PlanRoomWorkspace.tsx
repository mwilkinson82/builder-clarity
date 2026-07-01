import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import type {
  ChangeEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  ClipboardList,
  FileUp,
  Hand,
  Image as ImageIcon,
  Layers,
  Link2,
  Maximize2,
  Minimize2,
  MousePointer2,
  PencilRuler,
  Plus,
  Ruler,
  Save,
  Square,
  Target,
  Trash2,
  Undo2,
  XCircle,
  ZoomIn,
  ZoomOut,
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
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { fmtUSD } from "@/lib/format";
import { cn } from "@/lib/utils";
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
type RevisionOverlayMode = "compare" | "ghost";
type Point = PlanRoomPoint;
type ViewSize = PlanRoomViewSize;
type ZoomWindowDraft = { start: Point; end: Point };

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
const QUICK_CALIBRATION_FEET = [10, 20, 25, 50, 100];
const MIN_PLAN_ZOOM = 0.25;
const MAX_PLAN_ZOOM = 4;
const PLAN_ZOOM_STEP = 0.25;
const ZOOM_SLIDER_MIN = MIN_PLAN_ZOOM * 100;
const ZOOM_SLIDER_MAX = MAX_PLAN_ZOOM * 100;
const PDF_BASE_LONG_EDGE = 1800;
const PDF_RENDER_MAX_EDGE = 8192;
const PDF_RENDER_MAX_PIXELS = 24_000_000;

type PdfViewportLike = { width: number; height: number };

const planSetStatusLabel = (status: PlanSetRow["status"]) => {
  if (status === "superseded") return "Superseded";
  if (status === "archive") return "Archived";
  return "Current";
};

const sheetDisplayName = (sheet: PlanSheetRow, planSet?: PlanSetRow | null) => {
  const sheetName =
    `${sheet.sheet_number || `Page ${sheet.page_number}`} ${sheet.sheet_name}`.trim();
  return planSet ? `${sheetName} - ${planSet.name}` : sheetName;
};

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

const isDirectPlanFileUrl = (filePath: string) =>
  /^(https?:|blob:|data:)/i.test(filePath) || filePath.startsWith("/");

const directPlanFileUrl = (filePath: string) => {
  if (!filePath.startsWith("/")) return filePath;
  if (typeof window === "undefined") return filePath;
  return `${window.location.origin}${filePath}`;
};

const devicePixelRatioForPdf = () => {
  if (typeof window === "undefined") return 1;
  return Math.min(2, Math.max(1, window.devicePixelRatio || 1));
};

const pdfCssScaleFor = (viewport: PdfViewportLike) => {
  const longEdge = Math.max(viewport.width, viewport.height);
  if (!Number.isFinite(longEdge) || longEdge <= 0) return 1;
  return Math.min(3, Math.max(0.2, PDF_BASE_LONG_EDGE / longEdge));
};

const pdfRenderScaleFor = (viewport: PdfViewportLike, cssScale: number, zoom: number) => {
  const pagePixels = Math.max(1, viewport.width * viewport.height);
  const longEdge = Math.max(1, viewport.width, viewport.height);
  const desiredScale = cssScale * Math.max(1, zoom) * devicePixelRatioForPdf();
  const maxPixelScale = Math.sqrt(PDF_RENDER_MAX_PIXELS / pagePixels);
  const maxEdgeScale = PDF_RENDER_MAX_EDGE / longEdge;
  return Math.max(0.2, Math.min(desiredScale, maxPixelScale, maxEdgeScale));
};

const isPdfRenderCancelled = (error: unknown) =>
  error instanceof Error && error.name === "RenderingCancelledException";

const dataUrlToArrayBuffer = (url: string) => {
  const commaIndex = url.indexOf(",");
  if (commaIndex < 0) throw new Error("Invalid PDF data URL.");
  const meta = url.slice(0, commaIndex);
  const payload = url.slice(commaIndex + 1);
  const binary =
    meta.includes(";base64") && typeof atob !== "undefined"
      ? atob(payload)
      : decodeURIComponent(payload);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
};

const pdfDocumentSourceFor = async (url: string) => {
  if (!url.startsWith("data:")) return { url };
  return { data: dataUrlToArrayBuffer(url) };
};

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
  const [isCockpitMode, setIsCockpitMode] = useState(false);
  const [overlaySheetId, setOverlaySheetId] = useState("");
  const [overlayOpacity, setOverlayOpacity] = useState(65);
  const [overlayMode, setOverlayMode] = useState<RevisionOverlayMode>("compare");
  const [selectedMeasurementId, setSelectedMeasurementId] = useState("");
  const [selectedMeasurementDraft, setSelectedMeasurementDraft] = useState({
    label: "",
    notes: "",
  });

  const currentSheet = useMemo(
    () => sheets.find((sheet) => sheet.id === selectedSheetId) ?? sheets[0] ?? null,
    [selectedSheetId, sheets],
  );
  const currentPlanSet = currentSheet
    ? (planSets.find((planSet) => planSet.id === currentSheet.plan_set_id) ?? null)
    : null;
  const overlaySheet = overlaySheetId
    ? (sheets.find((sheet) => sheet.id === overlaySheetId) ?? null)
    : null;
  const overlayPlanSet = overlaySheet
    ? (planSets.find((planSet) => planSet.id === overlaySheet.plan_set_id) ?? null)
    : null;
  const revisionSheetOptions = useMemo(
    () =>
      sheets
        .filter((sheet) => sheet.id !== currentSheet?.id)
        .map((sheet) => ({
          sheet,
          planSet: planSets.find((planSet) => planSet.id === sheet.plan_set_id) ?? null,
        }))
        .sort((a, b) => {
          const sameA = a.sheet.sheet_number === currentSheet?.sheet_number ? 0 : 1;
          const sameB = b.sheet.sheet_number === currentSheet?.sheet_number ? 0 : 1;
          if (sameA !== sameB) return sameA - sameB;
          return sheetDisplayName(a.sheet, a.planSet).localeCompare(
            sheetDisplayName(b.sheet, b.planSet),
          );
        }),
    [currentSheet?.id, currentSheet?.sheet_number, planSets, sheets],
  );
  const selectedLine = lineItems.find((line) => line.id === selectedLineId);
  const sheetMeasurements = measurements.filter(
    (measurement) => measurement.plan_sheet_id === currentSheet?.id,
  );
  const selectedMeasurement =
    measurements.find((measurement) => measurement.id === selectedMeasurementId) ?? null;
  const selectedMeasurementSheet = selectedMeasurement
    ? (sheets.find((sheet) => sheet.id === selectedMeasurement.plan_sheet_id) ?? null)
    : null;
  const selectedMeasurementLine = selectedMeasurement?.estimate_line_item_id
    ? (lineItems.find((line) => line.id === selectedMeasurement.estimate_line_item_id) ?? null)
    : null;
  const selectedMeasurementLabel = selectedMeasurement?.label ?? "";
  const selectedMeasurementNotes = selectedMeasurement?.notes ?? "";
  const activeDraftPointCount =
    tool === "calibrate" ? calibrationPoints.length : pendingPoints.length;

  useEffect(() => {
    if (!selectedSheetId && sheets[0]) setSelectedSheetId(sheets[0].id);
  }, [selectedSheetId, sheets]);

  useEffect(() => {
    if (!overlaySheetId) return;
    if (
      overlaySheetId === currentSheet?.id ||
      !sheets.some((sheet) => sheet.id === overlaySheetId)
    ) {
      setOverlaySheetId("");
    }
  }, [currentSheet?.id, overlaySheetId, sheets]);

  useEffect(() => {
    if (selectedLine && !measurementLabel.trim()) {
      setMeasurementLabel(selectedLine.description);
    }
  }, [measurementLabel, selectedLine]);

  useEffect(() => {
    if (selectedMeasurementId && !measurements.some((item) => item.id === selectedMeasurementId)) {
      setSelectedMeasurementId("");
    }
  }, [measurements, selectedMeasurementId]);

  useEffect(() => {
    if (!selectedMeasurementId) {
      setSelectedMeasurementDraft({ label: "", notes: "" });
      return;
    }
    setSelectedMeasurementDraft({
      label: selectedMeasurementLabel,
      notes: selectedMeasurementNotes,
    });
  }, [selectedMeasurementId, selectedMeasurementLabel, selectedMeasurementNotes]);

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
    onSuccess: (result, variables) => {
      toast.success(selectedLine ? "Takeoff saved and estimate row updated" : "Takeoff saved");
      setPendingPoints([]);
      setSelectedMeasurementId(result.measurement.id);
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
    onSuccess: (_result, id) => {
      toast.success("Takeoff deleted");
      if (selectedMeasurementId === id) setSelectedMeasurementId("");
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

  const selectMeasurement = (measurement: TakeoffMeasurementRow) => {
    setSelectedMeasurementId(measurement.id);
    setTool("select");
    setPendingPoints([]);
    setCalibrationPoints([]);
    if (measurement.plan_sheet_id !== currentSheet?.id) {
      setSelectedSheetId(measurement.plan_sheet_id);
    }
  };

  const undoDraftPoint = () => {
    if (tool === "calibrate") {
      setCalibrationPoints((current) => current.slice(0, -1));
      return;
    }
    setPendingPoints((current) => current.slice(0, -1));
  };

  const clearDraftPoints = () => {
    if (tool === "calibrate") {
      setCalibrationPoints([]);
      return;
    }
    setPendingPoints([]);
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

  const saveSelectedMeasurement = () => {
    if (!selectedMeasurement) return;
    const label = selectedMeasurementDraft.label.trim();
    if (!label) {
      toast.warning("Give this takeoff a label before saving.");
      return;
    }
    updateMeasurementMutation.mutate({
      id: selectedMeasurement.id,
      patch: {
        label,
        notes: selectedMeasurementDraft.notes.trim(),
      },
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
    <div
      className={cn(
        "min-h-screen bg-background",
        isCockpitMode && "fixed inset-0 z-50 overflow-hidden",
      )}
      data-testid="plan-room-workspace"
    >
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
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setIsCockpitMode((current) => !current)}
                title={isCockpitMode ? "Exit command center" : "Open command center"}
              >
                {isCockpitMode ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
                {isCockpitMode ? "Exit" : "Command Center"}
              </Button>
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

      <main
        className={cn(
          "mx-auto grid max-w-[1800px] gap-5 px-5 py-6 xl:grid-cols-[220px_minmax(0,1fr)_300px] 2xl:grid-cols-[280px_minmax(0,1fr)_390px] lg:px-8",
          isCockpitMode &&
            "h-[calc(100vh-110px)] max-w-none overflow-hidden py-4 xl:grid-cols-[260px_minmax(0,1fr)_340px] 2xl:grid-cols-[300px_minmax(0,1fr)_380px]",
        )}
      >
        {!backendReady && (
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 xl:col-span-3">
            <p className="font-medium">Plan Room backend is still coming online</p>
            <p className="mt-1 text-amber-900">
              {schemaMessage ||
                "Lovable needs to apply the Plan Room migration and refresh the Supabase schema cache before uploads and takeoff saves are available."}
            </p>
          </section>
        )}

        <aside className={cn("min-w-0 space-y-4", isCockpitMode && "min-h-0 overflow-y-auto")}>
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
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{planSet.name}</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">
                            {planSet.page_count} pages
                          </p>
                        </div>
                        <Badge
                          variant={planSet.status === "current" ? "secondary" : "outline"}
                          className="shrink-0"
                        >
                          {planSetStatusLabel(planSet.status)}
                        </Badge>
                      </div>
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
                              if (selectedMeasurement?.plan_sheet_id !== sheet.id) {
                                setSelectedMeasurementId("");
                              }
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
              <Layers className="h-4 w-4" /> Revision Overlay
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Compare another sheet over the current drawing before you trust or update quantities.
            </p>
            <div className="mt-3 space-y-3">
              <Select
                value={overlaySheetId || "none"}
                onValueChange={(value) => setOverlaySheetId(value === "none" ? "" : value)}
              >
                <SelectTrigger data-testid="plan-revision-overlay-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No overlay</SelectItem>
                  {revisionSheetOptions.map(({ sheet, planSet }) => (
                    <SelectItem key={sheet.id} value={sheet.id}>
                      {sheetDisplayName(sheet, planSet).slice(0, 90)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {overlaySheet && overlayPlanSet ? (
                <div className="rounded-md border border-hairline bg-surface p-3 text-xs">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-foreground">
                        {sheetDisplayName(overlaySheet, overlayPlanSet)}
                      </p>
                      <p className="mt-1 text-muted-foreground">
                        Showing at {overlayOpacity}% opacity.
                      </p>
                    </div>
                    <Badge variant="outline">{planSetStatusLabel(overlayPlanSet.status)}</Badge>
                  </div>
                </div>
              ) : (
                <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-3 text-xs text-muted-foreground">
                  Upload a revision set, then choose the matching sheet here to compare changes.
                </div>
              )}

              <div className="grid grid-cols-2 gap-2" data-testid="plan-revision-mode-controls">
                <Button
                  type="button"
                  size="sm"
                  variant={overlayMode === "compare" ? "default" : "outline"}
                  onClick={() => setOverlayMode("compare")}
                  disabled={!overlaySheet}
                >
                  Compare
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={overlayMode === "ghost" ? "default" : "outline"}
                  onClick={() => setOverlayMode("ghost")}
                  disabled={!overlaySheet}
                >
                  Ghost
                </Button>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs">Overlay opacity</Label>
                  <span className="text-xs text-muted-foreground">{overlayOpacity}%</span>
                </div>
                <Slider
                  min={20}
                  max={90}
                  step={5}
                  value={[overlayOpacity]}
                  onValueChange={(value) => setOverlayOpacity(value[0] ?? 65)}
                  disabled={!overlaySheet}
                  data-testid="plan-revision-opacity"
                />
              </div>
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

        <section
          className={cn(
            "min-w-0 overflow-hidden rounded-lg border border-hairline bg-card shadow-card",
            isCockpitMode && "flex min-h-0 flex-col",
          )}
        >
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
              {activeDraftPointCount > 0 && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={undoDraftPoint}
                    data-testid="takeoff-undo-point"
                  >
                    <Undo2 className="h-3.5 w-3.5" /> Undo Point
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="gap-1.5"
                    onClick={clearDraftPoints}
                    data-testid="takeoff-clear-points"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Clear Points
                  </Button>
                </>
              )}
            </div>
          </div>

          <PlanCanvas
            planSet={currentPlanSet}
            sheet={currentSheet}
            overlayPlanSet={overlayPlanSet}
            overlaySheet={overlaySheet}
            overlayOpacity={overlayOpacity}
            overlayMode={overlayMode}
            measurements={sheetMeasurements}
            pendingPoints={pendingPoints}
            calibrationPoints={calibrationPoints}
            tool={tool}
            viewSize={viewSize}
            onViewSizeChange={setViewSize}
            onPoint={onCanvasPoint}
            isCockpitMode={isCockpitMode}
            selectedMeasurementId={selectedMeasurementId}
            onMeasurementSelect={(measurementId) => {
              const measurement = measurements.find((item) => item.id === measurementId);
              if (measurement) selectMeasurement(measurement);
            }}
          />
        </section>

        <aside className={cn("min-w-0 space-y-4", isCockpitMode && "min-h-0 overflow-y-auto")}>
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
                  Click both ends of a known dimension on the drawing. Type that real field distance
                  in feet, then save the sheet scale.
                </p>
                <div className="grid grid-cols-5 gap-1" data-testid="calibration-distance-presets">
                  {QUICK_CALIBRATION_FEET.map((feet) => (
                    <Button
                      key={feet}
                      type="button"
                      size="sm"
                      variant={calibrationFeet === String(feet) ? "default" : "outline"}
                      className="h-8 px-1 text-xs"
                      onClick={() => setCalibrationFeet(String(feet))}
                      data-testid={`calibration-distance-${feet}`}
                    >
                      {feet}'
                    </Button>
                  ))}
                </div>
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
                <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-muted-foreground">
                  {tool === "calibrate" ? (
                    <span>{calibrationPoints.length}/2 calibration points selected.</span>
                  ) : currentSheet?.scale_feet_per_pixel ? (
                    <span>
                      Scale locked at {currentSheet.scale_feet_per_pixel.toFixed(4)} feet per
                      drawing pixel.
                    </span>
                  ) : (
                    <span>Scale is needed before linear or area quantities can calculate.</span>
                  )}
                </div>
              </div>
            </div>
          </section>

          <section
            className="rounded-lg border border-hairline bg-card p-4 shadow-card"
            data-testid="selected-takeoff-inspector"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl">Selected Takeoff</h2>
                <p className="text-xs text-muted-foreground">
                  Click a markup or worksheet item to inspect and clean up its source.
                </p>
              </div>
              {selectedMeasurement && (
                <Badge variant="secondary">
                  {toolLabel(selectedMeasurement.tool_type)} ·{" "}
                  {formatQty(selectedMeasurement.quantity, selectedMeasurement.unit)}
                </Badge>
              )}
            </div>
            {selectedMeasurement ? (
              <div className="mt-4 space-y-3">
                <div className="rounded-md border border-hairline bg-surface p-3 text-xs text-muted-foreground">
                  <p className="font-medium text-foreground">
                    {selectedMeasurementSheet
                      ? `${selectedMeasurementSheet.sheet_number} ${selectedMeasurementSheet.sheet_name}`.trim()
                      : "Unknown sheet"}
                  </p>
                  <p className="mt-1">
                    Estimate row: {selectedMeasurementLine?.description || "Not linked yet"}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Takeoff label</Label>
                  <Input
                    value={selectedMeasurementDraft.label}
                    onChange={(event) =>
                      setSelectedMeasurementDraft((draft) => ({
                        ...draft,
                        label: event.target.value,
                      }))
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Notes</Label>
                  <Textarea
                    rows={3}
                    value={selectedMeasurementDraft.notes}
                    onChange={(event) =>
                      setSelectedMeasurementDraft((draft) => ({
                        ...draft,
                        notes: event.target.value,
                      }))
                    }
                    placeholder="Add assumptions, sheet notes, or scope clarifications."
                  />
                </div>
                <div className="space-y-2">
                  <Select
                    value={selectedMeasurement.estimate_line_item_id ?? "unlinked"}
                    onValueChange={(lineId) =>
                      updateMeasurementMutation.mutate({
                        id: selectedMeasurement.id,
                        patch: {
                          estimate_line_item_id: lineId === "unlinked" ? null : lineId,
                        },
                      })
                    }
                  >
                    <SelectTrigger data-testid="selected-takeoff-row-link">
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
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-1.5"
                      onClick={saveSelectedMeasurement}
                      disabled={updateMeasurementMutation.isPending}
                    >
                      <Save className="h-3.5 w-3.5" /> Save Details
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => deleteMeasurementMutation.mutate(selectedMeasurement.id)}
                      disabled={deleteMeasurementMutation.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5 text-danger" /> Delete
                    </Button>
                  </div>
                  {selectedMeasurementLine ? (
                    <Button
                      size="sm"
                      className="w-full gap-1.5"
                      onClick={() => syncLineMutation.mutate(selectedMeasurementLine.id)}
                    >
                      <Link2 className="h-3.5 w-3.5" />
                      Send This Takeoff Total to Estimate
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Link this takeoff to an estimate row before sending quantity.
                    </p>
                  )}
                </div>
              </div>
            ) : (
              <div className="mt-4 rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
                No takeoff selected. Use Select, then click a markup on the plan or a worksheet
                item.
              </div>
            )}
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
                  const measurementSheet = sheets.find(
                    (sheet) => sheet.id === measurement.plan_sheet_id,
                  );
                  const isSelected = measurement.id === selectedMeasurementId;
                  return (
                    <div
                      key={measurement.id}
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "rounded-md border border-hairline p-3 text-left transition",
                        isSelected && "border-primary bg-primary/5 shadow-sm",
                      )}
                      onClick={(event) => {
                        const target = event.target as HTMLElement;
                        if (target.closest("button,[role='combobox'],input,textarea")) return;
                        selectMeasurement(measurement);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          selectMeasurement(measurement);
                        }
                      }}
                    >
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
                          {measurementSheet && (
                            <p className="mt-1 truncate text-xs text-muted-foreground">
                              Source: {measurementSheet.sheet_number} ·{" "}
                              {measurementSheet.sheet_name}
                            </p>
                          )}
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
  overlayPlanSet,
  overlaySheet,
  overlayOpacity,
  overlayMode,
  measurements,
  pendingPoints,
  calibrationPoints,
  tool,
  viewSize,
  onViewSizeChange,
  onPoint,
  isCockpitMode,
  selectedMeasurementId,
  onMeasurementSelect,
}: {
  planSet: PlanSetRow | null;
  sheet: PlanSheetRow | null;
  overlayPlanSet: PlanSetRow | null;
  overlaySheet: PlanSheetRow | null;
  overlayOpacity: number;
  overlayMode: RevisionOverlayMode;
  measurements: TakeoffMeasurementRow[];
  pendingPoints: Point[];
  calibrationPoints: Point[];
  tool: ToolMode;
  viewSize: ViewSize;
  onViewSizeChange: (size: ViewSize) => void;
  onPoint: (point: Point) => void;
  isCockpitMode: boolean;
  selectedMeasurementId: string;
  onMeasurementSelect: (measurementId: string) => void;
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [signedUrl, setSignedUrl] = useState("");
  const [renderError, setRenderError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [isPanning, setIsPanning] = useState(false);
  const [isZoomWindowMode, setIsZoomWindowMode] = useState(false);
  const [zoomWindowDraft, setZoomWindowDraft] = useState<ZoomWindowDraft | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, left: 0, top: 0, dragged: false });
  const zoomWindowClickBlockRef = useRef(false);
  const hasRevisionOverlay = Boolean(overlayPlanSet && overlaySheet);
  const overlayBlendMode = overlayMode === "compare" ? "multiply" : "normal";

  useEffect(() => {
    let active = true;
    setSignedUrl("");
    setRenderError("");
    if (!planSet?.file_path) return;
    if (isDirectPlanFileUrl(planSet.file_path)) {
      setSignedUrl(directPlanFileUrl(planSet.file_path));
      return;
    }
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
    let renderTask: { promise: Promise<unknown>; cancel: () => void } | null = null;
    const renderPdf = async () => {
      if (!signedUrl || planSet?.file_mime_type !== "application/pdf" || !canvasRef.current) return;
      try {
        const pdfjs = await import("pdfjs-dist");
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        (
          pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }
        ).GlobalWorkerOptions.workerSrc = workerUrl;
        const pdf = await pdfjs.getDocument(await pdfDocumentSourceFor(signedUrl)).promise;
        const page = await pdf.getPage(sheet?.page_number ?? 1);
        const viewport = page.getViewport({ scale: 1 });
        const cssScale = pdfCssScaleFor(viewport);
        const renderScale = pdfRenderScaleFor(viewport, cssScale, zoom);
        const cssViewport = page.getViewport({ scale: cssScale });
        const renderViewport = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.round(renderViewport.width);
        canvas.height = Math.round(renderViewport.height);
        canvas.dataset.pdfRenderScale = renderScale.toFixed(3);
        canvas.dataset.pdfRenderWidth = String(canvas.width);
        canvas.dataset.pdfRenderHeight = String(canvas.height);
        onViewSizeChange({
          width: Math.round(cssViewport.width),
          height: Math.round(cssViewport.height),
        });
        renderTask = page.render({
          canvas,
          canvasContext: canvas.getContext("2d")!,
          viewport: renderViewport,
        });
        await renderTask.promise;
      } catch (error) {
        if (!cancelled && !isPdfRenderCancelled(error)) {
          setRenderError(error instanceof Error ? error.message : "PDF page did not render.");
        }
      }
    };
    renderPdf();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [onViewSizeChange, planSet?.file_mime_type, sheet?.page_number, signedUrl, zoom]);

  useEffect(() => {
    setZoom(1);
    setIsZoomWindowMode(false);
    setZoomWindowDraft(null);
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollLeft = 0;
      scrollRef.current.scrollTop = 0;
    });
  }, [sheet?.id]);

  useEffect(() => {
    setIsZoomWindowMode(false);
    setZoomWindowDraft(null);
  }, [tool]);

  const clampZoom = (nextZoom: number) =>
    Math.min(MAX_PLAN_ZOOM, Math.max(MIN_PLAN_ZOOM, nextZoom));

  const setClampedZoom = (nextZoom: number) => {
    setZoom(clampZoom(nextZoom));
  };

  const zoomBy = (delta: number) => {
    setClampedZoom(Number((zoom + delta).toFixed(2)));
  };

  const setZoomAndScroll = (nextZoom: number, scrollLeft = 0, scrollTop = 0) => {
    const clampedZoom = clampZoom(nextZoom);
    setZoom(clampedZoom);
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollLeft = Math.max(0, scrollLeft);
      scrollRef.current.scrollTop = Math.max(0, scrollTop);
    });
    return clampedZoom;
  };

  const fitToStage = () => {
    const stage = scrollRef.current;
    if (!stage || viewSize.width <= 0 || viewSize.height <= 0) {
      setClampedZoom(1);
      return;
    }
    const fitZoom = Math.min(
      (stage.clientWidth - 32) / viewSize.width,
      (stage.clientHeight - 32) / viewSize.height,
    );
    setZoomAndScroll(Number(Math.min(1, fitZoom).toFixed(2)));
  };

  const fitToWidth = () => {
    const stage = scrollRef.current;
    if (!stage || viewSize.width <= 0) {
      setClampedZoom(1);
      return;
    }
    const fitZoom = (stage.clientWidth - 32) / viewSize.width;
    setZoomAndScroll(Number(fitZoom.toFixed(2)), 0, stage.scrollTop);
  };

  const fitToHeight = () => {
    const stage = scrollRef.current;
    if (!stage || viewSize.height <= 0) {
      setClampedZoom(1);
      return;
    }
    const fitZoom = (stage.clientHeight - 32) / viewSize.height;
    setZoomAndScroll(Number(fitZoom.toFixed(2)), stage.scrollLeft, 0);
  };

  const setActualSize = () => {
    setZoomAndScroll(1);
  };

  const zoomToWindow = (draft: ZoomWindowDraft) => {
    const stage = scrollRef.current;
    if (!stage || viewSize.width <= 0 || viewSize.height <= 0) return;
    const minX = Math.min(draft.start.x, draft.end.x);
    const minY = Math.min(draft.start.y, draft.end.y);
    const maxX = Math.max(draft.start.x, draft.end.x);
    const maxY = Math.max(draft.start.y, draft.end.y);
    const width = maxX - minX;
    const height = maxY - minY;
    if (width * viewSize.width < 24 || height * viewSize.height < 24) {
      toast.warning("Drag a larger box around the area you want to inspect.");
      return;
    }
    const targetZoom = Math.min(
      (stage.clientWidth - 48) / (width * viewSize.width),
      (stage.clientHeight - 48) / (height * viewSize.height),
    );
    const nextZoom = clampZoom(Number(targetZoom.toFixed(2)));
    const focusedWidth = width * viewSize.width * nextZoom;
    const focusedHeight = height * viewSize.height * nextZoom;
    const scrollLeft = minX * viewSize.width * nextZoom - (stage.clientWidth - focusedWidth) / 2;
    const scrollTop = minY * viewSize.height * nextZoom - (stage.clientHeight - focusedHeight) / 2;
    setZoomAndScroll(nextZoom, scrollLeft, scrollTop);
  };

  const handleWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
    if (!event.metaKey && !event.ctrlKey) return;
    event.preventDefault();
    zoomBy(event.deltaY > 0 ? -PLAN_ZOOM_STEP : PLAN_ZOOM_STEP);
  };

  const pointFromClient = (clientX: number, clientY: number): Point | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (clientY - rect.top) / rect.height)),
    };
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (isZoomWindowMode) {
      const point = pointFromClient(event.clientX, event.clientY);
      if (!point) return;
      setZoomWindowDraft({ start: point, end: point });
      zoomWindowClickBlockRef.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (tool !== "select" || !scrollRef.current) return;
    panStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      left: scrollRef.current.scrollLeft,
      top: scrollRef.current.scrollTop,
      dragged: false,
    };
    setIsPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (isZoomWindowMode && zoomWindowDraft) {
      const point = pointFromClient(event.clientX, event.clientY);
      if (!point) return;
      setZoomWindowDraft((current) => (current ? { ...current, end: point } : current));
      return;
    }
    if (!isPanning || !scrollRef.current) return;
    const dx = event.clientX - panStartRef.current.x;
    const dy = event.clientY - panStartRef.current.y;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panStartRef.current.dragged = true;
    scrollRef.current.scrollLeft = panStartRef.current.left - dx;
    scrollRef.current.scrollTop = panStartRef.current.top - dy;
  };

  const handlePointerUp = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (isZoomWindowMode && zoomWindowDraft) {
      const point = pointFromClient(event.clientX, event.clientY);
      const completedDraft = point ? { ...zoomWindowDraft, end: point } : zoomWindowDraft;
      setZoomWindowDraft(null);
      setIsZoomWindowMode(false);
      event.currentTarget.releasePointerCapture(event.pointerId);
      zoomToWindow(completedDraft);
      return;
    }
    if (!isPanning) return;
    setIsPanning(false);
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const pointFromEvent = (event: ReactMouseEvent<SVGSVGElement>): Point | null => {
    return pointFromClient(event.clientX, event.clientY);
  };

  const handleClick = (event: ReactMouseEvent<SVGSVGElement>) => {
    if (zoomWindowClickBlockRef.current || isZoomWindowMode) {
      zoomWindowClickBlockRef.current = false;
      return;
    }
    if (panStartRef.current.dragged) {
      panStartRef.current.dragged = false;
      return;
    }
    const point = pointFromEvent(event);
    if (point) onPoint(point);
  };

  const viewBox = `0 0 ${viewSize.width} ${viewSize.height}`;
  const zoomPercent = `${Math.round(zoom * 100)}%`;
  const zoomSliderValue = Math.round(zoom * 100);

  return (
    <div
      className={cn("flex flex-col bg-background", isCockpitMode ? "min-h-0 flex-1 p-3" : "p-4")}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-md border border-hairline bg-surface px-3 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <Badge variant={tool === "select" ? "secondary" : "outline"} className="gap-1.5">
            {tool === "select" ? <Hand className="h-3 w-3" /> : <Target className="h-3 w-3" />}
            {toolLabel(tool)}
          </Badge>
          <Badge variant="outline">{zoomPercent}</Badge>
          {hasRevisionOverlay && (
            <Badge variant="secondary" data-testid="plan-revision-overlay-active">
              Revision overlay
            </Badge>
          )}
          <span className="truncate text-xs text-muted-foreground">
            {Math.round(viewSize.width)} x {Math.round(viewSize.height)}
          </span>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
          <Button
            type="button"
            size="sm"
            variant={isZoomWindowMode ? "default" : "outline"}
            title="Zoom to area"
            onClick={() => {
              setIsZoomWindowMode((current) => !current);
              setZoomWindowDraft(null);
            }}
            data-testid="plan-zoom-window"
          >
            <ZoomIn className="h-3.5 w-3.5" />
            Zoom Area
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8"
            title="Zoom out"
            onClick={() => zoomBy(-PLAN_ZOOM_STEP)}
            disabled={zoom <= MIN_PLAN_ZOOM}
            data-testid="plan-zoom-out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            title="Fit sheet"
            onClick={fitToStage}
            data-testid="plan-fit-sheet"
          >
            Fit
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            title="Fit width"
            onClick={fitToWidth}
            data-testid="plan-fit-width"
          >
            Width
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            title="Fit height"
            onClick={fitToHeight}
            data-testid="plan-fit-height"
          >
            Height
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            title="Actual size"
            onClick={setActualSize}
            data-testid="plan-actual-size"
          >
            100%
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-8 w-8"
            title="Zoom in"
            onClick={() => zoomBy(PLAN_ZOOM_STEP)}
            disabled={zoom >= MAX_PLAN_ZOOM}
            data-testid="plan-zoom-in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <div className="flex w-36 items-center px-2" data-testid="plan-zoom-slider">
            <Slider
              min={ZOOM_SLIDER_MIN}
              max={ZOOM_SLIDER_MAX}
              step={5}
              value={[zoomSliderValue]}
              onValueChange={(value) => setClampedZoom((value[0] ?? 100) / 100)}
              aria-label="Plan zoom percentage"
            />
          </div>
        </div>
      </div>

      <div
        ref={scrollRef}
        className={cn(
          "relative min-h-0 overflow-auto rounded-md border border-hairline bg-[#f7f4ef] shadow-inner",
          isCockpitMode ? "flex-1" : "h-[min(72vh,760px)]",
        )}
        onWheel={handleWheel}
        data-testid="plan-viewport"
      >
        <div className="inline-flex min-h-full min-w-full items-start justify-center p-4">
          <div
            className="relative shrink-0 overflow-hidden rounded-sm bg-white shadow-sm"
            style={{
              width: `${Math.max(1, viewSize.width * zoom)}px`,
              height: `${Math.max(1, viewSize.height * zoom)}px`,
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
                  const width = Math.min(1600, Math.max(960, img.naturalWidth));
                  onViewSizeChange({ width, height: Math.round(width / ratio) });
                }}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center bg-surface text-sm text-muted-foreground">
                Loading drawing...
              </div>
            )}

            {overlayPlanSet && overlaySheet && (
              <div
                className="pointer-events-none absolute inset-0"
                data-testid="plan-revision-overlay-layer"
                style={{
                  opacity: Math.min(0.9, Math.max(0.2, overlayOpacity / 100)),
                  mixBlendMode: overlayBlendMode,
                }}
              >
                <PlanSheetOverlayLayer
                  planSet={overlayPlanSet}
                  sheet={overlaySheet}
                  viewSize={viewSize}
                  zoom={zoom}
                />
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
              className={cn(
                "absolute inset-0 h-full w-full",
                isZoomWindowMode
                  ? "cursor-zoom-in"
                  : tool === "select"
                    ? isPanning
                      ? "cursor-grabbing"
                      : "cursor-grab"
                    : "cursor-crosshair",
              )}
              data-testid="plan-canvas"
              onClick={handleClick}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
            >
              <rect
                x="0"
                y="0"
                width={viewSize.width}
                height={viewSize.height}
                fill="transparent"
              />
              {measurements.map((measurement) => (
                <MeasurementShape
                  key={measurement.id}
                  measurement={measurement}
                  viewSize={viewSize}
                  selected={measurement.id === selectedMeasurementId}
                  onSelect={onMeasurementSelect}
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
              <ZoomWindowShape draft={zoomWindowDraft} viewSize={viewSize} />
            </svg>
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoomWindowShape({
  draft,
  viewSize,
}: {
  draft: ZoomWindowDraft | null;
  viewSize: ViewSize;
}) {
  if (!draft) return null;
  const minX = Math.min(draft.start.x, draft.end.x) * viewSize.width;
  const minY = Math.min(draft.start.y, draft.end.y) * viewSize.height;
  const width = Math.abs(draft.start.x - draft.end.x) * viewSize.width;
  const height = Math.abs(draft.start.y - draft.end.y) * viewSize.height;
  return (
    <g pointerEvents="none" data-testid="plan-zoom-window-draft">
      <rect
        x={minX}
        y={minY}
        width={width}
        height={height}
        fill="#1b7a6e18"
        stroke="#1b7a6e"
        strokeWidth="3"
        strokeDasharray="10 8"
      />
      <rect
        x={minX + 4}
        y={minY + 4}
        width={Math.max(0, width - 8)}
        height={Math.max(0, height - 8)}
        fill="none"
        stroke="white"
        strokeWidth="1.5"
        strokeDasharray="10 8"
      />
    </g>
  );
}

function PlanSheetOverlayLayer({
  planSet,
  sheet,
  viewSize,
  zoom,
}: {
  planSet: PlanSetRow;
  sheet: PlanSheetRow;
  viewSize: ViewSize;
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const [signedUrl, setSignedUrl] = useState("");
  const [renderError, setRenderError] = useState("");

  useEffect(() => {
    let active = true;
    setSignedUrl("");
    setRenderError("");
    if (!planSet.file_path) return;
    if (isDirectPlanFileUrl(planSet.file_path)) {
      setSignedUrl(directPlanFileUrl(planSet.file_path));
      return;
    }
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
  }, [planSet.file_path]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { promise: Promise<unknown>; cancel: () => void } | null = null;
    const renderPdf = async () => {
      if (!signedUrl || planSet.file_mime_type !== "application/pdf" || !canvasRef.current) return;
      try {
        const pdfjs = await import("pdfjs-dist");
        const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        (
          pdfjs as unknown as { GlobalWorkerOptions: { workerSrc: string } }
        ).GlobalWorkerOptions.workerSrc = workerUrl;
        const pdf = await pdfjs.getDocument(await pdfDocumentSourceFor(signedUrl)).promise;
        const page = await pdf.getPage(sheet.page_number || 1);
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(viewSize.width / viewport.width, viewSize.height / viewport.height);
        const cssScale = Math.max(0.1, scale);
        const renderScale = pdfRenderScaleFor(viewport, cssScale, zoom);
        const scaled = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.round(scaled.width);
        canvas.height = Math.round(scaled.height);
        canvas.dataset.pdfRenderScale = renderScale.toFixed(3);
        canvas.dataset.pdfRenderWidth = String(canvas.width);
        canvas.dataset.pdfRenderHeight = String(canvas.height);
        renderTask = page.render({
          canvas,
          canvasContext: canvas.getContext("2d")!,
          viewport: scaled,
        });
        await renderTask.promise;
      } catch (error) {
        if (!cancelled && !isPdfRenderCancelled(error)) {
          setRenderError(
            error instanceof Error ? error.message : "Revision overlay did not render.",
          );
        }
      }
    };
    renderPdf();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [planSet.file_mime_type, sheet.page_number, signedUrl, viewSize.height, viewSize.width, zoom]);

  if (planSet.sample_key === "harbor-residence" || !planSet.file_path) {
    return <SamplePlanBackground sheet={sheet} viewSize={viewSize} overlay />;
  }

  if (planSet.file_mime_type === "application/pdf") {
    return (
      <>
        <canvas ref={canvasRef} className="absolute inset-0 h-full w-full bg-white" />
        {renderError && (
          <div className="absolute inset-x-8 top-8 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
            {renderError}
          </div>
        )}
      </>
    );
  }

  if (signedUrl) {
    return (
      <img
        ref={imageRef}
        src={signedUrl}
        alt={`${sheet.sheet_name || "Revision sheet"} overlay`}
        className="absolute inset-0 h-full w-full object-contain"
      />
    );
  }

  return (
    <div className="absolute inset-0 flex items-center justify-center bg-surface text-sm text-muted-foreground">
      Loading revision overlay...
    </div>
  );
}

function SamplePlanBackground({
  sheet,
  viewSize,
  overlay = false,
}: {
  sheet: PlanSheetRow | null;
  viewSize: ViewSize;
  overlay?: boolean;
}) {
  const title = `${sheet?.sheet_number || "A1.1"} ${sheet?.sheet_name || "Sample Plan"}`.trim();
  const patternId = overlay ? "plan-grid-overlay" : "plan-grid";
  const offset = overlay ? 18 : 0;
  const lineColor = overlay ? "#b35035" : "#28231d";
  return (
    <svg
      viewBox={`0 0 ${viewSize.width} ${viewSize.height}`}
      className={cn("absolute inset-0 h-full w-full", overlay ? "bg-transparent" : "bg-white")}
    >
      <defs>
        <pattern id={patternId} width="32" height="32" patternUnits="userSpaceOnUse">
          <path d="M 32 0 L 0 0 0 32" fill="none" stroke="#e8e2d7" strokeWidth="1" />
        </pattern>
      </defs>
      {!overlay && <rect width={viewSize.width} height={viewSize.height} fill="#fffefa" />}
      <rect width={viewSize.width} height={viewSize.height} fill={`url(#${patternId})`} />
      <rect
        x={viewSize.width * 0.14 + offset}
        y={viewSize.height * 0.18 + offset * 0.4}
        width={viewSize.width * 0.7}
        height={viewSize.height * 0.58}
        fill="none"
        stroke={lineColor}
        strokeWidth="3"
      />
      <rect
        x={viewSize.width * 0.2 + offset}
        y={viewSize.height * 0.3 + offset * 0.4}
        width={viewSize.width * 0.56}
        height={viewSize.height * 0.34}
        fill="none"
        stroke={lineColor}
        strokeWidth="2"
      />
      <line
        x1={viewSize.width * 0.48 + offset}
        y1={viewSize.height * 0.18 + offset * 0.4}
        x2={viewSize.width * 0.48 + offset}
        y2={viewSize.height * 0.76 + offset * 0.4}
        stroke={overlay ? "#b35035" : "#928779"}
        strokeDasharray="8 8"
        strokeWidth="1.5"
      />
      <line
        x1={viewSize.width * 0.14 + offset}
        y1={viewSize.height * 0.47 + offset * 0.4}
        x2={viewSize.width * 0.84 + offset}
        y2={viewSize.height * 0.47 + offset * 0.4}
        stroke={overlay ? "#b35035" : "#928779"}
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
  selected,
  onSelect,
}: {
  measurement: TakeoffMeasurementRow;
  viewSize: ViewSize;
  selected: boolean;
  onSelect: (measurementId: string) => void;
}) {
  const points = geometryPoints(measurement.geometry);
  if (points.length === 0) return null;
  const scaled = points.map((point) => ({
    x: point.x * viewSize.width,
    y: point.y * viewSize.height,
  }));
  const labelPoint = scaled[0];
  const handleSelect = (event: ReactMouseEvent<SVGGElement>) => {
    event.stopPropagation();
    onSelect(measurement.id);
  };

  if (measurement.tool_type === "area" && scaled.length >= 3) {
    return (
      <g className="cursor-pointer" onClick={handleSelect}>
        <polygon
          points={scaled.map((point) => `${point.x},${point.y}`).join(" ")}
          fill={`${measurement.color}22`}
          stroke={selected ? "#111827" : measurement.color}
          strokeWidth={selected ? "6" : "3"}
        />
        {selected && (
          <polygon
            points={scaled.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke={measurement.color}
            strokeWidth="3"
          />
        )}
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
      <g className="cursor-pointer" onClick={handleSelect}>
        {scaled.map((point, index) => (
          <g key={`${point.x}-${point.y}-${index}`}>
            {selected && <circle cx={point.x} cy={point.y} r="16" fill="white" stroke="#111827" />}
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
    <g className="cursor-pointer" onClick={handleSelect}>
      {selected && (
        <polyline
          points={scaled.map((point) => `${point.x},${point.y}`).join(" ")}
          fill="none"
          stroke="#111827"
          strokeWidth="8"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity="0.35"
        />
      )}
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
