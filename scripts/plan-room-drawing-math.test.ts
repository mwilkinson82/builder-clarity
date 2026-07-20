import { describe, expect, it } from "vitest";
import {
  ANGLE_GUIDE_SNAP_TOLERANCE_DEG,
  formatGeometricLinearFeet,
  GEOMETRY_SNAP_TOLERANCE_PX,
  resolveTakeoffDrawPoint,
  snapLinearPoint,
  snapToTakeoffVertex,
} from "../src/lib/plan-room-math";

const viewSize = { width: 1000, height: 1000 };
const anchor = { x: 0.2, y: 0.5 };

function cursorAtAngle(angleDeg: number) {
  const dx = 0.5;
  return {
    x: anchor.x + dx,
    y: anchor.y - Math.tan((angleDeg * Math.PI) / 180) * dx,
  };
}

describe("construction drawing display and snapping", () => {
  it("displays decimal LF as feet, inches, and nearest eighth without changing the number", () => {
    const storedFeet = 21.03;

    expect(formatGeometricLinearFeet(storedFeet)).toBe(`21'-0 3/8"`);
    expect(storedFeet).toBe(21.03);
  });

  it("uses a practical six-degree ortho acquisition window", () => {
    expect(ANGLE_GUIDE_SNAP_TOLERANCE_DEG).toBe(6);

    const inside = snapLinearPoint({
      anchor,
      cursor: cursorAtAngle(5.75),
      viewSize,
    });
    expect(inside.snapped).toBe(true);
    expect(inside.angleDeg).toBe(0);
    expect(inside.point.y).toBeCloseTo(anchor.y, 10);

    const outside = snapLinearPoint({
      anchor,
      cursor: cursorAtAngle(6.25),
      viewSize,
    });
    expect(outside.snapped).toBe(false);
    expect(outside.point).toEqual(cursorAtAngle(6.25));
  });

  it("preserves Shift hard-lock outside the automatic ortho window", () => {
    const constrained = resolveTakeoffDrawPoint({
      anchor,
      cursor: cursorAtAngle(19),
      viewSize,
      shiftKey: true,
    });

    expect(constrained.orthoSnapped).toBe(true);
    expect(constrained.angleDeg).toBe(0);
    expect(constrained.point.y).toBeCloseTo(anchor.y, 10);
  });

  it("preserves Alt as an unconditional bypass for geometry and ortho snaps", () => {
    const cursor = cursorAtAngle(2);
    const resolved = resolveTakeoffDrawPoint({
      anchor,
      cursor,
      viewSize,
      candidates: [{ x: cursor.x + 0.002, y: cursor.y }],
      altKey: true,
      shiftKey: true,
    });

    expect(resolved.point).toEqual(cursor);
    expect(resolved.orthoSnapped).toBe(false);
    expect(resolved.geometrySnapped).toBe(false);
  });

  it("uses a fourteen-screen-pixel geometry acquisition radius", () => {
    expect(GEOMETRY_SNAP_TOLERANCE_PX).toBe(14);
    const cursor = { x: 0.5, y: 0.5 };
    const inside = { x: 0.5135, y: 0.5 };
    const outside = { x: 0.5145, y: 0.5 };

    expect(snapToTakeoffVertex({ cursor, candidates: [inside], viewSize })).toEqual(inside);
    expect(snapToTakeoffVertex({ cursor, candidates: [outside], viewSize })).toBeNull();
  });
});
