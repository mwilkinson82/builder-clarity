import { useState } from "react";
import {
  AlertTriangle,
  ClipboardList,
  Download,
  Link2,
  Rows3,
  Search,
  Sparkles,
  Trash2,
} from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  groupTakeoffWorksheet,
  takeoffUnitsCompatible,
  type TakeoffWorksheetGroup,
} from "@/lib/plan-room-math";
import type { EstimateLineItemRow } from "@/lib/estimates.functions";
import type { PlanSheetRow, TakeoffMeasurementRow } from "@/lib/plan-room.functions";
import { takeoffSyncBlockReason, takeoffTrustLabel } from "@/lib/plan-room-trust";
import { formatQty, toolLabel, unitLongName, type TakeoffFilterMode } from "./planRoomShared";
import { LinkOrCreatePicker } from "./TakeoffClassify";
import { TakeoffGroupCard } from "./TakeoffGroupCard";

export type SyncConflictState = {
  kind: "quantity" | "unit";
  lineId: string;
  lineDescription: string;
  lineUnit: string;
  takeoffUnit: string;
  currentQuantity: number;
  incomingQuantity: number;
  measurementCount: number;
  // Overrides already granted earlier in this sync attempt, so a confirmed
  // quantity replace does not re-raise the unit dialog.
  forceUnitGranted: boolean;
  sources: Array<{
    label: string;
    sheetNumber: string;
    sheetName: string;
    wastePct: number;
    quantity: number;
    unit: string;
  }>;
};

