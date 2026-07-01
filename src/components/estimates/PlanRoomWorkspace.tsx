import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import type {
  ChangeEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  WheelEvent as ReactWheelEvent,
} from "react";
import {
  ArrowLeft,
  Check,
  ClipboardList,
  ExternalLink,
  FileUp,
  Hand,
  Image as ImageIcon,
  Layers,
  Link2,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  MousePointer2,
  PencilRuler,
  Plus,
  Ruler,
  Save,
  Search,
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
type CockpitPanel = "drawings" | "tools" | null;
type MiniMapDock = "bottom-left" | "bottom-right" | "top-left" | "top-right";
type MiniMapPosition = { x: number; y: number };
type SheetFilterMode = "all" | "current" | "needs-scale" | "has-takeoff";
type TakeoffFilterMode = "all" | "sheet" | "unlinked" | "linked";
type Point = PlanRoomPoint;
type ViewSize = PlanRoomViewSize;
type ZoomWindowDraft = { start: Point; end: Point };
type ViewportFrame = { x: number; y: number; width: number; height: number };
type PdfRenderPlan = {
  renderScale: number;
  desiredScale: number;
  capped: boolean;
  maxEdge: number;
  maxPixels: number;
};
type RenderQualityStatus = {
  label: string;
  details: string;
  capped?: boolean;
};
type DraftCommandStatus = {
  title: string;
  value: string;
  detail: string;
  ready: boolean;
  actionLabel: string;
};
type GeometryEditDraft = {
  measurementId: string;
  pointIndex: number;
  points: Point[];
};

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
const PDF_STANDARD_RENDER_MAX_EDGE = 8192;
const PDF_STANDARD_RENDER_MAX_PIXELS = 24_000_000;
const PDF_HIGH_DETAIL_RENDER_MAX_EDGE = 12_288;
const PDF_HIGH_DETAIL_RENDER_MAX_PIXELS = 72_000_000;
const PDF_INSPECTION_RENDER_MULTIPLIER = 2;
const EMPTY_VIEWPORT_FRAME: ViewportFrame = { x: 0, y: 0, width: 1, height: 1 };

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

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const searchMatches = (query: string, values: Array<string | number | null | undefined>) => {
  const normalizedQuery = normalizeSearch(query);
  if (!normalizedQuery) return true;
  return values.some((value) =>
    String(value ?? "")
      .toLowerCase()
      .includes(normalizedQuery),
  );
};

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

const pdfRenderLimits = () => {
  if (typeof navigator === "undefined") {
    return {
      maxEdge: PDF_STANDARD_RENDER_MAX_EDGE,
      maxPixels: PDF_STANDARD_RENDER_MAX_PIXELS,
    };
  }
  const deviceMemory =
    Number((navigator as Navigator & { deviceMemory?: number }).deviceMemory) || 8;
  if (deviceMemory >= 4) {
    return {
      maxEdge: PDF_HIGH_DETAIL_RENDER_MAX_EDGE,
      maxPixels: PDF_HIGH_DETAIL_RENDER_MAX_PIXELS,
    };
  }
  return {
    maxEdge: PDF_STANDARD_RENDER_MAX_EDGE,
    maxPixels: PDF_STANDARD_RENDER_MAX_PIXELS,
  };
};

const pdfCssScaleFor = (viewport: PdfViewportLike) => {
  const longEdge = Math.max(viewport.width, viewport.height);
  if (!Number.isFinite(longEdge) || longEdge <= 0) return 1;
  return Math.min(3, Math.max(0.2, PDF_BASE_LONG_EDGE / longEdge));
};

const pdfRenderPlanFor = (
  viewport: PdfViewportLike,
  cssScale: number,
  zoom: number,
  detailMultiplier = 1,
): PdfRenderPlan => {
  const pagePixels = Math.max(1, viewport.width * viewport.height);
  const longEdge = Math.max(1, viewport.width, viewport.height);
  const desiredScale =
    cssScale * Math.max(1, zoom) * devicePixelRatioForPdf() * Math.max(1, detailMultiplier);
  const limits = pdfRenderLimits();
  const maxPixelScale = Math.sqrt(limits.maxPixels / pagePixels);
  const maxEdgeScale = limits.maxEdge / longEdge;
  const renderScale = Math.max(0.2, Math.min(desiredScale, maxPixelScale, maxEdgeScale));
  return {
    renderScale,
    desiredScale,
    capped: renderScale + 0.01 < desiredScale,
    maxEdge: limits.maxEdge,
    maxPixels: limits.maxPixels,
  };
};

const pdfRenderScaleFor = (
  viewport: PdfViewportLike,
  cssScale: number,
  zoom: number,
  detailMultiplier = 1,
) => pdfRenderPlanFor(viewport, cssScale, zoom, detailMultiplier).renderScale;

const configurePdfWorker = (pdfjs: unknown) => {
  const workerSrc = String(pdfWorkerUrl || "");
  if (!workerSrc) throw new Error("PDF worker is not available.");
  (pdfjs as { GlobalWorkerOptions: { workerSrc: string } }).GlobalWorkerOptions.workerSrc =
    workerSrc;
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

function geometryFromPoints(points: Point[], size: ViewSize) {
  return {
    points,
    view_size: {
      width: Math.round(size.width),
      height: Math.round(size.height),
    },
  };
}

function draftCommandFor({
  tool,
  points,
  sheet,
  viewSize,
  unit,
}: {
  tool: ToolMode;
  points: Point[];
  sheet: PlanSheetRow | null;
  viewSize: ViewSize;
  unit: string;
}): DraftCommandStatus | null {
  if (tool === "select") return null;

  if (tool === "calibrate") {
    const spanPx = distancePx(points, viewSize);
    return {
      title: "Scale calibration",
      value:
        points.length === 2
          ? `${Math.round(spanPx).toLocaleString()} px`
          : `${points.length}/2 points`,
      detail:
        points.length === 2
          ? "Type the real field distance, then save the sheet scale."
          : "Click both ends of a known dimension on the drawing.",
      ready: points.length === 2 && spanPx > 0,
      actionLabel: "Save Scale",
    };
  }

  if (tool === "count") {
    return {
      title: "Count takeoff",
      value: formatQty(points.length, unit || "EA"),
      detail:
        points.length > 0
          ? "Keep clicking matching items, then finish this grouped count."
          : "Click each matching item on the plan. One saved takeoff will hold the total count.",
      ready: points.length > 0,
      actionLabel: "Finish Count",
    };
  }

  const hasScale = Boolean(sheet?.scale_feet_per_pixel);
  const quantity = sheet ? calculateQuantity(tool, points, sheet, viewSize) : 0;
  const value =
    hasScale && quantity > 0
      ? formatQty(quantity, unit)
      : tool === "linear"
        ? `${points.length}/2+ points`
        : `${points.length}/3+ points`;

  if (tool === "linear") {
    return {
      title: "Linear takeoff",
      value,
      detail: !hasScale
        ? "Set the sheet scale before linear quantities can calculate."
        : points.length >= 2
          ? "Click additional turns for a run, or finish this linear takeoff."
          : "Click the start point, then the next point on the run.",
      ready: hasScale && points.length >= 2 && quantity > 0,
      actionLabel: "Finish Linear",
    };
  }

  return {
    title: "Area takeoff",
    value,
    detail: !hasScale
      ? "Set the sheet scale before area quantities can calculate."
      : points.length >= 3
        ? "Keep clicking corners, then finish to close and save the area."
        : "Click at least three corners around the area.",
    ready: hasScale && points.length >= 3 && quantity > 0,
    actionLabel: "Finish Area",
  };
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

function CockpitFloatingPanelHeader({
  title,
  closeTestId,
  onClose,
}: {
  title: string;
  closeTestId: string;
  onClose: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-hairline bg-card px-3 py-2 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </p>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={onClose}
        data-testid={closeTestId}
      >
        <Minimize2 className="h-3.5 w-3.5" />
        Hide
      </Button>
    </div>
  );
}

async function getPdfPageCount(file: File) {
  if (file.type !== "application/pdf") return 1;
  const pdfjs = await import("pdfjs-dist");
  configurePdfWorker(pdfjs);
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
  const [cockpitPanel, setCockpitPanel] = useState<CockpitPanel>(null);
  const [overlaySheetId, setOverlaySheetId] = useState("");
  const [overlayOpacity, setOverlayOpacity] = useState(65);
  const [overlayMode, setOverlayMode] = useState<RevisionOverlayMode>("compare");
  const [selectedMeasurementId, setSelectedMeasurementId] = useState("");
  const [sheetSearch, setSheetSearch] = useState("");
  const [sheetFilter, setSheetFilter] = useState<SheetFilterMode>("all");
  const [takeoffSearch, setTakeoffSearch] = useState("");
  const [takeoffFilter, setTakeoffFilter] = useState<TakeoffFilterMode>("all");
  const [selectedMeasurementDraft, setSelectedMeasurementDraft] = useState({
    color: TAKEOFF_COLORS[0],
    label: "",
    notes: "",
    quantity: "",
    unit: "",
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
  const measurementCountBySheet = useMemo(() => {
    const counts = new Map<string, number>();
    for (const measurement of measurements) {
      counts.set(measurement.plan_sheet_id, (counts.get(measurement.plan_sheet_id) ?? 0) + 1);
    }
    return counts;
  }, [measurements]);
  const filteredSheetsByPlanSet = useMemo(() => {
    const next = new Map<string, PlanSheetRow[]>();
    for (const planSet of planSets) next.set(planSet.id, []);
    for (const sheet of sheets) {
      const planSet = planSets.find((item) => item.id === sheet.plan_set_id) ?? null;
      const sheetMeasurementCount = measurementCountBySheet.get(sheet.id) ?? 0;
      const passesFilter =
        sheetFilter === "all" ||
        (sheetFilter === "current" && planSet?.status === "current") ||
        (sheetFilter === "needs-scale" && !sheet.scale_feet_per_pixel) ||
        (sheetFilter === "has-takeoff" && sheetMeasurementCount > 0);
      const passesSearch = searchMatches(sheetSearch, [
        sheet.sheet_number,
        sheet.sheet_name,
        sheet.discipline,
        sheet.page_number,
        planSet?.name,
        planSet?.source_file_name,
      ]);
      if (!passesFilter || !passesSearch) continue;
      const current = next.get(sheet.plan_set_id) ?? [];
      current.push(sheet);
      next.set(sheet.plan_set_id, current);
    }
    return next;
  }, [measurementCountBySheet, planSets, sheetFilter, sheetSearch, sheets]);
  const filteredSheetCount = useMemo(
    () =>
      Array.from(filteredSheetsByPlanSet.values()).reduce(
        (sum, planSetSheets) => sum + planSetSheets.length,
        0,
      ),
    [filteredSheetsByPlanSet],
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
  const activeDraftPoints = tool === "calibrate" ? calibrationPoints : pendingPoints;
  const draftUnit =
    tool === "linear" || tool === "area" || tool === "count" ? unitFor(tool, selectedLine) : "";
  const draftCommand = useMemo(
    () =>
      draftCommandFor({
        tool,
        points: activeDraftPoints,
        sheet: currentSheet,
        viewSize,
        unit: draftUnit,
      }),
    [activeDraftPoints, currentSheet, draftUnit, tool, viewSize],
  );

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
      setSelectedMeasurementDraft({
        color: TAKEOFF_COLORS[0],
        label: "",
        notes: "",
        quantity: "",
        unit: "",
      });
      return;
    }
    setSelectedMeasurementDraft({
      color: selectedMeasurement?.color || TAKEOFF_COLORS[0],
      label: selectedMeasurementLabel,
      notes: selectedMeasurementNotes,
      quantity: selectedMeasurement ? String(Number(selectedMeasurement.quantity.toFixed(3))) : "",
      unit: selectedMeasurement?.unit ?? "",
    });
  }, [
    selectedMeasurement,
    selectedMeasurementId,
    selectedMeasurementLabel,
    selectedMeasurementNotes,
  ]);

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
          geometry: geometryFromPoints(points, viewSize),
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
      setPendingPoints((current) => [...current, point]);
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

  const finishDraft = () => {
    if (tool === "calibrate") {
      saveScale();
      return;
    }
    if (tool === "linear") {
      if (pendingPoints.length < 2) {
        toast.warning("Click at least two points before finishing a linear takeoff.");
        return;
      }
      createMeasurementMutation.mutate({ measurementTool: "linear", points: pendingPoints });
      return;
    }
    if (tool === "count") {
      if (pendingPoints.length < 1) {
        toast.warning("Click at least one item before finishing a count.");
        return;
      }
      createMeasurementMutation.mutate({ measurementTool: "count", points: pendingPoints });
      return;
    }
    finishArea();
  };

  const saveSelectedMeasurement = () => {
    if (!selectedMeasurement) return;
    const label = selectedMeasurementDraft.label.trim();
    if (!label) {
      toast.warning("Give this takeoff a label before saving.");
      return;
    }
    const quantity = Number(selectedMeasurementDraft.quantity);
    if (!Number.isFinite(quantity) || quantity < 0) {
      toast.warning("Enter a valid measured quantity.");
      return;
    }
    const unit = selectedMeasurementDraft.unit.trim().toUpperCase();
    if (!unit) {
      toast.warning("Enter a unit for this takeoff.");
      return;
    }
    updateMeasurementMutation.mutate({
      id: selectedMeasurement.id,
      patch: {
        color: selectedMeasurementDraft.color,
        label,
        notes: selectedMeasurementDraft.notes.trim(),
        quantity,
        unit,
      },
    });
  };

  const recalculateSelectedMeasurement = () => {
    if (!selectedMeasurement || !selectedMeasurementSheet) return;
    const points = geometryPoints(selectedMeasurement.geometry);
    if (points.length === 0) {
      toast.warning("This takeoff does not have drawing geometry to recalculate.");
      return;
    }
    const quantity = calculateQuantity(
      selectedMeasurement.tool_type,
      points,
      selectedMeasurementSheet,
      viewSize,
    );
    if (quantity <= 0) {
      toast.warning(
        selectedMeasurement.tool_type === "count"
          ? "Place at least one count marker before recalculating."
          : "Set the sheet scale before recalculating this takeoff.",
      );
      return;
    }
    setSelectedMeasurementDraft((draft) => ({
      ...draft,
      quantity: String(Number(quantity.toFixed(3))),
    }));
  };

  const saveMeasurementGeometry = async (measurementId: string, points: Point[]) => {
    const measurement = measurements.find((item) => item.id === measurementId);
    if (!measurement) throw new Error("Choose an existing takeoff first.");
    const measurementSheet = sheets.find((sheet) => sheet.id === measurement.plan_sheet_id);
    if (!measurementSheet) throw new Error("The takeoff sheet could not be found.");
    if (currentSheet?.id !== measurementSheet.id) {
      throw new Error("Open the takeoff sheet before editing its geometry.");
    }
    const quantity = calculateQuantity(measurement.tool_type, points, measurementSheet, viewSize);
    if (quantity <= 0) {
      throw new Error(
        measurement.tool_type === "count"
          ? "Place at least one count marker."
          : "Set the drawing scale before saving this edited takeoff.",
      );
    }
    await updateMeasurementMutation.mutateAsync({
      id: measurement.id,
      patch: {
        quantity,
        geometry: geometryFromPoints(points, viewSize),
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
  const visibleMeasurements = useMemo(() => {
    return measurements
      .filter((measurement) => {
        const measurementSheet = sheets.find((sheet) => sheet.id === measurement.plan_sheet_id);
        const linkedLine = lineItems.find((line) => line.id === measurement.estimate_line_item_id);
        const passesFilter =
          takeoffFilter === "all" ||
          (takeoffFilter === "sheet" && measurement.plan_sheet_id === currentSheet?.id) ||
          (takeoffFilter === "unlinked" && !measurement.estimate_line_item_id) ||
          (takeoffFilter === "linked" && Boolean(measurement.estimate_line_item_id));
        const passesSearch = searchMatches(takeoffSearch, [
          measurement.label,
          measurement.unit,
          measurement.quantity,
          measurement.notes,
          toolLabel(measurement.tool_type),
          measurementSheet?.sheet_number,
          measurementSheet?.sheet_name,
          linkedLine?.cost_code,
          linkedLine?.scope_group,
          linkedLine?.description,
        ]);
        return passesFilter && passesSearch;
      })
      .sort((a, b) => {
        if (a.id === selectedMeasurementId) return -1;
        if (b.id === selectedMeasurementId) return 1;
        const aSheet = a.plan_sheet_id === currentSheet?.id ? 0 : 1;
        const bSheet = b.plan_sheet_id === currentSheet?.id ? 0 : 1;
        if (aSheet !== bSheet) return aSheet - bSheet;
        return a.updated_at < b.updated_at ? 1 : -1;
      });
  }, [
    currentSheet?.id,
    lineItems,
    measurements,
    selectedMeasurementId,
    sheets,
    takeoffFilter,
    takeoffSearch,
  ]);

  const totalMeasured = measurements.reduce((sum, measurement) => sum + measurement.quantity, 0);
  const linkedCount = measurements.filter(
    (measurement) => measurement.estimate_line_item_id,
  ).length;
  const backendReady = schemaReady !== false;
  const toggleCockpitPanel = (panel: Exclude<CockpitPanel, null>) =>
    setCockpitPanel((current) => (current === panel ? null : panel));

  return (
    <div
      className={cn(
        "bg-background",
        isCockpitMode ? "fixed inset-0 z-50 flex min-h-0 flex-col overflow-hidden" : "min-h-screen",
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
                onClick={() => {
                  setIsCockpitMode((current) => !current);
                  setCockpitPanel(null);
                }}
                title={isCockpitMode ? "Exit command center" : "Open command center"}
                data-testid="plan-command-center-toggle"
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
          "relative grid min-h-0",
          isCockpitMode
            ? "flex-1 grid-cols-1 overflow-hidden px-3 py-3"
            : "mx-auto max-w-[1800px] gap-5 px-5 py-6 lg:px-8 xl:grid-cols-[220px_minmax(0,1fr)_300px] 2xl:grid-cols-[280px_minmax(0,1fr)_390px]",
        )}
        data-testid="plan-room-main"
      >
        {isCockpitMode && (
          <div
            className="absolute left-1/2 top-3 z-40 flex -translate-x-1/2 items-center gap-2 rounded-md border border-hairline bg-card/95 p-1 shadow-lg backdrop-blur"
            data-testid="plan-cockpit-panel-dock"
          >
            <Button
              type="button"
              size="sm"
              variant={cockpitPanel === "drawings" ? "default" : "outline"}
              className="gap-1.5"
              onClick={() => toggleCockpitPanel("drawings")}
              data-testid="plan-cockpit-drawings-toggle"
            >
              <Layers className="h-3.5 w-3.5" />
              Drawings
            </Button>
            <Button
              type="button"
              size="sm"
              variant={cockpitPanel === "tools" ? "default" : "outline"}
              className="gap-1.5"
              onClick={() => toggleCockpitPanel("tools")}
              data-testid="plan-cockpit-tools-toggle"
            >
              <Target className="h-3.5 w-3.5" />
              Tools
            </Button>
          </div>
        )}

        {!backendReady && (
          <section className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950 xl:col-span-3">
            <p className="font-medium">Plan Room backend is still coming online</p>
            <p className="mt-1 text-amber-900">
              {schemaMessage ||
                "Lovable needs to apply the Plan Room migration and refresh the Supabase schema cache before uploads and takeoff saves are available."}
            </p>
          </section>
        )}

        <aside
          className={cn(
            "min-w-0 space-y-4",
            isCockpitMode &&
              (cockpitPanel === "drawings"
                ? "absolute left-3 top-16 z-40 max-h-[calc(100%-5rem)] w-[min(360px,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-hairline bg-background/95 p-2 shadow-2xl backdrop-blur"
                : "hidden"),
          )}
          data-testid="plan-cockpit-drawings-panel"
        >
          {isCockpitMode && (
            <CockpitFloatingPanelHeader
              title="Drawing Controls"
              closeTestId="plan-cockpit-drawings-close"
              onClose={() => setCockpitPanel(null)}
            />
          )}
          <section className="rounded-lg border border-hairline bg-card shadow-card">
            <div className="border-b border-hairline bg-surface px-4 py-3">
              <h2 className="font-serif text-xl">Drawing Sets</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Open a sheet, set scale, then take off quantities.
              </p>
            </div>
            <div className="border-b border-hairline p-3" data-testid="plan-sheet-finder">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={sheetSearch}
                  onChange={(event) => setSheetSearch(event.target.value)}
                  className="h-9 pl-8"
                  placeholder="Find sheet, page, discipline, or set"
                  data-testid="plan-sheet-search"
                />
              </div>
              <div
                className="mt-2 grid grid-cols-2 gap-1.5 text-xs"
                data-testid="plan-sheet-filter-controls"
              >
                {[
                  { value: "all", label: `All ${sheets.length}`, testId: "plan-sheet-filter-all" },
                  {
                    value: "current",
                    label: `Current ${sheets.filter((sheet) => planSets.find((set) => set.id === sheet.plan_set_id)?.status === "current").length}`,
                    testId: "plan-sheet-filter-current",
                  },
                  {
                    value: "needs-scale",
                    label: `Needs scale ${sheets.filter((sheet) => !sheet.scale_feet_per_pixel).length}`,
                    testId: "plan-sheet-filter-needs-scale",
                  },
                  {
                    value: "has-takeoff",
                    label: `Marked ${Array.from(measurementCountBySheet.values()).filter(Boolean).length}`,
                    testId: "plan-sheet-filter-has-takeoff",
                  },
                ].map((item) => (
                  <Button
                    key={item.value}
                    type="button"
                    size="sm"
                    variant={sheetFilter === item.value ? "default" : "outline"}
                    className="h-8 px-2 text-xs"
                    onClick={() => {
                      setSheetFilter(item.value as SheetFilterMode);
                      setSheetSearch("");
                    }}
                    data-testid={item.testId}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Showing {filteredSheetCount} of {sheets.length} sheets.
              </p>
            </div>
            <div className="max-h-[680px] space-y-2 overflow-y-auto p-3">
              {sheets.length === 0 ? (
                <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
                  Upload a PDF or image plan set to start measuring this estimate.
                </div>
              ) : filteredSheetCount === 0 ? (
                <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
                  No sheets match that finder. Clear the search or switch filters.
                </div>
              ) : (
                planSets.map((planSet) => {
                  const planSetSheets = filteredSheetsByPlanSet.get(planSet.id) ?? [];
                  if (planSetSheets.length === 0) return null;
                  return (
                    <div
                      key={planSet.id}
                      className="rounded-md border border-hairline bg-background"
                    >
                      <div className="border-b border-hairline px-3 py-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium">{planSet.name}</p>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {planSetSheets.length}/{planSet.page_count} sheets shown
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
                        {planSetSheets.map((sheet) => {
                          const sheetMeasurementCount = measurementCountBySheet.get(sheet.id) ?? 0;
                          return (
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
                              data-testid="plan-sheet-row"
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
                                <span className="mt-1 flex flex-wrap gap-1">
                                  {sheet.scale_feet_per_pixel ? (
                                    <Badge variant="outline" className="bg-background/80 px-1 py-0">
                                      Scale set
                                    </Badge>
                                  ) : (
                                    <Badge variant="outline" className="bg-background/80 px-1 py-0">
                                      Needs scale
                                    </Badge>
                                  )}
                                  {sheetMeasurementCount > 0 && (
                                    <Badge variant="outline" className="bg-background/80 px-1 py-0">
                                      {sheetMeasurementCount} marks
                                    </Badge>
                                  )}
                                </span>
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
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
            isCockpitMode && "flex h-full min-h-0 w-full flex-col",
          )}
          data-testid="plan-cockpit-drawing-stage"
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
              {draftCommand && (
                <Button
                  size="sm"
                  className="gap-1.5"
                  onClick={finishDraft}
                  disabled={
                    !backendReady ||
                    !draftCommand.ready ||
                    createMeasurementMutation.isPending ||
                    updateSheetMutation.isPending
                  }
                  data-testid="takeoff-finish-draft"
                >
                  <Check className="h-3.5 w-3.5" /> {draftCommand.actionLabel}
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
            draftCommand={draftCommand}
            draftUnit={draftUnit}
            draftActionDisabled={
              !backendReady ||
              !draftCommand?.ready ||
              createMeasurementMutation.isPending ||
              updateSheetMutation.isPending
            }
            onFinishDraft={finishDraft}
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
            onMeasurementGeometryChange={saveMeasurementGeometry}
            isGeometrySaving={updateMeasurementMutation.isPending}
          />
        </section>

        <aside
          className={cn(
            "min-w-0 space-y-4",
            isCockpitMode &&
              (cockpitPanel === "tools"
                ? "absolute right-3 top-16 z-40 max-h-[calc(100%-5rem)] w-[min(390px,calc(100vw-1.5rem))] overflow-y-auto rounded-lg border border-hairline bg-background/95 p-2 shadow-2xl backdrop-blur"
                : "hidden"),
          )}
          data-testid="plan-cockpit-tools-panel"
        >
          {isCockpitMode && (
            <CockpitFloatingPanelHeader
              title="Takeoff Tools"
              closeTestId="plan-cockpit-tools-close"
              onClose={() => setCockpitPanel(null)}
            />
          )}
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
                  <p className="mt-2" data-testid="selected-takeoff-edit-guidance">
                    Geometry: drag the white points on the plan to refine this takeoff. Quantity
                    recalculates and syncs to the linked estimate row when saved.
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
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_92px]">
                  <div className="space-y-1.5">
                    <Label>Measured quantity</Label>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
                      <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={selectedMeasurementDraft.quantity}
                        onChange={(event) =>
                          setSelectedMeasurementDraft((draft) => ({
                            ...draft,
                            quantity: event.target.value,
                          }))
                        }
                        data-testid="selected-takeoff-quantity-input"
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={recalculateSelectedMeasurement}
                        data-testid="selected-takeoff-recalculate"
                      >
                        Recalc
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Override only when field judgment beats the markup. Recalc returns to drawing
                      geometry.
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Unit</Label>
                    <Input
                      value={selectedMeasurementDraft.unit}
                      onChange={(event) =>
                        setSelectedMeasurementDraft((draft) => ({
                          ...draft,
                          unit: event.target.value,
                        }))
                      }
                      data-testid="selected-takeoff-unit-input"
                    />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label>Markup color</Label>
                  <div className="flex flex-wrap gap-2" data-testid="selected-takeoff-color-picker">
                    {TAKEOFF_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        title={color}
                        onClick={() =>
                          setSelectedMeasurementDraft((draft) => ({
                            ...draft,
                            color,
                          }))
                        }
                        className={`h-8 w-8 rounded border ${
                          selectedMeasurementDraft.color === color
                            ? "border-foreground"
                            : "border-hairline"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
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
                      data-testid="selected-takeoff-save-details"
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
            <div className="border-b border-hairline p-3" data-testid="takeoff-navigator">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={takeoffSearch}
                  onChange={(event) => setTakeoffSearch(event.target.value)}
                  className="h-9 pl-8"
                  placeholder="Find takeoff, row, sheet, or note"
                  data-testid="takeoff-search"
                />
              </div>
              <div
                className="mt-2 grid grid-cols-2 gap-1.5 text-xs"
                data-testid="takeoff-filter-controls"
              >
                {[
                  {
                    value: "all",
                    label: `All ${measurements.length}`,
                    testId: "takeoff-filter-all",
                  },
                  {
                    value: "sheet",
                    label: `This sheet ${sheetMeasurements.length}`,
                    testId: "takeoff-filter-sheet",
                  },
                  {
                    value: "unlinked",
                    label: `Unlinked ${measurements.length - linkedCount}`,
                    testId: "takeoff-filter-unlinked",
                  },
                  {
                    value: "linked",
                    label: `Linked ${linkedCount}`,
                    testId: "takeoff-filter-linked",
                  },
                ].map((item) => (
                  <Button
                    key={item.value}
                    type="button"
                    size="sm"
                    variant={takeoffFilter === item.value ? "default" : "outline"}
                    className="h-8 px-2 text-xs"
                    onClick={() => {
                      setTakeoffFilter(item.value as TakeoffFilterMode);
                      setTakeoffSearch("");
                    }}
                    data-testid={item.testId}
                  >
                    {item.label}
                  </Button>
                ))}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Showing {visibleMeasurements.length} takeoffs. Selecting one opens its sheet and
                centers the markup.
              </p>
            </div>
            <div className="max-h-[520px] space-y-3 overflow-y-auto p-3">
              {measurements.length === 0 ? (
                <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
                  No takeoffs yet. Choose a tool, click the plan, and link the result to an estimate
                  row.
                </div>
              ) : visibleMeasurements.length === 0 ? (
                <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
                  No takeoffs match that navigator view. Clear the search or choose another filter.
                </div>
              ) : (
                visibleMeasurements.map((measurement) => {
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
                      data-testid="takeoff-navigator-row"
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
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 px-2 text-xs"
                            title="Open this takeoff on the drawing"
                            onClick={(event) => {
                              event.stopPropagation();
                              selectMeasurement(measurement);
                            }}
                            data-testid="takeoff-open-on-plan"
                          >
                            Open
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            title="Delete takeoff"
                            onClick={(event) => {
                              event.stopPropagation();
                              deleteMeasurementMutation.mutate(measurement.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4 text-danger" />
                          </Button>
                        </div>
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
  draftCommand,
  draftUnit,
  draftActionDisabled,
  onFinishDraft,
  tool,
  viewSize,
  onViewSizeChange,
  onPoint,
  isCockpitMode,
  selectedMeasurementId,
  onMeasurementSelect,
  onMeasurementGeometryChange,
  isGeometrySaving,
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
  draftCommand: DraftCommandStatus | null;
  draftUnit: string;
  draftActionDisabled: boolean;
  onFinishDraft: () => void;
  tool: ToolMode;
  viewSize: ViewSize;
  onViewSizeChange: (size: ViewSize) => void;
  onPoint: (point: Point) => void;
  isCockpitMode: boolean;
  selectedMeasurementId: string;
  onMeasurementSelect: (measurementId: string) => void;
  onMeasurementGeometryChange: (measurementId: string, points: Point[]) => Promise<void>;
  isGeometrySaving: boolean;
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
  const [miniMapDock, setMiniMapDock] = useState<MiniMapDock>("bottom-left");
  const [miniMapPosition, setMiniMapPosition] = useState<MiniMapPosition | null>(null);
  const [isMiniMapCollapsed, setIsMiniMapCollapsed] = useState(false);
  const [viewportFrame, setViewportFrame] = useState<ViewportFrame>(EMPTY_VIEWPORT_FRAME);
  const [renderQuality, setRenderQuality] = useState<RenderQualityStatus | null>(null);
  const [geometryEditDraft, setGeometryEditDraft] = useState<GeometryEditDraft | null>(null);
  const [geometryPreview, setGeometryPreview] = useState<{
    measurementId: string;
    points: Point[];
  } | null>(null);
  const panStartRef = useRef({ x: 0, y: 0, left: 0, top: 0, dragged: false });
  const zoomWindowClickBlockRef = useRef(false);
  const geometryEditClickBlockRef = useRef(false);
  const hasRevisionOverlay = Boolean(overlayPlanSet && overlaySheet);
  const overlayBlendMode = overlayMode === "compare" ? "multiply" : "normal";
  const selectedMeasurement =
    measurements.find((measurement) => measurement.id === selectedMeasurementId) ?? null;

  useEffect(() => {
    let active = true;
    setSignedUrl("");
    setRenderError("");
    setRenderQuality(null);
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
    if (planSet?.sample_key === "harbor-residence" || !planSet?.file_path) {
      setRenderQuality({
        label: "Vector sample",
        details: "Sample sheets render as vector training drawings.",
      });
    }
  }, [planSet?.file_path, planSet?.sample_key]);

  useEffect(() => {
    let cancelled = false;
    let renderTask: { promise: Promise<unknown>; cancel: () => void } | null = null;
    const renderPdf = async () => {
      if (!signedUrl || planSet?.file_mime_type !== "application/pdf" || !canvasRef.current) return;
      try {
        const pdfjs = await import("pdfjs-dist");
        configurePdfWorker(pdfjs);
        const pdf = await pdfjs.getDocument(await pdfDocumentSourceFor(signedUrl)).promise;
        const page = await pdf.getPage(sheet?.page_number ?? 1);
        const viewport = page.getViewport({ scale: 1 });
        const cssScale = pdfCssScaleFor(viewport);
        const renderPlan = pdfRenderPlanFor(
          viewport,
          cssScale,
          zoom,
          PDF_INSPECTION_RENDER_MULTIPLIER,
        );
        const renderScale = renderPlan.renderScale;
        const cssViewport = page.getViewport({ scale: cssScale });
        const renderViewport = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.round(renderViewport.width);
        canvas.height = Math.round(renderViewport.height);
        canvas.dataset.pdfRenderScale = renderScale.toFixed(3);
        canvas.dataset.pdfRenderWidth = String(canvas.width);
        canvas.dataset.pdfRenderHeight = String(canvas.height);
        canvas.dataset.pdfDetailMode = "inspection";
        setRenderQuality({
          label: renderPlan.capped ? "Max PDF detail" : "Sharp PDF",
          details: `${canvas.width.toLocaleString()} x ${canvas.height.toLocaleString()} PDF inspection render at ${renderScale.toFixed(
            2,
          )}x. Device limit: ${renderPlan.maxEdge.toLocaleString()}px edge / ${(
            renderPlan.maxPixels / 1_000_000
          ).toFixed(0)}M pixels.`,
          capped: renderPlan.capped,
        });
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
    setGeometryEditDraft(null);
    setGeometryPreview(null);
    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollLeft = 0;
      scrollRef.current.scrollTop = 0;
    });
  }, [sheet?.id]);

  useEffect(() => {
    setIsZoomWindowMode(false);
    setZoomWindowDraft(null);
    setGeometryEditDraft(null);
  }, [tool]);

  useEffect(() => {
    setGeometryEditDraft(null);
    setGeometryPreview(null);
  }, [selectedMeasurementId]);

  const clampZoom = (nextZoom: number) =>
    Math.min(MAX_PLAN_ZOOM, Math.max(MIN_PLAN_ZOOM, nextZoom));

  const updateViewportFrame = useCallback(() => {
    const stage = scrollRef.current;
    if (!stage || stage.scrollWidth <= 0 || stage.scrollHeight <= 0) {
      setViewportFrame(EMPTY_VIEWPORT_FRAME);
      return;
    }
    const scrollableWidth = Math.max(1, stage.scrollWidth);
    const scrollableHeight = Math.max(1, stage.scrollHeight);
    setViewportFrame({
      x: Math.min(1, Math.max(0, stage.scrollLeft / scrollableWidth)),
      y: Math.min(1, Math.max(0, stage.scrollTop / scrollableHeight)),
      width: Math.min(1, Math.max(0.05, stage.clientWidth / scrollableWidth)),
      height: Math.min(1, Math.max(0.05, stage.clientHeight / scrollableHeight)),
    });
  }, []);

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
      updateViewportFrame();
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

  const panBy = (left: number, top: number) => {
    scrollRef.current?.scrollBy({ left, top });
    requestAnimationFrame(updateViewportFrame);
  };

  const handleKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest("input,textarea,button,[role='combobox']")) return;

    if (event.key === "+" || event.key === "=") {
      event.preventDefault();
      zoomBy(PLAN_ZOOM_STEP);
      return;
    }
    if (event.key === "-") {
      event.preventDefault();
      zoomBy(-PLAN_ZOOM_STEP);
      return;
    }
    if (event.key === "0") {
      event.preventDefault();
      setActualSize();
      return;
    }
    if (event.key.toLowerCase() === "f") {
      event.preventDefault();
      fitToStage();
      return;
    }
    if (event.key.toLowerCase() === "w") {
      event.preventDefault();
      fitToWidth();
      return;
    }
    if (event.key.toLowerCase() === "z") {
      event.preventDefault();
      setIsZoomWindowMode((current) => !current);
      setZoomWindowDraft(null);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setIsZoomWindowMode(false);
      setZoomWindowDraft(null);
      setGeometryEditDraft(null);
      setGeometryPreview(null);
      return;
    }
    if (event.key === "Enter" && draftCommand?.ready && !draftActionDisabled) {
      event.preventDefault();
      onFinishDraft();
      return;
    }

    const panDistance = event.shiftKey ? 260 : 90;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      panBy(-panDistance, 0);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      panBy(panDistance, 0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      panBy(0, -panDistance);
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      panBy(0, panDistance);
    }
  };

  const jumpViewport = useCallback(
    (point: Point) => {
      const stage = scrollRef.current;
      if (!stage) return;
      stage.scrollLeft = Math.max(0, point.x * stage.scrollWidth - stage.clientWidth / 2);
      stage.scrollTop = Math.max(0, point.y * stage.scrollHeight - stage.clientHeight / 2);
      requestAnimationFrame(updateViewportFrame);
    },
    [updateViewportFrame],
  );

  useEffect(() => {
    if (!selectedMeasurement) return;
    const points = geometryPoints(selectedMeasurement.geometry);
    if (points.length === 0) return;
    const center =
      points.length === 1
        ? points[0]
        : {
            x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
            y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
          };
    requestAnimationFrame(() => jumpViewport(center));
  }, [jumpViewport, selectedMeasurement, sheet?.id, viewSize.height, viewSize.width, zoom]);

  useEffect(() => {
    requestAnimationFrame(updateViewportFrame);
  }, [updateViewportFrame, viewSize.height, viewSize.width, zoom]);

  useEffect(() => {
    const stage = scrollRef.current;
    if (!stage) return;
    stage.addEventListener("scroll", updateViewportFrame, { passive: true });
    window.addEventListener("resize", updateViewportFrame);
    updateViewportFrame();
    return () => {
      stage.removeEventListener("scroll", updateViewportFrame);
      window.removeEventListener("resize", updateViewportFrame);
    };
  }, [updateViewportFrame]);

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

  const pointsForMeasurement = (measurement: TakeoffMeasurementRow) => {
    if (geometryPreview?.measurementId === measurement.id) return geometryPreview.points;
    return geometryPoints(measurement.geometry);
  };

  const beginGeometryEdit = (
    event: ReactPointerEvent<SVGCircleElement>,
    measurement: TakeoffMeasurementRow,
    pointIndex: number,
  ) => {
    if (tool !== "select" || isGeometrySaving) return;
    event.stopPropagation();
    event.preventDefault();
    const points = pointsForMeasurement(measurement);
    if (!points[pointIndex]) return;
    onMeasurementSelect(measurement.id);
    setGeometryEditDraft({ measurementId: measurement.id, pointIndex, points });
    setGeometryPreview({ measurementId: measurement.id, points });
    geometryEditClickBlockRef.current = true;
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (geometryEditDraft) return;
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
    if (geometryEditDraft) {
      const point = pointFromClient(event.clientX, event.clientY);
      if (!point) return;
      const nextPoints = geometryEditDraft.points.map((current, index) =>
        index === geometryEditDraft.pointIndex ? point : current,
      );
      setGeometryEditDraft((current) => (current ? { ...current, points: nextPoints } : current));
      setGeometryPreview({ measurementId: geometryEditDraft.measurementId, points: nextPoints });
      return;
    }
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
    if (geometryEditDraft) {
      const point = pointFromClient(event.clientX, event.clientY);
      const completedPoints = point
        ? geometryEditDraft.points.map((current, index) =>
            index === geometryEditDraft.pointIndex ? point : current,
          )
        : geometryEditDraft.points;
      const measurementId = geometryEditDraft.measurementId;
      setGeometryEditDraft(null);
      setGeometryPreview({ measurementId, points: completedPoints });
      if (svgRef.current?.hasPointerCapture(event.pointerId)) {
        svgRef.current.releasePointerCapture(event.pointerId);
      }
      void onMeasurementGeometryChange(measurementId, completedPoints).catch((error) => {
        setGeometryPreview(null);
        toast.error(error instanceof Error ? error.message : "Takeoff geometry did not save");
      });
      return;
    }
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
    if (geometryEditClickBlockRef.current) {
      geometryEditClickBlockRef.current = false;
      return;
    }
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
  const canOpenOriginalPdf =
    Boolean(signedUrl) && planSet?.file_mime_type === "application/pdf" && !planSet?.sample_key;

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
          {renderQuality && (
            <Badge
              variant={renderQuality.capped ? "secondary" : "outline"}
              title={renderQuality.details}
              data-testid="plan-render-quality"
            >
              {renderQuality.label}
            </Badge>
          )}
          {planSet?.file_mime_type === "application/pdf" && !planSet?.sample_key && (
            <Badge
              variant="outline"
              title="Uploaded PDFs render at a higher backing resolution so plan notes stay readable while you zoom."
              data-testid="plan-pdf-inspection-mode"
            >
              Inspection render
            </Badge>
          )}
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
          {canOpenOriginalPdf && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              title="Open the untouched source PDF in a new tab"
              asChild
              data-testid="plan-open-original-pdf"
            >
              <a href={signedUrl} target="_blank" rel="noreferrer">
                <ExternalLink className="h-3.5 w-3.5" />
                Open PDF
              </a>
            </Button>
          )}
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

      <TakeoffDraftHud
        draftCommand={draftCommand}
        activePointCount={tool === "calibrate" ? calibrationPoints.length : pendingPoints.length}
        disabled={draftActionDisabled}
        onFinishDraft={onFinishDraft}
      />

      <div
        ref={scrollRef}
        tabIndex={0}
        className={cn(
          "relative min-h-0 overflow-auto rounded-md border border-hairline bg-[#f7f4ef] shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
          isCockpitMode ? "flex-1" : "h-[min(72vh,760px)]",
        )}
        onWheel={handleWheel}
        onKeyDown={handleKeyboard}
        aria-label="Plan drawing viewport"
        title="Plan viewport: use +/- to zoom, arrows to pan, F to fit, W for width, Z for zoom area, Esc to cancel."
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
                  setRenderQuality({
                    label: "Image source",
                    details: `${img.naturalWidth.toLocaleString()} x ${img.naturalHeight.toLocaleString()} uploaded image source.`,
                  });
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
                  pointsOverride={
                    geometryPreview?.measurementId === measurement.id
                      ? geometryPreview.points
                      : null
                  }
                  editable={
                    tool === "select" &&
                    selectedMeasurement?.id === measurement.id &&
                    !isGeometrySaving
                  }
                  onSelect={onMeasurementSelect}
                  onPointDragStart={beginGeometryEdit}
                />
              ))}
              <DraftShape
                points={pendingPoints}
                viewSize={viewSize}
                color="#1b7a6e"
                dashed
                closed={tool === "area"}
                scaleFeetPerPixel={sheet?.scale_feet_per_pixel ?? 0}
                unit={draftUnit}
                tool={tool}
                command={draftCommand}
              />
              <DraftShape
                points={calibrationPoints}
                viewSize={viewSize}
                color="#111827"
                dashed
                closed={false}
                scaleFeetPerPixel={0}
                unit="px"
                tool={tool === "calibrate" ? "calibrate" : "select"}
                command={tool === "calibrate" ? draftCommand : null}
              />
              <ZoomWindowShape draft={zoomWindowDraft} viewSize={viewSize} />
            </svg>
          </div>
        </div>
        <PlanMiniMap
          viewSize={viewSize}
          measurements={measurements}
          viewportFrame={viewportFrame}
          onJump={jumpViewport}
          dock={miniMapDock}
          onDockChange={(dock) => {
            setMiniMapDock(dock);
            setMiniMapPosition(null);
          }}
          position={miniMapPosition}
          onPositionChange={setMiniMapPosition}
          collapsed={isMiniMapCollapsed}
          onCollapsedChange={setIsMiniMapCollapsed}
        />
      </div>
    </div>
  );
}

function PlanMiniMap({
  viewSize,
  measurements,
  viewportFrame,
  onJump,
  dock,
  onDockChange,
  position,
  onPositionChange,
  collapsed,
  onCollapsedChange,
}: {
  viewSize: ViewSize;
  measurements: TakeoffMeasurementRow[];
  viewportFrame: ViewportFrame;
  onJump: (point: Point) => void;
  dock: MiniMapDock;
  onDockChange: (dock: MiniMapDock) => void;
  position: MiniMapPosition | null;
  onPositionChange: (position: MiniMapPosition | null) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null>(null);
  const dockClass = {
    "bottom-left": "bottom-3 left-3",
    "bottom-right": "bottom-3 right-3",
    "top-left": "left-3 top-3",
    "top-right": "right-3 top-3",
  }[dock];
  const nextDock = {
    "bottom-left": "bottom-right",
    "bottom-right": "top-right",
    "top-right": "top-left",
    "top-left": "bottom-left",
  }[dock] as MiniMapDock;
  const jumpFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const point = {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
    onJump(point);
  };
  const positionStyle = position
    ? {
        left: `${position.x}px`,
        top: `${position.y}px`,
      }
    : undefined;
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const panel = mapRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) return;
    const panelRect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    dragRef.current = {
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
      width: panelRect.width,
      height: panelRect.height,
    };
    onPositionChange({
      x: Math.max(
        0,
        Math.min(parentRect.width - panelRect.width, panelRect.left - parentRect.left),
      ),
      y: Math.max(
        0,
        Math.min(parentRect.height - panelRect.height, panelRect.top - parentRect.top),
      ),
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const dragMap = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const parent = mapRef.current?.offsetParent as HTMLElement | null;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const maxX = Math.max(0, parentRect.width - dragRef.current.width);
    const maxY = Math.max(0, parentRect.height - dragRef.current.height);
    onPositionChange({
      x: Math.max(0, Math.min(maxX, event.clientX - parentRect.left - dragRef.current.offsetX)),
      y: Math.max(0, Math.min(maxY, event.clientY - parentRect.top - dragRef.current.offsetY)),
    });
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className={cn(
          "absolute z-20 hidden items-center gap-2 rounded-md border border-hairline bg-card/95 px-3 py-2 text-xs font-medium text-card-foreground shadow-lg backdrop-blur sm:flex",
          position ? "" : dockClass,
        )}
        style={positionStyle}
        onClick={() => onCollapsedChange(false)}
        data-testid="plan-minimap-collapsed"
        title="Show sheet map"
      >
        <MapIcon className="h-3.5 w-3.5" />
        Sheet Map
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          {measurements.length}
        </Badge>
      </button>
    );
  }

  return (
    <div
      ref={mapRef}
      className={cn(
        "absolute z-20 hidden w-52 overflow-hidden rounded-md border border-hairline bg-card/95 text-card-foreground shadow-lg backdrop-blur sm:block",
        position ? "" : dockClass,
      )}
      style={positionStyle}
      data-testid="plan-minimap"
      title="Sheet map. Drag the header to move it, dock it in a corner, or hide it."
    >
      <div
        className="flex cursor-move touch-none items-center justify-between gap-2 border-b border-hairline bg-surface px-2 py-1.5"
        onPointerDown={beginDrag}
        onPointerMove={dragMap}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        data-testid="plan-minimap-drag-handle"
        title="Drag to move sheet map"
      >
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          <MapIcon className="h-3 w-3" />
          Sheet Map
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {measurements.length} marks
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onDockChange(nextDock);
            }}
            data-testid="plan-minimap-dock"
            title="Dock sheet map in another corner"
          >
            Dock
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onCollapsedChange(true);
            }}
            data-testid="plan-minimap-collapse"
            title="Hide sheet map"
          >
            <Minimize2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div
        role="button"
        tabIndex={0}
        onPointerDown={jumpFromEvent}
        onPointerMove={(event) => {
          if (event.buttons === 1) jumpFromEvent(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onJump({ x: 0.5, y: 0.5 });
          }
        }}
        title="Click or drag to jump around the sheet"
      >
        <svg
          viewBox={`0 0 ${viewSize.width} ${viewSize.height}`}
          className="block aspect-[4/3] w-full bg-[#fffefa]"
          preserveAspectRatio="xMidYMid meet"
        >
          <rect
            x="0"
            y="0"
            width={viewSize.width}
            height={viewSize.height}
            fill="#fffefa"
            stroke="#ded6c8"
            strokeWidth="8"
          />
          {measurements.slice(0, 60).map((measurement) => (
            <MiniMapMeasurement
              key={measurement.id}
              measurement={measurement}
              viewSize={viewSize}
            />
          ))}
          <rect
            x={viewportFrame.x * viewSize.width}
            y={viewportFrame.y * viewSize.height}
            width={Math.max(18, viewportFrame.width * viewSize.width)}
            height={Math.max(18, viewportFrame.height * viewSize.height)}
            fill="#1b7a6e18"
            stroke="#1b7a6e"
            strokeWidth="10"
            data-testid="plan-minimap-frame"
          />
        </svg>
      </div>
    </div>
  );
}

function TakeoffDraftHud({
  draftCommand,
  activePointCount,
  disabled,
  onFinishDraft,
}: {
  draftCommand: DraftCommandStatus | null;
  activePointCount: number;
  disabled: boolean;
  onFinishDraft: () => void;
}) {
  if (!draftCommand) return null;

  return (
    <div
      className="mb-3 grid gap-3 rounded-md border border-hairline bg-card px-3 py-2 shadow-sm md:grid-cols-[minmax(0,1fr)_auto]"
      data-testid="takeoff-draft-hud"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium">{draftCommand.title}</p>
          <Badge variant={draftCommand.ready ? "secondary" : "outline"}>
            {activePointCount} point{activePointCount === 1 ? "" : "s"}
          </Badge>
          <Badge variant="outline" data-testid="takeoff-draft-live-quantity">
            {draftCommand.value}
          </Badge>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">{draftCommand.detail}</p>
      </div>
      <Button
        type="button"
        size="sm"
        className="gap-1.5 self-center"
        onClick={onFinishDraft}
        disabled={!draftCommand.ready || disabled}
        data-testid="takeoff-draft-hud-finish"
      >
        <Check className="h-3.5 w-3.5" />
        {draftCommand.actionLabel}
      </Button>
    </div>
  );
}

function MiniMapMeasurement({
  measurement,
  viewSize,
}: {
  measurement: TakeoffMeasurementRow;
  viewSize: ViewSize;
}) {
  const points = geometryPoints(measurement.geometry).map((point) => ({
    x: point.x * viewSize.width,
    y: point.y * viewSize.height,
  }));
  if (points.length === 0) return null;
  const pointText = points.map((point) => `${point.x},${point.y}`).join(" ");

  if (measurement.tool_type === "count") {
    return points.map((point, index) => (
      <circle
        key={`${measurement.id}-${index}`}
        cx={point.x}
        cy={point.y}
        r="14"
        fill={measurement.color}
        opacity="0.7"
      />
    ));
  }

  if (measurement.tool_type === "area" && points.length >= 3) {
    return (
      <polygon
        points={pointText}
        fill={`${measurement.color}24`}
        stroke={measurement.color}
        strokeWidth="8"
      />
    );
  }

  return (
    <polyline
      points={pointText}
      fill="none"
      stroke={measurement.color}
      strokeWidth="10"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
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
        configurePdfWorker(pdfjs);
        const pdf = await pdfjs.getDocument(await pdfDocumentSourceFor(signedUrl)).promise;
        const page = await pdf.getPage(sheet.page_number || 1);
        const viewport = page.getViewport({ scale: 1 });
        const scale = Math.min(viewSize.width / viewport.width, viewSize.height / viewport.height);
        const cssScale = Math.max(0.1, scale);
        const renderScale = pdfRenderScaleFor(
          viewport,
          cssScale,
          zoom,
          PDF_INSPECTION_RENDER_MULTIPLIER,
        );
        const scaled = page.getViewport({ scale: renderScale });
        const canvas = canvasRef.current;
        if (!canvas || cancelled) return;
        canvas.width = Math.round(scaled.width);
        canvas.height = Math.round(scaled.height);
        canvas.dataset.pdfRenderScale = renderScale.toFixed(3);
        canvas.dataset.pdfRenderWidth = String(canvas.width);
        canvas.dataset.pdfRenderHeight = String(canvas.height);
        canvas.dataset.pdfDetailMode = "inspection";
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
  editable,
  pointsOverride,
  onSelect,
  onPointDragStart,
}: {
  measurement: TakeoffMeasurementRow;
  viewSize: ViewSize;
  selected: boolean;
  editable: boolean;
  pointsOverride: Point[] | null;
  onSelect: (measurementId: string) => void;
  onPointDragStart: (
    event: ReactPointerEvent<SVGCircleElement>,
    measurement: TakeoffMeasurementRow,
    pointIndex: number,
  ) => void;
}) {
  const points = pointsOverride ?? geometryPoints(measurement.geometry);
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
        <MeasurementEditHandles
          points={scaled}
          measurement={measurement}
          editable={editable}
          onPointDragStart={onPointDragStart}
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
      <g className="cursor-pointer" onClick={handleSelect}>
        {scaled.map((point, index) => (
          <g key={`${point.x}-${point.y}-${index}`}>
            {selected && <circle cx={point.x} cy={point.y} r="16" fill="white" stroke="#111827" />}
            <circle cx={point.x} cy={point.y} r="11" fill={measurement.color} />
            {editable && (
              <circle
                cx={point.x}
                cy={point.y}
                r="18"
                fill="transparent"
                className="cursor-move"
                data-testid="takeoff-edit-handle"
                aria-label={`Move ${measurement.label} point ${index + 1}`}
                onPointerDown={(event) => onPointDragStart(event, measurement, index)}
              />
            )}
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
      <MeasurementEditHandles
        points={scaled}
        measurement={measurement}
        editable={editable}
        onPointDragStart={onPointDragStart}
      />
      <MeasurementLabel
        x={labelPoint.x + 10}
        y={labelPoint.y - 10}
        color={measurement.color}
        text={formatQty(measurement.quantity, measurement.unit)}
      />
    </g>
  );
}

function MeasurementEditHandles({
  points,
  measurement,
  editable,
  onPointDragStart,
}: {
  points: Array<{ x: number; y: number }>;
  measurement: TakeoffMeasurementRow;
  editable: boolean;
  onPointDragStart: (
    event: ReactPointerEvent<SVGCircleElement>,
    measurement: TakeoffMeasurementRow,
    pointIndex: number,
  ) => void;
}) {
  if (!editable) return null;
  return (
    <g data-testid="takeoff-edit-handles">
      {points.map((point, index) => (
        <circle
          key={`${measurement.id}-edit-${index}`}
          cx={point.x}
          cy={point.y}
          r="9"
          fill="white"
          stroke={measurement.color}
          strokeWidth="3"
          className="cursor-move"
          data-testid="takeoff-edit-handle"
          aria-label={`Move ${measurement.label} point ${index + 1}`}
          onPointerDown={(event) => onPointDragStart(event, measurement, index)}
        />
      ))}
    </g>
  );
}

function DraftShape({
  points,
  viewSize,
  color,
  dashed,
  closed,
  scaleFeetPerPixel,
  unit,
  tool,
  command,
}: {
  points: Point[];
  viewSize: ViewSize;
  color: string;
  dashed?: boolean;
  closed?: boolean;
  scaleFeetPerPixel: number;
  unit: string;
  tool: ToolMode;
  command: DraftCommandStatus | null;
}) {
  if (points.length === 0) return null;
  const scaled = points.map((point) => ({
    x: point.x * viewSize.width,
    y: point.y * viewSize.height,
  }));
  const pointText = scaled.map((point) => `${point.x},${point.y}`).join(" ");

  if (tool === "count") {
    return (
      <g data-testid="takeoff-draft-points" pointerEvents="none">
        {scaled.map((point, index) => (
          <g key={`${point.x}-${point.y}-${index}`}>
            <circle cx={point.x} cy={point.y} r="12" fill="white" stroke={color} strokeWidth="3" />
            <circle cx={point.x} cy={point.y} r="7" fill={color} />
            <DraftPointLabel x={point.x + 10} y={point.y - 10} text={`${index + 1}`} />
          </g>
        ))}
        {command && (
          <DraftCommandLabel
            x={scaled[0].x + 18}
            y={scaled[0].y - 22}
            color={color}
            text={command.value}
          />
        )}
      </g>
    );
  }

  return (
    <g data-testid="takeoff-draft-points" pointerEvents="none">
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
        <g key={index}>
          <circle cx={point.x} cy={point.y} r="5" fill={color} />
          <DraftPointLabel x={point.x + 8} y={point.y - 8} text={`${index + 1}`} />
        </g>
      ))}
      {tool === "linear" &&
        scaleFeetPerPixel > 0 &&
        scaled.slice(1).map((point, index) => {
          const previous = scaled[index];
          const length = Math.hypot(point.x - previous.x, point.y - previous.y) * scaleFeetPerPixel;
          return (
            <DraftSegmentLabel
              key={`${point.x}-${point.y}-${index}`}
              x={(point.x + previous.x) / 2}
              y={(point.y + previous.y) / 2}
              text={formatQty(length, unit)}
            />
          );
        })}
      {tool === "calibrate" && scaled.length === 2 && (
        <DraftSegmentLabel
          x={(scaled[0].x + scaled[1].x) / 2}
          y={(scaled[0].y + scaled[1].y) / 2}
          text={`${Math.round(distancePx(points, viewSize)).toLocaleString()} px`}
        />
      )}
      {command && (
        <DraftCommandLabel
          x={scaled[0].x + 14}
          y={scaled[0].y - 24}
          color={color}
          text={command.value}
        />
      )}
    </g>
  );
}

function DraftPointLabel({ x, y, text }: { x: number; y: number; text: string }) {
  return (
    <g data-testid="takeoff-draft-point-label">
      <circle cx={x} cy={y - 3} r="8" fill="white" stroke="#28231d" strokeWidth="1" />
      <text x={x} y={y + 1} textAnchor="middle" fill="#28231d" fontSize="9" fontWeight="700">
        {text}
      </text>
    </g>
  );
}

function DraftSegmentLabel({ x, y, text }: { x: number; y: number; text: string }) {
  const width = Math.max(58, text.length * 6.5);
  return (
    <g data-testid="takeoff-draft-segment-label">
      <rect x={x - width / 2} y={y - 24} width={width} height="20" rx="4" fill="white" />
      <rect
        x={x - width / 2}
        y={y - 24}
        width={width}
        height="20"
        rx="4"
        fill="#28231d10"
        stroke="#28231d"
        strokeWidth="0.75"
      />
      <text x={x} y={y - 10} textAnchor="middle" fill="#28231d" fontSize="10" fontWeight="700">
        {text}
      </text>
    </g>
  );
}

function DraftCommandLabel({
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
  const width = Math.max(80, text.length * 7);
  return (
    <g data-testid="takeoff-draft-command-label">
      <rect x={x} y={y - 20} width={width} height="24" rx="4" fill="white" />
      <rect x={x} y={y - 20} width={width} height="24" rx="4" fill={`${color}18`} stroke={color} />
      <text x={x + 8} y={y - 4} fill="#28231d" fontSize="11" fontWeight="700">
        {text}
      </text>
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
