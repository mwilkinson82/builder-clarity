import type { TakeoffCalculationStatus, TakeoffMeasurementRow } from "@/lib/plan-room.functions";

export type PlanRoomMeasurementCache = {
  measurements: TakeoffMeasurementRow[];
};

export function takeoffTrustLabel(status: TakeoffCalculationStatus) {
  switch (status) {
    case "current":
      return "Quantity current";
    case "unverified_scale":
      return "Verify scale";
    case "stale":
      return "Scale changed";
    case "review_required":
      return "Review required";
  }
}

export function takeoffSyncBlockReason(status: TakeoffCalculationStatus) {
  switch (status) {
    case "current":
      return "";
    case "unverified_scale":
      return "Verify this sheet's scale before sending its quantity to the estimate.";
    case "stale":
      return "Recalculate this takeoff after the scale change before sending its quantity.";
    case "review_required":
      return "Review and recalculate this takeoff before sending its quantity to the estimate.";
  }
}

export function addTakeoffToPlanRoomCache<T extends PlanRoomMeasurementCache>(
  current: T | undefined,
  measurement: TakeoffMeasurementRow,
): T | undefined {
  if (!current) return current;
  return {
    ...current,
    measurements: [
      measurement,
      ...current.measurements.filter((item) => item.id !== measurement.id),
    ],
  };
}
