import type {
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
} from "react";
import {
  Check,
  DraftingCompass,
  MousePointer2,
  PencilRuler,
  Plus,
  Redo2,
  Ruler,
  ShieldCheck,
  Square,
  Undo2,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  decimalFeetHint,
  distancePx,
  formatFeetInches,
  formatGeometricLinearFeet,
} from "@/lib/plan-room-math";
import type { TakeoffMeasurementRow } from "@/lib/plan-room.functions";
import {
  formatQty,
  geometryPoints,
  toolLabel,
  type DraftCommandStatus,
  type Point,
  type ToolMode,
  type ViewSize,
} from "./planRoomShared";

export function TakeoffTools({
  compact = false,
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
  canUndo = false,
  canRedo = false,
  onUndo,
  onRedo,
  onOpenAiAssist,
  aiAssistOpen = false,
}: {
  compact?: boolean;
  tool: ToolMode;
  backendReady: boolean;
  draftCommand: DraftCommandStatus | null;
  activeDraftPointCount: number;
  setTool: (tool: ToolMode) => void;
  setPendingPoints: (points: Point[]) => void;
  setCalibrationPoints: (points: Point[]) => void;
  finishDraft: () => void;
  undoDraftPoint: () => void;
  clearDraftPoints: () => void;
  createMeasurementMutation: { isPending: boolean };
  updateSheetMutation: { isPending: boolean };
  // Per-sheet takeoff undo/redo (Phase 4 Task 0). Buttons always render with
  // disabled states so the affordance is discoverable before the first edit.
  canUndo?: boolean;
  canRedo?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  // AI Assist (AITAKEOFF1): opens the count-scan panel — a panel entry, not a
  // drawing tool, so it never changes the active ToolMode.
  onOpenAiAssist?: () => void;
  aiAssistOpen?: boolean;
}) {
  return (
    <>
      {[
        { value: "select", icon: MousePointer2 },
        { value: "calibrate", icon: Ruler },
        { value: "verify", icon: ShieldCheck },
        { value: "linear", icon: PencilRuler },
        { value: "area", icon: Square },
        { value: "count", icon: Plus },
        { value: "ruler", icon: DraftingCompass },
      ].map((item) => {
        const Icon = item.icon;
        return (
          <Button
            key={item.value}
            type="button"
            size="sm"
            variant={tool === item.value ? "default" : "outline"}
            className={cn("gap-1.5", compact && "h-8 px-2 text-xs")}
            title={toolLabel(item.value as ToolMode)}
            data-testid={`takeoff-tool-${item.value}`}
            disabled={!backendReady}
            onClick={() => {
              setTool(item.value as ToolMode);
              setPendingPoints([]);
              if (item.value !== "calibrate" && item.value !== "verify") {
                setCalibrationPoints([]);
              }
            }}
          >
            <Icon className="h-3.5 w-3.5" />
            <span className={cn(compact && "hidden 2xl:inline")}>
              {toolLabel(item.value as ToolMode)}
            </span>
          </Button>
        );
      })}
      {onOpenAiAssist && (
        <Button
          type="button"
          size="sm"
          variant={aiAssistOpen ? "default" : "outline"}
          className={cn(
            "gap-1.5",
            !aiAssistOpen && "border-clay bg-clay/[0.06] text-clay",
            compact && "h-8 px-2 text-xs",
          )}
          title="AI Markups — identify repeated symbols or find more like an accepted example"
          data-testid="takeoff-tool-ai-assist"
          disabled={!backendReady}
          onClick={onOpenAiAssist}
        >
          <img src="/favicon.svg" alt="" aria-hidden className="h-3.5 w-3.5" />
          <span className={cn(compact && "hidden 2xl:inline")}>AI Markups</span>
        </Button>
      )}
      {draftCommand && draftCommand.actionLabel && (
        <Button
          size="sm"
          className={cn("gap-1.5", compact && "h-8 px-2 text-xs")}
          title={draftCommand.actionLabel}
          onClick={finishDraft}
          disabled={
            !backendReady ||
            !draftCommand.ready ||
            createMeasurementMutation.isPending ||
            updateSheetMutation.isPending
          }
          data-testid="takeoff-finish-draft"
        >
          <Check className="h-3.5 w-3.5" />
          <span>{draftCommand.actionLabel}</span>
        </Button>
      )}
      {(tool === "calibrate" || tool === "verify") && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className={cn("gap-1.5", compact && "h-8 px-2 text-xs")}
          onClick={() => {
            clearDraftPoints();
            setCalibrationPoints([]);
            setTool("select");
          }}
          data-testid="takeoff-cancel-scale"
        >
          <XCircle className="h-3.5 w-3.5" /> Cancel scale check
        </Button>
      )}
      {activeDraftPointCount > 0 && (
        <>
          <Button
            size="sm"
            variant="outline"
            className={cn("gap-1.5", compact && "h-8 px-2 text-xs")}
            title="Remove the last placed point (Ctrl/Cmd+Z while drawing)"
            onClick={undoDraftPoint}
            data-testid="takeoff-undo-point"
          >
            <Undo2 className="h-3.5 w-3.5" />
            <span className={cn(compact && "hidden 2xl:inline")}>Undo Point</span>
          </Button>
          <Button
            size="sm"
            variant="outline"
            className={cn("gap-1.5", compact && "h-8 px-2 text-xs")}
            title="Clear points"
            onClick={clearDraftPoints}
            data-testid="takeoff-clear-points"
          >
            <XCircle className="h-3.5 w-3.5" />
            <span className={cn(compact && "hidden 2xl:inline")}>Clear Points</span>
          </Button>
        </>
      )}
      {onUndo && (
        <Button
          size="sm"
          variant="outline"
          className={cn("gap-1.5", compact && "h-8 px-2 text-xs")}
          title="Undo the last takeoff change on this sheet (Ctrl/Cmd+Z)"
          onClick={onUndo}
          disabled={!backendReady || !canUndo}
          data-testid="takeoff-undo"
        >
          <Undo2 className="h-3.5 w-3.5" />
          <span className={cn(compact && "hidden 2xl:inline")}>Undo</span>
        </Button>
      )}
      {onRedo && (
        <Button
          size="sm"
          variant="outline"
          className={cn("gap-1.5", compact && "h-8 px-2 text-xs")}
          title="Redo the last undone takeoff change (Shift+Ctrl/Cmd+Z)"
          onClick={onRedo}
          disabled={!backendReady || !canRedo}
          data-testid="takeoff-redo"
        >
          <Redo2 className="h-3.5 w-3.5" />
          <span className={cn(compact && "hidden 2xl:inline")}>Redo</span>
        </Button>
      )}
    </>
  );
}

