import type { TakeoffToolType } from "@/lib/plan-room.functions";

export type PlanRoomPoint = { x: number; y: number };
export type PlanRoomViewSize = { width: number; height: number };

export function distancePx(points: PlanRoomPoint[], size: PlanRoomViewSize) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    total += Math.hypot((b.x - a.x) * size.width, (b.y - a.y) * size.height);
  }
  return total;
}

export function areaPx(points: PlanRoomPoint[], size: PlanRoomViewSize) {
  if (points.length < 3) return 0;
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    total += current.x * size.width * (next.y * size.height);
    total -= next.x * size.width * (current.y * size.height);
  }
  return Math.abs(total) / 2;
}

export function calculateTakeoffQuantity({
  tool,
  points,
  scaleFeetPerPixel,
  viewSize,
}: {
  tool: TakeoffToolType;
  points: PlanRoomPoint[];
  scaleFeetPerPixel: number;
  viewSize: PlanRoomViewSize;
}) {
  if (tool === "count") return points.length || 1;
  if (scaleFeetPerPixel <= 0) return 0;
  if (tool === "linear") return distancePx(points, viewSize) * scaleFeetPerPixel;
  return areaPx(points, viewSize) * scaleFeetPerPixel * scaleFeetPerPixel;
}
