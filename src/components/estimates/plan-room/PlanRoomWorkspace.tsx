import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Eye,
  EyeOff,
  FileUp,
  CircleHelp,
  Layers,
  Link2,
  Maximize2,
  Minimize2,
  Pencil,
  Save,
  Target,
  Trash2,
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { fmtUSD } from "@/lib/format";
import {
  addTakeoffToPlanRoomCache,
  takeoffSyncBlockReason,
  takeoffTrustLabel,
  type PlanRoomMeasurementCache,
} from "@/lib/plan-room-trust";
import { cn } from "@/lib/utils";
import {
  applyScaleToSheets,
  updatePlanSheets,
  createLineItemForTakeoffs,
  createPlanSet,
  createTakeoffMeasurement,
  deleteTakeoffMeasurement,
  planRoomBucket,
  recalculateSheetTakeoffs,
  recordScaleAssessment,
  syncTakeoffToEstimateLine,
  updatePlanSheet,
  updateTakeoffMeasurement,
  type PlanSetRow,
  type PlanSheetRow,
  type TakeoffMeasurementRow,
  type TakeoffToolType,
} from "@/lib/plan-room.functions";
import {
  defaultPlanRoomSheetId,
  distancePx,
  findTakeoffGroupMatch,
  groupTakeoffWorksheet,
  groupUnlinkedTakeoffs,
  normalizeTakeoffLabel,
  parseFeetInches,
  SAMPLE_PLAN_SET_MIME,
  statedScaleFeetPerPixel,
  suggestTakeoffMatches,
  takeoffUnitsCompatible,
  type TakeoffGroup,
} from "@/lib/plan-room-math";
import {
  previewScaleAssuranceCheck,
  resolveScaleAssessmentForSheet,
  SCALE_ASSURANCE_TOLERANCE_PCT,
  summarizeScaleAssuranceChecks,
  type ScaleAssessmentRow,
  type ScaleAssuranceCheckPreview,
} from "@/lib/plan-room-scale-assurance";
import { analyzePlanSheetMeasurementNotes } from "@/lib/plan-room-measurement-assistant.functions";
import { generatePlanScopeBrief } from "@/lib/plan-scope-brief.functions";
import type { PlanScopeBriefItem } from "@/lib/plan-scope-brief";
import type { PlanScopeBriefNextAction, PlanScopeBriefReview } from "@/lib/plan-scope-brief-review";
import {
  analyzeAcceptedPlanRevisionScope,
  type PlanRevisionMatchRow,
} from "@/lib/plan-revision-match.functions";
import {
  MEASUREMENT_GUIDE_LONG_EDGE_PX,
  measurementAssistantTakeoffNote,
  type MeasurementEvidenceAnchor,
  type MeasurementAssistantPlanResult,
  type MeasurementAssistantSuggestion,
} from "@/lib/plan-room-measurement-assistant";
import {
  completeMeasurementScopeItem,
  getMeasurementScopeQueue,
  saveMeasurementScopeDecision,
} from "@/lib/plan-room-measurement-scope.functions";
import {
  duplicateScopeCounts,
  measurementScopeKey,
  measurementSuggestionKey,
  scopeItemAsSuggestion,
  type MeasurementScopeDecisionStatus,
  type MeasurementScopeQueueItem,
} from "@/lib/plan-room-measurement-scope";
import {
  commitRedo,
  commitUndo,
  dropRedo,
  dropUndo,
  emptyTakeoffUndoStack,
  peekRedoCommand,
  peekUndoCommand,
  pushTakeoffCommand,
  redoOperationFor,
  remapTakeoffMeasurementId,
  undoOperationFor,
  type TakeoffCommand,
  type TakeoffInverseOp,
  type TakeoffSnapshot,
  type TakeoffUndoStack,
  type TakeoffUpdatePatch,
} from "@/lib/takeoff-undo";
import type { PlanEvidenceFocus, ProcessedSheetPage } from "./PdfSheetViewer";
import type { EstimateLineItemRow, EstimateRow } from "@/lib/estimates.functions";
import { AiAssistPanel } from "./AiAssistPanel";
import { useSymbolDiscovery } from "./useSymbolDiscovery";
import { SymbolDiscoveryPanel, type StartDiscoveryGroupReviewInput } from "./SymbolDiscoveryPanel";
import { clusterMemberPoints } from "@/lib/ai-takeoff/embedding-match/embedding-cluster-domain";
import { saveAiSymbolLibraryExample } from "@/lib/ai-takeoff/ai-symbol-library.functions";
import { AiReviewBar } from "./AiReviewBar";
import { useAiAssist } from "./useAiAssist";
import {
  COCKPIT_CHROME_PANEL_TOP_GAP,
  COCKPIT_PANEL_EDGE_GAP,
  COCKPIT_PANEL_MAX_HEIGHT,
  COCKPIT_PANEL_MAX_WIDTH,
  COCKPIT_PANEL_MIN_HEIGHT,
  COCKPIT_PANEL_MIN_WIDTH,
  COCKPIT_PANEL_MOVE_RESERVE,
  DEFAULT_COCKPIT_PANEL_LAYOUTS,
  DEFAULT_TAKEOFF_LAYER_VISIBILITY,
  DEFAULT_VIEW_SIZE,
  QUICK_CALIBRATION_FEET,
  ARCHITECTURAL_SCALE_PRESETS,
  ENGINEERING_SCALE_PRESETS,
  STATED_SCALE_PRESETS,
  TAKEOFF_COLORS,
  TAKEOFF_LAYER_COPY,
  TAKEOFF_LAYER_KEYS,
  TAKEOFF_LAYER_TEST_IDS,
  buildTakeoffCsv,
  buildTakeoffSummary,
  calculateQuantity,
  centsToDollars,
  clampNumber,
  clearCockpitPanelLayoutStorage,
  cockpitPanelLayoutsEqual,
  coerceCockpitPanelLayout,
  copyTextToClipboard,
  downloadTextFile,
  draftCommandFor,
  formatQty,
  geometryFromPoints,
  geometryPoints,
  measurementMatchesTakeoffLayers,
  readCockpitPanelLayoutStorage,
  readLastViewedSheetStorage,
  safeReportFileName,
  searchMatches,
  sheetDisplayName,
  slugFileName,
  toolLabel,
  unitFor,
  unitLongName,
  writeCockpitPanelLayoutStorage,
  writeLastViewedSheetStorage,
  type CockpitPanelInteraction,
  type CockpitPanelKey,
  type CockpitPanelLayout,
  type CockpitPanelPresentation,
  type Point,
  type RevisionOverlayMode,
  type SheetFilterMode,
  type TakeoffFilterMode,
  type TakeoffLayerKey,
  type TakeoffLayerVisibility,
  type ToolMode,
  type ViewSize,
} from "./planRoomShared";
import {
  PlanCanvas,
  computeStatedScalePatches,
  getPdfPageCount,
  processPlanSetSheets,
} from "./PdfSheetViewer";
import { FeetInchesHint, TakeoffTools } from "./TakeoffTools";
import { SyncConflictDialog, TakeoffWorksheet, type SyncConflictState } from "./TakeoffWorksheet";
import { LinkOrCreatePicker, TakeoffFinishPopover } from "./TakeoffClassify";
import { SheetSidebar } from "./SheetSidebar";
import { CockpitFloatingPanelHeader } from "./CockpitFloatingPanelHeader";
import { ReadinessPanel } from "./ReadinessPanel";
import { ScaleAssurancePanel } from "./ScaleAssurancePanel";
import { MeasurementAssistantPanel } from "./MeasurementAssistantPanel";
import { MeasurementGuideReviewBar } from "./MeasurementGuideReviewBar";
import { MeasurementScopeQueuePanel } from "./MeasurementScopeQueuePanel";
import { PlanScopeCoverageMatrix } from "./PlanScopeCoverageMatrix";
import { PlanScopeBriefPanel } from "./PlanScopeBriefPanel";
import { TakeoffAssemblyWorkbench } from "./TakeoffAssemblyWorkbench";
import {
  extractPdfMeasurementEvidence,
  extractPdfPlanScopeBriefEvidence,
} from "./pdfMeasurementText";

import { canvasToBase64Png, renderDetectionSheet } from "./aiDetectionRender";
import { FlagIssueButton } from "../FlagIssueButton";
import { EstimatorActivationDialog } from "./EstimatorActivationDialog";
import { EstimatorActivationChecklist } from "./EstimatorActivationChecklist";
import { useEstimatorActivation } from "./useEstimatorActivation";
import type { PlanScopeCoverageRecord } from "@/lib/plan-scope-coverage";
import { CommandCenterToolsNav, type CommandCenterToolsView } from "./CommandCenterToolsNav";
import { ScaleDraftEditor } from "./ScaleDraftEditor";
import { PlanRevisionOverlayPanel } from "./PlanRevisionOverlayPanel";
interface PlanRoomWorkspaceProps {
  estimate: EstimateRow;
  lineItems: EstimateLineItemRow[];
  planSets: PlanSetRow[];
  sheets: PlanSheetRow[];
  measurements: TakeoffMeasurementRow[];
  scaleAssessments: ScaleAssessmentRow[];
  scaleAssuranceReady?: boolean;
  companyName?: string;
  schemaReady?: boolean;
  schemaMessage?: string;
  // Estimate line to focus on load: selects its first takeoff measurement
  // and that measurement's sheet (used by the estimate grid takeoff badge).
  focusLineItemId?: string;
  // Exact takeoff to focus on load (used by estimate-grid assembly source traces).
  focusMeasurementId?: string;
  // First-run launcher handoff: open the drawing upload flow on arrival when
  // the estimate has no real drawing set yet.
  autoOpenUpload?: boolean;
}

