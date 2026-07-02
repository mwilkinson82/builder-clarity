import { ClipboardList, Download, Link2, Search, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { EstimateLineItemRow } from "@/lib/estimates.functions";
import type { PlanSheetRow, TakeoffMeasurementRow } from "@/lib/plan-room.functions";
import { formatQty, toolLabel, type TakeoffFilterMode } from "./planRoomShared";

export function TakeoffWorksheet({
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
}: {
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
  lineTotals: Map<string, { quantity: number; count: number }>;
}) {
  return (
    <>
      <section className="rounded-lg border border-hairline bg-card shadow-card">
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
        <div className="border-b border-hairline p-3" data-testid="takeoff-navigator">
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
            className="mt-2 grid grid-cols-2 gap-1.5 text-xs"
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
          <p className="mt-2 text-xs text-muted-foreground">
            Showing {visibleMeasurements.length} takeoffs. Selecting one opens its sheet and centers
            the markup.
          </p>
        </div>
        <div className="max-h-[520px] space-y-3 overflow-y-auto p-3">
          {measurements.length === 0 ? (
            <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
              No takeoffs yet. Choose a tool, click the plan, and link the result to an estimate
              row.
            </div>
          ) : visibleMeasurements.length === 0 ? (
            <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
              No takeoffs match that navigator view. Clear the search or choose another filter.
            </div>
          ) : (
            visibleMeasurements.map((measurement) => {
              const linkedLine = lineItems.find(
                (line) => line.id === measurement.estimate_line_item_id,
              );
              const measurementSheet = sheets.find(
                (sheet) => sheet.id === measurement.plan_sheet_id,
              );
              const isSelected = measurement.id === selectedMeasurementId;
              return (
                <div
                  key={measurement.id}
                  role="button"
                  tabIndex={0}
                  data-testid="takeoff-navigator-row"
                  className={cn(
                    "rounded-md border border-hairline p-3 text-left transition",
                    isSelected && "border-primary bg-primary/5 shadow-sm",
                  )}
                  onClick={(event) => {
                    const target = event.target as HTMLElement;
                    if (target.closest("button,[role='combobox'],input,textarea")) return;
                    selectMeasurement(measurement);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      selectMeasurement(measurement);
                    }
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 rounded-full"
                          style={{ backgroundColor: measurement.color }}
                        />
                        <p className="truncate text-sm font-medium">{measurement.label}</p>
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
                        onClick={(event) => {
                          event.stopPropagation();
                          selectMeasurement(measurement);
                        }}
                        data-testid="takeoff-open-on-plan"
                      >
                        Open
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title="Delete takeoff"
                        onClick={(event) => {
                          event.stopPropagation();
                          deleteMeasurementMutation.mutate(measurement.id);
                        }}
                      >
                        <Trash2 className="h-4 w-4 text-danger" />
                      </Button>
                    </div>
                  </div>
                  <div className="mt-3 space-y-2">
                    <Select
                      value={measurement.estimate_line_item_id ?? "unlinked"}
                      onValueChange={(lineId) =>
                        updateMeasurementMutation.mutate({
                          id: measurement.id,
                          patch: {
                            estimate_line_item_id: lineId === "unlinked" ? null : lineId,
                          },
                        })
                      }
                    >
                      <SelectTrigger>
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
                    {linkedLine ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="w-full gap-1.5"
                        onClick={() => syncLineMutation.mutate({ lineId: linkedLine.id })}
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

      <section className="rounded-lg border border-hairline bg-card p-4 shadow-card">
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
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => syncLineMutation.mutate({ lineId: line.id })}
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
    </>
  );
}
