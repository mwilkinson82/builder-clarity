import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  EyeOff,
  FileUp,
  Layers,
  Link2,
  Maximize2,
  Minimize2,
  Save,
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
import { distancePx } from "@/lib/plan-room-math";
import type { EstimateLineItemRow, EstimateRow } from "@/lib/estimates.functions";
import {
  COCKPIT_CHROME_PANEL_TOP_GAP,
  COCKPIT_PANEL_EDGE_GAP,
  COCKPIT_PANEL_LAYOUT_STORAGE_KEY,
  COCKPIT_PANEL_MAX_HEIGHT,
  COCKPIT_PANEL_MAX_WIDTH,
  COCKPIT_PANEL_MIN_HEIGHT,
  COCKPIT_PANEL_MIN_WIDTH,
  DEFAULT_COCKPIT_PANEL_LAYOUTS,
  DEFAULT_TAKEOFF_LAYER_VISIBILITY,
  DEFAULT_VIEW_SIZE,
  QUICK_CALIBRATION_FEET,
  TAKEOFF_COLORS,
  TAKEOFF_LAYER_COPY,
  TAKEOFF_LAYER_KEYS,
  TAKEOFF_LAYER_TEST_IDS,
  buildTakeoffCsv,
  buildTakeoffSummary,
  calculateQuantity,
  centsToDollars,
  clampNumber,
  coerceCockpitPanelLayout,
  copyTextToClipboard,
  downloadTextFile,
  draftCommandFor,
  formatQty,
  geometryFromPoints,
  geometryPoints,
  measurementMatchesTakeoffLayers,
  planSetStatusLabel,
  safeReportFileName,
  searchMatches,
  sheetDisplayName,
  slugFileName,
  toolLabel,
  unitFor,
  type CockpitPanelInteraction,
  type CockpitPanelKey,
  type CockpitPanelLayout,
  type Point,
  type RevisionOverlayMode,
  type SheetFilterMode,
  type TakeoffFilterMode,
  type TakeoffLayerKey,
  type TakeoffLayerVisibility,
  type ToolMode,
  type ViewSize,
} from "./planRoomShared";
import { PlanCanvas, getPdfPageCount } from "./PdfSheetViewer";
import { TakeoffTools } from "./TakeoffTools";
import { TakeoffWorksheet } from "./TakeoffWorksheet";
import { CockpitFloatingPanelHeader, SheetSidebar } from "./SheetSidebar";
import { ReadinessPanel } from "./ReadinessPanel";