export function PlanRoomWorkspace({
  estimate,
  lineItems,
  planSets,
  sheets,
  measurements,
  scaleAssessments,
  scaleAssuranceReady = false,
  companyName = "Company",
  schemaReady = true,
  schemaMessage = "",
  focusLineItemId = "",
  focusMeasurementId = "",
  autoOpenUpload = false,
}: PlanRoomWorkspaceProps) {
  const qc = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const focusTargetAppliedRef = useRef(false);
  const autoUploadTriggeredRef = useRef(false);
  const thumbBackfillRef = useRef<Set<string>>(new Set());
  const pendingPointsRef = useRef<Point[]>([]);
  const mainRef = useRef<HTMLElement | null>(null);
  const cockpitPanelInteractionRef = useRef<CockpitPanelInteraction | null>(null);
  const createPlanSetFn = useServerFn(createPlanSet);
  const createMeasurementFn = useServerFn(createTakeoffMeasurement);
  const updateSheetFn = useServerFn(updatePlanSheet);
  const updateMeasurementFn = useServerFn(updateTakeoffMeasurement);
  const deleteMeasurementFn = useServerFn(deleteTakeoffMeasurement);
  const syncLineFn = useServerFn(syncTakeoffToEstimateLine);
  const applyScaleToSheetsFn = useServerFn(applyScaleToSheets);
  const updatePlanSheetsFn = useServerFn(updatePlanSheets);
  const recordScaleAssessmentFn = useServerFn(recordScaleAssessment);
  const analyzeMeasurementNotesFn = useServerFn(analyzePlanSheetMeasurementNotes);
  const generatePlanScopeBriefFn = useServerFn(generatePlanScopeBrief);
  const analyzeRevisionScopeFn = useServerFn(analyzeAcceptedPlanRevisionScope);
  const getMeasurementScopeQueueFn = useServerFn(getMeasurementScopeQueue);
  const saveMeasurementScopeDecisionFn = useServerFn(saveMeasurementScopeDecision);
  const completeMeasurementScopeItemFn = useServerFn(completeMeasurementScopeItem);
  const createLineForTakeoffsFn = useServerFn(createLineItemForTakeoffs);
  const recalculateSheetTakeoffsFn = useServerFn(recalculateSheetTakeoffs);
  const saveSymbolLibraryExampleFn = useServerFn(saveAiSymbolLibraryExample);
  const measurementScopeQueueQuery = useQuery({
    queryKey: ["measurement-scope-queue", estimate.id],
    queryFn: () => getMeasurementScopeQueueFn({ data: { estimate_id: estimate.id } }),
    enabled: schemaReady !== false,
  });

  const [selectedSheetId, setSelectedSheetId] = useState<string>("");
  const [tool, setTool] = useState<ToolMode>("select");
  const [selectedLineId, setSelectedLineId] = useState<string>("unlinked");
  const [measurementLabel, setMeasurementLabel] = useState("");
  const [takeoffColor, setTakeoffColor] = useState(TAKEOFF_COLORS[0]);
  const [pendingPoints, setPendingPoints] = useState<Point[]>([]);
  const [viewSize, setViewSize] = useState<ViewSize>(DEFAULT_VIEW_SIZE);
  const [calibrationFeet, setCalibrationFeet] = useState("10");
  const [calibrationPoints, setCalibrationPoints] = useState<Point[]>([]);
  const [verifyFeet, setVerifyFeet] = useState("");
  const [scaleCheckDrafts, setScaleCheckDrafts] = useState<ScaleAssuranceCheckPreview[]>([]);
  const [scaleAssessmentOverride, setScaleAssessmentOverride] = useState<ScaleAssessmentRow | null>(
    null,
  );
  const [scaleVerifiedAtOverride, setScaleVerifiedAtOverride] = useState<string | null | undefined>(
    undefined,
  );
  const [measurementAssistantPlan, setMeasurementAssistantPlan] =
    useState<MeasurementAssistantPlanResult | null>(null);
  const [activeMeasurementGuideId, setActiveMeasurementGuideId] = useState("");
  const [measurementGuideLabel, setMeasurementGuideLabel] = useState("");
  const [preparedMeasurementSuggestionId, setPreparedMeasurementSuggestionId] = useState("");
  const [preparedMeasurementSuggestion, setPreparedMeasurementSuggestion] =
    useState<MeasurementAssistantSuggestion | null>(null);
  const [preparedScopeBriefTakeoff, setPreparedScopeBriefTakeoff] = useState<{
    reviewId: string;
    suggestionId: string;
  } | null>(null);
  const [completedMeasurementSuggestionIds, setCompletedMeasurementSuggestionIds] = useState<
    string[]
  >([]);
  const [measurementSourceNote, setMeasurementSourceNote] = useState("");
  const [scopeBriefProgress, setScopeBriefProgress] = useState("");
  const [measurementEvidenceAnchors, setMeasurementEvidenceAnchors] = useState<
    Record<string, MeasurementEvidenceAnchor>
  >({});
  const [measurementEvidenceFocus, setMeasurementEvidenceFocus] = useState<
    (PlanEvidenceFocus & { sheetId: string }) | null
  >(null);
  const [preparedMeasurementScopeItemId, setPreparedMeasurementScopeItemId] = useState("");
  const [pendingMeasurementScopeStart, setPendingMeasurementScopeStart] =
    useState<MeasurementScopeQueueItem | null>(null);
  const [pendingScopeBriefAction, setPendingScopeBriefAction] = useState<{
    item: PlanScopeBriefItem;
    review: PlanScopeBriefReview;
  } | null>(null);
  const [pdfPageMetrics, setPdfPageMetrics] = useState<{
    widthPoints: number;
    heightPoints: number;
  } | null>(null);
  const [statedPresetId, setStatedPresetId] = useState("");
  const [customStatedInches, setCustomStatedInches] = useState("");
  const [customStatedFeet, setCustomStatedFeet] = useState("");
  const [applyToSetOffer, setApplyToSetOffer] = useState<{
    statedInches: number;
    statedFeet: number;
    label: string;
    count: number;
  } | null>(null);
  const [syncConflict, setSyncConflict] = useState<SyncConflictState | null>(null);
  const [thumbUrlByPath, setThumbUrlByPath] = useState<Record<string, string>>({});
  const [detectProposals, setDetectProposals] = useState<Array<{
    sheetId: string;
    currentLabel: string;
    detectedNumber: string;
    detectedName: string;
    accepted: boolean;
  }> | null>(null);
  const [headerRename, setHeaderRename] = useState<{
    sheetNumber: string;
    sheetName: string;
  } | null>(null);
  const [finishPopover, setFinishPopover] = useState<{
    measurementId: string;
    anchor: Point;
  } | null>(null);
  const [buildGroups, setBuildGroups] = useState<Array<
    TakeoffGroup & { accepted: boolean }
  > | null>(null);
  const [matchProposals, setMatchProposals] = useState<Array<{
    measurementId: string;
    lineId: string;
    takeoffLabel: string;
    takeoffQuantity: number;
    takeoffUnit: string;
    rowLabel: string;
    rowUnit: string;
    accepted: boolean;
  }> | null>(null);
  const [verifyOutcome, setVerifyOutcome] = useState<{
    measuredFeet: number;
    expectedFeet: number;
    offPct: number;
    correctedScale: number;
    maxVariancePct: number;
    scaleSpreadPct: number;
    canRecalibrate: boolean;
  } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [postProcessingPlanSetId, setPostProcessingPlanSetId] = useState("");
  // The Plan Room is the Command Center. Contractors should not have to open
  // the route and then discover a second button before reaching the workbench.
  const [isCockpitMode, setIsCockpitMode] = useState(true);
  const [cockpitPanels, setCockpitPanels] = useState<Record<CockpitPanelKey, boolean>>({
    drawings: true,
    tools: true,
  });
  const [cockpitPanelLayouts, setCockpitPanelLayouts] = useState<
    Record<CockpitPanelKey, CockpitPanelLayout>
  >(DEFAULT_COCKPIT_PANEL_LAYOUTS);
  const [cockpitPanelPresentations, setCockpitPanelPresentations] = useState<
    Record<CockpitPanelKey, CockpitPanelPresentation>
  >({ drawings: "windowed", tools: "windowed" });
  const [cockpitChromeVisible, setCockpitChromeVisible] = useState(true);
  const [cockpitToolsView, setCockpitToolsView] = useState<CommandCenterToolsView>("measure");
  const estimatorActivation = useEstimatorActivation(estimate.id);
  const [overlaySheetId, setOverlaySheetId] = useState("");
  const [overlayOpacity, setOverlayOpacity] = useState(65);
  const [overlayMode, setOverlayMode] = useState<RevisionOverlayMode>("redline");
  const [selectedMeasurementId, setSelectedMeasurementId] = useState("");
  const [sheetSearch, setSheetSearch] = useState("");
  const [sheetFilter, setSheetFilter] = useState<SheetFilterMode>("all");
  const [takeoffSearch, setTakeoffSearch] = useState("");
  const [takeoffFilter, setTakeoffFilter] = useState<TakeoffFilterMode>("all");
  const [takeoffLayerVisibility, setTakeoffLayerVisibility] = useState<TakeoffLayerVisibility>(
    DEFAULT_TAKEOFF_LAYER_VISIBILITY,
  );
  // Per-color canvas visibility (beta batch 2): the layers-style workflow —
  // hide the demo reds while measuring the new-work greens. Per-session.
  const [hiddenTakeoffColors, setHiddenTakeoffColors] = useState<string[]>([]);
  const [selectedMeasurementDraft, setSelectedMeasurementDraft] = useState({
    color: TAKEOFF_COLORS[0],
    label: "",
    notes: "",
    quantity: "",
    unit: "",
    overrideReason: "",
  });
  const [takeoffSummaryFallback, setTakeoffSummaryFallback] = useState("");
  // Per-sheet undo/redo stacks for takeoff operations. In-memory only: they
  // survive sheet switches within the session and reset on reload.
  const [undoStacks, setUndoStacks] = useState<Record<string, TakeoffUndoStack>>({});
  const [undoBusy, setUndoBusy] = useState(false);
  useEffect(() => {
    if (!isCockpitMode || tool === "select") return;
    setCockpitToolsView("measure");
  }, [isCockpitMode, tool]);
  useEffect(() => {
    if (isCockpitMode && selectedMeasurementId) setCockpitToolsView("review");
  }, [isCockpitMode, selectedMeasurementId]);
  const currentSheet = useMemo(
    () => sheets.find((sheet) => sheet.id === selectedSheetId) ?? sheets[0] ?? null,
    [selectedSheetId, sheets],
  );
  const latestScaleAssessment = useMemo(() => {
    if (!currentSheet) return null;
    return resolveScaleAssessmentForSheet({
      assessments: scaleAssessments,
      pendingAssessment: scaleAssessmentOverride,
      sheetId: currentSheet.id,
      scaleRevision: currentSheet.scale_revision,
    });
  }, [currentSheet, scaleAssessmentOverride, scaleAssessments]);
  const effectiveScaleVerifiedAt =
    scaleVerifiedAtOverride !== undefined
      ? scaleVerifiedAtOverride
      : (currentSheet?.scale_verified_at ?? null);
  const currentSheetScaleStatus = !currentSheet?.scale_feet_per_pixel
    ? "none"
    : effectiveScaleVerifiedAt &&
        latestScaleAssessment?.outcome === "verified" &&
        latestScaleAssessment.scale_revision === currentSheet.scale_revision
      ? "verified"
      : "unverified";
  const currentPlanSet = currentSheet
    ? (planSets.find((planSet) => planSet.id === currentSheet.plan_set_id) ?? null)
    : null;
  const overlaySheet = overlaySheetId
    ? (sheets.find((sheet) => sheet.id === overlaySheetId) ?? null)
    : null;
  const overlayPlanSet = overlaySheet
    ? (planSets.find((planSet) => planSet.id === overlaySheet.plan_set_id) ?? null)
    : null;
  const measurementScopeItems = useMemo(
    () => measurementScopeQueueQuery.data?.items ?? [],
    [measurementScopeQueueQuery.data?.items],
  );
  const measurementScopeDuplicateCounts = useMemo(
    () => duplicateScopeCounts(measurementScopeItems),
    [measurementScopeItems],
  );
  const queueItemBySuggestionId = useMemo(() => {
    if (!currentSheet || !measurementAssistantPlan) return {};
    return Object.fromEntries(
      measurementAssistantPlan.suggestions.map((suggestion) => {
        const suggestionKey = measurementSuggestionKey(currentSheet.id, suggestion);
        return [
          suggestion.id,
          measurementScopeItems.find(
            (item) =>
              item.plan_sheet_id === currentSheet.id && item.suggestion_key === suggestionKey,
          ),
        ];
      }),
    ) as Record<string, MeasurementScopeQueueItem | undefined>;
  }, [currentSheet, measurementAssistantPlan, measurementScopeItems]);
  const activeMeasurementGuideSuggestion =
    measurementAssistantPlan?.suggestions.find(
      (suggestion) => suggestion.id === activeMeasurementGuideId && suggestion.guide,
    ) ?? null;
  const activeMeasurementGuideQueueItem = activeMeasurementGuideSuggestion
    ? queueItemBySuggestionId[activeMeasurementGuideSuggestion.id]
    : undefined;
  const duplicateCountBySuggestionId = useMemo(() => {
    if (!measurementAssistantPlan) return {};
    return Object.fromEntries(
      measurementAssistantPlan.suggestions.map((suggestion) => [
        suggestion.id,
        (measurementScopeDuplicateCounts.get(measurementScopeKey(suggestion)) ?? 0) +
          (queueItemBySuggestionId[suggestion.id] ? 0 : 1),
      ]),
    ) as Record<string, number>;
  }, [measurementAssistantPlan, measurementScopeDuplicateCounts, queueItemBySuggestionId]);

  useEffect(() => {
    setScaleCheckDrafts([]);
    setCalibrationPoints([]);
    setVerifyFeet("");
    setVerifyOutcome(null);
    setScaleAssessmentOverride(null);
    setScaleVerifiedAtOverride(undefined);
    setMeasurementAssistantPlan(null);
    setActiveMeasurementGuideId("");
    setMeasurementGuideLabel("");
    setPreparedMeasurementSuggestionId("");
    setPreparedMeasurementSuggestion(null);
    setPreparedScopeBriefTakeoff(null);
    setCompletedMeasurementSuggestionIds([]);
    setMeasurementSourceNote("");
    setMeasurementEvidenceAnchors({});
    setPreparedMeasurementScopeItemId("");
  }, [currentSheet?.id, currentSheet?.scale_revision]);

  useEffect(() => {
    if (
      scaleAssessmentOverride &&
      scaleAssessments.some((assessment) => assessment.id === scaleAssessmentOverride.id)
    ) {
      setScaleAssessmentOverride(null);
    }
  }, [scaleAssessmentOverride, scaleAssessments]);

  useEffect(() => {
    if (
      scaleVerifiedAtOverride !== undefined &&
      currentSheet?.scale_verified_at === scaleVerifiedAtOverride
    ) {
      setScaleVerifiedAtOverride(undefined);
    }
  }, [currentSheet?.scale_verified_at, scaleVerifiedAtOverride]);
  const revisionSheetOptions = useMemo(
    () =>
      sheets
        .filter((sheet) => sheet.id !== currentSheet?.id)
        .flatMap((sheet) => {
          const planSet = planSets.find((candidate) => candidate.id === sheet.plan_set_id);
          return planSet ? [{ sheet, planSet }] : [];
        })
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
      sheetMeasurements.filter(
        (measurement) =>
          measurementMatchesTakeoffLayers(measurement, takeoffLayerVisibility) &&
          !hiddenTakeoffColors.includes(measurement.color),
      ),
    [hiddenTakeoffColors, sheetMeasurements, takeoffLayerVisibility],
  );
  const sheetColorsInUse = useMemo(
    () => Array.from(new Set(sheetMeasurements.map((measurement) => measurement.color))),
    [sheetMeasurements],
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
  const finishPopoverMeasurement = finishPopover
    ? (measurements.find((item) => item.id === finishPopover.measurementId) ?? null)
    : null;
  // Group recognition for the finish popover (beta batch 2): the banner counts
  // INCLUDE the just-finished measurement.
  const finishPopoverGroupState = useMemo(() => {
    if (!finishPopoverMeasurement) return null;
    const match = findTakeoffGroupMatch({
      label: finishPopoverMeasurement.label,
      unit: finishPopoverMeasurement.unit,
      measurements,
      excludeId: finishPopoverMeasurement.id,
    });
    if (match.joins && match.group) {
      return {
        kind: "joined" as const,
        label: match.group.label,
        memberCount: match.group.members.length + 1,
        measuredTotal:
          Math.round((match.group.measuredQuantity + finishPopoverMeasurement.quantity) * 10000) /
          10000,
        unit: finishPopoverMeasurement.unit,
      };
    }
    if (match.unitMismatch) {
      const normalized = normalizeTakeoffLabel(finishPopoverMeasurement.label);
      const other = measurements.find(
        (item) =>
          item.id !== finishPopoverMeasurement.id &&
          normalizeTakeoffLabel(item.label) === normalized,
      );
      return {
        kind: "unit-mismatch" as const,
        label: finishPopoverMeasurement.label.trim(),
        memberCount: 1,
        measuredTotal: finishPopoverMeasurement.quantity,
        unit: finishPopoverMeasurement.unit,
        otherUnit: other?.unit,
      };
    }
    return null;
  }, [finishPopoverMeasurement, measurements]);
  // Existing group labels for the popover's autocomplete, so joining a group
  // is the default gesture and a typo doesn't fork a new one.
  const groupLabelSuggestions = useMemo(
    () =>
      Array.from(new Set(groupTakeoffWorksheet(measurements).map((group) => group.label)))
        .sort((a, b) => a.localeCompare(b))
        .slice(0, 60),
    [measurements],
  );
  const selectedMeasurementLabel = selectedMeasurement?.label ?? "";
  const selectedMeasurementNotes = selectedMeasurement?.notes ?? "";
  const activeDraftPointCount =
    tool === "calibrate" || tool === "verify" ? calibrationPoints.length : pendingPoints.length;
  const activeDraftPoints =
    tool === "calibrate" || tool === "verify" ? calibrationPoints : pendingPoints;
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

  // Default current sheet: last-viewed for this estimate when it still
  // exists, else the first sheet of the first real PDF set (never the sample
  // set — it hides PDF-only actions like Detect), else whatever exists.
  useEffect(() => {
    if (selectedSheetId || sheets.length === 0) return;
    const sheetId = defaultPlanRoomSheetId({
      lastViewedSheetId: readLastViewedSheetStorage(estimate.id),
      planSets,
      sheets,
    });
    if (sheetId) setSelectedSheetId(sheetId);
  }, [estimate.id, planSets, selectedSheetId, sheets]);

  // Persist only once a sheet is actually selected — never the implicit
  // sheets[0] fallback that renders before the defaulting effect runs.
  useEffect(() => {
    if (!selectedSheetId || !currentSheet) return;
    writeLastViewedSheetStorage(estimate.id, currentSheet.id);
  }, [currentSheet, estimate.id, selectedSheetId]);

  useEffect(() => {
    if (focusTargetAppliedRef.current) return;
    if (!focusMeasurementId && !focusLineItemId) return;
    const measurement = focusMeasurementId
      ? measurements.find((item) => item.id === focusMeasurementId)
      : measurements.find((item) => item.estimate_line_item_id === focusLineItemId);
    if (!measurement) return;
    focusTargetAppliedRef.current = true;
    setSelectedMeasurementId(measurement.id);
    setSelectedSheetId(measurement.plan_sheet_id);
  }, [focusLineItemId, focusMeasurementId, measurements]);

  useEffect(() => {
    const raw = readCockpitPanelLayoutStorage();
    if (!raw) return;
    try {
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
      clearCockpitPanelLayoutStorage();
    }
  }, []);

  useEffect(() => {
    writeCockpitPanelLayoutStorage(
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
    setFinishPopover((current) =>
      current && !measurements.some((item) => item.id === current.measurementId) ? null : current,
    );
  }, [measurements]);

  useEffect(() => {
    setFinishPopover(null);
  }, [tool, selectedSheetId]);

  useEffect(() => {
    if (!selectedMeasurementId) {
      setSelectedMeasurementDraft({
        color: TAKEOFF_COLORS[0],
        label: "",
        notes: "",
        quantity: "",
        unit: "",
        overrideReason: "",
      });
      return;
    }
    setSelectedMeasurementDraft({
      color: selectedMeasurement?.color || TAKEOFF_COLORS[0],
      label: selectedMeasurementLabel,
      notes: selectedMeasurementNotes,
      quantity: selectedMeasurement ? String(Number(selectedMeasurement.quantity.toFixed(3))) : "",
      unit: selectedMeasurement?.unit ?? "",
      overrideReason: selectedMeasurement?.override_reason ?? "",
    });
  }, [
    selectedMeasurement,
    selectedMeasurementId,
    selectedMeasurementLabel,
    selectedMeasurementNotes,
  ]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["plan-room", estimate.id] });
    qc.invalidateQueries({ queryKey: ["plan-scope-brief-work-operations", estimate.id] });
    qc.invalidateQueries({ queryKey: ["estimate", estimate.id] });
    qc.invalidateQueries({ queryKey: ["estimates"] });
  };

  const cacheMeasurementScopeItem = (item: MeasurementScopeQueueItem) => {
    qc.setQueryData<{ items: MeasurementScopeQueueItem[]; ready: boolean }>(
      ["measurement-scope-queue", estimate.id],
      (current) => ({
        ready: true,
        items: [item, ...(current?.items ?? []).filter((candidate) => candidate.id !== item.id)],
      }),
    );
    qc.invalidateQueries({ queryKey: ["measurement-scope-queue", estimate.id] });
  };

  // --- Takeoff undo/redo (Phase 4 Task 0) ---
  // Commands are recorded only after the server confirms the original
  // operation. Scale changes and estimate-row creation stay off this stack:
  // both are multi-user, server-side operations a per-session undo must not
  // silently reverse.
  const snapshotFromMeasurement = (measurement: TakeoffMeasurementRow): TakeoffSnapshot => ({
    estimate_id: measurement.estimate_id,
    plan_sheet_id: measurement.plan_sheet_id,
    estimate_line_item_id: measurement.estimate_line_item_id,
    library_item_id: measurement.library_item_id,
    tool_type: measurement.tool_type,
    label: measurement.label,
    unit: measurement.unit,
    quantity: measurement.quantity,
    waste_pct: measurement.waste_pct,
    color: measurement.color,
    geometry: measurement.geometry,
    notes: measurement.notes,
    scope_brief_review_id: measurement.scope_brief_review_id,
  });

  const recordTakeoffCommand = (sheetId: string, command: TakeoffCommand) => {
    setUndoStacks((current) => ({
      ...current,
      [sheetId]: pushTakeoffCommand(current[sheetId] ?? emptyTakeoffUndoStack(), command),
    }));
  };

  const UNDOABLE_PATCH_KEYS = [
    "estimate_line_item_id",
    "library_item_id",
    "label",
    "unit",
    "quantity",
    "waste_pct",
    "color",
    "geometry",
    "notes",
  ] as const;

  const recordMeasurementUpdate = (
    id: string,
    patch: Parameters<typeof updateMeasurementFn>[0]["data"]["patch"],
  ) => {
    const measurement = measurements.find((item) => item.id === id);
    if (!measurement) return;
    const before: TakeoffUpdatePatch = {};
    const after: TakeoffUpdatePatch = {};
    for (const key of UNDOABLE_PATCH_KEYS) {
      if (!(key in patch) || patch[key] === undefined) continue;
      before[key] = measurement[key] as never;
      after[key] = patch[key] as never;
    }
    if (Object.keys(after).length === 0) return;
    recordTakeoffCommand(measurement.plan_sheet_id, {
      kind: "update",
      measurementId: id,
      before,
      after,
    });
  };

  useEffect(() => {
    pendingPointsRef.current = pendingPoints;
  }, [pendingPoints]);
  // Ruler chains are ephemeral by design: they do not survive sheet changes.
  useEffect(() => {
    if (tool === "ruler") setPendingPoints([]);
  }, [currentSheet?.id, tool]);

  const handlePageMetrics = useCallback(
    (metrics: { widthPoints: number; heightPoints: number } | null) => {
      setPdfPageMetrics((current) => {
        if (!current && !metrics) return current;
        if (
          current &&
          metrics &&
          current.widthPoints === metrics.widthPoints &&
          current.heightPoints === metrics.heightPoints
        ) {
          return current;
        }
        return metrics;
      });
    },
    [],
  );

  const createSetMutation = useMutation({
    mutationFn: (file: File) => uploadDrawingSet(file),
    onSuccess: (created) => {
      const firstSheet = created.sheets[0];
      if (firstSheet) setSelectedSheetId(firstSheet.id);
      toast.success("Drawing set uploaded. Review title blocks before matching revisions.");
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
      const label =
        measurementLabel.trim() || line?.description || `${toolLabel(measurementTool)} takeoff`;
      const unit = unitFor(measurementTool, line);
      const preparedSuggestion =
        preparedMeasurementSuggestion?.id === preparedMeasurementSuggestionId
          ? preparedMeasurementSuggestion
          : null;
      const preparedNote =
        preparedSuggestion?.tool === measurementTool && preparedSuggestion.label === label
          ? measurementSourceNote
          : "";
      const scopeBriefTakeoff = preparedScopeBriefTakeoff;
      const scopeBriefReviewId =
        preparedNote &&
        scopeBriefTakeoff &&
        scopeBriefTakeoff.suggestionId === preparedSuggestion?.id
          ? scopeBriefTakeoff.reviewId
          : null;
      // Label-match inheritance (beta batch 2): finishing into an existing
      // group inherits its estimate-row link, library item, and color —
      // unless the takeoff was explicitly aimed at a row in the tools panel.
      // A same-label group with an incompatible unit never auto-joins.
      const match = findTakeoffGroupMatch({ label, unit, measurements });
      const joinedGroup = !line && match.joins ? match.group : null;
      const result = await createMeasurementFn({
        data: {
          estimate_id: estimate.id,
          plan_sheet_id: currentSheet.id,
          estimate_line_item_id: line?.id ?? joinedGroup?.linkedLineId ?? null,
          library_item_id: line?.library_item_id ?? joinedGroup?.libraryItemId ?? null,
          tool_type: measurementTool,
          label,
          unit,
          quantity,
          waste_pct: 0,
          color: joinedGroup ? joinedGroup.color : takeoffColor,
          geometry: geometryFromPoints(points, viewSize),
          notes: preparedNote || (line ? "Quantity produced from Plan Room takeoff." : ""),
          scope_brief_review_id: scopeBriefReviewId,
        },
      });
      return {
        ...result,
        joinedGroupLinked: Boolean(joinedGroup?.linkedLineId),
        measurementScopeItemId: preparedMeasurementScopeItemId,
      };
    },
    onSuccess: (result, variables) => {
      qc.setQueryData<PlanRoomMeasurementCache>(["plan-room", estimate.id], (current) =>
        addTakeoffToPlanRoomCache(current, result.measurement),
      );
      if (result.sync?.calculation_conflict) {
        toast.warning(
          "Takeoff saved, but its quantity needs review before it can update the estimate.",
        );
      } else {
        toast.success(
          result.joinedGroupLinked
            ? "Takeoff saved — added to its group and linked"
            : selectedLine
              ? "Takeoff saved and estimate row updated"
              : "Takeoff saved",
        );
      }
      setPendingPoints([]);
      setSelectedMeasurementId(result.measurement.id);
      recordTakeoffCommand(result.measurement.plan_sheet_id, {
        kind: "create",
        measurementId: result.measurement.id,
        snapshot: snapshotFromMeasurement(result.measurement),
      });
      if (variables.measurementTool !== "count") setTool("select");
      const completedSuggestion =
        preparedMeasurementSuggestion?.id === preparedMeasurementSuggestionId &&
        preparedMeasurementSuggestion.tool === variables.measurementTool &&
        preparedMeasurementSuggestion.label === result.measurement.label
          ? preparedMeasurementSuggestion
          : null;
      if (completedSuggestion) {
        setCompletedMeasurementSuggestionIds((current) =>
          current.includes(completedSuggestion.id) ? current : [...current, completedSuggestion.id],
        );
        setPreparedMeasurementSuggestionId("");
        setPreparedMeasurementSuggestion(null);
        setPreparedScopeBriefTakeoff(null);
        setMeasurementSourceNote("");
      }
      if (result.measurementScopeItemId) {
        void completeMeasurementScopeItemFn({
          data: {
            scope_item_id: result.measurementScopeItemId,
            takeoff_measurement_id: result.measurement.id,
          },
        })
          .then(({ item }) => {
            cacheMeasurementScopeItem(item);
          })
          .catch((error) =>
            toast.warning(
              error instanceof Error
                ? `Takeoff saved, but scope completion needs review: ${error.message}`
                : "Takeoff saved, but scope completion needs review.",
            ),
          )
          .finally(() => setPreparedMeasurementScopeItemId(""));
      }
      const anchor = variables.points[variables.points.length - 1];
      if (anchor) {
        // The takeoff comes to you: classify right where you finished.
        setFinishPopover({ measurementId: result.measurement.id, anchor });
      }
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
    onSuccess: (_result, patch) => {
      toast.success("Sheet updated");
      setCalibrationPoints([]);
      if (patch.scale_feet_per_pixel != null) setTool("select");
      invalidate();
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Sheet did not save"),
  });

  const scaleAssessmentMutation = useMutation({
    mutationFn: (checks: ScaleAssuranceCheckPreview[]) => {
      if (!currentSheet) throw new Error("Choose a plan sheet first.");
      return recordScaleAssessmentFn({
        data: {
          estimate_id: estimate.id,
          plan_sheet_id: currentSheet.id,
          scale_revision: currentSheet.scale_revision,
          checks: checks.map((check) => ({
            points: check.points,
            labeled_distance_feet: check.labeled_distance_feet,
          })),
          notes: "Two-check Scale Assurance review from the Plan Room.",
        },
      });
    },
    onSuccess: (result) => {
      setScaleAssessmentOverride(result.assessment);
      setScaleVerifiedAtOverride(result.verified_at);
      const summary = summarizeScaleAssuranceChecks(result.evidence);
      if (result.outcome === "verified") {
        toast.success(
          `Scale verified with two checks. Maximum variance ${result.max_variance_pct.toFixed(2)}%.`,
        );
      } else if (summary) {
        const worst = result.evidence.reduce((current, check) =>
          Math.abs(check.variance_pct) > Math.abs(current.variance_pct) ? check : current,
        );
        setVerifyOutcome({
          measuredFeet: worst.measured_distance_feet,
          expectedFeet: worst.labeled_distance_feet,
          offPct: worst.variance_pct,
          correctedScale: summary.correctedScaleFeetPerPixel,
          maxVariancePct: result.max_variance_pct,
          scaleSpreadPct: result.scale_spread_pct,
          canRecalibrate: result.scale_spread_pct <= SCALE_ASSURANCE_TOLERANCE_PCT,
        });
        toast.warning("The two scale checks did not pass. This sheet remains unverified.");
      }
      setScaleCheckDrafts([]);
      setCalibrationPoints([]);
      setVerifyFeet("");
      setTool("select");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Scale evidence did not save"),
  });

  const scaleCorrectionMutation = useMutation({
    mutationFn: (correctedScale: number) => {
      if (!currentSheet) throw new Error("Choose a plan sheet first.");
      return updateSheetFn({
        data: {
          sheet_id: currentSheet.id,
          patch: {
            scale_feet_per_pixel: correctedScale,
            scale_label: "Two-check assurance recalibration",
            scale_source: "calibrated",
            scale_verified_at: null,
            width_px: Math.round(viewSize.width),
            height_px: Math.round(viewSize.height),
          },
        },
      });
    },
    onSuccess: () => {
      toast.success("Scale recalibrated. Run two new checks before trusting quantities.");
      setScaleCheckDrafts([]);
      setCalibrationPoints([]);
      setVerifyFeet("");
      setVerifyOutcome(null);
      setScaleAssessmentOverride(null);
      setScaleVerifiedAtOverride(null);
      setTool("select");
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Scale correction did not save"),
  });

  const applyToSetMutation = useMutation({
    mutationFn: async (stated: { statedInches: number; statedFeet: number; label: string }) => {
      if (!currentPlanSet || !currentSheet) throw new Error("Choose a plan sheet first.");
      const targets = sheets.filter(
        (sheet) =>
          sheet.plan_set_id === currentPlanSet.id &&
          sheet.id !== currentSheet.id &&
          !sheet.scale_feet_per_pixel,
      );
      if (targets.length === 0) return { count: 0 };
      const { data, error } = await supabase.storage
        .from(planRoomBucket)
        .createSignedUrl(currentPlanSet.file_path, 60 * 10);
      if (error || !data?.signedUrl) {
        throw new Error(error?.message ?? "The drawing set file did not open.");
      }
      const patches = await computeStatedScalePatches({
        fileUrl: data.signedUrl,
        sheets: targets,
        statedInches: stated.statedInches,
        statedFeet: stated.statedFeet,
        scaleLabel: `${stated.label} stated scale`,
      });
      if (patches.length === 0) {
        throw new Error("No unscaled sheets could take the stated scale.");
      }
      await applyScaleToSheetsFn({
        data: { estimate_id: estimate.id, sheets: patches },
      });
      return { count: patches.length };
    },
    onSuccess: ({ count }) => {
      if (count > 0) {
        toast.success(
          `Stated scale applied to ${count} more sheet${count === 1 ? "" : "s"}. Complete two Scale Assurance checks before measuring.`,
        );
      }
      setApplyToSetOffer(null);
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Stated scale did not apply to the set"),
  });

  const updateMeasurementMutation = useMutation({
    mutationFn: ({
      id,
      patch,
      recalculateFromGeometry = false,
    }: {
      id: string;
      patch: Parameters<typeof updateMeasurementFn>[0]["data"]["patch"];
      recalculateFromGeometry?: boolean;
    }) =>
      updateMeasurementFn({
        data: { id, patch, recalculate_from_geometry: recalculateFromGeometry },
      }),
    onSuccess: (_result, variables) => {
      toast.success("Takeoff updated");
      // `measurements` still holds the pre-update row here — the query only
      // refetches after invalidate below — so the undo `before` is accurate.
      recordMeasurementUpdate(variables.id, variables.patch);
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Takeoff did not save"),
  });

  const recalculateSheetMutation = useMutation({
    mutationFn: (sheetId: string) =>
      recalculateSheetTakeoffsFn({
        data: { estimate_id: estimate.id, plan_sheet_id: sheetId },
      }),
    onSuccess: (result) => {
      const recalculated = result.measurements.length;
      const skipped = result.skipped_manual_overrides.length;
      toast.success(
        skipped > 0
          ? `${recalculated} takeoffs recalculated; ${skipped} manual override${skipped === 1 ? "" : "s"} still need review`
          : `${recalculated} takeoff${recalculated === 1 ? "" : "s"} recalculated from drawing geometry`,
      );
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Sheet takeoffs did not recalculate"),
  });

  const deleteMeasurementMutation = useMutation({
    mutationFn: async (id: string) => {
      // Capture the row before it is gone; undo recreates it from this.
      const measurement = measurements.find((item) => item.id === id) ?? null;
      await deleteMeasurementFn({ data: { id } });
      return measurement;
    },
    onSuccess: (measurement, id) => {
      toast.success("Takeoff deleted");
      if (selectedMeasurementId === id) setSelectedMeasurementId("");
      if (measurement) {
        recordTakeoffCommand(measurement.plan_sheet_id, {
          kind: "delete",
          measurementId: id,
          snapshot: snapshotFromMeasurement(measurement),
        });
      }
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Takeoff did not delete"),
  });

  // Link-or-create classification. The subsequent sync runs through the
  // normal mutation so waste, unit-guard, and anti-clobber dialogs all apply.
  const classifyTakeoffMutation = useMutation({
    mutationFn: (variables: {
      measurementIds: string[];
      source:
        | { type: "library"; library_item_id: string }
        | { type: "label"; description: string; unit: string };
    }) =>
      createLineForTakeoffsFn({
        data: {
          estimate_id: estimate.id,
          measurement_ids: variables.measurementIds,
          source: variables.source,
        },
      }),
    onSuccess: (result) => {
      invalidate();
      syncLineMutation.mutate({ lineId: result.line_item_id });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Estimate row did not save"),
  });

  const linkMeasurementToRow = (measurementId: string, lineId: string) => {
    updateMeasurementMutation.mutate(
      { id: measurementId, patch: { estimate_line_item_id: lineId } },
      { onSuccess: () => syncLineMutation.mutate({ lineId }) },
    );
  };

  // Group actions (beta batch 2): one answer links every member; each link is
  // recorded on the undo stack, then the row syncs once.
  const linkGroupMutation = useMutation({
    mutationFn: async ({
      measurementIds,
      lineId,
    }: {
      measurementIds: string[];
      lineId: string;
    }) => {
      for (const id of measurementIds) {
        await updateMeasurementFn({ data: { id, patch: { estimate_line_item_id: lineId } } });
      }
      return { measurementIds, lineId };
    },
    onSuccess: ({ measurementIds, lineId }) => {
      // `measurements` still holds the pre-update rows here, so the undo
      // snapshots are accurate (same pattern as updateMeasurementMutation).
      measurementIds.forEach((id) =>
        recordMeasurementUpdate(id, { estimate_line_item_id: lineId }),
      );
      toast.success(
        `${measurementIds.length} takeoff${measurementIds.length === 1 ? "" : "s"} linked`,
      );
      invalidate();
      syncLineMutation.mutate({ lineId });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The group did not link"),
  });

  // Detach covers the intentional same-name-different-thing case: clears the
  // inherited link on that measurement only. The server re-syncs the row it
  // left so the group rollup stays honest.
  const detachMeasurementFromGroup = (measurementId: string) => {
    updateMeasurementMutation.mutate({
      id: measurementId,
      patch: { estimate_line_item_id: null, library_item_id: null },
    });
  };

  // Executes the server side of an undo/redo. Recreates return the fresh row
  // id so the stacks can follow it. These call the raw server functions, not
  // the recording mutations — an undo must never record itself.
  const runTakeoffInverseOp = async (op: TakeoffInverseOp): Promise<string | null> => {
    if (op.type === "delete") {
      await deleteMeasurementFn({ data: { id: op.measurementId } });
      return null;
    }
    if (op.type === "update") {
      await updateMeasurementFn({
        data: {
          id: op.measurementId,
          patch: op.patch as Parameters<typeof updateMeasurementFn>[0]["data"]["patch"],
        },
      });
      return null;
    }
    const result = await createMeasurementFn({
      data: op.snapshot as Parameters<typeof createMeasurementFn>[0]["data"],
    });
    return result.measurement.id;
  };

  const undoToastCopy = (command: TakeoffCommand, direction: "undo" | "redo") => {
    const reversed = direction === "undo";
    if (command.kind === "create") return reversed ? "Takeoff removed" : "Takeoff restored";
    if (command.kind === "delete") return reversed ? "Takeoff restored" : "Takeoff removed";
    return reversed ? "Takeoff change undone" : "Takeoff change reapplied";
  };

  const activeUndoStack = currentSheet ? (undoStacks[currentSheet.id] ?? null) : null;
  const canUndoTakeoff = !undoBusy && Boolean(activeUndoStack && activeUndoStack.undo.length > 0);
  const canRedoTakeoff = !undoBusy && Boolean(activeUndoStack && activeUndoStack.redo.length > 0);

  const runStackStep = async (direction: "undo" | "redo") => {
    if (!currentSheet || undoBusy) return;
    const sheetId = currentSheet.id;
    const stack = undoStacks[sheetId];
    const command = stack
      ? direction === "undo"
        ? peekUndoCommand(stack)
        : peekRedoCommand(stack)
      : null;
    if (!command) return;
    setUndoBusy(true);
    try {
      const op = direction === "undo" ? undoOperationFor(command) : redoOperationFor(command);
      const newId = await runTakeoffInverseOp(op);
      setUndoStacks((current) => {
        const base = current[sheetId] ?? emptyTakeoffUndoStack();
        let next = direction === "undo" ? commitUndo(base) : commitRedo(base);
        if (newId && op.type === "create") {
          next = remapTakeoffMeasurementId(next, op.replacesId, newId);
        }
        return { ...current, [sheetId]: next };
      });
      // A removed takeoff cannot stay selected or keep its popover open.
      if (op.type === "delete") {
        if (selectedMeasurementId === op.measurementId) setSelectedMeasurementId("");
        setFinishPopover((current) =>
          current?.measurementId === op.measurementId ? null : current,
        );
      }
      toast.success(undoToastCopy(command, direction));
      invalidate();
    } catch {
      // The inverse mutation failed. Drop the entry so the stack and the
      // server never disagree, and say so plainly.
      setUndoStacks((current) => {
        const base = current[sheetId] ?? emptyTakeoffUndoStack();
        return { ...current, [sheetId]: direction === "undo" ? dropUndo(base) : dropRedo(base) };
      });
      toast.error(
        direction === "undo"
          ? "Couldn't undo — the change already synced"
          : "Couldn't redo — the change already synced",
      );
    } finally {
      setUndoBusy(false);
    }
  };

  const undoTakeoff = () => void runStackStep("undo");
  const redoTakeoff = () => void runStackStep("redo");

  // Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z work anywhere in the Plan Room except
  // while typing. Window-level so the shortcut works from the worksheet and
  // panels, not just the canvas.
  //
  // While a run is active, Cmd/Ctrl+Z peels off the last placed vertex
  // instead of touching the committed-takeoff stack (beta batch 1 Task 2).
  // Removing the final vertex leaves an empty run — the same end state as
  // Esc. Only with no run active does the shortcut fall through to the
  // committed undo stack.
  const isRunActive =
    ((tool === "linear" || tool === "area" || tool === "count" || tool === "ruler") &&
      pendingPoints.length > 0) ||
    ((tool === "calibrate" || tool === "verify") && calibrationPoints.length > 0);
  const undoRunVertex = () => {
    if (!isRunActive) return false;
    if (tool === "calibrate" || tool === "verify") {
      setCalibrationPoints((current) => current.slice(0, -1));
      return true;
    }
    setPendingPoints((current) => current.slice(0, -1));
    return true;
  };
  const undoHandlersRef = useRef({
    undo: undoTakeoff,
    redo: redoTakeoff,
    undoRunVertex,
    isRunActive,
  });
  useEffect(() => {
    undoHandlersRef.current = { undo: undoTakeoff, redo: redoTakeoff, undoRunVertex, isRunActive };
  });
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input,textarea,select,[contenteditable='true']")) return;
      event.preventDefault();
      if (event.shiftKey) {
        // Redo stays inert during an active run: the committed stack must
        // not change underneath a half-drawn takeoff.
        if (!undoHandlersRef.current.isRunActive) undoHandlersRef.current.redo();
        return;
      }
      if (undoHandlersRef.current.undoRunVertex()) return;
      undoHandlersRef.current.undo();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Task 3: offered matches, never auto-applied. Computed live so rows that
  // appear after a master sheet import are matched the moment they exist.
  const takeoffMatchSuggestions = useMemo(
    () =>
      suggestTakeoffMatches(
        measurements
          .filter((measurement) => !measurement.estimate_line_item_id)
          .map((measurement) => ({
            id: measurement.id,
            label: measurement.label,
            unit: measurement.unit,
          })),
        lineItems.map((line) => ({
          id: line.id,
          cost_code: line.cost_code,
          description: line.description,
          unit: line.unit,
        })),
      ),
    [lineItems, measurements],
  );

  const openBuildFromTakeoffs = () => {
    const groups = groupUnlinkedTakeoffs(
      measurements
        .filter((measurement) => !measurement.estimate_line_item_id)
        .map((measurement) => ({
          id: measurement.id,
          label: measurement.label,
          unit: measurement.unit,
          quantity: measurement.quantity,
          waste_pct: measurement.waste_pct,
          library_item_id: measurement.library_item_id,
        })),
    );
    if (groups.length === 0) {
      toast.info("Every takeoff is already linked to an estimate row.");
      return;
    }
    setBuildGroups(groups.map((group) => ({ ...group, accepted: true })));
  };

  const buildFromTakeoffsMutation = useMutation({
    mutationFn: async (groups: TakeoffGroup[]) => {
      const createdLineIds: string[] = [];
      for (const group of groups) {
        const result = await createLineForTakeoffsFn({
          data: {
            estimate_id: estimate.id,
            measurement_ids: group.measurement_ids,
            source: group.library_item_id
              ? { type: "library", library_item_id: group.library_item_id }
              : { type: "label", description: group.label, unit: group.unit },
          },
        });
        createdLineIds.push(result.line_item_id);
      }
      return createdLineIds;
    },
    onSuccess: (createdLineIds) => {
      toast.success(
        `${createdLineIds.length} estimate row${createdLineIds.length === 1 ? "" : "s"} created from takeoffs`,
      );
      setBuildGroups(null);
      invalidate();
      createdLineIds.forEach((lineId) => syncLineMutation.mutate({ lineId }));
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Estimate rows did not build"),
  });

  const openMatchProposals = () => {
    const proposals = takeoffMatchSuggestions
      .map((match) => {
        const measurement = measurements.find((item) => item.id === match.measurement_id);
        const line = lineItems.find((item) => item.id === match.line_id);
        if (!measurement || !line) return null;
        return {
          measurementId: measurement.id,
          lineId: line.id,
          takeoffLabel: measurement.label,
          takeoffQuantity: measurement.quantity,
          takeoffUnit: measurement.unit,
          rowLabel: `${line.cost_code ? `${line.cost_code} · ` : ""}${line.description}`,
          rowUnit: line.unit,
          accepted: true,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);
    if (proposals.length === 0) {
      toast.info("No confident takeoff-to-row matches found.");
      return;
    }
    setMatchProposals(proposals);
  };

  const applyMatchesMutation = useMutation({
    mutationFn: async (rows: NonNullable<typeof matchProposals>) => {
      const accepted = rows.filter((row) => row.accepted);
      for (const row of accepted) {
        await updateMeasurementFn({
          data: { id: row.measurementId, patch: { estimate_line_item_id: row.lineId } },
        });
      }
      return Array.from(new Set(accepted.map((row) => row.lineId)));
    },
    onSuccess: (lineIds) => {
      if (lineIds.length > 0) {
        toast.success(
          `${lineIds.length} estimate row${lineIds.length === 1 ? "" : "s"} matched to takeoffs`,
        );
      }
      setMatchProposals(null);
      invalidate();
      lineIds.forEach((lineId) => syncLineMutation.mutate({ lineId }));
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Matches did not apply"),
  });

  const renameSheetMutation = useMutation({
    mutationFn: ({
      sheetId,
      patch,
    }: {
      sheetId: string;
      patch: { sheet_number?: string; sheet_name?: string };
    }) =>
      updatePlanSheetsFn({
        data: { estimate_id: estimate.id, sheets: [{ sheet_id: sheetId, patch }] },
      }),
    onSuccess: () => {
      toast.success("Sheet renamed");
      setHeaderRename(null);
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Sheet did not rename"),
  });

  // "Detect sheet names": run title-block extraction across the set, then
  // suggest — never silently rename sheets the user may already reference.
  const detectNamesMutation = useMutation({
    mutationFn: async () => {
      if (!currentPlanSet) throw new Error("Choose a plan set first.");
      if (currentPlanSet.file_mime_type !== "application/pdf" || !currentPlanSet.file_path) {
        throw new Error("Sheet name detection needs an uploaded PDF drawing set.");
      }
      const url = await planSetSignedUrl(currentPlanSet);
      const setSheets = sheets.filter((sheet) => sheet.plan_set_id === currentPlanSet.id);
      const processed = await processPlanSetSheets({
        source: { url },
        sheets: setSheets,
        extractIdentityText: true,
      });
      return { processed, setSheets };
    },
    onSuccess: ({ processed, setSheets }) => {
      const proposals = processed
        .map((page) => {
          const sheet = setSheets.find((item) => item.id === page.sheet_id);
          if (!sheet || !page.sheet_number) return null;
          const detectedName = page.sheet_name ?? sheet.sheet_name;
          if (page.sheet_number === sheet.sheet_number && detectedName === sheet.sheet_name) {
            return null;
          }
          return {
            sheetId: sheet.id,
            currentLabel: `${sheet.sheet_number || `Page ${sheet.page_number}`} — ${sheet.sheet_name || "Unnamed sheet"}`,
            detectedNumber: page.sheet_number,
            detectedName: detectedName || "",
            accepted: true,
          };
        })
        .filter((item): item is NonNullable<typeof item> => item !== null);
      if (proposals.length === 0) {
        toast.info(
          "No title-block names found. Scanned sets keep their names — use the pencil to rename.",
        );
        return;
      }
      setDetectProposals(proposals);
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Sheet detection did not run"),
  });

  const applyDetectedNames = useMutation({
    mutationFn: (proposals: NonNullable<typeof detectProposals>) => {
      const accepted = proposals.filter((row) => row.accepted);
      if (accepted.length === 0) return Promise.resolve(null);
      return updatePlanSheetsFn({
        data: {
          estimate_id: estimate.id,
          sheets: accepted.map((row) => ({
            sheet_id: row.sheetId,
            patch: {
              sheet_number: row.detectedNumber,
              ...(row.detectedName ? { sheet_name: row.detectedName } : {}),
            },
          })),
        },
      });
    },
    onSuccess: (result) => {
      if (result) toast.success("Sheet names updated");
      setDetectProposals(null);
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Sheet names did not apply"),
  });

  const syncLineMutation = useMutation({
    mutationFn: ({
      lineId,
      force = false,
      forceUnit = false,
    }: {
      lineId: string;
      force?: boolean;
      forceUnit?: boolean;
    }) =>
      syncLineFn({
        data: {
          estimate_id: estimate.id,
          estimate_line_item_id: lineId,
          force,
          force_unit: forceUnit,
        },
      }),
    onSuccess: (result, variables) => {
      if (result.sync.calculation_conflict) {
        const firstBlockedId = result.sync.blocked_measurements[0]?.id;
        const firstBlocked = measurements.find((measurement) => measurement.id === firstBlockedId);
        if (firstBlocked) {
          setSelectedSheetId(firstBlocked.plan_sheet_id);
          setSelectedMeasurementId(firstBlocked.id);
        }
        toast.error(
          `${result.sync.blocked_measurements.length} takeoff${result.sync.blocked_measurements.length === 1 ? " is" : "s are"} not trusted yet. Review the highlighted quantity before syncing.`,
        );
        return;
      }
      if (result.sync.unit_conflict || result.sync.conflict) {
        // Show the in-app conflict dialog (unit guard first, then the
        // hand-typed quantity guard) instead of overwriting silently.
        const line = lineItems.find((item) => item.id === variables.lineId);
        const sources = measurements
          .filter((measurement) => measurement.estimate_line_item_id === variables.lineId)
          .map((measurement) => {
            const sourceSheet = sheets.find((sheet) => sheet.id === measurement.plan_sheet_id);
            return {
              label: measurement.label,
              sheetNumber: sourceSheet?.sheet_number ?? "",
              sheetName: sourceSheet?.sheet_name ?? "",
              wastePct: measurement.waste_pct,
              quantity: measurement.quantity,
              unit: measurement.unit,
            };
          });
        setSyncConflict({
          kind: result.sync.unit_conflict ? "unit" : "quantity",
          lineId: variables.lineId,
          lineDescription: line?.description ?? "",
          lineUnit: result.sync.line_unit,
          takeoffUnit: result.sync.takeoff_unit,
          currentQuantity: result.sync.quantity,
          incomingQuantity: result.sync.takeoff_quantity,
          measurementCount: result.sync.measurement_count,
          forceUnitGranted: Boolean(variables.forceUnit),
          sources,
        });
        return;
      }
      setSyncConflict(null);
      toast.success(
        `Estimate quantity updated to ${formatQty(result.sync.quantity, result.sync.line_unit)}`,
      );
      invalidate();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Estimate row did not update"),
  });

  const confirmSyncConflict = (conflict: SyncConflictState) => {
    syncLineMutation.mutate({
      lineId: conflict.lineId,
      force: conflict.kind === "quantity",
      forceUnit: conflict.kind === "unit" || conflict.forceUnitGranted,
    });
  };

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
      const created = await createPlanSetFn({
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
      setPostProcessingPlanSetId(created.plan_set.id);
      void postProcessUploadedSet(
        file,
        created.plan_set.id,
        created.sheets.map((sheet) => ({ id: sheet.id, page_number: sheet.page_number })),
      ).finally(() =>
        setPostProcessingPlanSetId((current) => (current === created.plan_set.id ? "" : current)),
      );
      return created;
    } finally {
      setUploading(false);
    }
  };

  const thumbnailPathFor = (planSetId: string, sheetId: string) =>
    `${estimate.id}/${planSetId}/thumbs/${sheetId}.webp`;

  const uploadThumbnailsAndPatches = async (planSetId: string, processed: ProcessedSheetPage[]) => {
    const patches: Array<{
      sheet_id: string;
      patch: {
        sheet_number?: string;
        sheet_name?: string;
        thumbnail_path?: string;
      };
    }> = [];
    for (const page of processed) {
      const patch: {
        sheet_number?: string;
        sheet_name?: string;
        thumbnail_path?: string;
      } = {};
      if (page.sheet_number) patch.sheet_number = page.sheet_number;
      if (page.sheet_name) patch.sheet_name = page.sheet_name;
      if (page.thumbnail) {
        const path = thumbnailPathFor(planSetId, page.sheet_id);
        const { error } = await supabase.storage.from(planRoomBucket).upload(path, page.thumbnail, {
          upsert: true,
          contentType: page.thumbnail.type || "image/webp",
        });
        if (!error) patch.thumbnail_path = path;
      }
      if (Object.keys(patch).length > 0) patches.push({ sheet_id: page.sheet_id, patch });
    }
    if (patches.length > 0) {
      await updatePlanSheetsFn({ data: { estimate_id: estimate.id, sheets: patches } });
    }
    return patches.length;
  };

  // Upload post-processing: thumbnails + title-block identity in one pass over
  // the file that is already in memory. Runs in the background after the set
  // is created; placeholder names make overwriting safe.
  const postProcessUploadedSet = async (
    file: File,
    planSetId: string,
    createdSheets: Array<{ id: string; page_number: number }>,
  ) => {
    if (file.type !== "application/pdf" || createdSheets.length === 0) return;
    try {
      const processed = await processPlanSetSheets({
        source: { data: await file.arrayBuffer() },
        sheets: createdSheets,
        extractIdentityText: true,
        renderThumbnails: true,
      });
      const patched = await uploadThumbnailsAndPatches(planSetId, processed);
      if (patched > 0) {
        const named = processed.filter((page) => page.sheet_number).length;
        if (named > 0) {
          toast.success(`Sheet names read from ${named} title block${named === 1 ? "" : "s"}`);
        }
        invalidate();
      }
    } catch {
      // Thumbnails and names are conveniences; the upload itself already
      // succeeded, so fail quietly rather than alarming the user.
    }
  };

  const planSetSignedUrl = async (planSet: PlanSetRow) => {
    const { data, error } = await supabase.storage
      .from(planRoomBucket)
      .createSignedUrl(planSet.file_path, 60 * 10);
    if (error || !data?.signedUrl) {
      throw new Error(error?.message ?? "The drawing set file did not open.");
    }
    return data.signedUrl;
  };

  const scopeBriefMutation = useMutation({
    mutationFn: async () => {
      if (!currentPlanSet) throw new Error("Choose a drawing set first.");
      if (currentPlanSet.file_mime_type !== "application/pdf" || !currentPlanSet.file_path) {
        throw new Error("The Scope Brief needs a retained vector PDF drawing set.");
      }
      const setSheets = sheets
        .filter((sheet) => sheet.plan_set_id === currentPlanSet.id)
        .sort((left, right) => left.sort_order - right.sort_order);
      if (setSheets.length === 0) throw new Error("This drawing set has no retained sheets.");
      const fileUrl = await planSetSignedUrl(currentPlanSet);
      setScopeBriefProgress(`Reading selectable notes · 0/${setSheets.length} sheets`);
      const sourceSheets = await extractPdfPlanScopeBriefEvidence({
        fileUrl,
        sheets: setSheets,
        onProgress: (completed, total) =>
          setScopeBriefProgress(`Reading selectable notes · ${completed}/${total} sheets`),
      });
      if (sourceSheets.length === 0) {
        throw new Error(
          "No supported selectable plan notes were found in this set. No AI credit was used.",
        );
      }
      setScopeBriefProgress(
        `Organizing cited scope from ${sourceSheets.length}/${setSheets.length} evidence-bearing sheets…`,
      );
      const brief = await generatePlanScopeBriefFn({
        data: {
          estimate_id: estimate.id,
          plan_set_id: currentPlanSet.id,
          plan_set_name: currentPlanSet.name || currentPlanSet.source_file_name,
          total_sheet_count: setSheets.length,
          source_sheets: sourceSheets,
        },
      });
      return { brief, planSetId: currentPlanSet.id };
    },
    onSuccess: ({ brief, planSetId }) => {
      qc.invalidateQueries({ queryKey: ["plan-scope-brief", estimate.id, planSetId] });
      toast.success(
        brief.items.length > 0
          ? `${brief.items.length} cited estimator scope prompt${brief.items.length === 1 ? "" : "s"} ready for review.`
          : "No sufficiently supported scope prompt was retained. Manual review remains required.",
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The Scope Brief could not be built"),
    onSettled: () => setScopeBriefProgress(""),
  });

  const reviewAcceptedRevisionNotes = async (match: PlanRevisionMatchRow) => {
    const revisionSheet = sheets.find((sheet) => sheet.id === match.revision_sheet_id);
    const baseSheet = sheets.find((sheet) => sheet.id === match.base_sheet_id);
    const revisionSet = planSets.find((planSet) => planSet.id === revisionSheet?.plan_set_id);
    const baseSet = planSets.find((planSet) => planSet.id === baseSheet?.plan_set_id);
    if (!revisionSheet || !baseSheet || !revisionSet || !baseSet) {
      throw new Error("Both accepted sheets must still be available in the Plan Room.");
    }
    if (
      revisionSet.file_mime_type !== "application/pdf" ||
      baseSet.file_mime_type !== "application/pdf" ||
      !revisionSet.file_path ||
      !baseSet.file_path
    ) {
      throw new Error("Revision note comparison needs two retained vector-PDF sheets.");
    }
    const [revisionFileUrl, baseFileUrl] = await Promise.all([
      planSetSignedUrl(revisionSet),
      planSetSignedUrl(baseSet),
    ]);
    const [revisionEvidence, baseEvidence] = await Promise.all([
      extractPdfMeasurementEvidence({
        fileUrl: revisionFileUrl,
        pageNumber: revisionSheet.page_number,
      }),
      extractPdfMeasurementEvidence({
        fileUrl: baseFileUrl,
        pageNumber: baseSheet.page_number,
      }),
    ]);
    if (revisionEvidence.sourceLines.length === 0 || baseEvidence.sourceLines.length === 0) {
      throw new Error(
        "Selectable note text is required on both accepted sheets. No AI credit was used.",
      );
    }
    return analyzeRevisionScopeFn({
      data: {
        estimate_id: estimate.id,
        revision_match_id: match.id,
        revision_source_lines: revisionEvidence.sourceLines,
        base_source_lines: baseEvidence.sourceLines,
      },
    });
  };

  const measurementAssistantMutation = useMutation({
    mutationFn: async (input?: { sheetId: string }) => {
      const reviewSheet = input?.sheetId
        ? sheets.find((sheet) => sheet.id === input.sheetId)
        : currentSheet;
      const reviewPlanSet = reviewSheet
        ? planSets.find((planSet) => planSet.id === reviewSheet.plan_set_id)
        : null;
      if (!reviewSheet || !reviewPlanSet) throw new Error("Choose a drawing sheet first.");
      if (reviewPlanSet.file_mime_type !== "application/pdf" || !reviewPlanSet.file_path) {
        throw new Error("Measurement note review needs an uploaded vector PDF.");
      }
      const fileUrl = await planSetSignedUrl(reviewPlanSet);
      const [evidence, guideRaster] = await Promise.all([
        extractPdfMeasurementEvidence({
          fileUrl,
          pageNumber: reviewSheet.page_number,
        }),
        renderDetectionSheet(fileUrl, reviewSheet.page_number, MEASUREMENT_GUIDE_LONG_EDGE_PX),
      ]);
      if (evidence.sourceLines.length === 0) {
        throw new Error(
          "No selectable drawing notes were found on this sheet. It may be a scanned image.",
        );
      }
      const plan = await analyzeMeasurementNotesFn({
        data: {
          estimate_id: estimate.id,
          plan_sheet_id: reviewSheet.id,
          sheet_number: reviewSheet.sheet_number,
          sheet_name: reviewSheet.sheet_name,
          source_lines: evidence.sourceLines.map((line) => ({
            ...line,
            anchor: evidence.anchors[line.line_number],
          })),
          sheet_image: {
            media_type: "image/png",
            base64: canvasToBase64Png(guideRaster.canvas),
            width_px: guideRaster.widthPx,
            height_px: guideRaster.heightPx,
          },
        },
      });
      return { plan, anchors: evidence.anchors };
    },
    onSuccess: ({ plan, anchors }) => {
      setMeasurementAssistantPlan(plan);
      setActiveMeasurementGuideId("");
      setMeasurementGuideLabel("");
      setMeasurementEvidenceAnchors(anchors);
      setPreparedMeasurementSuggestionId("");
      setPreparedMeasurementSuggestion(null);
      setPreparedScopeBriefTakeoff(null);
      setPreparedMeasurementScopeItemId("");
      setCompletedMeasurementSuggestionIds([]);
      setMeasurementSourceNote("");
      const guideCount = plan.suggestions.filter((suggestion) => suggestion.guide).length;
      toast.success(
        plan.suggestions.length > 0
          ? `${plan.suggestions.length} cited measurement suggestion${plan.suggestions.length === 1 ? "" : "s"} ready${guideCount > 0 ? ` · ${guideCount} marked on the drawing` : ""}.`
          : "AI found no sufficiently cited measurement scope and left the checklist empty.",
      );
      qc.invalidateQueries({ queryKey: ["plan-scope-coverage", estimate.id] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Drawing notes could not be reviewed"),
  });

  const openScopeCoverageRecordMutation = useMutation({
    mutationFn: async (record: PlanScopeCoverageRecord) => {
      const sheet = sheets.find((item) => item.id === record.sheet_id);
      const planSet = planSets.find((item) => item.id === sheet?.plan_set_id);
      if (!sheet || !planSet) throw new Error("The cited drawing sheet is no longer available.");
      if (planSet.file_mime_type !== "application/pdf" || !planSet.file_path) {
        throw new Error("The cited review needs its retained vector PDF.");
      }
      const fileUrl = await planSetSignedUrl(planSet);
      const evidence = await extractPdfMeasurementEvidence({
        fileUrl,
        pageNumber: sheet.page_number,
      });
      return { record, anchors: evidence.anchors };
    },
    onSuccess: ({ record, anchors }) => {
      setMeasurementAssistantPlan({
        ...record.plan,
        operation_id: record.operation_id,
        credits_charged: record.credits_charged,
        model: record.model,
        provider: "recorded",
        source_line_count: record.source_line_count,
      });
      setActiveMeasurementGuideId("");
      setMeasurementGuideLabel("");
      setMeasurementEvidenceAnchors(anchors);
      setPreparedMeasurementSuggestionId("");
      setPreparedMeasurementSuggestion(null);
      setPreparedScopeBriefTakeoff(null);
      setPreparedMeasurementScopeItemId("");
      setCompletedMeasurementSuggestionIds([]);
      setMeasurementSourceNote("");
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The cited review could not open"),
  });

  const measurementScopeDecisionMutation = useMutation({
    mutationFn: ({
      suggestion,
      status,
      sheetId,
      aiOperationId,
      anchor,
      suggestionKey,
      scopeKey,
    }: {
      suggestion: MeasurementAssistantSuggestion;
      status: MeasurementScopeDecisionStatus;
      sheetId: string;
      aiOperationId: string | null;
      anchor: MeasurementEvidenceAnchor | null;
      suggestionKey?: string;
      scopeKey?: string;
    }) =>
      saveMeasurementScopeDecisionFn({
        data: {
          estimate_id: estimate.id,
          plan_sheet_id: sheetId,
          ai_operation_id: aiOperationId,
          suggestion_key: suggestionKey ?? measurementSuggestionKey(sheetId, suggestion),
          scope_key: scopeKey ?? measurementScopeKey(suggestion),
          label: suggestion.label,
          tool_type: suggestion.tool,
          unit: suggestion.unit,
          source_line: suggestion.source_line,
          source_excerpt: suggestion.source_excerpt,
          source_anchor: anchor,
          status,
        },
      }),
    onSuccess: ({ item }, variables) => {
      cacheMeasurementScopeItem(item);
      toast.success(
        variables.status === "accepted"
          ? "Scope added to the estimate queue."
          : variables.status === "deferred"
            ? "Scope deferred for later review."
            : "Scope rejected and retained in the review history.",
      );
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Scope decision did not save"),
  });

  const showMeasurementEvidence = ({
    sheetId,
    sourceLine,
    label,
    anchor,
  }: {
    sheetId: string;
    sourceLine: string;
    label: string;
    anchor: MeasurementEvidenceAnchor | null;
  }) => {
    if (!anchor) {
      toast.warning(
        "This cited note has no saved drawing location. Re-review its vector PDF sheet.",
      );
      return;
    }
    if (currentSheet?.id !== sheetId) openSheet(sheetId);
    setMeasurementEvidenceFocus({
      id: `${sheetId}-${sourceLine}-${Date.now()}`,
      sheetId,
      sourceLine,
      label,
      ...anchor,
    });
  };

  const openScopeBriefEvidenceMutation = useMutation({
    mutationFn: async (request: {
      item: PlanScopeBriefItem;
      action?: PlanScopeBriefNextAction;
      review?: PlanScopeBriefReview;
    }) => {
      const { item, action } = request;
      const sheet = sheets.find((candidate) => candidate.id === item.plan_sheet_id);
      const planSet = planSets.find((candidate) => candidate.id === sheet?.plan_set_id);
      if (!sheet || !planSet) throw new Error("The cited drawing sheet is no longer available.");
      if (planSet.file_mime_type !== "application/pdf" || !planSet.file_path) {
        throw new Error("The cited brief needs its retained vector PDF.");
      }
      const fileUrl = await planSetSignedUrl(planSet);
      const evidence = await extractPdfMeasurementEvidence({
        fileUrl,
        pageNumber: sheet.page_number,
      });
      const anchor = evidence.anchors[item.source_line] ?? null;
      if (action && !anchor) {
        throw new Error(
          "The cited note could not be located on the drawing. Rebuild the Scope Brief before starting review.",
        );
      }
      // Preserve the exact accepted review through the asynchronous evidence
      // lookup. Dropping it here closes the brief without opening the routed
      // workbench, because the downstream handoff deliberately requires both
      // an action and its durable estimator decision.
      return { ...request, anchor };
    },
    onSuccess: ({ item, action, review, anchor }) => {
      setSelectedSheetId(item.plan_sheet_id);
      showMeasurementEvidence({
        sheetId: item.plan_sheet_id,
        sourceLine: item.source_line,
        label: item.scope_label,
        anchor,
      });
      if (action && review) setPendingScopeBriefAction({ item, review });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "The cited sheet could not open"),
  });

  const decideMeasurementSuggestion = (
    suggestion: MeasurementAssistantSuggestion,
    status: MeasurementScopeDecisionStatus,
    labelOverride?: string,
  ) => {
    if (!currentSheet || !measurementAssistantPlan) return;
    const suggestionKey = measurementSuggestionKey(currentSheet.id, suggestion);
    const decidedSuggestion = labelOverride?.trim()
      ? { ...suggestion, label: labelOverride.trim() }
      : suggestion;
    measurementScopeDecisionMutation.mutate({
      suggestion: decidedSuggestion,
      status,
      sheetId: currentSheet.id,
      aiOperationId: measurementAssistantPlan.operation_id,
      anchor: measurementEvidenceAnchors[suggestion.source_line] ?? null,
      suggestionKey,
    });
  };

  const selectMeasurementGuide = (suggestion: MeasurementAssistantSuggestion) => {
    const queueItem = queueItemBySuggestionId[suggestion.id];
    setActiveMeasurementGuideId(suggestion.id);
    setMeasurementGuideLabel(queueItem?.label || suggestion.label);
  };

  const showActiveMeasurementGuideEvidence = () => {
    if (!currentSheet || !activeMeasurementGuideSuggestion) return;
    showMeasurementEvidence({
      sheetId: currentSheet.id,
      sourceLine: activeMeasurementGuideSuggestion.source_line,
      label: measurementGuideLabel.trim() || activeMeasurementGuideSuggestion.label,
      anchor: measurementEvidenceAnchors[activeMeasurementGuideSuggestion.source_line] ?? null,
    });
  };

  const acceptActiveMeasurementGuide = () => {
    if (!activeMeasurementGuideSuggestion) return;
    decideMeasurementSuggestion(
      activeMeasurementGuideSuggestion,
      "accepted",
      measurementGuideLabel,
    );
  };

  const rejectActiveMeasurementGuide = () => {
    if (!activeMeasurementGuideSuggestion) return;
    decideMeasurementSuggestion(
      activeMeasurementGuideSuggestion,
      "rejected",
      measurementGuideLabel,
    );
  };

  const startActiveMeasurementGuideTrace = () => {
    if (!activeMeasurementGuideSuggestion || !activeMeasurementGuideQueueItem) return;
    const label = measurementGuideLabel.trim() || activeMeasurementGuideQueueItem.label;
    setPreparedMeasurementScopeItemId(activeMeasurementGuideQueueItem.id);
    prepareMeasurementSuggestion({ ...activeMeasurementGuideSuggestion, label });
    setActiveMeasurementGuideId("");
    setMeasurementGuideLabel("");
  };

  const decideMeasurementScopeItem = (
    item: MeasurementScopeQueueItem,
    status: MeasurementScopeDecisionStatus,
  ) => {
    measurementScopeDecisionMutation.mutate({
      suggestion: scopeItemAsSuggestion(item),
      status,
      sheetId: item.plan_sheet_id,
      aiOperationId: item.ai_operation_id,
      anchor: item.source_anchor,
      suggestionKey: item.suggestion_key,
      scopeKey: item.scope_key,
    });
  };

  const prepareMeasurementSuggestion = (suggestion: MeasurementAssistantSuggestion) => {
    setActiveMeasurementGuideId("");
    setMeasurementGuideLabel("");
    setPreparedScopeBriefTakeoff(null);
    setMeasurementLabel(suggestion.label);
    setMeasurementSourceNote(measurementAssistantTakeoffNote(suggestion));
    setPreparedMeasurementSuggestionId(suggestion.id);
    setPreparedMeasurementSuggestion(suggestion);
    setPendingPoints([]);
    setCalibrationPoints([]);
    setSelectedMeasurementId("");
    if (isCockpitMode) {
      setCockpitPanels((current) => ({ ...current, tools: true }));
    }
    if (currentSheetScaleStatus !== "verified") {
      setTool("select");
      toast.warning(
        "Scope prepared. Complete two Scale Assurance checks before drawing this measurement.",
      );
      return;
    }
    setTool(suggestion.tool);
    toast.info(
      suggestion.tool === "linear"
        ? "Linear takeoff armed. Trace the scope; double-click or press Enter to finish."
        : "Area takeoff armed. Trace the perimeter, then finish the area.",
    );
  };

  const startMeasurementScopeItem = (item: MeasurementScopeQueueItem) => {
    if (item.status === "deferred") {
      decideMeasurementScopeItem(item, "accepted");
      return;
    }
    if (item.status !== "accepted") return;
    showMeasurementEvidence({
      sheetId: item.plan_sheet_id,
      sourceLine: item.source_line,
      label: item.label,
      anchor: item.source_anchor,
    });
    if (currentSheet?.id !== item.plan_sheet_id) {
      setPendingMeasurementScopeStart(item);
      return;
    }
    setPreparedMeasurementScopeItemId(item.id);
    prepareMeasurementSuggestion(scopeItemAsSuggestion(item));
  };

  useEffect(() => {
    if (
      !pendingMeasurementScopeStart ||
      currentSheet?.id !== pendingMeasurementScopeStart.plan_sheet_id
    ) {
      return;
    }
    setPreparedMeasurementScopeItemId(pendingMeasurementScopeStart.id);
    prepareMeasurementSuggestion(scopeItemAsSuggestion(pendingMeasurementScopeStart));
    setPendingMeasurementScopeStart(null);
    // Scope preparation is deliberately triggered only by this cross-sheet handoff.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentSheet?.id, pendingMeasurementScopeStart]);

  // Lazy thumbnail backfill: sets uploaded before thumbnails existed gain them
  // in the background from the already-fetched PDF, current sheet first, one
  // page at a time.
  const backfillThumbnails = async (planSet: PlanSetRow, missing: PlanSheetRow[]) => {
    try {
      const url = await planSetSignedUrl(planSet);
      const ordered = [...missing].sort((a, b) =>
        a.id === currentSheet?.id
          ? -1
          : b.id === currentSheet?.id
            ? 1
            : a.sort_order - b.sort_order,
      );
      const processed = await processPlanSetSheets({
        source: { url },
        sheets: ordered,
        renderThumbnails: true,
        throttleMs: 150,
      });
      const patched = await uploadThumbnailsAndPatches(planSet.id, processed);
      if (patched > 0) invalidate();
    } catch {
      // Background nicety; try again next session.
    }
  };

  useEffect(() => {
    const planSet = currentPlanSet;
    if (!planSet || planSet.file_mime_type !== "application/pdf" || !planSet.file_path) return;
    if (planSet.file_path.startsWith("http") || planSet.file_path.startsWith("/")) return;
    if (thumbBackfillRef.current.has(planSet.id)) return;
    const missing = sheets.filter(
      (sheet) => sheet.plan_set_id === planSet.id && !sheet.thumbnail_path,
    );
    if (missing.length === 0) return;
    thumbBackfillRef.current.add(planSet.id);
    void backfillThumbnails(planSet, missing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPlanSet, sheets]);

  // Signed URLs for sidebar thumbnails, fetched in one batch per new path set.
  useEffect(() => {
    const paths = sheets
      .map((sheet) => sheet.thumbnail_path)
      .filter((path) => path && !(path in thumbUrlByPath));
    if (paths.length === 0) return;
    let active = true;
    supabase.storage
      .from(planRoomBucket)
      .createSignedUrls(paths, 60 * 60)
      .then(({ data }) => {
        if (!active || !data) return;
        setThumbUrlByPath((current) => {
          const next = { ...current };
          data.forEach((entry, index) => {
            if (entry.signedUrl) next[entry.path ?? paths[index]] = entry.signedUrl;
          });
          return next;
        });
      });
    return () => {
      active = false;
    };
  }, [sheets, thumbUrlByPath]);

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    createSetMutation.mutate(file);
  };

  const onCanvasPoint = (point: Point) => {
    if (finishPopover) setFinishPopover(null);
    if (!currentSheet || tool === "select") return;

    if (tool === "calibrate" || tool === "verify") {
      const next = [...calibrationPoints, point].slice(-2);
      setCalibrationPoints(next);
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
    if (tool === "calibrate" || tool === "verify") {
      setCalibrationPoints((current) => current.slice(0, -1));
      return;
    }
    setPendingPoints((current) => current.slice(0, -1));
  };

  const clearDraftPoints = () => {
    if (tool === "calibrate" || tool === "verify") {
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
    const feet = parseFeetInches(calibrationFeet);
    if (!feet) {
      toast.warning("Enter the real distance, like 12' 6\" or 12.5.");
      return;
    }
    const px = distancePx(calibrationPoints, viewSize);
    if (px <= 0) {
      toast.warning("The calibration line is too short.");
      return;
    }
    updateSheetMutation.mutate({
      scale_feet_per_pixel: feet / px,
      scale_label: `${formatQty(feet, "ft")} calibration`,
      scale_source: "calibrated",
      scale_verified_at: null,
      width_px: Math.round(viewSize.width),
      height_px: Math.round(viewSize.height),
    });
  };

  // Scale Assurance: capture two independent labeled dimensions, then let the
  // server calculate the evidence and decide whether the scale is trustworthy.
  const checkScale = () => {
    if (!currentSheet || calibrationPoints.length !== 2) {
      toast.warning("Click both ends of a labeled dimension first.");
      return;
    }
    if (!currentSheet.scale_feet_per_pixel) {
      toast.warning("Set a scale before verifying it.");
      return;
    }
    const expected = parseFeetInches(verifyFeet);
    if (!expected) {
      toast.warning("Enter the labeled dimension, like 12' 6\".");
      return;
    }
    const preview = previewScaleAssuranceCheck({
      points: calibrationPoints as [Point, Point],
      labeledDistanceFeet: expected,
      scaleFeetPerPixel: currentSheet.scale_feet_per_pixel,
      viewSize,
      checkNumber: scaleCheckDrafts.length + 1,
    });
    if (!preview) {
      toast.warning("The check line is too short.");
      return;
    }
    const checks = [...scaleCheckDrafts, preview];
    if (checks.length < 2) {
      setScaleCheckDrafts(checks);
      setCalibrationPoints([]);
      setVerifyFeet("");
      toast.info("First dimension recorded. Check a different labeled dimension next.");
      return;
    }
    scaleAssessmentMutation.mutate(checks);
  };

  const applyVerifyCorrection = () => {
    if (!verifyOutcome || !verifyOutcome.canRecalibrate) return;
    scaleCorrectionMutation.mutate(verifyOutcome.correctedScale);
  };

  const resetScaleChecks = () => {
    setScaleCheckDrafts([]);
    setCalibrationPoints([]);
    setVerifyFeet("");
    setVerifyOutcome(null);
    if (tool === "verify") setTool("select");
  };

  // Stated-scale presets (vector PDFs only): the page's physical size is
  // known, so the stated scale converts directly with no two-point guess.
  const activeStatedScale = () => {
    if (statedPresetId === "custom") {
      const inches = Number(customStatedInches);
      const feet = Number(customStatedFeet);
      if (!Number.isFinite(inches) || inches <= 0 || !Number.isFinite(feet) || feet <= 0) {
        return null;
      }
      return { statedInches: inches, statedFeet: feet, label: `${inches}" = ${feet}'` };
    }
    const preset = STATED_SCALE_PRESETS.find((item) => item.id === statedPresetId);
    if (!preset) return null;
    return {
      statedInches: preset.statedInches,
      statedFeet: preset.statedFeet,
      label: preset.label,
    };
  };

  const applyStatedScale = () => {
    if (!currentSheet) {
      toast.warning("Choose a plan sheet first.");
      return;
    }
    if (!pdfPageMetrics) {
      toast.warning(
        "Stated scale needs a PDF sheet with known page dimensions. Use two-point calibration instead.",
      );
      return;
    }
    const stated = activeStatedScale();
    if (!stated) {
      toast.warning("Choose a stated scale first.");
      return;
    }
    const feetPerPixel = statedScaleFeetPerPixel({
      statedInches: stated.statedInches,
      statedFeet: stated.statedFeet,
      pageWidthPoints: pdfPageMetrics.widthPoints,
      renderedWidthPx: viewSize.width,
    });
    if (feetPerPixel <= 0) {
      toast.error("The stated scale did not compute for this sheet.");
      return;
    }
    updateSheetMutation.mutate({
      scale_feet_per_pixel: feetPerPixel,
      scale_label: `${stated.label} stated scale`,
      scale_source: "stated",
      scale_verified_at: null,
      width_px: Math.round(viewSize.width),
      height_px: Math.round(viewSize.height),
    });
    const remaining = sheets.filter(
      (sheet) =>
        sheet.plan_set_id === currentSheet.plan_set_id &&
        sheet.id !== currentSheet.id &&
        !sheet.scale_feet_per_pixel,
    );
    setApplyToSetOffer(
      remaining.length > 0 &&
        currentPlanSet?.file_mime_type === "application/pdf" &&
        currentPlanSet.file_path
        ? { ...stated, count: remaining.length }
        : null,
    );
  };

  // Double-click / Enter / right-click closeout: finish the run with the
  // vertices placed so far. Double-click's second click is skipped by the
  // canvas, so the pair plants exactly one final point.
  const finishRunFromCanvas = () => {
    // The ruler saves nothing: any finish gesture just clears the chain.
    if (tool === "ruler") {
      setPendingPoints([]);
      return;
    }
    const points = pendingPointsRef.current;
    if (tool === "linear" && points.length >= 2) {
      createMeasurementMutation.mutate({ measurementTool: "linear", points });
      return;
    }
    if (tool === "area" && points.length >= 3) {
      createMeasurementMutation.mutate({ measurementTool: "area", points });
      return;
    }
    if (tool === "count" && points.length >= 1) {
      createMeasurementMutation.mutate({ measurementTool: "count", points });
    }
  };

  const abandonDraftRun = () => {
    setPendingPoints([]);
  };

  const finishDraft = () => {
    if (tool === "ruler") {
      setPendingPoints([]);
      return;
    }
    if (tool === "calibrate") {
      saveScale();
      return;
    }
    if (tool === "verify") {
      checkScale();
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
    const quantityChanged = Math.abs(quantity - selectedMeasurement.quantity) > 0.00005;
    const overrideReason = selectedMeasurementDraft.overrideReason.trim();
    if (quantityChanged && overrideReason.length < 3) {
      toast.warning("Explain why field judgment should override the drawing quantity.");
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
        ...(quantityChanged ? { override_reason: overrideReason } : {}),
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
    updateMeasurementMutation.mutate({
      id: selectedMeasurement.id,
      patch: {},
      recalculateFromGeometry: true,
    });
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
    const totals = new Map<string, { quantity: number; count: number; untrustedCount: number }>();
    for (const measurement of measurements) {
      if (!measurement.estimate_line_item_id) continue;
      const current = totals.get(measurement.estimate_line_item_id) ?? {
        quantity: 0,
        count: 0,
        untrustedCount: 0,
      };
      current.quantity += measurement.quantity;
      current.count += 1;
      if (measurement.calculation_status !== "current") current.untrustedCount += 1;
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
  const calculationIssues = useMemo(
    () => measurements.filter((measurement) => measurement.calculation_status !== "current"),
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
  // Automatic context for "Flag an issue": which estimate, sheet, and tool
  // the contractor was on when they hit the problem.
  const flagIssueContext = () => ({
    estimate_id: estimate.id,
    sheet_id: currentSheet?.id ?? null,
    sheet_number: currentSheet?.sheet_number ?? null,
    active_tool: tool,
  });

  // First-run launcher handoff (?upload=true): open the file picker on
  // arrival, once, and only while the estimate still has no real drawing set.
  // If the browser swallows the programmatic click, the Upload Plans button
  // is the visible fallback.
  useEffect(() => {
    if (!autoOpenUpload || autoUploadTriggeredRef.current) return;
    if (!backendReady || uploading || createSetMutation.isPending) return;
    autoUploadTriggeredRef.current = true;
    const hasRealPlanSet = planSets.some(
      (planSet) => planSet.file_mime_type !== SAMPLE_PLAN_SET_MIME,
    );
    if (hasRealPlanSet) return;
    fileInputRef.current?.click();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpenUpload, backendReady, planSets, uploading]);
  const openSheet = (sheetId: string) => {
    setSelectedSheetId(sheetId);
    setPendingPoints([]);
    setCalibrationPoints([]);
    if (selectedMeasurement?.plan_sheet_id !== sheetId) {
      setSelectedMeasurementId("");
    }
  };
  // AI Assist (AITAKEOFF1): the model proposes count locations, the human
  // verifies every one in this same harness. The hook owns the panel, scan,
  // and review state; the workspace only wires canvas + toolbar surfaces.
  const aiAssist = useAiAssist({
    estimateId: estimate.id,
    sheets,
    planSets,
    measurements,
    currentSheetId: currentSheet?.id ?? null,
    viewSize,
    openSheet,
    onTakeoffsChanged: invalidate,
  });
  const { openScopeBriefReview: openAiAssistScopeBriefReview, setScope: setAiAssistScope } =
    aiAssist;

  useEffect(() => {
    if (
      !pendingScopeBriefAction ||
      currentSheet?.id !== pendingScopeBriefAction.item.plan_sheet_id
    ) {
      return;
    }

    const { item, review } = pendingScopeBriefAction;
    const action = review.next_action;
    setPendingScopeBriefAction(null);
    setMeasurementLabel(item.scope_label);
    setPendingPoints([]);
    setCalibrationPoints([]);
    setSelectedMeasurementId("");
    if (isCockpitMode) {
      setCockpitPanels((current) => ({ ...current, tools: true }));
    }

    if (action === "count_review") {
      setPreparedMeasurementSuggestionId("");
      setPreparedMeasurementSuggestion(null);
      setPreparedScopeBriefTakeoff(null);
      setPreparedMeasurementScopeItemId("");
      setMeasurementSourceNote("");
      setTool("select");
      setAiAssistScope("sheet");
      openAiAssistScopeBriefReview({
        reviewId: review.id,
        version: review.version,
        label: item.scope_label,
        sheetNumber: item.sheet_number,
        sourceLine: item.source_line,
        sourceExcerpt: item.source_excerpt,
      });
      toast.info(
        "Count workbench opened on the cited sheet. Identify one accepted symbol, then start the scan when you are ready.",
      );
      return;
    }

    if (action === "length_review" || action === "area_review") {
      const suggestion: MeasurementAssistantSuggestion = {
        id: `scope-brief-${item.id}`,
        label: item.scope_label,
        tool: action === "length_review" ? "linear" : "area",
        unit: action === "length_review" ? "LF" : "SF",
        source_line: item.source_line,
        source_excerpt: item.source_excerpt,
        rationale: item.estimator_prompt,
        evidence_strength: "direct",
      };
      setPreparedMeasurementSuggestionId(suggestion.id);
      setPreparedMeasurementSuggestion(suggestion);
      setPreparedScopeBriefTakeoff({ reviewId: review.id, suggestionId: suggestion.id });
      setPreparedMeasurementScopeItemId("");
      setMeasurementSourceNote(measurementAssistantTakeoffNote(suggestion));
      if (currentSheetScaleStatus !== "verified") {
        setTool("select");
        toast.warning(
          "Cited scope prepared. Complete two Scale Assurance checks before drawing the takeoff.",
        );
        return;
      }
      setTool(suggestion.tool);
      toast.info(
        suggestion.tool === "linear"
          ? "Cited length scope prepared. Trace the run; you remain responsible for every endpoint."
          : "Cited area scope prepared. Trace the perimeter; you remain responsible for every point.",
      );
      return;
    }

    setPreparedMeasurementSuggestionId("");
    setPreparedMeasurementSuggestion(null);
    setPreparedScopeBriefTakeoff(null);
    setPreparedMeasurementScopeItemId("");
    setMeasurementSourceNote("");
    setTool("select");
    toast.info(
      action === "assembly_review"
        ? "Cited sheet opened. Select a trusted takeoff, then confirm assembly inputs in the Selected Takeoff panel."
        : action === "pricing_review"
          ? "Cited sheet opened. Review the evidence, then price the intended estimate row manually."
          : "Cited sheet opened for scope coordination. Resolve ownership before changing the estimate.",
    );
  }, [
    currentSheet?.id,
    currentSheetScaleStatus,
    isCockpitMode,
    openAiAssistScopeBriefReview,
    pendingScopeBriefAction,
    setAiAssistScope,
  ]);
  // Canvas-first symbol discovery: AI marks candidate groups; the estimator
  // names one group and every point still enters the existing count review.
  const symbolDiscovery = useSymbolDiscovery({
    estimateId: estimate.id,
    sheets,
    planSets,
    currentSheetId: currentSheet?.id ?? null,
  });
  const startDiscoveryGroupReview = (input: StartDiscoveryGroupReviewInput) => {
    const result = symbolDiscovery.result;
    const cluster = result?.clusters[input.clusterIndex];
    if (!result || !cluster) return;
    const seeded = aiAssist.beginExternalReview({
      label: input.label,
      color: takeoffColor || TAKEOFF_COLORS[0],
      unit: input.unit,
      estimateLineItemId: input.estimateLineItemId,
      libraryItemId: input.costLibraryItemId,
      operationId: result.operationId,
      radius: result.dedupeRadius,
      points: clusterMemberPoints(cluster, result.crops).map((crop) => ({
        sheetId: result.sheetId,
        x: crop.x,
        y: crop.y,
      })),
      onComplete: (outcome) => {
        symbolDiscovery.completeGroupReview(input.clusterIndex, {
          label: input.label,
          accepted: outcome.accepted.length,
          rejected: outcome.rejectedCount,
        });
        const accepted = outcome.accepted[0];
        if (!accepted || !result.operationId) return;
        let exemplar: (typeof result.crops)[number] | null = null;
        for (const memberIndex of cluster.memberIndexes) {
          const crop = result.crops[memberIndex];
          if (!crop) continue;
          if (!exemplar) {
            exemplar = crop;
            continue;
          }
          const cropDistance =
            (crop.x - accepted.originalX) ** 2 + (crop.y - accepted.originalY) ** 2;
          const exemplarDistance =
            (exemplar.x - accepted.originalX) ** 2 + (exemplar.y - accepted.originalY) ** 2;
          if (cropDistance < exemplarDistance) exemplar = crop;
        }
        if (!exemplar) return;
        void saveSymbolLibraryExampleFn({
          data: {
            estimate_id: estimate.id,
            plan_sheet_id: result.sheetId,
            ai_operation_id: result.operationId,
            label: input.label,
            trade: input.trade,
            unit: input.unit,
            cost_library_item_id: input.costLibraryItemId,
            source_point: { x: accepted.originalX, y: accepted.originalY },
            exemplar_base64: exemplar.base64,
            accepted_count: outcome.accepted.length,
            rejected_count: outcome.rejectedCount,
          },
        })
          .then(() =>
            toast.success(
              `${input.label} saved to the company identification library from ${outcome.accepted.length} accepted count${outcome.accepted.length === 1 ? "" : "s"}.`,
            ),
          )
          .catch((error) =>
            toast.error(
              error instanceof Error
                ? error.message
                : "The accepted symbol did not save to the company library.",
            ),
          );
      },
    });
    if (seeded > 0) {
      symbolDiscovery.close();
      if (currentSheet?.id !== result.sheetId) openSheet(result.sheetId);
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
  const restoreCockpitPanel = (panel: CockpitPanelKey) => {
    setCockpitPanelPresentations((current) => ({ ...current, [panel]: "windowed" }));
    setCockpitPanels((current) => ({ ...current, [panel]: true }));
  };
  const minimizeCockpitPanel = (panel: CockpitPanelKey) => {
    setCockpitPanelPresentations((current) => ({ ...current, [panel]: "windowed" }));
    setCockpitPanels((current) => ({ ...current, [panel]: false }));
  };
  const toggleCockpitPanel = (panel: CockpitPanelKey) => {
    if (cockpitPanels[panel]) minimizeCockpitPanel(panel);
    else restoreCockpitPanel(panel);
  };
  const showCockpitPanels = () => {
    setCockpitPanelPresentations({ drawings: "windowed", tools: "windowed" });
    setCockpitPanels({ drawings: true, tools: true });
  };
  const hideCockpitPanels = () => {
    setCockpitPanelPresentations({ drawings: "windowed", tools: "windowed" });
    setCockpitPanels({ drawings: false, tools: false });
  };
  const maximizeCockpitPanel = (panel: CockpitPanelKey) => {
    const otherPanel: CockpitPanelKey = panel === "drawings" ? "tools" : "drawings";
    setCockpitPanelPresentations((current) => ({
      ...current,
      [panel]: "maximized",
      [otherPanel]: "windowed",
    }));
    setCockpitPanels((current) => ({ ...current, [panel]: true, [otherPanel]: false }));
    setCockpitChromeVisible(true);
  };
  const toggleCockpitPanelMaximize = (panel: CockpitPanelKey) => {
    if (cockpitPanelPresentations[panel] === "maximized") restoreCockpitPanel(panel);
    else maximizeCockpitPanel(panel);
  };
  const selectCockpitToolsView = (view: CommandCenterToolsView) => {
    setCockpitToolsView(view);
    setCockpitPanels((current) => ({ ...current, tools: true }));
    if (view === "worksheet") maximizeCockpitPanel("tools");
  };
  const drawingsWorkspaceMaximized =
    isCockpitMode && cockpitPanelPresentations.drawings === "maximized";
  const toolsWorkspaceMaximized = isCockpitMode && cockpitPanelPresentations.tools === "maximized";
  // Panels must stay below the floating command deck. The deck wraps to extra
  // rows on narrow viewports, so measure its real footprint when it is in the
  // DOM and only fall back to the chrome constant when it is not measurable.
  const cockpitPanelTopGap = useCallback(() => {
    if (!cockpitChromeVisible) return COCKPIT_PANEL_EDGE_GAP;
    const parentRect = mainRef.current?.getBoundingClientRect();
    const deck = mainRef.current?.querySelector<HTMLElement>(
      '[data-testid="plan-cockpit-command-deck"]',
    );
    const deckRect = deck?.getBoundingClientRect();
    if (!parentRect || !deckRect || deckRect.height <= 0) return COCKPIT_CHROME_PANEL_TOP_GAP;
    return Math.max(
      COCKPIT_CHROME_PANEL_TOP_GAP,
      deckRect.bottom - parentRect.top + COCKPIT_PANEL_EDGE_GAP,
    );
  }, [cockpitChromeVisible]);
  const clampCockpitPanelLayout = useCallback(
    (layout: CockpitPanelLayout): CockpitPanelLayout => {
      const parent = mainRef.current;
      const parentRect = parent?.getBoundingClientRect();
      const parentWidth =
        parentRect?.width ?? (typeof window === "undefined" ? 1800 : window.innerWidth);
      const parentHeight =
        parentRect?.height ?? (typeof window === "undefined" ? 900 : window.innerHeight - 48);
      const topGap = cockpitPanelTopGap();
      const maxWidth = Math.min(COCKPIT_PANEL_MAX_WIDTH, parentWidth - COCKPIT_PANEL_EDGE_GAP * 2);
      const maxHeight = Math.min(
        COCKPIT_PANEL_MAX_HEIGHT,
        parentHeight - topGap - COCKPIT_PANEL_EDGE_GAP,
      );
      const constrainedMaxHeight = Math.max(COCKPIT_PANEL_MIN_HEIGHT, maxHeight);
      const movementReserve = Math.min(
        COCKPIT_PANEL_MOVE_RESERVE,
        Math.max(0, constrainedMaxHeight - COCKPIT_PANEL_MIN_HEIGHT),
      );
      const windowedMaxHeight = constrainedMaxHeight - movementReserve;
      const width = clampNumber(layout.width, COCKPIT_PANEL_MIN_WIDTH, Math.max(280, maxWidth));
      const height = clampNumber(layout.height, COCKPIT_PANEL_MIN_HEIGHT, windowedMaxHeight);
      const y = clampNumber(
        layout.y,
        topGap,
        Math.max(topGap, parentHeight - height - COCKPIT_PANEL_EDGE_GAP),
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
    },
    [cockpitPanelTopGap],
  );
  // Re-clamp both panels whenever the viewport changes (or the command deck
  // appears/disappears with cockpit chrome) so restored or dragged layouts
  // never sit under the deck or outside the visible canvas.
  useEffect(() => {
    if (!isCockpitMode || typeof window === "undefined") return;
    const reclampCockpitPanels = () =>
      setCockpitPanelLayouts((current) => {
        const drawings = clampCockpitPanelLayout(current.drawings);
        const tools = clampCockpitPanelLayout(current.tools);
        return cockpitPanelLayoutsEqual(drawings, current.drawings) &&
          cockpitPanelLayoutsEqual(tools, current.tools)
          ? current
          : { drawings, tools };
      });
    reclampCockpitPanels();
    window.addEventListener("resize", reclampCockpitPanels);
    return () => window.removeEventListener("resize", reclampCockpitPanels);
  }, [clampCockpitPanelLayout, isCockpitMode]);
  const cockpitPanelStyle = (panel: CockpitPanelKey): CSSProperties => {
    if (cockpitPanelPresentations[panel] === "maximized") {
      return {
        top: COCKPIT_PANEL_EDGE_GAP,
        right: COCKPIT_PANEL_EDGE_GAP,
        bottom: COCKPIT_PANEL_EDGE_GAP,
        left: COCKPIT_PANEL_EDGE_GAP,
        width: "auto",
        height: "auto",
        maxHeight: "none",
      };
    }
    const layout = clampCockpitPanelLayout(cockpitPanelLayouts[panel]);
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
    if (cockpitPanelPresentations[panel] === "maximized") {
      return "Full workspace · Restore to move or resize";
    }
    const layout = cockpitPanelLayouts[panel];
    return `${Math.round(layout.width)} x ${Math.round(layout.height)} · ${
      layout.x === null ? `docked ${layout.anchor}` : "custom position"
    } · drag in any direction`;
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
    if (cockpitPanelPresentations[panel] === "maximized") return;
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
    if (cockpitPanelPresentations[panel] === "maximized") return;
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
  const openActivationDrawings = () => {
    if (sheets.length === 0) fileInputRef.current?.click();
    restoreCockpitPanel("drawings");
  };
  const openActivationScale = () => {
    restoreCockpitPanel("tools");
    setCockpitToolsView("measure");
    setTool(currentSheet?.scale_feet_per_pixel ? "verify" : "calibrate");
    setPendingPoints([]);
    setCalibrationPoints([]);
  };
  const openActivationAiMarkups = () => {
    restoreCockpitPanel("tools");
    setCockpitToolsView("ai");
    if (!aiAssist.open) aiAssist.openPanel();
  };
  const openActivationWorksheet = () => selectCockpitToolsView("worksheet");
  const startGuidedActivation = () => {
    const preferredMeasurement =
      measurements.find((measurement) => measurement.created_by_ai) ?? measurements[0];
    const preferredSheet =
      sheets.find((sheet) => sheet.id === preferredMeasurement?.plan_sheet_id) ??
      sheets.find((sheet) => Boolean(sheet.scale_verified_at)) ??
      sheets[0];
    if (preferredSheet) openSheet(preferredSheet.id);
    else fileInputRef.current?.click();
    showCockpitPanels();
    setCockpitToolsView("ai");
    estimatorActivation.choose("guided");
  };
  const startTakeoffActivation = () => {
    if (sheets.length === 0) fileInputRef.current?.click();
    showCockpitPanels();
    setCockpitToolsView("measure");
    estimatorActivation.choose("takeoff");
  };
  const startRevisionActivation = () => {
    maximizeCockpitPanel("drawings");
    estimatorActivation.choose("revision");
  };
  const takeoffToolsProps = {
    tool,
    backendReady,
    draftCommand,
    activeDraftPointCount,
    setTool: (nextTool: ToolMode) => {
      setTool(nextTool);
      if (isCockpitMode && nextTool !== "select") setCockpitToolsView("measure");
    },
    setPendingPoints,
    setCalibrationPoints,
    finishDraft,
    undoDraftPoint,
    clearDraftPoints,
    createMeasurementMutation,
    updateSheetMutation,
    canUndo: canUndoTakeoff,
    canRedo: canRedoTakeoff,
    onUndo: undoTakeoff,
    onRedo: redoTakeoff,
    onOpenAiAssist: () => {
      setCockpitToolsView("ai");
      if (aiAssist.open) aiAssist.closePanel();
      else aiAssist.openPanel();
    },
    aiAssistOpen: aiAssist.open,
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
            variant={currentSheetScaleStatus === "verified" ? "secondary" : "outline"}
            className="hidden xl:inline-flex"
            data-testid="plan-cockpit-sheet-scale-status"
          >
            {currentSheetScaleStatus === "verified"
              ? "Scale verified"
              : currentSheetScaleStatus === "unverified"
                ? "Scale set — unverified"
                : "Needs scale"}
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
        <p className="eyebrow truncate">{companyName}</p>
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
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="h-8 gap-1.5 px-2"
        title="Open the getting-started workflow"
        onClick={estimatorActivation.openWelcome}
        data-testid="estimator-activation-open"
      >
        <CircleHelp className="h-3.5 w-3.5" />
        <span className="hidden 2xl:inline">Getting started</span>
      </Button>
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
      <FlagIssueButton compact getContext={flagIssueContext} />
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
      <EstimatorActivationDialog
        open={estimatorActivation.welcomeOpen}
        hasDrawings={sheets.length > 0}
        onGuidedExample={startGuidedActivation}
        onStartTakeoff={startTakeoffActivation}
        onCompareRevisions={startRevisionActivation}
        onSkip={estimatorActivation.hide}
      />
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
                  <p className="eyebrow">{companyName}</p>
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
                <FlagIssueButton getContext={flagIssueContext} />
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
          <section className="rounded-lg border border-warning/30 bg-warning/10 p-4 text-sm text-warning xl:col-span-3">
            <p className="font-medium">Plan Room backend is still coming online</p>
            <p className="mt-1 text-warning">
              {schemaMessage ||
                "Lovable needs to apply the Plan Room migration and refresh the Supabase schema cache before uploads and takeoff saves are available."}
            </p>
          </section>
        )}

        <aside
          className={cn(
            "min-w-0",
            !isCockpitMode && "space-y-4",
            isCockpitMode &&
              (cockpitPanels.drawings
                ? drawingsWorkspaceMaximized
                  ? "absolute z-[60] grid auto-rows-min gap-4 overflow-y-auto overscroll-contain rounded-[15px] border border-hairline bg-card p-2 shadow-nav backdrop-blur [scrollbar-gutter:stable] xl:grid-cols-2 2xl:grid-cols-3"
                  : "absolute z-40 space-y-4 overflow-y-auto rounded-[15px] border border-hairline bg-card p-2 shadow-nav backdrop-blur"
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
              maximizeTestId="plan-cockpit-drawings-maximize"
              layoutLabel={cockpitPanelLayoutLabel("drawings")}
              maximized={cockpitPanelPresentations.drawings === "maximized"}
              onMoveStart={(event) => beginCockpitPanelMove("drawings", event)}
              onMove={moveCockpitPanel}
              onMoveEnd={endCockpitPanelInteraction}
              onReset={() => resetCockpitPanelLayout("drawings")}
              onToggleMaximize={() => toggleCockpitPanelMaximize("drawings")}
              onClose={() => minimizeCockpitPanel("drawings")}
            />
          )}
          <SheetSidebar
            expanded={drawingsWorkspaceMaximized}
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
            thumbnailUrlByPath={thumbUrlByPath}
            onRenameSheet={(sheetId, patch) => renameSheetMutation.mutate({ sheetId, patch })}
            renamePending={renameSheetMutation.isPending}
            onDetectSheetNames={
              currentPlanSet?.file_mime_type === "application/pdf" && currentPlanSet.file_path
                ? () => detectNamesMutation.mutate()
                : undefined
            }
            detectingNames={detectNamesMutation.isPending}
          />

          <PlanScopeCoverageMatrix
            estimateId={estimate.id}
            planSet={currentPlanSet}
            sheets={sheets}
            queueItems={measurementScopeItems}
            reviewingSheetId={
              measurementAssistantMutation.isPending
                ? (measurementAssistantMutation.variables?.sheetId ?? currentSheet?.id ?? "")
                : ""
            }
            onReviewSheet={(sheetId) => {
              setSelectedSheetId(sheetId);
              measurementAssistantMutation.mutate({ sheetId });
            }}
            onOpenRecord={(record) => {
              setSelectedSheetId(record.sheet_id);
              openScopeCoverageRecordMutation.mutate(record);
            }}
          />

          <PlanScopeBriefPanel
            estimateId={estimate.id}
            planSet={currentPlanSet}
            measurements={measurements}
            pending={scopeBriefMutation.isPending}
            progress={scopeBriefProgress}
            evidencePending={openScopeBriefEvidenceMutation.isPending}
            onGenerate={() => scopeBriefMutation.mutate()}
            onOpenEvidence={(item) => openScopeBriefEvidenceMutation.mutate({ item })}
            onStartAction={(item, review) =>
              openScopeBriefEvidenceMutation.mutate({
                item,
                action: review.next_action,
                review,
              })
            }
          />

          <PlanRevisionOverlayPanel
            estimateId={estimate.id}
            currentPlanSet={currentPlanSet}
            currentSheet={currentSheet}
            planSets={planSets}
            sheets={sheets}
            processingIdentity={postProcessingPlanSetId === currentPlanSet?.id}
            overlaySheetId={overlaySheetId}
            overlaySheet={overlaySheet}
            overlayPlanSet={overlayPlanSet}
            overlayMode={overlayMode}
            overlayOpacity={overlayOpacity}
            revisionSheetOptions={revisionSheetOptions}
            onOverlaySheetChange={setOverlaySheetId}
            onOverlayModeChange={setOverlayMode}
            onOverlayOpacityChange={setOverlayOpacity}
            onReviewRevisionNotes={reviewAcceptedRevisionNotes}
          />

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
                    {line.unit ? ` · per ${line.unit}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedLine &&
              (tool === "linear" || tool === "area" || tool === "count") &&
              !takeoffUnitsCompatible(unitFor(tool), selectedLine.unit) && (
                <p
                  className="mt-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs"
                  data-testid="takeoff-setup-unit-mismatch"
                >
                  The {toolLabel(tool)} tool measures {unitLongName(unitFor(tool))}, but this row is
                  priced per {unitLongName(selectedLine.unit)}. Sync will ask before mixing them.
                </p>
              )}
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
          {isCockpitMode && cockpitPanelPresentations.drawings !== "maximized" && (
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
                {headerRename && currentSheet ? (
                  <div
                    className="flex flex-wrap items-center gap-2"
                    data-testid="sheet-header-rename"
                  >
                    <Input
                      value={headerRename.sheetNumber}
                      onChange={(event) =>
                        setHeaderRename((current) =>
                          current ? { ...current, sheetNumber: event.target.value } : current,
                        )
                      }
                      className="h-8 w-28"
                      aria-label="Sheet number"
                    />
                    <Input
                      value={headerRename.sheetName}
                      onChange={(event) =>
                        setHeaderRename((current) =>
                          current ? { ...current, sheetName: event.target.value } : current,
                        )
                      }
                      className="h-8 w-64"
                      aria-label="Sheet name"
                    />
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        renameSheetMutation.mutate({
                          sheetId: currentSheet.id,
                          patch: {
                            sheet_number: headerRename.sheetNumber.trim(),
                            sheet_name: headerRename.sheetName.trim(),
                          },
                        })
                      }
                      disabled={renameSheetMutation.isPending || !headerRename.sheetNumber.trim()}
                    >
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setHeaderRename(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <h2 className="group flex items-center gap-2 font-serif text-2xl leading-tight">
                    <span className="truncate">{currentSheetTitle}</span>
                    {currentSheet && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 transition group-hover:opacity-100"
                        title="Rename this sheet"
                        aria-label="Rename this sheet"
                        data-testid="sheet-header-rename-button"
                        onClick={() =>
                          setHeaderRename({
                            sheetNumber: currentSheet.sheet_number,
                            sheetName: currentSheet.sheet_name,
                          })
                        }
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </h2>
                )}
                <p className="text-xs text-muted-foreground">
                  {currentSheet?.scale_feet_per_pixel
                    ? `Scale set: ${currentSheet.scale_label || `${currentSheet.scale_feet_per_pixel.toFixed(4)} ft/px`}${
                        currentSheetScaleStatus === "verified"
                          ? " — verified"
                          : currentSheet.scale_source === "stated"
                            ? " — from stated scale, complete two assurance checks"
                            : " — not verified yet"
                      }`
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
              (tool === "calibrate" && !parseFeetInches(calibrationFeet)) ||
              (tool === "verify" && !parseFeetInches(verifyFeet)) ||
              createMeasurementMutation.isPending ||
              updateSheetMutation.isPending
            }
            draftEditor={
              <ScaleDraftEditor
                tool={tool}
                calibrationFeet={calibrationFeet}
                verifyFeet={verifyFeet}
                onCalibrationFeetChange={setCalibrationFeet}
                onVerifyFeetChange={setVerifyFeet}
              />
            }
            onFinishDraft={finishDraft}
            onFinishRun={finishRunFromCanvas}
            onAbandonDraft={abandonDraftRun}
            onCancelDraft={() => {
              setPendingPoints([]);
              setCalibrationPoints([]);
              setTool("select");
            }}
            finishPopoverAnchor={finishPopover?.anchor ?? null}
            onFinishPopoverDismiss={() => setFinishPopover(null)}
            finishPopover={
              finishPopoverMeasurement ? (
                <TakeoffFinishPopover
                  key={finishPopoverMeasurement.id}
                  measurement={finishPopoverMeasurement}
                  lineItems={lineItems}
                  linkedLine={
                    lineItems.find(
                      (line) => line.id === finishPopoverMeasurement.estimate_line_item_id,
                    ) ?? null
                  }
                  groupState={finishPopoverGroupState}
                  groupLabelSuggestions={groupLabelSuggestions}
                  onDetach={
                    finishPopoverGroupState?.kind === "joined" &&
                    finishPopoverMeasurement.estimate_line_item_id
                      ? () => detachMeasurementFromGroup(finishPopoverMeasurement.id)
                      : null
                  }
                  onSaveDetails={({ label, wastePct }) => {
                    // Committing a label that matches an existing group joins
                    // it: take the group's color, and inherit its link only
                    // when this takeoff is still unlinked. Unit mismatch
                    // never auto-joins (Phase 2 guard).
                    const match = findTakeoffGroupMatch({
                      label,
                      unit: finishPopoverMeasurement.unit,
                      measurements,
                      excludeId: finishPopoverMeasurement.id,
                    });
                    const joined = match.joins ? match.group : null;
                    updateMeasurementMutation.mutate({
                      id: finishPopoverMeasurement.id,
                      patch: {
                        label,
                        waste_pct: wastePct,
                        ...(joined ? { color: joined.color } : {}),
                        ...(joined &&
                        joined.linkedLineId &&
                        !finishPopoverMeasurement.estimate_line_item_id
                          ? {
                              estimate_line_item_id: joined.linkedLineId,
                              library_item_id: joined.libraryItemId,
                            }
                          : {}),
                      },
                    });
                  }}
                  onPickRow={(lineId) => linkMeasurementToRow(finishPopoverMeasurement.id, lineId)}
                  onPickLibraryItem={(item) =>
                    classifyTakeoffMutation.mutate({
                      measurementIds: [finishPopoverMeasurement.id],
                      source: { type: "library", library_item_id: item.id },
                    })
                  }
                  onCreateFromLabel={(label) =>
                    classifyTakeoffMutation.mutate({
                      measurementIds: [finishPopoverMeasurement.id],
                      source: {
                        type: "label",
                        description: label,
                        unit: finishPopoverMeasurement.unit,
                      },
                    })
                  }
                  onDismiss={() => setFinishPopover(null)}
                  pending={classifyTakeoffMutation.isPending || updateMeasurementMutation.isPending}
                />
              ) : null
            }
            tool={tool}
            viewSize={viewSize}
            onViewSizeChange={setViewSize}
            onPageMetrics={handlePageMetrics}
            onPoint={onCanvasPoint}
            isCockpitMode={isCockpitMode}
            selectedMeasurementId={selectedMeasurementId}
            onMeasurementSelect={(measurementId) => {
              const measurement = measurements.find((item) => item.id === measurementId);
              if (!measurement) return;
              // While AI Assist is arming an exemplar, the click picks the
              // exemplar instead of selecting the marker.
              if (aiAssist.handleMeasurementSelected(measurement)) return;
              selectMeasurement(measurement);
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
            aiGhosts={aiAssist.ghostsForSheet(currentSheet?.id ?? null)}
            activeAiGhostId={aiAssist.activeProposal?.id ?? null}
            onAiGhostSelect={aiAssist.selectProposal}
            discoveryMarkups={symbolDiscovery.markupsForSheet(currentSheet?.id ?? null)}
            activeDiscoveryClusterIndex={symbolDiscovery.selectedClusterIndex}
            onDiscoveryGroupSelect={symbolDiscovery.selectGroup}
            measurementGuideSuggestions={measurementAssistantPlan?.suggestions ?? []}
            activeMeasurementGuideId={activeMeasurementGuideId}
            onMeasurementGuideSelect={(suggestionId) => {
              const suggestion = measurementAssistantPlan?.suggestions.find(
                (candidate) => candidate.id === suggestionId,
              );
              if (suggestion) selectMeasurementGuide(suggestion);
            }}
            aiPanel={
              symbolDiscovery.open ? (
                <SymbolDiscoveryPanel
                  discovery={symbolDiscovery}
                  lineItems={lineItems}
                  onStartReview={startDiscoveryGroupReview}
                />
              ) : (
                <AiAssistPanel ai={aiAssist} onDiscoverSymbols={symbolDiscovery.start} />
              )
            }
            aiReviewBar={
              <div className="flex flex-col items-center gap-2">
                {activeMeasurementGuideSuggestion && (
                  <MeasurementGuideReviewBar
                    suggestion={activeMeasurementGuideSuggestion}
                    label={measurementGuideLabel}
                    queueStatus={activeMeasurementGuideQueueItem?.status ?? null}
                    scaleVerified={currentSheetScaleStatus === "verified"}
                    pending={measurementScopeDecisionMutation.isPending}
                    onLabelChange={setMeasurementGuideLabel}
                    onShowEvidence={showActiveMeasurementGuideEvidence}
                    onAccept={acceptActiveMeasurementGuide}
                    onReject={rejectActiveMeasurementGuide}
                    onStartTrace={startActiveMeasurementGuideTrace}
                    onClose={() => {
                      setActiveMeasurementGuideId("");
                      setMeasurementGuideLabel("");
                    }}
                  />
                )}
                <AiReviewBar ai={aiAssist} />
              </div>
            }
            evidenceFocus={
              measurementEvidenceFocus?.sheetId === currentSheet?.id
                ? measurementEvidenceFocus
                : null
            }
            hasPreviousSheet={Boolean(previousSheetNavigationItem)}
            hasNextSheet={Boolean(nextSheetNavigationItem)}
            onPreviousSheet={() => openAdjacentSheet(-1)}
            onNextSheet={() => openAdjacentSheet(1)}
          />
        </section>

        <aside
          className={cn(
            "min-w-0",
            !isCockpitMode && "space-y-4",
            isCockpitMode &&
              (cockpitPanels.tools
                ? toolsWorkspaceMaximized
                  ? cockpitToolsView === "review"
                    ? "absolute z-[60] grid auto-rows-min gap-4 overflow-y-auto overscroll-contain rounded-[15px] border border-hairline bg-card p-2 shadow-nav backdrop-blur [scrollbar-gutter:stable] xl:grid-cols-[minmax(260px,0.75fr)_minmax(320px,0.85fr)_minmax(420px,1.4fr)]"
                    : "absolute z-[60] space-y-4 overflow-y-auto overscroll-contain rounded-[15px] border border-hairline bg-card p-2 shadow-nav backdrop-blur [scrollbar-gutter:stable]"
                  : "absolute z-40 space-y-4 overflow-y-auto rounded-[15px] border border-hairline bg-card p-2 shadow-nav backdrop-blur"
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
              maximizeTestId="plan-cockpit-tools-maximize"
              layoutLabel={cockpitPanelLayoutLabel("tools")}
              maximized={cockpitPanelPresentations.tools === "maximized"}
              onMoveStart={(event) => beginCockpitPanelMove("tools", event)}
              onMove={moveCockpitPanel}
              onMoveEnd={endCockpitPanelInteraction}
              onReset={() => resetCockpitPanelLayout("tools")}
              onToggleMaximize={() => toggleCockpitPanelMaximize("tools")}
              onClose={() => minimizeCockpitPanel("tools")}
            />
          )}
          {estimatorActivation.checklistVisible && (
            <div
              className={cn(
                toolsWorkspaceMaximized && cockpitToolsView === "review" && "xl:col-span-3",
              )}
            >
              <EstimatorActivationChecklist
                hasDrawings={sheets.length > 0}
                scaleVerified={currentSheetScaleStatus === "verified"}
                hasTakeoff={measurements.length > 0}
                hasLinkedTakeoff={linkedCount > 0}
                onOpenDrawings={openActivationDrawings}
                onVerifyScale={openActivationScale}
                onOpenAiMarkups={openActivationAiMarkups}
                onOpenWorksheet={openActivationWorksheet}
                onHide={estimatorActivation.hide}
              />
            </div>
          )}
          {isCockpitMode && (
            <div
              className={cn(
                toolsWorkspaceMaximized && "sticky top-14 z-30",
                toolsWorkspaceMaximized && cockpitToolsView === "review" && "xl:col-span-3",
              )}
            >
              <CommandCenterToolsNav value={cockpitToolsView} onChange={selectCockpitToolsView} />
            </div>
          )}
          {(!isCockpitMode || cockpitToolsView === "ai" || cockpitToolsView === "measure") && (
            <section className="rounded-lg border border-hairline bg-card p-4 shadow-card">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h2 className="font-serif text-xl">
                    {isCockpitMode && cockpitToolsView === "ai" ? "AI & Scope" : "Measure"}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {isCockpitMode && cockpitToolsView === "ai"
                      ? "Review AI-drawn proposals and route accepted scope into estimator-controlled work."
                      : "Set the label, color, and trusted drawing scale before measuring."}
                  </p>
                </div>
                <Target className="h-4 w-4 text-muted-foreground" />
              </div>
              <div
                className={cn(
                  "mt-4",
                  toolsWorkspaceMaximized
                    ? "grid items-start gap-4 xl:grid-cols-[minmax(280px,0.7fr)_minmax(0,1.3fr)]"
                    : "space-y-3",
                )}
              >
                {(!isCockpitMode || cockpitToolsView === "ai") && (
                  <>
                    <MeasurementAssistantPanel
                      plan={measurementAssistantPlan}
                      pending={measurementAssistantMutation.isPending}
                      canAnalyze={Boolean(
                        backendReady &&
                        currentSheet &&
                        currentPlanSet?.file_mime_type === "application/pdf" &&
                        currentPlanSet.file_path,
                      )}
                      scaleVerified={currentSheetScaleStatus === "verified"}
                      preparedSuggestionId={preparedMeasurementSuggestionId}
                      completedSuggestionIds={completedMeasurementSuggestionIds}
                      queueItemBySuggestionId={queueItemBySuggestionId}
                      duplicateCountBySuggestionId={duplicateCountBySuggestionId}
                      activeEvidenceSourceLine={
                        measurementEvidenceFocus?.sheetId === currentSheet?.id
                          ? measurementEvidenceFocus.sourceLine
                          : ""
                      }
                      activeGuideSuggestionId={activeMeasurementGuideId}
                      decisionPending={measurementScopeDecisionMutation.isPending}
                      onAnalyze={() => measurementAssistantMutation.mutate(undefined)}
                      onPrepare={(suggestion) => {
                        setPreparedMeasurementScopeItemId(
                          queueItemBySuggestionId[suggestion.id]?.id ?? "",
                        );
                        prepareMeasurementSuggestion(suggestion);
                      }}
                      onShowEvidence={(suggestion) => {
                        if (!currentSheet) return;
                        showMeasurementEvidence({
                          sheetId: currentSheet.id,
                          sourceLine: suggestion.source_line,
                          label: suggestion.label,
                          anchor: measurementEvidenceAnchors[suggestion.source_line] ?? null,
                        });
                      }}
                      onShowGuide={selectMeasurementGuide}
                      onDecision={decideMeasurementSuggestion}
                      onClear={() => {
                        setMeasurementAssistantPlan(null);
                        setActiveMeasurementGuideId("");
                        setMeasurementGuideLabel("");
                        setPreparedMeasurementSuggestionId("");
                        setPreparedMeasurementSuggestion(null);
                        setPreparedScopeBriefTakeoff(null);
                        setPreparedMeasurementScopeItemId("");
                        setCompletedMeasurementSuggestionIds([]);
                        setMeasurementSourceNote("");
                        setMeasurementEvidenceAnchors({});
                      }}
                    />
                    <MeasurementScopeQueuePanel
                      expanded={toolsWorkspaceMaximized}
                      items={measurementScopeItems}
                      sheets={sheets}
                      measurements={measurements}
                      lineItems={lineItems}
                      ready={
                        measurementScopeQueueQuery.isPending ||
                        measurementScopeQueueQuery.data?.ready !== false
                      }
                      pending={measurementScopeDecisionMutation.isPending}
                      onLocate={(item) =>
                        showMeasurementEvidence({
                          sheetId: item.plan_sheet_id,
                          sourceLine: item.source_line,
                          label: item.label,
                          anchor: item.source_anchor,
                        })
                      }
                      onStart={startMeasurementScopeItem}
                      onDecision={decideMeasurementScopeItem}
                    />
                  </>
                )}
                {(!isCockpitMode || cockpitToolsView === "measure") && (
                  <>
                    <div
                      className={cn(
                        "space-y-3",
                        toolsWorkspaceMaximized &&
                          "rounded-lg border border-hairline bg-surface p-4",
                      )}
                    >
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
                    </div>
                    {!toolsWorkspaceMaximized && <Separator />}
                    <div
                      className={cn(
                        "space-y-2",
                        toolsWorkspaceMaximized &&
                          "rounded-lg border border-hairline bg-surface p-4",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <Label>Set drawing scale</Label>
                        {currentSheetScaleStatus === "verified" ? (
                          <Badge variant="secondary" data-testid="scale-status-verified">
                            Scale verified
                          </Badge>
                        ) : currentSheetScaleStatus === "unverified" ? (
                          <Badge variant="outline" data-testid="scale-status-unverified">
                            Set, not verified
                          </Badge>
                        ) : (
                          <Badge variant="outline" data-testid="scale-status-none">
                            Needed
                          </Badge>
                        )}
                      </div>
                      {pdfPageMetrics ? (
                        <div className="space-y-2" data-testid="stated-scale-presets">
                          <p className="text-xs text-muted-foreground">
                            The drawing states its scale in the title block? Pick it here — no
                            clicking needed on vector PDFs.
                          </p>
                          <Select value={statedPresetId} onValueChange={setStatedPresetId}>
                            <SelectTrigger
                              aria-label="Stated scale"
                              data-testid="stated-scale-select"
                            >
                              <SelectValue placeholder='Stated scale, e.g. 1/4" = 1&apos;-0"' />
                            </SelectTrigger>
                            <SelectContent>
                              {ARCHITECTURAL_SCALE_PRESETS.map((preset) => (
                                <SelectItem key={preset.id} value={preset.id}>
                                  {preset.label}
                                </SelectItem>
                              ))}
                              {ENGINEERING_SCALE_PRESETS.map((preset) => (
                                <SelectItem key={preset.id} value={preset.id}>
                                  {preset.label}
                                </SelectItem>
                              ))}
                              <SelectItem value="custom">Custom stated scale...</SelectItem>
                            </SelectContent>
                          </Select>
                          {statedPresetId === "custom" && (
                            <div
                              className="grid grid-cols-[1fr_auto_1fr] items-center gap-2"
                              data-testid="stated-scale-custom"
                            >
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={customStatedInches}
                                onChange={(event) => setCustomStatedInches(event.target.value)}
                                placeholder={"Paper inches"}
                                aria-label="Stated paper inches"
                              />
                              <span className="text-xs text-muted-foreground">inches =</span>
                              <Input
                                type="number"
                                min={0}
                                step="0.01"
                                value={customStatedFeet}
                                onChange={(event) => setCustomStatedFeet(event.target.value)}
                                placeholder="Real feet"
                                aria-label="Stated real feet"
                              />
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            className="w-full gap-1.5"
                            onClick={applyStatedScale}
                            disabled={
                              !backendReady || !statedPresetId || updateSheetMutation.isPending
                            }
                            data-testid="stated-scale-apply"
                          >
                            <Save className="h-3.5 w-3.5" /> Use Stated Scale
                          </Button>
                          {applyToSetOffer && (
                            <div
                              className="rounded-md border border-hairline bg-surface px-3 py-2 text-xs"
                              data-testid="stated-scale-apply-to-set"
                            >
                              <p className="text-muted-foreground">
                                {applyToSetOffer.count} more sheet
                                {applyToSetOffer.count === 1 ? "" : "s"} in this set still need a
                                scale.
                              </p>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="mt-2 w-full"
                                onClick={() => applyToSetMutation.mutate(applyToSetOffer)}
                                disabled={applyToSetMutation.isPending}
                                data-testid="stated-scale-apply-to-set-button"
                              >
                                {applyToSetMutation.isPending
                                  ? "Applying to set..."
                                  : `Apply ${applyToSetOffer.label} to all unscaled sheets`}
                              </Button>
                            </div>
                          )}
                          <Separator />
                        </div>
                      ) : (
                        <p
                          className="rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-muted-foreground"
                          data-testid="stated-scale-unavailable"
                        >
                          This sheet has no PDF page dimensions, so stated-scale presets are off.
                          Calibrate with two points on a known dimension instead.
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Or calibrate: click both ends of a known dimension on the drawing, type the
                        real distance, then save the sheet scale.
                      </p>
                      <div
                        className="grid grid-cols-3 gap-1"
                        data-testid="calibration-distance-presets"
                      >
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
                          value={calibrationFeet}
                          onChange={(event) => setCalibrationFeet(event.target.value)}
                          placeholder={`Feet & inches, e.g. 12' 6"`}
                          aria-label="Known distance in feet and inches"
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
                      <FeetInchesHint value={calibrationFeet} onAccept={setCalibrationFeet} />
                      {Boolean(currentSheet?.scale_feet_per_pixel) && (
                        <ScaleAssurancePanel
                          sheet={{ ...currentSheet, scale_verified_at: effectiveScaleVerifiedAt }}
                          latestAssessment={latestScaleAssessment}
                          drafts={scaleCheckDrafts}
                          tool={tool}
                          selectedPointCount={calibrationPoints.length}
                          verifyFeet={verifyFeet}
                          backendReady={backendReady}
                          scaleAssuranceReady={scaleAssuranceReady}
                          pending={
                            scaleAssessmentMutation.isPending || scaleCorrectionMutation.isPending
                          }
                          onVerifyFeetChange={setVerifyFeet}
                          onStartCheck={() => {
                            setCalibrationPoints([]);
                            setTool("verify");
                          }}
                          onRecordCheck={checkScale}
                          onResetChecks={resetScaleChecks}
                        />
                      )}
                      <div className="rounded-md border border-hairline bg-surface px-3 py-2 text-xs text-muted-foreground">
                        {tool === "calibrate" ? (
                          <span>{calibrationPoints.length}/2 calibration points selected.</span>
                        ) : tool === "verify" ? (
                          <span>{calibrationPoints.length}/2 check points selected.</span>
                        ) : currentSheet?.scale_feet_per_pixel ? (
                          <span>
                            Scale locked at {currentSheet.scale_feet_per_pixel.toFixed(4)} feet per
                            drawing pixel.
                            {currentSheet.scale_source === "stated" && !effectiveScaleVerifiedAt
                              ? " From stated scale — complete two assurance checks."
                              : ""}
                          </span>
                        ) : (
                          <span>
                            Scale is needed before linear or area quantities can calculate.
                          </span>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </section>
          )}

          {(!isCockpitMode || cockpitToolsView === "review") && (
            <section
              className={cn(
                "rounded-lg border border-hairline bg-card p-4 shadow-card",
                toolsWorkspaceMaximized && "self-start",
              )}
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
                  Use this when dense sheets need less noise. The worksheet still keeps every
                  takeoff.
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
                          <span className="block truncate text-muted-foreground">
                            {copy.detail}
                          </span>
                        </span>
                      </span>
                      <Badge variant={visible ? "secondary" : "outline"}>
                        {takeoffLayerCounts[key]}
                      </Badge>
                    </button>
                  );
                })}
              </div>
              {sheetColorsInUse.length > 0 && (
                <div className="mt-3" data-testid="takeoff-color-visibility">
                  <p className="eyebrow">Colors on this sheet</p>
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {sheetColorsInUse.map((color) => {
                      const hidden = hiddenTakeoffColors.includes(color);
                      return (
                        <button
                          key={color}
                          type="button"
                          className={cn(
                            "h-7 w-7 rounded border transition",
                            hidden ? "border-hairline opacity-25" : "border-foreground/40",
                          )}
                          style={{ backgroundColor: color }}
                          title={
                            hidden
                              ? "Show this color's markups on the sheet"
                              : "Hide this color's markups on the sheet"
                          }
                          aria-pressed={!hidden}
                          onClick={() =>
                            setHiddenTakeoffColors((current) =>
                              hidden
                                ? current.filter((item) => item !== color)
                                : [...current, color],
                            )
                          }
                          data-testid="takeoff-color-chip"
                        />
                      );
                    })}
                    {hiddenTakeoffColors.length > 0 && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-xs"
                        onClick={() => setHiddenTakeoffColors([])}
                        data-testid="takeoff-color-show-all"
                      >
                        Show all colors
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </section>
          )}

          {(!isCockpitMode || cockpitToolsView === "review") && (
            <ReadinessPanel
              className={toolsWorkspaceMaximized ? "self-start" : undefined}
              sheets={sheets}
              measurements={measurements}
              unscaledSheets={unscaledSheets}
              unlinkedMeasurements={unlinkedMeasurements}
              calculationIssues={calculationIssues}
              linkedCount={linkedCount}
              hiddenSheetMeasurementCount={hiddenSheetMeasurementCount}
              sheetMeasurements={sheetMeasurements}
              visibleSheetMeasurements={visibleSheetMeasurements}
              openFirstUnscaledSheet={openFirstUnscaledSheet}
              showUnlinkedTakeoffs={showUnlinkedTakeoffs}
              reviewCalculationIssues={() => {
                const firstIssue = calculationIssues[0];
                if (!firstIssue) return;
                setSelectedSheetId(firstIssue.plan_sheet_id);
                setSelectedMeasurementId(firstIssue.id);
              }}
              setAllTakeoffLayersVisible={setAllTakeoffLayersVisible}
            />
          )}

          {(!isCockpitMode || cockpitToolsView === "review") && (
            <section
              className={cn(
                "rounded-lg border border-hairline bg-card p-4 shadow-card",
                toolsWorkspaceMaximized && "self-start",
              )}
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
                  <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                    {selectedMeasurement.created_by_ai && (
                      <Badge
                        variant="outline"
                        className="gap-1 border-warning/30 bg-warning/10 text-warning"
                        title="Counted with AI Assist — every point was reviewed and accepted by hand."
                        data-testid="takeoff-inspector-ai-chip"
                      >
                        AI-assisted
                      </Badge>
                    )}
                    <Badge
                      variant={
                        selectedMeasurement.calculation_status === "current"
                          ? "secondary"
                          : "outline"
                      }
                      className={cn(
                        selectedMeasurement.calculation_status !== "current" &&
                          "border-warning/40 bg-warning/10 text-warning",
                      )}
                      data-testid="takeoff-inspector-trust-chip"
                    >
                      {selectedMeasurement.calculation_status === "current" &&
                      selectedMeasurement.calculation_method === "manual_override"
                        ? "Approved override"
                        : takeoffTrustLabel(selectedMeasurement.calculation_status)}
                    </Badge>
                    <Badge variant="secondary">
                      {toolLabel(selectedMeasurement.tool_type)} ·{" "}
                      {formatQty(selectedMeasurement.quantity, selectedMeasurement.unit)}
                    </Badge>
                  </div>
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
                    <p className="mt-1" data-testid="selected-takeoff-calculation-source">
                      Quantity source: {selectedMeasurement.calculation_method.replaceAll("_", " ")}
                      {selectedMeasurement.calculation_scale_revision
                        ? ` · scale revision ${selectedMeasurement.calculation_scale_revision}`
                        : " · scale independent"}
                    </p>
                    {selectedMeasurement.calculation_status !== "current" && (
                      <div className="mt-3 flex items-center justify-between gap-2 rounded-md border border-warning/40 bg-warning/10 px-2 py-2 text-foreground">
                        <span>
                          {selectedMeasurement.calculation_status === "unverified_scale"
                            ? "Complete two Scale Assurance checks before sending its length or area to the estimate."
                            : "Recalculate this sheet from its saved geometry before sending quantities to the estimate."}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-8 shrink-0"
                          onClick={() =>
                            recalculateSheetMutation.mutate(selectedMeasurement.plan_sheet_id)
                          }
                          disabled={recalculateSheetMutation.isPending}
                          data-testid="selected-takeoff-recalculate-sheet"
                        >
                          Recalculate sheet
                        </Button>
                      </div>
                    )}
                  </div>
                  <TakeoffAssemblyWorkbench
                    estimateId={estimate.id}
                    measurement={selectedMeasurement}
                    scopeItems={measurementScopeItems}
                    lineItems={lineItems}
                  />
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
                          disabled={updateMeasurementMutation.isPending}
                          data-testid="selected-takeoff-recalculate"
                        >
                          Recalc
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Override only when field judgment beats the markup. Recalc returns to
                        drawing geometry.
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
                  {(Math.abs(
                    Number(selectedMeasurementDraft.quantity || 0) - selectedMeasurement.quantity,
                  ) > 0.00005 ||
                    selectedMeasurement.calculation_method === "manual_override") && (
                    <div className="space-y-1.5">
                      <Label>Override reason</Label>
                      <Textarea
                        rows={2}
                        value={selectedMeasurementDraft.overrideReason}
                        onChange={(event) =>
                          setSelectedMeasurementDraft((draft) => ({
                            ...draft,
                            overrideReason: event.target.value,
                          }))
                        }
                        placeholder="Example: field-verified dimension supersedes the printed plan."
                        data-testid="selected-takeoff-override-reason"
                      />
                      <p className="text-xs text-muted-foreground">
                        Manual quantities are allowed, but the estimator's reason stays in the audit
                        trail.
                      </p>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <Label>Markup color</Label>
                    <div
                      className="flex flex-wrap gap-2"
                      data-testid="selected-takeoff-color-picker"
                    >
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
                    {selectedMeasurementLine ? (
                      <div
                        className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs"
                        data-testid="selected-takeoff-row-link"
                      >
                        <span className="min-w-0 truncate">
                          Linked:{" "}
                          {selectedMeasurementLine.cost_code
                            ? `${selectedMeasurementLine.cost_code} · `
                            : ""}
                          {selectedMeasurementLine.description.slice(0, 50)} · per{" "}
                          {selectedMeasurementLine.unit}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 shrink-0 px-2 text-xs"
                          onClick={() =>
                            updateMeasurementMutation.mutate({
                              id: selectedMeasurement.id,
                              patch: { estimate_line_item_id: null },
                            })
                          }
                          data-testid="selected-takeoff-unlink"
                        >
                          Unlink
                        </Button>
                      </div>
                    ) : (
                      <div data-testid="selected-takeoff-row-link">
                        <LinkOrCreatePicker
                          lineItems={lineItems}
                          takeoffUnit={selectedMeasurement.unit}
                          onPickRow={(lineId) =>
                            linkMeasurementToRow(selectedMeasurement.id, lineId)
                          }
                          onPickLibraryItem={(item) =>
                            classifyTakeoffMutation.mutate({
                              measurementIds: [selectedMeasurement.id],
                              source: { type: "library", library_item_id: item.id },
                            })
                          }
                          onCreateFromLabel={(label) =>
                            classifyTakeoffMutation.mutate({
                              measurementIds: [selectedMeasurement.id],
                              source: {
                                type: "label",
                                description: label,
                                unit: selectedMeasurement.unit,
                              },
                            })
                          }
                          pending={classifyTakeoffMutation.isPending}
                          compact
                        />
                      </div>
                    )}
                    {selectedMeasurementLine &&
                      !takeoffUnitsCompatible(
                        selectedMeasurement.unit,
                        selectedMeasurementLine.unit,
                      ) && (
                        <p
                          className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs"
                          data-testid="selected-takeoff-unit-mismatch"
                        >
                          This takeoff measures {unitLongName(selectedMeasurement.unit)}, but the
                          row is priced per {unitLongName(selectedMeasurementLine.unit)}. Sync will
                          ask before mixing them.
                        </p>
                      )}
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
                    {selectedMeasurement.calculation_status === "current" &&
                      selectedMeasurementLine &&
                      (lineTotals.get(selectedMeasurementLine.id)?.untrustedCount ?? 0) > 0 && (
                        <p
                          className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-foreground"
                          data-testid="selected-takeoff-linked-trust-warning"
                        >
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                          Another takeoff feeding this estimate row needs review before the row can
                          sync.
                        </p>
                      )}
                    {selectedMeasurementLine ? (
                      <Button
                        size="sm"
                        className="w-full gap-1.5"
                        onClick={() =>
                          syncLineMutation.mutate({ lineId: selectedMeasurementLine.id })
                        }
                        disabled={
                          syncLineMutation.isPending ||
                          (lineTotals.get(selectedMeasurementLine.id)?.untrustedCount ?? 0) > 0
                        }
                        title={
                          takeoffSyncBlockReason(selectedMeasurement.calculation_status) ||
                          ((lineTotals.get(selectedMeasurementLine.id)?.untrustedCount ?? 0) > 0
                            ? "Another takeoff feeding this estimate row must be reviewed before sending."
                            : "Send this takeoff total to the estimate.")
                        }
                        data-testid="selected-takeoff-sync"
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
          )}

          {(!isCockpitMode || cockpitToolsView === "worksheet") && (
            <TakeoffWorksheet
              expanded={toolsWorkspaceMaximized}
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
              linkMeasurement={linkMeasurementToRow}
              classifyMeasurement={(measurementId, source) =>
                classifyTakeoffMutation.mutate({ measurementIds: [measurementId], source })
              }
              linkMeasurements={(measurementIds, lineId) =>
                linkGroupMutation.mutate({ measurementIds, lineId })
              }
              classifyMeasurements={(measurementIds, source) =>
                classifyTakeoffMutation.mutate({ measurementIds, source })
              }
              detachMeasurement={detachMeasurementFromGroup}
              classifyPending={classifyTakeoffMutation.isPending}
              onBuildFromTakeoffs={
                unlinkedMeasurements.length > 0 ? openBuildFromTakeoffs : undefined
              }
              buildPending={buildFromTakeoffsMutation.isPending}
              onReviewMatches={takeoffMatchSuggestions.length > 0 ? openMatchProposals : undefined}
              matchCount={takeoffMatchSuggestions.length}
            />
          )}
          {isCockpitMode && cockpitPanelPresentations.tools !== "maximized" && (
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
      {buildGroups && (
        <Dialog open onOpenChange={(open) => !open && setBuildGroups(null)}>
          <DialogContent className="max-w-2xl" data-testid="build-from-takeoffs-dialog">
            <DialogHeader>
              <div className="eyebrow">Takeoff</div>
              <DialogTitle className="font-serif text-2xl font-normal">
                Build estimate rows from takeoffs
              </DialogTitle>
              <DialogDescription>
                Unlinked takeoffs grouped into the rows they would create (waste applied, mixed
                units kept separate). Uncheck any group to leave it as-is.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
              {buildGroups.map((group) => (
                <label
                  key={group.key}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-hairline bg-surface px-3 py-2 text-sm"
                  data-testid="build-from-takeoffs-row"
                >
                  <input
                    type="checkbox"
                    checked={group.accepted}
                    onChange={(event) =>
                      setBuildGroups(
                        (current) =>
                          current?.map((item) =>
                            item.key === group.key
                              ? { ...item, accepted: event.target.checked }
                              : item,
                          ) ?? null,
                      )
                    }
                    className="mt-1"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{group.label}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatQty(group.quantity, group.unit)} from {group.measurement_count} takeoff
                      {group.measurement_count === 1 ? "" : "s"}
                    </span>
                  </span>
                  {group.library_item_id ? (
                    <Badge variant="secondary" className="shrink-0">
                      Priced from library
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="shrink-0 border-warning/50 bg-warning/10">
                      Needs pricing
                    </Badge>
                  )}
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setBuildGroups(null)}
                disabled={buildFromTakeoffsMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() =>
                  buildFromTakeoffsMutation.mutate(buildGroups.filter((group) => group.accepted))
                }
                disabled={
                  buildFromTakeoffsMutation.isPending ||
                  buildGroups.every((group) => !group.accepted)
                }
                data-testid="build-from-takeoffs-apply"
              >
                {buildFromTakeoffsMutation.isPending
                  ? "Creating rows..."
                  : `Create ${buildGroups.filter((group) => group.accepted).length} Row${
                      buildGroups.filter((group) => group.accepted).length === 1 ? "" : "s"
                    }`}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {matchProposals && (
        <Dialog open onOpenChange={(open) => !open && setMatchProposals(null)}>
          <DialogContent className="max-w-2xl" data-testid="takeoff-match-dialog">
            <DialogHeader>
              <div className="eyebrow">Takeoff</div>
              <DialogTitle className="font-serif text-2xl font-normal">
                Match takeoffs to estimate rows
              </DialogTitle>
              <DialogDescription>
                Suggested matches on cost code or description with compatible units. Uncheck any row
                to skip it — nothing links until you apply.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
              {matchProposals.map((row) => (
                <label
                  key={row.measurementId}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-hairline bg-surface px-3 py-2 text-sm"
                  data-testid="takeoff-match-row"
                >
                  <input
                    type="checkbox"
                    checked={row.accepted}
                    onChange={(event) =>
                      setMatchProposals(
                        (current) =>
                          current?.map((item) =>
                            item.measurementId === row.measurementId
                              ? { ...item, accepted: event.target.checked }
                              : item,
                          ) ?? null,
                      )
                    }
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.takeoffLabel} · {formatQty(row.takeoffQuantity, row.takeoffUnit)}
                    </span>
                    <span className="block truncate font-medium">
                      → {row.rowLabel} · per {row.rowUnit}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setMatchProposals(null)}
                disabled={applyMatchesMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => applyMatchesMutation.mutate(matchProposals)}
                disabled={
                  applyMatchesMutation.isPending || matchProposals.every((row) => !row.accepted)
                }
                data-testid="takeoff-match-apply"
              >
                Apply {matchProposals.filter((row) => row.accepted).length} Match
                {matchProposals.filter((row) => row.accepted).length === 1 ? "" : "es"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {detectProposals && (
        <Dialog open onOpenChange={(open) => !open && setDetectProposals(null)}>
          <DialogContent className="max-w-2xl" data-testid="detect-names-dialog">
            <DialogHeader>
              <div className="eyebrow">Plan Room</div>
              <DialogTitle className="font-serif text-2xl font-normal">
                Detected sheet names
              </DialogTitle>
              <DialogDescription>
                Read from each sheet's title block. Uncheck any row you want to keep as-is — nothing
                renames until you apply.
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[50vh] space-y-1.5 overflow-y-auto">
              {detectProposals.map((row) => (
                <label
                  key={row.sheetId}
                  className="flex cursor-pointer items-start gap-2 rounded-md border border-hairline bg-surface px-3 py-2 text-sm"
                  data-testid="detect-names-row"
                >
                  <input
                    type="checkbox"
                    checked={row.accepted}
                    onChange={(event) =>
                      setDetectProposals(
                        (current) =>
                          current?.map((item) =>
                            item.sheetId === row.sheetId
                              ? { ...item, accepted: event.target.checked }
                              : item,
                          ) ?? null,
                      )
                    }
                    className="mt-1"
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.currentLabel}
                    </span>
                    <span className="block truncate font-medium">
                      {row.detectedNumber} — {row.detectedName || "(name unchanged)"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setDetectProposals(null)}
                disabled={applyDetectedNames.isPending}
              >
                Cancel
              </Button>
              <Button
                onClick={() => applyDetectedNames.mutate(detectProposals)}
                disabled={
                  applyDetectedNames.isPending || detectProposals.every((row) => !row.accepted)
                }
                data-testid="detect-names-apply"
              >
                Apply {detectProposals.filter((row) => row.accepted).length} Rename
                {detectProposals.filter((row) => row.accepted).length === 1 ? "" : "s"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      <SyncConflictDialog
        conflict={syncConflict}
        pending={syncLineMutation.isPending}
        onCancel={() => setSyncConflict(null)}
        onConfirm={confirmSyncConflict}
      />
      {verifyOutcome && (
        <Dialog open onOpenChange={(open) => !open && setVerifyOutcome(null)}>
          <DialogContent data-testid="verify-scale-discrepancy-dialog">
            <DialogHeader>
              <div className="eyebrow">Scale check</div>
              <DialogTitle className="font-serif text-2xl font-normal">
                The scale is off
              </DialogTitle>
              <DialogDescription>
                The worst check measured {formatQty(verifyOutcome.measuredFeet, "ft")} where you
                expected {formatQty(verifyOutcome.expectedFeet, "ft")} — off by{" "}
                {Math.abs(verifyOutcome.offPct).toFixed(2)}%.
              </DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              Maximum variance was {verifyOutcome.maxVariancePct.toFixed(2)}%; the two implied
              scales differed by {verifyOutcome.scaleSpreadPct.toFixed(2)}%.{" "}
              {verifyOutcome.canRecalibrate
                ? "The checks agree with each other, so Overwatch can recalibrate from both. You must run two new checks before the sheet becomes verified."
                : "The checks disagree with each other. Re-run them on two clear printed dimensions before changing the scale."}
            </p>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setVerifyOutcome(null)}
                disabled={scaleCorrectionMutation.isPending}
              >
                Keep Unverified
              </Button>
              {verifyOutcome.canRecalibrate && (
                <Button
                  onClick={applyVerifyCorrection}
                  disabled={scaleCorrectionMutation.isPending}
                  data-testid="verify-scale-recalibrate"
                >
                  Recalibrate &amp; Recheck
                </Button>
              )}
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