export function TakeoffDraftHud({
  draftCommand,
  activePointCount,
  disabled,
  onFinishDraft,
  editor,
  onCancel,
  className,
}: {
  draftCommand: DraftCommandStatus | null;
  activePointCount: number;
  disabled: boolean;
  onFinishDraft: () => void;
  editor?: ReactNode;
  onCancel?: () => void;
  className?: string;
}) {
  if (!draftCommand) return null;

  return (
    <div
      className={cn(
        "grid gap-3 rounded-md border border-hairline bg-card px-3 py-2 shadow-sm md:grid-cols-[minmax(0,1fr)_auto]",
        className ?? "mb-3",
      )}
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
      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        {editor}
        {onCancel && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={onCancel}
            data-testid="takeoff-draft-hud-cancel"
          >
            Cancel
          </Button>
        )}
        {draftCommand.actionLabel && (
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
        )}
      </div>
    </div>
  );
}

export function MeasurementShape({
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
      <g
        className="cursor-pointer"
        onClick={handleSelect}
        data-testid="takeoff-measurement-shape"
        data-takeoff-tool={measurement.tool_type}
        data-takeoff-linked={measurement.estimate_line_item_id ? "true" : "false"}
      >
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
      <g
        className="cursor-pointer"
        onClick={handleSelect}
        data-testid="takeoff-measurement-shape"
        data-takeoff-tool={measurement.tool_type}
        data-takeoff-linked={measurement.estimate_line_item_id ? "true" : "false"}
      >
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
    <g
      className="cursor-pointer"
      onClick={handleSelect}
      data-testid="takeoff-measurement-shape"
      data-takeoff-tool={measurement.tool_type}
      data-takeoff-linked={measurement.estimate_line_item_id ? "true" : "false"}
    >
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
        text={formatGeometricLinearFeet(measurement.quantity)}
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

export function DraftShape({
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
              text={formatGeometricLinearFeet(length)}
            />
          );
        })}
      {tool === "ruler" &&
        scaleFeetPerPixel > 0 &&
        scaled.slice(1).map((point, index) => {
          const previous = scaled[index];
          const length = Math.hypot(point.x - previous.x, point.y - previous.y) * scaleFeetPerPixel;
          return (
            <DraftSegmentLabel
              key={`${point.x}-${point.y}-${index}`}
              x={(point.x + previous.x) / 2}
              y={(point.y + previous.y) / 2}
              text={formatFeetInches(length)}
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

// Live guide for the linear tool: a segment from the last vertex to the
// cursor that turns green when snapped to a 45-degree increment (the level
// metaphor), with a small angle readout near the cursor. Sizes divide by zoom
// so the guide stays out of the way when zoomed in close.
export function LinearAngleGuide({
  anchor,
  point,
  angleDeg,
  snapped,
  viewSize,
  zoom,
}: {
  anchor: Point;
  point: Point;
  angleDeg: number;
  snapped: boolean;
  viewSize: ViewSize;
  zoom: number;
}) {
  const scale = Math.max(1, zoom);
  const x1 = anchor.x * viewSize.width;
  const y1 = anchor.y * viewSize.height;
  const x2 = point.x * viewSize.width;
  const y2 = point.y * viewSize.height;
  if (!Number.isFinite(x1) || !Number.isFinite(y2)) return null;
  const color = snapped ? "#16a34a" : "#64748b";
  const fontSize = 11 / scale;
  const labelText = `${Math.round(angleDeg)}°`;
  const labelWidth = (labelText.length * 7 + 14) / scale;
  const labelHeight = 18 / scale;
  const offset = 14 / scale;
  return (
    <g data-testid="linear-angle-guide" pointerEvents="none">
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={color}
        strokeWidth={snapped ? 2.5 / scale : 1.5 / scale}
        strokeDasharray={snapped ? undefined : `${6 / scale} ${5 / scale}`}
      />
      <circle cx={x2} cy={y2} r={4 / scale} fill={color} />
      <g data-testid="linear-angle-readout">
        <rect
          x={x2 + offset}
          y={y2 - labelHeight - offset / 2}
          width={labelWidth}
          height={labelHeight}
          rx={4 / scale}
          fill="white"
          stroke={color}
          strokeWidth={1 / scale}
        />
        <text
          x={x2 + offset + 6 / scale}
          y={y2 - offset / 2 - labelHeight * 0.28}
          fill={snapped ? "#166534" : "#28231d"}
          fontSize={fontSize}
          fontWeight="700"
        >
          {labelText}
        </text>
      </g>
    </g>
  );
}

// Live conversion line for real-world distance fields. A bare decimal like
// "12.8" shows its true feet-inches value and, when the digits read like an
// inch count, a one-tap "did you mean 12'-8\"?" fix. Never blocks entry.
export function FeetInchesHint({
  value,
  onAccept,
}: {
  value: string;
  onAccept: (value: string) => void;
}) {
  const hint = decimalFeetHint(value);
  if (!hint) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs"
      data-testid="feet-inches-hint"
    >
      <span className="text-muted-foreground">{hint.conversionLabel}</span>
      {hint.suggestion && (
        <button
          type="button"
          className="rounded border border-warning/50 bg-warning/10 px-1.5 py-0.5 font-medium hover:bg-warning/20"
          onClick={() => onAccept(hint.suggestion!.value)}
          data-testid="feet-inches-suggestion"
        >
          {hint.suggestion.label}
        </button>
      )}
    </div>
  );
}
