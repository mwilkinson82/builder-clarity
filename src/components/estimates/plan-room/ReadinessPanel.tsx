import { AlertTriangle, Check, EyeOff, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PlanSheetRow, TakeoffMeasurementRow } from "@/lib/plan-room.functions";
import { sheetScaleStatus } from "./planRoomShared";

export function ReadinessPanel({
  sheets,
  measurements,
  unscaledSheets,
  unlinkedMeasurements,
  linkedCount,
  hiddenSheetMeasurementCount,
  sheetMeasurements,
  visibleSheetMeasurements,
  openFirstUnscaledSheet,
  showUnlinkedTakeoffs,
  setAllTakeoffLayersVisible,
}: {
  sheets: PlanSheetRow[];
  measurements: TakeoffMeasurementRow[];
  unscaledSheets: PlanSheetRow[];
  unlinkedMeasurements: TakeoffMeasurementRow[];
  linkedCount: number;
  hiddenSheetMeasurementCount: number;
  sheetMeasurements: TakeoffMeasurementRow[];
  visibleSheetMeasurements: TakeoffMeasurementRow[];
  openFirstUnscaledSheet: () => void;
  showUnlinkedTakeoffs: () => void;
  setAllTakeoffLayersVisible: (visible: boolean) => void;
}) {
  const scaledSheetCount = sheets.length - unscaledSheets.length;
  const verifiedSheetCount = sheets.filter(
    (sheet) => sheetScaleStatus(sheet) === "verified",
  ).length;
  const unverifiedScaledCount = scaledSheetCount - verifiedSheetCount;
  const readinessIssueCount =
    (sheets.length === 0 ? 1 : 0) +
    (measurements.length === 0 ? 1 : 0) +
    unscaledSheets.length +
    unlinkedMeasurements.length +
    hiddenSheetMeasurementCount;
  const readinessReady =
    sheets.length > 0 &&
    measurements.length > 0 &&
    unscaledSheets.length === 0 &&
    unlinkedMeasurements.length === 0 &&
    hiddenSheetMeasurementCount === 0;
  return (
    <section
      className="rounded-lg border border-hairline bg-card p-4 shadow-card"
      data-testid="takeoff-readiness-checklist"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl">Estimate Readiness</h2>
          <p className="text-xs text-muted-foreground">
            Clean up the plan room before you trust the estimate quantities.
          </p>
        </div>
        {readinessReady ? (
          <Badge variant="secondary" data-testid="takeoff-readiness-ready">
            Ready
          </Badge>
        ) : (
          <Badge variant="outline" data-testid="takeoff-readiness-issues">
            {readinessIssueCount} to check
          </Badge>
        )}
      </div>
      <div className="mt-4 space-y-2 text-xs">
        <div className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-surface px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            {unscaledSheets.length > 0 ? (
              <XCircle className="h-3.5 w-3.5 text-danger" />
            ) : unverifiedScaledCount > 0 ? (
              <AlertTriangle className="h-3.5 w-3.5 text-warning" />
            ) : (
              <Check className="h-3.5 w-3.5 text-primary" />
            )}
            <span className="min-w-0">
              <span className="block font-medium text-foreground">Sheet scales</span>
              <span
                className="block truncate text-muted-foreground"
                data-testid="readiness-scale-summary"
              >
                {unscaledSheets.length > 0
                  ? `${unscaledSheets.length} of ${sheets.length} sheets have no scale`
                  : unverifiedScaledCount > 0
                    ? `All scaled — ${unverifiedScaledCount} not verified yet`
                    : `All ${sheets.length} sheets scaled and verified`}
              </span>
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            onClick={openFirstUnscaledSheet}
            disabled={unscaledSheets.length === 0}
            data-testid="takeoff-readiness-open-unscaled"
          >
            Open
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-surface px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            {unlinkedMeasurements.length === 0 ? (
              <Check className="h-3.5 w-3.5 text-primary" />
            ) : (
              <XCircle className="h-3.5 w-3.5 text-danger" />
            )}
            <span className="min-w-0">
              <span className="block font-medium text-foreground">Takeoff links</span>
              <span className="block truncate text-muted-foreground">
                {linkedCount} of {measurements.length} takeoffs linked to estimate rows
              </span>
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            onClick={showUnlinkedTakeoffs}
            disabled={unlinkedMeasurements.length === 0}
            data-testid="takeoff-readiness-show-unlinked"
          >
            Review
          </Button>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-surface px-3 py-2">
          <span className="flex min-w-0 items-center gap-2">
            {hiddenSheetMeasurementCount === 0 ? (
              <Check className="h-3.5 w-3.5 text-primary" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
            )}
            <span className="min-w-0">
              <span className="block font-medium text-foreground">Visible markups</span>
              <span className="block truncate text-muted-foreground">
                {visibleSheetMeasurements.length} of {sheetMeasurements.length} marks visible on
                this sheet
              </span>
            </span>
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 px-2 text-xs"
            onClick={() => setAllTakeoffLayersVisible(true)}
            disabled={hiddenSheetMeasurementCount === 0}
            data-testid="takeoff-readiness-show-markups"
          >
            Show
          </Button>
        </div>
      </div>
    </section>
  );
}
