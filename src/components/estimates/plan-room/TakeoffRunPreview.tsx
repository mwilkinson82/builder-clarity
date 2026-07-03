import { calculateTakeoffQuantity } from "@/lib/plan-room-math";
import { formatQty, type Point, type ToolMode, type ViewSize } from "./planRoomShared";
import { LinearAngleGuide } from "./TakeoffTools";

// The resolved cursor for an active drawing run: where the next click will
// land after ortho/geometry snapping, plus which snap (if any) produced it.
export type RunCursorState = {
  point: Point;
  angleDeg: number;
  orthoSnapped: boolean;
  geometrySnapped: boolean;
};

// Rubber-band preview for an active linear/area run (beta batch 1, Task 0):
// a live segment from the last placed vertex to the resolved cursor, carrying
// the angle guide and a live measurement readout so the numbers move with the
// hand, not only after the click. The geometry-snap indicator (Task 1) also
// renders before the first vertex, so a run can be aimed at a prior run's
// endpoint. Sizes divide by zoom to stay readable when zoomed in close.
export function TakeoffRunPreview({
  pendingPoints,
  cursor,
  tool,
  viewSize,
  zoom,
  scaleFeetPerPixel,
  unit,
}: {
  pendingPoints: Point[];
  cursor: RunCursorState;
  tool: ToolMode;
  viewSize: ViewSize;
  zoom: number;
  scaleFeetPerPixel: number;
  unit: string;
}) {
  const scale = Math.max(1, zoom);
  const anchor = pendingPoints.length > 0 ? pendingPoints[pendingPoints.length - 1] : null;
  const cursorX = cursor.point.x * viewSize.width;
  const cursorY = cursor.point.y * viewSize.height;

  let readout: { x: number; y: number; text: string } | null = null;
  if (anchor && scaleFeetPerPixel > 0) {
    if (tool === "linear") {
      const segmentFeet =
        Math.hypot(
          (cursor.point.x - anchor.x) * viewSize.width,
          (cursor.point.y - anchor.y) * viewSize.height,
        ) * scaleFeetPerPixel;
      const runFeet = calculateTakeoffQuantity({
        tool: "linear",
        points: [...pendingPoints, cursor.point],
        scaleFeetPerPixel,
        viewSize,
      });
      readout = {
        x: (cursorX + anchor.x * viewSize.width) / 2,
        y: (cursorY + anchor.y * viewSize.height) / 2,
        text:
          pendingPoints.length >= 2
            ? `${formatQty(segmentFeet, unit)} · run ${formatQty(runFeet, unit)}`
            : formatQty(segmentFeet, unit),
      };
    }
    if (tool === "area" && pendingPoints.length >= 2) {
      const areaQty = calculateTakeoffQuantity({
        tool: "area",
        points: [...pendingPoints, cursor.point],
        scaleFeetPerPixel,
        viewSize,
      });
      readout = {
        x: cursorX + 18 / scale,
        y: cursorY + 30 / scale,
        text: formatQty(areaQty, unit),
      };
    }
  }

  return (
    <g data-testid="takeoff-run-preview" pointerEvents="none">
      {anchor && (
        <LinearAngleGuide
          anchor={anchor}
          point={cursor.point}
          angleDeg={cursor.angleDeg}
          snapped={cursor.orthoSnapped}
          viewSize={viewSize}
          zoom={zoom}
        />
      )}
      {tool === "area" && pendingPoints.length >= 2 && (
        <line
          x1={cursorX}
          y1={cursorY}
          x2={pendingPoints[0].x * viewSize.width}
          y2={pendingPoints[0].y * viewSize.height}
          stroke="#64748b"
          strokeWidth={1 / scale}
          strokeDasharray={`${3 / scale} ${5 / scale}`}
          opacity="0.7"
          data-testid="takeoff-run-preview-closing"
        />
      )}
      {readout && (
        <PreviewReadout
          x={readout.x}
          y={readout.y}
          text={readout.text}
          scale={scale}
          snapped={cursor.orthoSnapped}
        />
      )}
      {cursor.geometrySnapped && <SnapIndicator x={cursorX} y={cursorY} scale={scale} />}
    </g>
  );
}

function PreviewReadout({
  x,
  y,
  text,
  scale,
  snapped,
}: {
  x: number;
  y: number;
  text: string;
  scale: number;
  snapped: boolean;
}) {
  const width = (Math.max(58, text.length * 6.5) + 12) / scale;
  const height = 20 / scale;
  const color = snapped ? "#16a34a" : "#28231d";
  return (
    <g data-testid="takeoff-run-preview-readout">
      <rect
        x={x - width / 2}
        y={y - height - 6 / scale}
        width={width}
        height={height}
        rx={4 / scale}
        fill="white"
      />
      <rect
        x={x - width / 2}
        y={y - height - 6 / scale}
        width={width}
        height={height}
        rx={4 / scale}
        fill={`${color}10`}
        stroke={color}
        strokeWidth={0.75 / scale}
      />
      <text
        x={x}
        y={y - height * 0.3 - 6 / scale}
        textAnchor="middle"
        fill={color}
        fontSize={10 / scale}
        fontWeight="700"
      >
        {text}
      </text>
    </g>
  );
}

// Endpoint-snap marker in the CAD dialect: a small green square over the
// vertex the cursor is magnetized to.
function SnapIndicator({ x, y, scale }: { x: number; y: number; scale: number }) {
  const half = 6 / scale;
  return (
    <g data-testid="takeoff-snap-indicator">
      <rect
        x={x - half}
        y={y - half}
        width={half * 2}
        height={half * 2}
        fill="white"
        fillOpacity="0.6"
        stroke="#16a34a"
        strokeWidth={2 / scale}
      />
      <circle cx={x} cy={y} r={2 / scale} fill="#16a34a" />
    </g>
  );
}