interface PlanRoomWorkspaceProps {
  estimate: EstimateRow;
  lineItems: EstimateLineItemRow[];
  planSets: PlanSetRow[];
  sheets: PlanSheetRow[];
  measurements: TakeoffMeasurementRow[];
  companyName?: string;
  schemaReady?: boolean;
  schemaMessage?: string;
  // Estimate line to focus on load: selects its first takeoff measurement
  // and that measurement's sheet (used by the estimate grid takeoff badge).
  focusLineItemId?: string;
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
  focusLineItemId = "",
}: PlanRoomWorkspaceProps) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const focusLineAppliedRef = useRef(false);
  const mainRef = useRef<HTMLElement | null>(null);
  const cockpitPanelInteractionRef = useRef<CockpitPanelInteraction | null>(null);
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
  const [cockpitPanels, setCockpitPanels] = useState<Record<CockpitPanelKey, boolean>>({
    drawings: false,
    tools: false,
  });
  const [cockpitPanelLayouts, setCockpitPanelLayouts] = useState<
    Record<CockpitPanelKey, CockpitPanelLayout>
  >(DEFAULT_COCKPIT_PANEL_LAYOUTS);
  const [cockpitChromeVisible, setCockpitChromeVisible] = useState(true);
  const [overlaySheetId, setOverlaySheetId] = useState("");
  const [overlayOpacity, setOverlayOpacity] = useState(65);
  const [overlayMode, setOverlayMode] = useState<RevisionOverlayMode>("compare");
  const [selectedMeasurementId, setSelectedMeasurementId] = useState("");
  const [sheetSearch, setSheetSearch] = useState("");
  const [sheetFilter, setSheetFilter] = useState<SheetFilterMode>("all");
  const [takeoffSearch, setTakeoffSearch] = useState("");
  const [takeoffFilter, setTakeoffFilter] = useState<TakeoffFilterMode>("all");
  const [takeoffLayerVisibility, setTakeoffLayerVisibility] = useState<TakeoffLayerVisibility>(
    DEFAULT_TAKEOFF_LAYER_VISIBILITY,
  );
  const [selectedMeasurementDraft, setSelectedMeasurementDraft] = useState({
    color: TAKEOFF_COLORS[0],
    label: "",
    notes: "",
    quantity: "",
    unit: "",
  });
  const [takeoffSummaryFallback, setTakeoffSummaryFallback] = useState("");

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
  const sheetMeasurements = useMemo(
    () => measurements.filter((measurement) => measurement.plan_sheet_id === currentSheet?.id),
    [currentSheet?.id, measurements],
  );
  const takeoffLayerCounts = useMemo(() => {
    const counts: Record<TakeoffLayerKey, number> = {
      linear: 0,
      area: 0,
      count: 0,
      linked: 0,
      unlinked: 0,
    };
    for (const measurement of sheetMeasurements) {
      counts[measurement.tool_type] += 1;
      if (measurement.estimate_line_item_id) counts.linked += 1;
      else counts.unlinked += 1;
    }
    return counts;
  }, [sheetMeasurements]);
  const visibleSheetMeasurements = useMemo(
    () =>
      sheetMeasurements.filter((measurement) =>
        measurementMatchesTakeoffLayers(measurement, takeoffLayerVisibility),
      ),
    [sheetMeasurements, takeoffLayerVisibility],
  );
  const hiddenSheetMeasurementCount = sheetMeasurements.length - visibleSheetMeasurements.length;
  const allTakeoffLayersVisible = TAKEOFF_LAYER_KEYS.every((key) => takeoffLayerVisibility[key]);
  const noTakeoffLayersVisible = TAKEOFF_LAYER_KEYS.every((key) => !takeoffLayerVisibility[key]);
  const setAllTakeoffLayersVisible = (visible: boolean) =>
    setTakeoffLayerVisibility({
      linear: visible,
      area: visible,
      count: visible,
      linked: visible,
      unlinked: visible,
    });
  const toggleTakeoffLayer = (key: TakeoffLayerKey) =>
    setTakeoffLayerVisibility((current) => ({ ...current, [key]: !current[key] }));
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
  const sheetNavigationItems = useMemo(
    () =>
      sheets
        .map((sheet) => {
          const planSet = planSets.find((item) => item.id === sheet.plan_set_id) ?? null;
          return {
            sheet,
            planSet,
            measurementCount: measurementCountBySheet.get(sheet.id) ?? 0,
            label: sheetDisplayName(sheet, planSet),
          };
        })
        .sort((a, b) => {
          const setSort =
            planSets.findIndex((item) => item.id === a.sheet.plan_set_id) -
            planSets.findIndex((item) => item.id === b.sheet.plan_set_id);
          if (setSort !== 0) return setSort;
          return a.sheet.sort_order - b.sheet.sort_order;
        }),
    [measurementCountBySheet, planSets, sheets],
  );
  const currentSheetNavigationIndex = currentSheet
    ? sheetNavigationItems.findIndex((item) => item.sheet.id === currentSheet.id)
    : -1;
  const currentSheetNavigationItem =
    currentSheetNavigationIndex >= 0 ? sheetNavigationItems[currentSheetNavigationIndex] : null;
  const previousSheetNavigationItem =
    currentSheetNavigationIndex > 0 ? sheetNavigationItems[currentSheetNavigationIndex - 1] : null;
  const nextSheetNavigationItem =
    currentSheetNavigationIndex >= 0 &&
    currentSheetNavigationIndex < sheetNavigationItems.length - 1
      ? sheetNavigationItems[currentSheetNavigationIndex + 1]
      : null;
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
    if (!focusLineItemId || focusLineAppliedRef.current) return;
    const measurement = measurements.find((item) => item.estimate_line_item_id === focusLineItemId);
    if (!measurement) return;
    focusLineAppliedRef.current = true;
    setSelectedMeasurementId(measurement.id);
    setSelectedSheetId(measurement.plan_sheet_id);
  }, [focusLineItemId, measurements]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(COCKPIT_PANEL_LAYOUT_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as {
        layouts?: Partial<Record<CockpitPanelKey, unknown>>;
        chromeVisible?: unknown;
      };
      setCockpitPanelLayouts({
        drawings: coerceCockpitPanelLayout(
          parsed.layouts?.drawings,
          DEFAULT_COCKPIT_PANEL_LAYOUTS.drawings,
        ),
        tools: coerceCockpitPanelLayout(parsed.layouts?.tools, DEFAULT_COCKPIT_PANEL_LAYOUTS.tools),
      });
      if (typeof parsed.chromeVisible === "boolean") {
        setCockpitChromeVisible(parsed.chromeVisible);
      }
    } catch {
      window.localStorage.removeItem(COCKPIT_PANEL_LAYOUT_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(
      COCKPIT_PANEL_LAYOUT_STORAGE_KEY,
      JSON.stringify({
        layouts: cockpitPanelLayouts,
        chromeVisible: cockpitChromeVisible,
      }),
    );
  }, [cockpitChromeVisible, cockpitPanelLayouts]);

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
    mutationFn: ({ lineId, force = false }: { lineId: string; force?: boolean }) =>
      syncLineFn({
        data: { estimate_id: estimate.id, estimate_line_item_id: lineId, force },
      }),
    onSuccess: (result, variables) => {
      if (result.sync.conflict) {
        // The estimate row's quantity was typed by hand; show old -> new and
        // ask before replacing it.
        const confirmed = window.confirm(
          `This estimate row's quantity was typed by hand: ${formatQty(result.sync.quantity, "")}. ` +
            `The takeoff measures ${formatQty(result.sync.takeoff_quantity, "")} (waste applied). ` +
            "Replace the hand-typed quantity with the takeoff number?",
        );
        if (confirmed) {
          syncLineMutation.mutate({ lineId: variables.lineId, force: true });
        }
        return;
      }
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
  const unlinkedMeasurements = useMemo(
    () => measurements.filter((measurement) => !measurement.estimate_line_item_id),
    [measurements],
  );
  const unscaledSheets = useMemo(
    () => sheets.filter((sheet) => !sheet.scale_feet_per_pixel),
    [sheets],
  );
  const takeoffReportArgs = {
    estimate,
    companyName,
    lineItems,
    planSets,
    sheets,
    measurements,
  };
  const downloadTakeoffCsv = () => {
    if (measurements.length === 0) {
      toast.info("No takeoffs to export yet.");
      return;
    }
    downloadTextFile(
      safeReportFileName(`${estimate.name}-takeoffs`, "csv"),
      buildTakeoffCsv(takeoffReportArgs),
      "text/csv;charset=utf-8",
    );
    toast.success("Takeoff CSV exported");
  };
  const copyTakeoffSummary = async () => {
    if (measurements.length === 0) {
      toast.info("No takeoffs to copy yet.");
      return;
    }
    const summary = buildTakeoffSummary(takeoffReportArgs);
    try {
      await copyTextToClipboard(summary);
      setTakeoffSummaryFallback("");
      toast.success("Takeoff summary copied");
    } catch (error) {
      setTakeoffSummaryFallback(summary);
      toast.warning(
        error instanceof Error
          ? `${error.message} Summary is ready below.`
          : "Clipboard access was blocked. Summary is ready below.",
      );
    }
  };
  const backendReady = schemaReady !== false;
  const currentSheetTitle = currentSheet
    ? `${currentSheet.sheet_number} ${currentSheet.sheet_name}`.trim()
    : "No sheet selected";
  const openSheet = (sheetId: string) => {
    setSelectedSheetId(sheetId);
    setPendingPoints([]);
    setCalibrationPoints([]);
    if (selectedMeasurement?.plan_sheet_id !== sheetId) {
      setSelectedMeasurementId("");
    }
  };
  const openFirstUnscaledSheet = () => {
    const sheet = unscaledSheets[0];
    if (!sheet) return;
    openSheet(sheet.id);
    setTool("calibrate");
    setCockpitPanels((current) => ({ ...current, tools: true }));
    toast.info("Opened the first sheet that still needs scale.");
  };
  const showUnlinkedTakeoffs = () => {
    setTakeoffFilter("unlinked");
    setTakeoffSearch("");
    const measurement = unlinkedMeasurements[0];
    if (measurement) selectMeasurement(measurement);
  };
  const openAdjacentSheet = (direction: -1 | 1) => {
    const nextItem = direction < 0 ? previousSheetNavigationItem : nextSheetNavigationItem;
    if (!nextItem) return;
    openSheet(nextItem.sheet.id);
  };
  const toggleCockpitPanel = (panel: CockpitPanelKey) =>
    setCockpitPanels((current) => ({ ...current, [panel]: !current[panel] }));
  const showCockpitPanels = () => setCockpitPanels({ drawings: true, tools: true });
  const hideCockpitPanels = () => setCockpitPanels({ drawings: false, tools: false });
  const clampCockpitPanelLayout = (layout: CockpitPanelLayout): CockpitPanelLayout => {
    const parent = mainRef.current;
    const parentRect = parent?.getBoundingClientRect();
    const parentWidth =
      parentRect?.width ?? (typeof window === "undefined" ? 1800 : window.innerWidth);
    const parentHeight =
      parentRect?.height ?? (typeof window === "undefined" ? 900 : window.innerHeight - 48);
    const maxWidth = Math.min(COCKPIT_PANEL_MAX_WIDTH, parentWidth - COCKPIT_PANEL_EDGE_GAP * 2);
    const maxHeight = Math.min(COCKPIT_PANEL_MAX_HEIGHT, parentHeight - COCKPIT_PANEL_EDGE_GAP * 2);
    const width = clampNumber(layout.width, COCKPIT_PANEL_MIN_WIDTH, Math.max(280, maxWidth));
    const height = clampNumber(layout.height, COCKPIT_PANEL_MIN_HEIGHT, Math.max(280, maxHeight));
    const y = clampNumber(
      layout.y,
      COCKPIT_PANEL_EDGE_GAP,
      Math.max(COCKPIT_PANEL_EDGE_GAP, parentHeight - height - COCKPIT_PANEL_EDGE_GAP),
    );
    const x =
      layout.x === null
        ? null
        : clampNumber(
            layout.x,
            COCKPIT_PANEL_EDGE_GAP,
            Math.max(COCKPIT_PANEL_EDGE_GAP, parentWidth - width - COCKPIT_PANEL_EDGE_GAP),
          );
    return { ...layout, x, y, width, height };
  };
  const cockpitPanelStyle = (panel: CockpitPanelKey): CSSProperties => {
    const rawLayout = cockpitPanelLayouts[panel];
    const layout = clampCockpitPanelLayout({
      ...rawLayout,
      y: Math.max(
        cockpitChromeVisible ? COCKPIT_CHROME_PANEL_TOP_GAP : COCKPIT_PANEL_EDGE_GAP,
        rawLayout.y,
      ),
    });
    const style: CSSProperties = {
      top: layout.y,
      width: layout.width,
      height: layout.height,
      maxHeight: `calc(100% - ${layout.y + COCKPIT_PANEL_EDGE_GAP}px)`,
    };
    if (layout.x === null) {
      if (layout.anchor === "left") style.left = COCKPIT_PANEL_EDGE_GAP;
      else style.right = COCKPIT_PANEL_EDGE_GAP;
    } else {
      style.left = layout.x;
    }
    return style;
  };
  const cockpitPanelLayoutLabel = (panel: CockpitPanelKey) => {
    const layout = cockpitPanelLayouts[panel];
    return `${Math.round(layout.width)} x ${Math.round(layout.height)} · ${
      layout.x === null ? `docked ${layout.anchor}` : "custom position"
    }`;
  };
  const resetCockpitPanelLayout = (panel: CockpitPanelKey) =>
    setCockpitPanelLayouts((current) => ({
      ...current,
      [panel]: DEFAULT_COCKPIT_PANEL_LAYOUTS[panel],
    }));
  const beginCockpitPanelMove = (
    panel: CockpitPanelKey,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const panelElement = event.currentTarget.closest<HTMLElement>("[data-cockpit-panel-key]");
    const parent = mainRef.current;
    if (!panelElement || !parent) return;
    const panelRect = panelElement.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    cockpitPanelInteractionRef.current = {
      key: panel,
      mode: "move",
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
      startWidth: panelRect.width,
      startHeight: panelRect.height,
    };
    setCockpitPanelLayouts((current) => ({
      ...current,
      [panel]: clampCockpitPanelLayout({
        ...current[panel],
        x: panelRect.left - parentRect.left,
        y: panelRect.top - parentRect.top,
        width: panelRect.width,
        height: panelRect.height,
      }),
    }));
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const moveCockpitPanel = (event: ReactPointerEvent<HTMLDivElement>) => {
    const interaction = cockpitPanelInteractionRef.current;
    const parent = mainRef.current;
    if (!interaction || !parent) return;
    const parentRect = parent.getBoundingClientRect();
    setCockpitPanelLayouts((current) => {
      const layout = current[interaction.key];
      const nextLayout =
        interaction.mode === "move"
          ? {
              ...layout,
              x: event.clientX - parentRect.left - interaction.offsetX,
              y: event.clientY - parentRect.top - interaction.offsetY,
            }
          : {
              ...layout,
              width: interaction.startWidth + event.clientX - interaction.offsetX,
              height: interaction.startHeight + event.clientY - interaction.offsetY,
            };
      return {
        ...current,
        [interaction.key]: clampCockpitPanelLayout(nextLayout),
      };
    });
  };
  const endCockpitPanelInteraction = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!cockpitPanelInteractionRef.current) return;
    cockpitPanelInteractionRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };
  const beginCockpitPanelResize = (
    panel: CockpitPanelKey,
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const panelElement = event.currentTarget.closest<HTMLElement>("[data-cockpit-panel-key]");
    const parent = mainRef.current;
    if (!panelElement || !parent) return;
    const panelRect = panelElement.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    setCockpitPanelLayouts((current) => ({
      ...current,
      [panel]: clampCockpitPanelLayout({
        ...current[panel],
        x: panelRect.left - parentRect.left,
        y: panelRect.top - parentRect.top,
        width: panelRect.width,
        height: panelRect.height,
      }),
    }));
    cockpitPanelInteractionRef.current = {
      key: panel,
      mode: "resize",
      offsetX: event.clientX,
      offsetY: event.clientY,
      startWidth: panelRect.width,
      startHeight: panelRect.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    event.stopPropagation();
    event.preventDefault();
  };
  const takeoffToolsProps = {
    tool,
    backendReady,
    draftCommand,
    activeDraftPointCount,
    setTool,
    setPendingPoints,
    setCalibrationPoints,
    finishDraft,
    undoDraftPoint,
    clearDraftPoints,
    createMeasurementMutation,
    updateSheetMutation,
  };
  const takeoffToolButtons = <TakeoffTools {...takeoffToolsProps} compact={false} />;
  const cockpitTakeoffToolButtons = <TakeoffTools {...takeoffToolsProps} compact />;
  const cockpitSheetControls = sheetNavigationItems.length ? (
    <div
      className="flex max-w-[min(500px,calc(100vw-2rem))] flex-wrap items-center gap-1.5"
      data-testid="plan-cockpit-sheet-strip"
    >
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="h-8 w-8"
        title="Previous sheet"
        onClick={() => openAdjacentSheet(-1)}
        disabled={!previousSheetNavigationItem}
        data-testid="plan-cockpit-prev-sheet"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
      </Button>
      <Select
        value={currentSheet?.id ?? sheetNavigationItems[0]?.sheet.id}
        onValueChange={openSheet}
      >
        <SelectTrigger
          className="h-8 w-[min(260px,calc(100vw-12rem))] bg-background/95 text-left"
          data-testid="plan-cockpit-sheet-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent className="max-h-[min(520px,70vh)]">
          {sheetNavigationItems.map((item, index) => (
            <SelectItem key={item.sheet.id} value={item.sheet.id}>
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                  {index + 1}/{sheetNavigationItems.length}
                </span>
                <span className="min-w-0 truncate">{item.label}</span>
                {item.measurementCount > 0 && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {item.measurementCount} marks
                  </span>
                )}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="h-8 w-8"
        title="Next sheet"
        onClick={() => openAdjacentSheet(1)}
        disabled={!nextSheetNavigationItem}
        data-testid="plan-cockpit-next-sheet"
      >
        <ChevronRight className="h-3.5 w-3.5" />
      </Button>
      {currentSheetNavigationItem && (
        <>
          <Badge
            variant={currentSheet?.scale_feet_per_pixel ? "secondary" : "outline"}
            className="hidden xl:inline-flex"
            data-testid="plan-cockpit-sheet-scale-status"
          >
            {currentSheet?.scale_feet_per_pixel ? "Scale set" : "Needs scale"}
          </Badge>
          <Badge
            variant="outline"
            className="hidden xl:inline-flex"
            data-testid="plan-cockpit-sheet-mark-count"
          >
            {currentSheetNavigationItem.measurementCount} marks
          </Badge>
        </>
      )}
    </div>
  ) : null;
  const cockpitRoomControls = (
    <div
      className="pointer-events-auto flex max-w-[min(580px,calc(100vw-1.5rem))] flex-wrap items-center gap-1.5 rounded-md border border-hairline bg-card/95 px-2 py-1.5 shadow-lg backdrop-blur"
      data-testid="plan-cockpit-room-controls"
    >
      <Button
        asChild
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        title="Back to estimate"
      >
        <Link to="/estimates/$estimateId" params={{ estimateId: estimate.id }}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
      </Button>
      <div className="mr-1 min-w-[110px] max-w-[145px]">
        <p className="truncate text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          {companyName}
        </p>
        <p className="truncate font-serif text-sm leading-tight text-foreground">
          {currentSheetTitle}
        </p>
      </div>
      <div
        className="hidden items-center gap-1.5 2xl:flex"
        data-testid="plan-cockpit-status-badges"
      >
        <Badge variant="outline">{planSets.length} sets</Badge>
        <Badge variant="outline">{sheets.length} sheets</Badge>
        <Badge variant={linkedCount === measurements.length ? "secondary" : "outline"}>
          {linkedCount}/{measurements.length} linked
        </Badge>
      </div>
      <Separator orientation="vertical" className="mx-1 hidden h-6 lg:block" />
      {(!cockpitPanels.drawings || !cockpitPanels.tools) && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 gap-1.5 px-2"
          title="Show both side panels"
          aria-label="Show both side panels"
          onClick={showCockpitPanels}
          data-testid="plan-cockpit-show-panels"
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Panels
        </Button>
      )}
      <Button
        type="button"
        size="sm"
        variant={cockpitPanels.drawings ? "default" : "outline"}
        className="h-8 gap-1.5 px-2"
        aria-pressed={cockpitPanels.drawings}
        title={cockpitPanels.drawings ? "Hide drawings panel" : "Show drawings panel"}
        onClick={() => toggleCockpitPanel("drawings")}
        data-testid="plan-cockpit-drawings-toggle"
      >
        <Layers className="h-3.5 w-3.5" />
        Drawings
      </Button>
      <Button
        type="button"
        size="sm"
        variant={cockpitPanels.tools ? "default" : "outline"}
        className="h-8 gap-1.5 px-2"
        aria-pressed={cockpitPanels.tools}
        title={cockpitPanels.tools ? "Hide takeoff tools panel" : "Show takeoff tools panel"}
        onClick={() => toggleCockpitPanel("tools")}
        data-testid="plan-cockpit-tools-toggle"
      >
        <Target className="h-3.5 w-3.5" />
        Takeoff Tools
      </Button>
      {(cockpitPanels.drawings || cockpitPanels.tools) && (
        <Button
          type="button"
          size="icon"
          variant="outline"
          className="h-8 w-8"
          title="Hide command center panels"
          onClick={hideCockpitPanels}
          data-testid="plan-cockpit-hide-panels"
        >
          <Minimize2 className="h-3.5 w-3.5" />
        </Button>
      )}
      <Button
        type="button"
        size="icon"
        variant="outline"
        className="h-8 w-8"
        title="Clean view: hide floating command bars without closing your panels"
        aria-label="Clean view"
        onClick={() => setCockpitChromeVisible(false)}
        data-testid="plan-cockpit-focus-toggle"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        size="icon"
        variant="outline"
        className="h-8 w-8"
        onClick={() => {
          setIsCockpitMode(false);
          hideCockpitPanels();
          setCockpitChromeVisible(true);
        }}
        title="Exit command center"
        aria-label="Exit command center"
        data-testid="plan-command-center-toggle"
      >
        <Minimize2 className="h-3.5 w-3.5" />
      </Button>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept="application/pdf,image/png,image/jpeg,image/webp"
        onChange={onFileChange}
      />
      <Button
        size="icon"
        className="h-8 w-8"
        title="Upload plans"
        aria-label="Upload plans"
        onClick={() => fileInputRef.current?.click()}
        disabled={!backendReady || uploading || createSetMutation.isPending}
      >
        <FileUp className="h-3.5 w-3.5" />
      </Button>
    </div>
  );

  return (
    <div
      className={cn(
        "bg-background",
        isCockpitMode ? "fixed inset-0 z-50 min-h-0 overflow-hidden" : "min-h-screen",
      )}
      data-testid="plan-room-workspace"
    >
      {isCockpitMode ? (
        !cockpitChromeVisible && (
          <div className="pointer-events-none absolute right-3 top-3 z-50">
            <Button
              type="button"
              size="sm"
              className="pointer-events-auto gap-1.5 shadow-lg"
              onClick={() => setCockpitChromeVisible(true)}
              data-testid="plan-cockpit-controls-restore"
            >
              <Minimize2 className="h-3.5 w-3.5" />
              Controls
            </Button>
          </div>
        )
      ) : (
        <header className="shrink-0 border-b border-hairline bg-surface-elevated">
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
                    {estimate.name}. Measure the plans once, link the takeoff to an estimate row,
                    and Overwatch updates the worksheet quantity.
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
                    setIsCockpitMode(true);
                    setCockpitChromeVisible(true);
                    showCockpitPanels();
                  }}
                  title="Open command center"
                  data-testid="plan-command-center-toggle"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  Command Center
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
      )}

      <main
        ref={mainRef}
        className={cn(
          "relative grid min-h-0",
          isCockpitMode
            ? "absolute inset-0 grid-cols-1 overflow-hidden p-0"
            : "mx-auto max-w-[1800px] gap-5 px-5 py-6 lg:px-8 xl:grid-cols-[220px_minmax(0,1fr)_300px] 2xl:grid-cols-[280px_minmax(0,1fr)_390px]",
        )}
        data-testid="plan-room-main"
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

        <aside
          className={cn(
            "min-w-0 space-y-4",
            isCockpitMode &&
              (cockpitPanels.drawings
                ? "absolute z-40 overflow-y-auto rounded-lg border border-hairline bg-background/95 p-2 shadow-2xl backdrop-blur"
                : "hidden"),
          )}
          style={
            isCockpitMode && cockpitPanels.drawings ? cockpitPanelStyle("drawings") : undefined
          }
          data-testid="plan-cockpit-drawings-panel"
          data-cockpit-panel-key="drawings"
        >
          {isCockpitMode && (
            <CockpitFloatingPanelHeader
              title="Drawing Controls"
              closeTestId="plan-cockpit-drawings-close"
              dragTestId="plan-cockpit-drawings-drag"
              resetTestId="plan-cockpit-drawings-reset"
              layoutLabel={cockpitPanelLayoutLabel("drawings")}
              onMoveStart={(event) => beginCockpitPanelMove("drawings", event)}
              onMove={moveCockpitPanel}
              onMoveEnd={endCockpitPanelInteraction}
              onReset={() => resetCockpitPanelLayout("drawings")}
              onClose={() =>
                setCockpitPanels((current) => ({
                  ...current,
                  drawings: false,
                }))
              }
            />
          )}
          <SheetSidebar
            sheets={sheets}
            planSets={planSets}
            sheetSearch={sheetSearch}
            setSheetSearch={setSheetSearch}
            sheetFilter={sheetFilter}
            setSheetFilter={setSheetFilter}
            measurementCountBySheet={measurementCountBySheet}
            filteredSheetCount={filteredSheetCount}
            filteredSheetsByPlanSet={filteredSheetsByPlanSet}
            currentSheet={currentSheet}
            openSheet={openSheet}
          />

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
          {isCockpitMode && (
            <div
              className="sticky bottom-0 ml-auto h-5 w-5 cursor-nwse-resize touch-none rounded-tl-md border-l border-t border-hairline bg-surface/90"
              title="Resize drawing controls panel"
              onPointerDown={(event) => beginCockpitPanelResize("drawings", event)}
              onPointerMove={moveCockpitPanel}
              onPointerUp={endCockpitPanelInteraction}
              onPointerCancel={endCockpitPanelInteraction}
              data-testid="plan-cockpit-drawings-resize"
            />
          )}
        </aside>

        <section
          className={cn(
            "min-w-0 overflow-hidden bg-card",
            isCockpitMode
              ? "flex h-full min-h-0 w-full flex-col border-0 shadow-none"
              : "rounded-lg border border-hairline shadow-card",
          )}
          data-testid="plan-cockpit-drawing-stage"
        >
          {!isCockpitMode && (
            <div className="flex flex-col gap-3 border-b border-hairline bg-surface px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
              <div className="min-w-0">
                <h2 className="font-serif text-2xl leading-tight">{currentSheetTitle}</h2>
                <p className="text-xs text-muted-foreground">
                  {currentSheet?.scale_feet_per_pixel
                    ? `Scale set: ${currentSheet.scale_label || `${currentSheet.scale_feet_per_pixel.toFixed(4)} ft/px`}`
                    : "Set scale before linear or area takeoff."}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">{takeoffToolButtons}</div>
            </div>
          )}

          <PlanCanvas
            planSet={currentPlanSet}
            sheet={currentSheet}
            overlayPlanSet={overlayPlanSet}
            overlaySheet={overlaySheet}
            overlayOpacity={overlayOpacity}
            overlayMode={overlayMode}
            measurements={visibleSheetMeasurements}
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
            showFloatingControls={cockpitChromeVisible}
            roomControls={isCockpitMode && cockpitChromeVisible ? cockpitRoomControls : null}
            sheetControls={isCockpitMode && cockpitChromeVisible ? cockpitSheetControls : null}
            toolControls={
              isCockpitMode && cockpitChromeVisible ? (
                <div className="flex max-w-[min(620px,calc(100vw-2rem))] flex-wrap items-center justify-center gap-1.5">
                  {cockpitTakeoffToolButtons}
                </div>
              ) : null
            }
            hasPreviousSheet={Boolean(previousSheetNavigationItem)}
            hasNextSheet={Boolean(nextSheetNavigationItem)}
            onPreviousSheet={() => openAdjacentSheet(-1)}
            onNextSheet={() => openAdjacentSheet(1)}
          />
        </section>

        <aside
          className={cn(
            "min-w-0 space-y-4",
            isCockpitMode &&
              (cockpitPanels.tools
                ? "absolute z-40 overflow-y-auto rounded-lg border border-hairline bg-background/95 p-2 shadow-2xl backdrop-blur"
                : "hidden"),
          )}
          style={isCockpitMode && cockpitPanels.tools ? cockpitPanelStyle("tools") : undefined}
          data-testid="plan-cockpit-tools-panel"
          data-cockpit-panel-key="tools"
        >
          {isCockpitMode && (
            <CockpitFloatingPanelHeader
              title="Takeoff Tools"
              closeTestId="plan-cockpit-tools-close"
              dragTestId="plan-cockpit-tools-drag"
              resetTestId="plan-cockpit-tools-reset"
              layoutLabel={cockpitPanelLayoutLabel("tools")}
              onMoveStart={(event) => beginCockpitPanelMove("tools", event)}
              onMove={moveCockpitPanel}
              onMoveEnd={endCockpitPanelInteraction}
              onReset={() => resetCockpitPanelLayout("tools")}
              onClose={() =>
                setCockpitPanels((current) => ({
                  ...current,
                  tools: false,
                }))
              }
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
            data-testid="takeoff-layer-controls"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="font-serif text-xl">Plan Markup Layers</h2>
                <p className="text-xs text-muted-foreground">
                  Show or hide markups on this sheet without deleting any takeoffs.
                </p>
              </div>
              <Layers className="mt-0.5 h-4 w-4 text-muted-foreground" />
            </div>
            <div
              className="mt-4 rounded-md border border-hairline bg-surface px-3 py-2 text-xs"
              data-testid="takeoff-layer-summary"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-foreground">
                  Showing {visibleSheetMeasurements.length} of {sheetMeasurements.length} marks
                </span>
                {hiddenSheetMeasurementCount > 0 ? (
                  <Badge variant="outline">{hiddenSheetMeasurementCount} hidden</Badge>
                ) : (
                  <Badge variant="secondary">All visible</Badge>
                )}
              </div>
              <p className="mt-1 text-muted-foreground">
                Use this when dense sheets need less noise. The worksheet still keeps every takeoff.
              </p>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setAllTakeoffLayersVisible(true)}
                disabled={allTakeoffLayersVisible}
                data-testid="takeoff-layer-show-all"
              >
                <Eye className="h-3.5 w-3.5" />
                Show All
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={() => setAllTakeoffLayersVisible(false)}
                disabled={noTakeoffLayersVisible}
                data-testid="takeoff-layer-hide-all"
              >
                <EyeOff className="h-3.5 w-3.5" />
                Hide All
              </Button>
            </div>
            <div className="mt-3 space-y-2" data-testid="takeoff-layer-toggle-list">
              {TAKEOFF_LAYER_KEYS.map((key) => {
                const visible = takeoffLayerVisibility[key];
                const copy = TAKEOFF_LAYER_COPY[key];
                return (
                  <button
                    key={key}
                    type="button"
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left text-xs transition",
                      visible
                        ? "border-primary/30 bg-primary/5"
                        : "border-hairline bg-surface/70 text-muted-foreground",
                    )}
                    onClick={() => toggleTakeoffLayer(key)}
                    data-testid={TAKEOFF_LAYER_TEST_IDS[key]}
                    aria-pressed={visible}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {visible ? (
                        <Eye className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <EyeOff className="h-3.5 w-3.5 shrink-0" />
                      )}
                      <span className="min-w-0">
                        <span className="block font-medium text-foreground">{copy.label}</span>
                        <span className="block truncate text-muted-foreground">{copy.detail}</span>
                      </span>
                    </span>
                    <Badge variant={visible ? "secondary" : "outline"}>
                      {takeoffLayerCounts[key]}
                    </Badge>
                  </button>
                );
              })}
            </div>
          </section>

          <ReadinessPanel
            sheets={sheets}
            measurements={measurements}
            unscaledSheets={unscaledSheets}
            unlinkedMeasurements={unlinkedMeasurements}
            linkedCount={linkedCount}
            hiddenSheetMeasurementCount={hiddenSheetMeasurementCount}
            sheetMeasurements={sheetMeasurements}
            visibleSheetMeasurements={visibleSheetMeasurements}
            openFirstUnscaledSheet={openFirstUnscaledSheet}
            showUnlinkedTakeoffs={showUnlinkedTakeoffs}
            setAllTakeoffLayersVisible={setAllTakeoffLayersVisible}
          />

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
                      onClick={() =>
                        syncLineMutation.mutate({ lineId: selectedMeasurementLine.id })
                      }
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

          <TakeoffWorksheet
            measurements={measurements}
            totalMeasured={totalMeasured}
            copyTakeoffSummary={copyTakeoffSummary}
            downloadTakeoffCsv={downloadTakeoffCsv}
            takeoffSummaryFallback={takeoffSummaryFallback}
            takeoffSearch={takeoffSearch}
            setTakeoffSearch={setTakeoffSearch}
            takeoffFilter={takeoffFilter}
            setTakeoffFilter={setTakeoffFilter}
            sheetMeasurements={sheetMeasurements}
            linkedCount={linkedCount}
            visibleMeasurements={visibleMeasurements}
            lineItems={lineItems}
            sheets={sheets}
            selectedMeasurementId={selectedMeasurementId}
            selectMeasurement={selectMeasurement}
            deleteMeasurementMutation={deleteMeasurementMutation}
            updateMeasurementMutation={updateMeasurementMutation}
            syncLineMutation={syncLineMutation}
            lineTotals={lineTotals}
          />
          {isCockpitMode && (
            <div
              className="sticky bottom-0 ml-auto h-5 w-5 cursor-nwse-resize touch-none rounded-tl-md border-l border-t border-hairline bg-surface/90"
              title="Resize takeoff tools panel"
              onPointerDown={(event) => beginCockpitPanelResize("tools", event)}
              onPointerMove={moveCockpitPanel}
              onPointerUp={endCockpitPanelInteraction}
              onPointerCancel={endCockpitPanelInteraction}
              data-testid="plan-cockpit-tools-resize"
            />
          )}
        </aside>
      </main>
    </div>
  );
}