// One dialog frame for both sync guards: the quantity anti-clobber and the
// Task 0 unit-mismatch guard. All copy in contractor language.
export function SyncConflictDialog({
  conflict,
  pending,
  onCancel,
  onConfirm,
}: {
  conflict: SyncConflictState | null;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (conflict: SyncConflictState) => void;
}) {
  if (!conflict) return null;
  const isUnit = conflict.kind === "unit";
  return (
    <Dialog open onOpenChange={(open) => !open && onCancel()}>
      <DialogContent data-testid="sync-conflict-dialog">
        <DialogHeader>
          <div className="eyebrow">Takeoff</div>
          <DialogTitle className="font-serif text-2xl font-normal">
            {isUnit ? "This takeoff measures a different unit" : "Replace the hand-typed quantity?"}
          </DialogTitle>
          <DialogDescription>
            {isUnit
              ? `This takeoff measures ${unitLongName(conflict.takeoffUnit)}, but the estimate row is priced per ${unitLongName(conflict.lineUnit)}. Syncing would treat ${formatQty(conflict.incomingQuantity, conflict.takeoffUnit)} as ${formatQty(conflict.incomingQuantity, conflict.lineUnit)}.`
              : "This estimate row's quantity was typed by hand. Decide which number the estimate should trust."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2 text-sm" data-testid="sync-conflict-details">
          <div className="rounded-md border border-hairline bg-surface px-3 py-2">
            <p className="eyebrow">Estimate row</p>
            <p className="mt-1 font-medium">{conflict.lineDescription || "Estimate row"}</p>
            <p className="text-xs text-muted-foreground">
              Now: {formatQty(conflict.currentQuantity, conflict.lineUnit)}
              {conflict.kind === "quantity" ? " — typed by hand" : ""}
            </p>
          </div>
          <div className="rounded-md border border-hairline bg-surface px-3 py-2">
            <p className="eyebrow">From the takeoff</p>
            <p className="mt-1 font-medium">
              {formatQty(conflict.incomingQuantity, conflict.takeoffUnit || conflict.lineUnit)}{" "}
              <span className="text-xs font-normal text-muted-foreground">
                ({conflict.measurementCount} takeoff
                {conflict.measurementCount === 1 ? "" : "s"}, waste applied)
              </span>
            </p>
            {conflict.sources.slice(0, 4).map((source, index) => (
              <p key={index} className="text-xs text-muted-foreground">
                Sheet {source.sheetNumber || "?"} · {source.label} ·{" "}
                {formatQty(source.quantity, source.unit)}
                {source.wastePct > 0 ? ` · waste ${source.wastePct}%` : ""}
              </p>
            ))}
            {conflict.sources.length > 4 && (
              <p className="text-xs text-muted-foreground">
                +{conflict.sources.length - 4} more takeoffs
              </p>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
          <Button
            variant={isUnit ? "destructive" : "default"}
            onClick={() => onConfirm(conflict)}
            disabled={pending}
            data-testid="sync-conflict-confirm"
          >
            {isUnit ? "Sync Anyway — Units Differ" : "Replace Quantity"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TakeoffWorksheet({
  expanded = false,
  measurements,
  totalMeasured,
  copyTakeoffSummary,
  downloadTakeoffCsv,
  takeoffSummaryFallback,
  takeoffSearch,
  setTakeoffSearch,
  takeoffFilter,
  setTakeoffFilter,
  sheetMeasurements,
  linkedCount,
  visibleMeasurements,
  lineItems,
  sheets,
  selectedMeasurementId,
  selectMeasurement,
  deleteMeasurementMutation,
  updateMeasurementMutation,
  syncLineMutation,
  lineTotals,
  linkMeasurement,
  classifyMeasurement,
  linkMeasurements,
  classifyMeasurements,
  detachMeasurement,
  classifyPending = false,
  onBuildFromTakeoffs,
  buildPending = false,
  onReviewMatches,
  matchCount = 0,
}: {
  expanded?: boolean;
  measurements: TakeoffMeasurementRow[];
  totalMeasured: number;
  copyTakeoffSummary: () => void;
  downloadTakeoffCsv: () => void;
  takeoffSummaryFallback: string;
  takeoffSearch: string;
  setTakeoffSearch: (value: string) => void;
  takeoffFilter: TakeoffFilterMode;
  setTakeoffFilter: (mode: TakeoffFilterMode) => void;
  sheetMeasurements: TakeoffMeasurementRow[];
  linkedCount: number;
  visibleMeasurements: TakeoffMeasurementRow[];
  lineItems: EstimateLineItemRow[];
  sheets: PlanSheetRow[];
  selectedMeasurementId: string;
  selectMeasurement: (measurement: TakeoffMeasurementRow) => void;
  deleteMeasurementMutation: { mutate: (id: string) => void };
  updateMeasurementMutation: {
    mutate: (variables: { id: string; patch: { estimate_line_item_id: string | null } }) => void;
  };
  syncLineMutation: { mutate: (variables: { lineId: string }) => void };
  lineTotals: Map<string, { quantity: number; count: number; untrustedCount: number }>;
  linkMeasurement: (measurementId: string, lineId: string) => void;
  classifyMeasurement: (
    measurementId: string,
    source:
      | { type: "library"; library_item_id: string }
      | { type: "label"; description: string; unit: string },
  ) => void;
  // Group-card actions (beta batch 2): one answer classifies or links every
  // member; detach clears the link on a single member only.
  linkMeasurements: (measurementIds: string[], lineId: string) => void;
  classifyMeasurements: (
    measurementIds: string[],
    source:
      | { type: "library"; library_item_id: string }
      | { type: "label"; description: string; unit: string },
  ) => void;
  detachMeasurement: (measurementId: string) => void;
  classifyPending?: boolean;
  onBuildFromTakeoffs?: () => void;
  buildPending?: boolean;
  onReviewMatches?: () => void;
  matchCount?: number;
}) {
  const [expandedGroups, setExpandedGroups] = useState<string[]>([]);
  // Per-session worksheet color filter — the all-my-red-is-demo scan.
  const [hiddenCardColors, setHiddenCardColors] = useState<string[]>([]);

  // One card per (normalized label, unit) group; singletons render exactly as
  // before. Grouping is the same pure function Build Estimate from Takeoffs
  // normalizes with, so the two can never disagree.
  const groups = groupTakeoffWorksheet(visibleMeasurements);
  const worksheetColors = Array.from(new Set(measurements.map((item) => item.color)));
  const displayGroups =
    hiddenCardColors.length > 0
      ? groups.filter((group) => !hiddenCardColors.includes(group.color))
      : groups;

  const toggleGroupExpanded = (key: string) =>
    setExpandedGroups((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );

  const renderGroupCard = (group: TakeoffWorksheetGroup<TakeoffMeasurementRow>) => (
    <TakeoffGroupCard
      key={group.key}
      group={group}
      lineItems={lineItems}
      sheets={sheets}
      selectedMeasurementId={selectedMeasurementId}
      expanded={expandedGroups.includes(group.key)}
      workspaceExpanded={expanded}
      onToggleExpanded={() => toggleGroupExpanded(group.key)}
      selectMeasurement={selectMeasurement}
      deleteMeasurement={(measurementId) => deleteMeasurementMutation.mutate(measurementId)}
      detachMeasurement={detachMeasurement}
      linkMeasurements={linkMeasurements}
      classifyMeasurements={classifyMeasurements}
      syncLine={(lineId) => syncLineMutation.mutate({ lineId })}
      linkedLineUntrustedCount={
        group.linkedLineId ? (lineTotals.get(group.linkedLineId)?.untrustedCount ?? 0) : 0
      }
      classifyPending={classifyPending}
    />
  );

  return (
    <div
      className={cn(
        expanded
          ? "grid w-full gap-4 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,0.65fr)]"
          : "space-y-4",
      )}
      data-testid="takeoff-worksheet-layout"
      data-layout={expanded ? "expanded" : "panel"}
    >
      <section
        className={cn(
          "rounded-lg border border-hairline bg-card shadow-card",
          expanded && "overflow-visible",
        )}
      >
        <div className="border-b border-hairline bg-surface px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="font-serif text-xl">Takeoff Worksheet</h2>
              <p className="text-xs text-muted-foreground">
                {measurements.length} takeoffs. Total measured quantity:{" "}
                {new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(
                  totalMeasured,
                )}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2" data-testid="takeoff-report-actions">
              {onBuildFromTakeoffs && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 px-2 text-xs"
                  onClick={onBuildFromTakeoffs}
                  disabled={buildPending}
                  title="Group unlinked takeoffs into new estimate rows, then confirm"
                  data-testid="build-from-takeoffs"
                >
                  <Rows3 className="h-3.5 w-3.5" />
                  Build Estimate From Takeoffs
                </Button>
              )}
              {onReviewMatches && matchCount > 0 && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="h-8 gap-1.5 px-2 text-xs"
                  onClick={onReviewMatches}
                  title="Review suggested takeoff-to-row matches"
                  data-testid="review-takeoff-matches"
                >
                  <Link2 className="h-3.5 w-3.5" />
                  Match to Rows ({matchCount})
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 px-2 text-xs"
                onClick={copyTakeoffSummary}
                disabled={measurements.length === 0}
                data-testid="takeoff-copy-summary"
              >
                <ClipboardList className="h-3.5 w-3.5" />
                Copy Summary
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-8 gap-1.5 px-2 text-xs"
                onClick={downloadTakeoffCsv}
                disabled={measurements.length === 0}
                data-testid="takeoff-export-csv"
              >
                <Download className="h-3.5 w-3.5" />
                Export CSV
              </Button>
            </div>
          </div>
          {takeoffSummaryFallback && (
            <div
              className="mt-3 rounded-md border border-hairline bg-card p-3"
              data-testid="takeoff-copy-fallback"
            >
              <p className="text-xs font-medium text-foreground">
                Copy was blocked by the browser. Select this summary instead.
              </p>
              <Textarea
                readOnly
                rows={6}
                value={takeoffSummaryFallback}
                className="mt-2 font-mono text-xs"
                aria-label="Takeoff summary text"
                onFocus={(event) => event.currentTarget.select()}
              />
            </div>
          )}
        </div>
        <div
          className={cn(
            "border-b border-hairline p-3",
            expanded &&
              "grid items-start gap-3 lg:grid-cols-[minmax(260px,0.8fr)_minmax(440px,1.2fr)]",
          )}
          data-testid="takeoff-navigator"
        >
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
            className={cn("grid grid-cols-2 gap-1.5 text-xs", expanded ? "sm:grid-cols-4" : "mt-2")}
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
          {worksheetColors.length > 1 && (
            <div
              className={cn(
                "flex flex-wrap items-center gap-1.5",
                expanded ? "lg:col-span-2" : "mt-2",
              )}
              data-testid="takeoff-worksheet-color-filter"
            >
              <span className="eyebrow">Colors</span>
              {worksheetColors.map((color) => {
                const hidden = hiddenCardColors.includes(color);
                return (
                  <button
                    key={color}
                    type="button"
                    className={cn(
                      "h-6 w-6 rounded border transition",
                      hidden ? "border-hairline opacity-25" : "border-foreground/40",
                    )}
                    style={{ backgroundColor: color }}
                    title={hidden ? "Show these cards" : "Hide these cards"}
                    aria-pressed={!hidden}
                    onClick={() =>
                      setHiddenCardColors((current) =>
                        hidden ? current.filter((item) => item !== color) : [...current, color],
                      )
                    }
                    data-testid="takeoff-worksheet-color-chip"
                  />
                );
              })}
              {hiddenCardColors.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs"
                  onClick={() => setHiddenCardColors([])}
                  data-testid="takeoff-worksheet-color-clear"
                >
                  Show all colors
                </Button>
              )}
            </div>
          )}
          <p className={cn("text-xs text-muted-foreground", expanded ? "lg:col-span-2" : "mt-2")}>
            Showing {visibleMeasurements.length} takeoffs in {displayGroups.length} card
            {displayGroups.length === 1 ? "" : "s"}.
            {" Selecting one opens its sheet and centers the markup."}
          </p>
        </div>
        <div
          className={cn(
            "p-3",
            expanded
              ? "grid auto-rows-min gap-3 xl:grid-cols-2 2xl:grid-cols-3"
              : "max-h-[520px] space-y-3 overflow-y-auto",
          )}
          data-testid="takeoff-workspace-records"
        >
          {measurements.length === 0 ? (
            <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
              No takeoffs yet. Choose a tool, click the plan, and link the result to an estimate
              row.
            </div>
          ) : visibleMeasurements.length === 0 ? (
            <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
              No takeoffs match that navigator view. Clear the search or choose another filter.
            </div>
          ) : displayGroups.length === 0 ? (
            <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
              Every takeoff here is hidden by the color filter. Turn a color chip back on to see its
              cards.
            </div>
          ) : (
            displayGroups.map((group) => {
              if (group.members.length > 1) return renderGroupCard(group);
              const measurement = group.members[0];
              const linkedLine = lineItems.find(
                (line) => line.id === measurement.estimate_line_item_id,
              );
              const measurementSheet = sheets.find(
                (sheet) => sheet.id === measurement.plan_sheet_id,
              );
              const isSelected = measurement.id === selectedMeasurementId;
              const trustBlockReason = takeoffSyncBlockReason(measurement.calculation_status);
              const linkedLineUntrustedCount = linkedLine
                ? (lineTotals.get(linkedLine.id)?.untrustedCount ?? 0)
                : 0;
              return (
                <div
                  key={measurement.id}
                  data-testid="takeoff-navigator-row"
                  className={cn(
                    "rounded-md border border-hairline p-3 text-left transition",
                    isSelected && "border-primary bg-primary/5 shadow-sm",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: measurement.color }}
                        />
                        <p className="truncate text-sm font-medium">{measurement.label}</p>
                        {measurement.created_by_ai && (
                          <Badge
                            variant="outline"
                            className="shrink-0 gap-1 border-warning/30 bg-warning/10 text-[10px] text-warning"
                            title="Counted with AI Assist — every point was reviewed and accepted by hand."
                            data-testid="takeoff-ai-chip"
                          >
                            <Sparkles className="h-2.5 w-2.5" />
                            AI-assisted
                          </Badge>
                        )}
                        {trustBlockReason && (
                          <Badge
                            variant="outline"
                            className="shrink-0 gap-1 border-warning/40 bg-warning/10 text-[10px] text-warning"
                            title={trustBlockReason}
                            data-testid="takeoff-trust-chip"
                          >
                            <AlertTriangle className="h-2.5 w-2.5" />
                            {takeoffTrustLabel(measurement.calculation_status)}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {toolLabel(measurement.tool_type)} ·{" "}
                        {formatQty(measurement.quantity, measurement.unit)}
                      </p>
                      {measurementSheet && (
                        <p className="mt-1 truncate text-xs text-muted-foreground">
                          Source: {measurementSheet.sheet_number} · {measurementSheet.sheet_name}
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
                        onClick={() => selectMeasurement(measurement)}
                        data-testid="takeoff-open-on-plan"
                      >
                        Open
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 gap-1 px-2 text-xs"
                        title="Delete this takeoff"
                        onClick={() => deleteMeasurementMutation.mutate(measurement.id)}
                        data-testid="takeoff-row-delete"
                      >
                        <Trash2 className="h-3.5 w-3.5 text-danger" />
                        Delete
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    {linkedLine ? (
                      <div className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs">
                        <span className="min-w-0 truncate">
                          Linked: {linkedLine.cost_code ? `${linkedLine.cost_code} · ` : ""}
                          {linkedLine.description.slice(0, 50)} · per {linkedLine.unit}
                        </span>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="h-7 shrink-0 px-2 text-xs"
                          onClick={() => {
                            updateMeasurementMutation.mutate({
                              id: measurement.id,
                              patch: { estimate_line_item_id: null },
                            });
                          }}
                          data-testid="takeoff-row-unlink"
                        >
                          Unlink
                        </Button>
                      </div>
                    ) : (
                      // The same unified picker as the finish popover and the
                      // inspector — dismissing the popover always leaves this
                      // obvious second chance to classify.
                      <div className="space-y-1.5" data-testid="takeoff-row-classify">
                        <p className="text-xs font-medium">What is this measurement?</p>
                        <LinkOrCreatePicker
                          lineItems={lineItems}
                          takeoffUnit={measurement.unit}
                          onPickRow={(lineId) => linkMeasurement(measurement.id, lineId)}
                          onPickLibraryItem={(item) =>
                            classifyMeasurement(measurement.id, {
                              type: "library",
                              library_item_id: item.id,
                            })
                          }
                          onCreateFromLabel={(label) =>
                            classifyMeasurement(measurement.id, {
                              type: "label",
                              description: label,
                              unit: measurement.unit,
                            })
                          }
                          pending={classifyPending}
                          compact
                          workspaceExpanded={expanded}
                        />
                      </div>
                    )}
                    {linkedLine && !takeoffUnitsCompatible(measurement.unit, linkedLine.unit) && (
                      <p
                        className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-foreground"
                        data-testid="takeoff-unit-mismatch"
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                        <span>
                          This takeoff measures {unitLongName(measurement.unit)}, but the row is
                          priced per {unitLongName(linkedLine.unit)}. Sync will ask before mixing
                          them.
                        </span>
                      </p>
                    )}
                    {!trustBlockReason && linkedLineUntrustedCount > 0 && (
                      <p
                        className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-foreground"
                        data-testid="takeoff-row-linked-trust-warning"
                      >
                        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                        Another takeoff feeding this estimate row needs review before the row can
                        sync.
                      </p>
                    )}
                    {linkedLine ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5"
                        onClick={() => syncLineMutation.mutate({ lineId: linkedLine.id })}
                        disabled={linkedLineUntrustedCount > 0}
                        title={
                          linkedLineUntrustedCount > 0
                            ? `${linkedLineUntrustedCount} takeoff${linkedLineUntrustedCount === 1 ? "" : "s"} feeding this estimate row must be reviewed before sending.`
                            : "Send this takeoff total to the estimate."
                        }
                        data-testid="takeoff-row-sync"
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

      <section
        className={cn(
          "rounded-lg border border-hairline bg-card p-4 shadow-card",
          expanded && "self-start xl:sticky xl:top-28",
        )}
      >
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
                      {total?.count ?? 0} takeoffs · {formatQty(total?.quantity ?? 0, line.unit)}
                    </p>
                    {(total?.untrustedCount ?? 0) > 0 && (
                      <p className="mt-1 flex items-center gap-1 text-warning">
                        <AlertTriangle className="h-3 w-3" />
                        {total?.untrustedCount} to review before sync
                      </p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => syncLineMutation.mutate({ lineId: line.id })}
                    disabled={(total?.untrustedCount ?? 0) > 0}
                    title={
                      (total?.untrustedCount ?? 0) > 0
                        ? "Review every stale or unverified takeoff feeding this row before syncing."
                        : "Send this takeoff total to the estimate."
                    }
                    data-testid="takeoff-line-sync"
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
    </div>
  );
}
