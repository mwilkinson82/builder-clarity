export type TrustedTakeoffTool = "linear" | "area" | "count";
export type TakeoffCalculationMethod = "geometry" | "count";
export type TakeoffCalculationStatus = "current" | "unverified_scale";

type Point = { x: number; y: number };
type ViewSize = { width: number; height: number };

export type TakeoffCalculation = {
  quantity: number;
  method: TakeoffCalculationMethod;
  status: TakeoffCalculationStatus;
  scaleRevision: number | null;
  context: Record<string, unknown>;
};

const finite = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const positive = (value: unknown) => {
  const parsed = finite(value);
  return parsed != null && parsed > 0 ? parsed : null;
};

const positiveInteger = (value: unknown) => {
  const parsed = positive(value);
  return parsed == null ? null : Math.max(1, Math.round(parsed));
};

const roundQuantity = (value: number) => Math.round(value * 10_000) / 10_000;

function geometryRecord(geometry: unknown): Record<string, unknown> {
  return geometry != null && typeof geometry === "object" && !Array.isArray(geometry)
    ? (geometry as Record<string, unknown>)
    : {};
}

function pointsFromGeometry(geometry: unknown): Point[] {
  const points = geometryRecord(geometry).points;
  if (!Array.isArray(points)) return [];
  return points.flatMap((candidate) => {
    if (candidate == null || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const point = candidate as Record<string, unknown>;
    const x = finite(point.x);
    const y = finite(point.y);
    if (x == null || y == null || x < 0 || x > 1 || y < 0 || y > 1) return [];
    return [{ x, y }];
  });
}

function viewSizeFromGeometry(geometry: unknown): ViewSize | null {
  const viewSize = geometryRecord(geometry).view_size;
  if (viewSize == null || typeof viewSize !== "object" || Array.isArray(viewSize)) return null;
  const record = viewSize as Record<string, unknown>;
  const width = positive(record.width);
  const height = positive(record.height);
  return width != null && height != null ? { width, height } : null;
}

function distancePixels(points: Point[], size: ViewSize) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    total += Math.hypot(
      (current.x - previous.x) * size.width,
      (current.y - previous.y) * size.height,
    );
  }
  return total;
}

function areaPixels(points: Point[], size: ViewSize) {
  let signedDoubleArea = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    signedDoubleArea += current.x * size.width * next.y * size.height;
    signedDoubleArea -= next.x * size.width * current.y * size.height;
  }
  return Math.abs(signedDoubleArea) / 2;
}

export function calculateAuthoritativeTakeoff({
  tool,
  geometry,
  sheet,
}: {
  tool: TrustedTakeoffTool;
  geometry: unknown;
  sheet: {
    scale_feet_per_pixel?: unknown;
    scale_verified_at?: unknown;
    scale_revision?: unknown;
    width_px?: unknown;
    height_px?: unknown;
  };
}): TakeoffCalculation {
  const points = pointsFromGeometry(geometry);
  if (tool === "count") {
    if (points.length < 1) throw new Error("A count takeoff requires at least one marker.");
    return {
      quantity: points.length,
      method: "count",
      status: "current",
      scaleRevision: null,
      context: {
        algorithm: "normalized-geometry-v1",
        point_count: points.length,
        scale_independent: true,
      },
    };
  }

  const minimumPoints = tool === "linear" ? 2 : 3;
  if (points.length < minimumPoints) {
    throw new Error(
      tool === "linear"
        ? "A linear takeoff requires at least two points."
        : "An area takeoff requires at least three points.",
    );
  }

  const scale = positive(sheet.scale_feet_per_pixel);
  if (scale == null) throw new Error("Set a sheet scale before measuring length or area.");
  const sheetWidth = positive(sheet.width_px);
  const sheetHeight = positive(sheet.height_px);
  const fallbackView = viewSizeFromGeometry(geometry);
  const viewSize =
    sheetWidth != null && sheetHeight != null
      ? { width: sheetWidth, height: sheetHeight }
      : fallbackView;
  if (!viewSize)
    throw new Error("The drawing dimensions are unavailable. Reopen the sheet and try again.");

  const scaleRevision = positiveInteger(sheet.scale_revision) ?? 1;
  const pixels =
    tool === "linear" ? distancePixels(points, viewSize) : areaPixels(points, viewSize);
  const quantity = roundQuantity(tool === "linear" ? pixels * scale : pixels * scale * scale);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new Error("The takeoff geometry does not produce a measurable quantity.");
  }

  return {
    quantity,
    method: "geometry",
    status: sheet.scale_verified_at ? "current" : "unverified_scale",
    scaleRevision,
    context: {
      algorithm: "normalized-geometry-v1",
      point_count: points.length,
      view_size: viewSize,
      view_size_source: sheetWidth != null && sheetHeight != null ? "sheet" : "geometry_fallback",
      scale_feet_per_pixel: scale,
      scale_revision: scaleRevision,
    },
  };
}
