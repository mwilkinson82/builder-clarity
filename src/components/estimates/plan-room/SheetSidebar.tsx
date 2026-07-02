import { useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { Image as ImageIcon, Map as MapIcon, Minimize2, Move, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { PlanSetRow, PlanSheetRow, TakeoffMeasurementRow } from "@/lib/plan-room.functions";
import {
  geometryPoints,
  planSetStatusLabel,
  type MiniMapDock,
  type MiniMapPosition,
  type Point,
  type SheetFilterMode,
  type ViewSize,
  type ViewportFrame,
} from "./planRoomShared";

export function CockpitFloatingPanelHeader({
  title,
  closeTestId,
  dragTestId,
  resetTestId,
  layoutLabel,
  onMoveStart,
  onMove,
  onMoveEnd,
  onReset,
  onClose,
}: {
  title: string;
  closeTestId: string;
  dragTestId: string;
  resetTestId: string;
  layoutLabel: string;
  onMoveStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onMoveEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  return (
    <div className="mb-2 flex items-center justify-between gap-3 rounded-md border border-hairline bg-card px-3 py-2 shadow-sm">
      <div
        className="flex min-w-0 flex-1 cursor-move touch-none items-center gap-2"
        title="Drag this panel anywhere in Command Center"
        onPointerDown={onMoveStart}
        onPointerMove={onMove}
        onPointerUp={onMoveEnd}
        onPointerCancel={onMoveEnd}
        data-testid={dragTestId}
      >
        <Move className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {title}
          </p>
          <p className="truncate text-[10px] text-muted-foreground">{layoutLabel}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-xs"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onReset}
          data-testid={resetTestId}
        >
          Reset
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1.5 px-2 text-xs"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          data-testid={closeTestId}
        >
          <Minimize2 className="h-3.5 w-3.5" />
          Hide
        </Button>
      </div>
    </div>
  );
}

export function SheetSidebar({
  sheets,
  planSets,
  sheetSearch,
  setSheetSearch,
  sheetFilter,
  setSheetFilter,
  measurementCountBySheet,
  filteredSheetCount,
  filteredSheetsByPlanSet,
  currentSheet,
  openSheet,
}: {
  sheets: PlanSheetRow[];
  planSets: PlanSetRow[];
  sheetSearch: string;
  setSheetSearch: (value: string) => void;
  sheetFilter: SheetFilterMode;
  setSheetFilter: (mode: SheetFilterMode) => void;
  measurementCountBySheet: Map<string, number>;
  filteredSheetCount: number;
  filteredSheetsByPlanSet: Map<string, PlanSheetRow[]>;
  currentSheet: PlanSheetRow | null;
  openSheet: (sheetId: string) => void;
}) {
  return (
    <section className="rounded-lg border border-hairline bg-card shadow-card">
      <div className="border-b border-hairline bg-surface px-4 py-3">
        <h2 className="font-serif text-xl">Drawing Sets</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Open a sheet, set scale, then take off quantities.
        </p>
      </div>
      <div className="border-b border-hairline p-3" data-testid="plan-sheet-finder">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={sheetSearch}
            onChange={(event) => setSheetSearch(event.target.value)}
            className="h-9 pl-8"
            placeholder="Find sheet, page, discipline, or set"
            data-testid="plan-sheet-search"
          />
        </div>
        <div
          className="mt-2 grid grid-cols-2 gap-1.5 text-xs"
          data-testid="plan-sheet-filter-controls"
        >
          {[
            { value: "all", label: `All ${sheets.length}`, testId: "plan-sheet-filter-all" },
            {
              value: "current",
              label: `Current ${sheets.filter((sheet) => planSets.find((set) => set.id === sheet.plan_set_id)?.status === "current").length}`,
              testId: "plan-sheet-filter-current",
            },
            {
              value: "needs-scale",
              label: `Needs scale ${sheets.filter((sheet) => !sheet.scale_feet_per_pixel).length}`,
              testId: "plan-sheet-filter-needs-scale",
            },
            {
              value: "has-takeoff",
              label: `Marked ${Array.from(measurementCountBySheet.values()).filter(Boolean).length}`,
              testId: "plan-sheet-filter-has-takeoff",
            },
          ].map((item) => (
            <Button
              key={item.value}
              type="button"
              size="sm"
              variant={sheetFilter === item.value ? "default" : "outline"}
              className="h-8 px-2 text-xs"
              onClick={() => {
                setSheetFilter(item.value as SheetFilterMode);
                setSheetSearch("");
              }}
              data-testid={item.testId}
            >
              {item.label}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Showing {filteredSheetCount} of {sheets.length} sheets.
        </p>
      </div>
      <div className="max-h-[680px] space-y-2 overflow-y-auto p-3">
        {sheets.length === 0 ? (
          <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
            Upload a PDF or image plan set to start measuring this estimate.
          </div>
        ) : filteredSheetCount === 0 ? (
          <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-4 text-sm text-muted-foreground">
            No sheets match that finder. Clear the search or switch filters.
          </div>
        ) : (
          planSets.map((planSet) => {
            const planSetSheets = filteredSheetsByPlanSet.get(planSet.id) ?? [];
            if (planSetSheets.length === 0) return null;
            return (
              <div key={planSet.id} className="rounded-md border border-hairline bg-background">
                <div className="border-b border-hairline px-3 py-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{planSet.name}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {planSetSheets.length}/{planSet.page_count} sheets shown
                      </p>
                    </div>
                    <Badge
                      variant={planSet.status === "current" ? "secondary" : "outline"}
                      className="shrink-0"
                    >
                      {planSetStatusLabel(planSet.status)}
                    </Badge>
                  </div>
                </div>
                <div className="p-1.5">
                  {planSetSheets.map((sheet) => {
                    const sheetMeasurementCount = measurementCountBySheet.get(sheet.id) ?? 0;
                    return (
                      <button
                        key={sheet.id}
                        type="button"
                        onClick={() => openSheet(sheet.id)}
                        data-testid="plan-sheet-row"
                        className={`flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition ${
                          sheet.id === currentSheet?.id
                            ? "bg-primary text-primary-foreground"
                            : "hover:bg-surface"
                        }`}
                      >
                        <ImageIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                        <span className="min-w-0">
                          <span className="block truncate font-medium">
                            {sheet.sheet_number || `Page ${sheet.page_number}`}
                          </span>
                          <span className="block truncate text-xs opacity-75">
                            {sheet.sheet_name || "Unnamed sheet"}
                          </span>
                          <span className="mt-1 flex flex-wrap gap-1">
                            {sheet.scale_feet_per_pixel ? (
                              <Badge variant="outline" className="bg-background/80 px-1 py-0">
                                Scale set
                              </Badge>
                            ) : (
                              <Badge variant="outline" className="bg-background/80 px-1 py-0">
                                Needs scale
                              </Badge>
                            )}
                            {sheetMeasurementCount > 0 && (
                              <Badge variant="outline" className="bg-background/80 px-1 py-0">
                                {sheetMeasurementCount} marks
                              </Badge>
                            )}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

export function PlanMiniMap({
  viewSize,
  measurements,
  viewportFrame,
  onJump,
  dock,
  onDockChange,
  position,
  onPositionChange,
  collapsed,
  onCollapsedChange,
}: {
  viewSize: ViewSize;
  measurements: TakeoffMeasurementRow[];
  viewportFrame: ViewportFrame;
  onJump: (point: Point) => void;
  dock: MiniMapDock;
  onDockChange: (dock: MiniMapDock) => void;
  position: MiniMapPosition | null;
  onPositionChange: (position: MiniMapPosition | null) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}) {
  const mapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{
    offsetX: number;
    offsetY: number;
    width: number;
    height: number;
  } | null>(null);
  const dockClass = {
    "bottom-left": "bottom-3 left-3",
    "bottom-right": "bottom-3 right-3",
    "top-left": "left-3 top-3",
    "top-right": "right-3 top-3",
  }[dock];
  const nextDock = {
    "bottom-left": "bottom-right",
    "bottom-right": "top-right",
    "top-right": "top-left",
    "top-left": "bottom-left",
  }[dock] as MiniMapDock;
  const jumpFromEvent = (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = mapRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    const point = {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
    onJump(point);
  };
  const positionStyle = position
    ? {
        left: `${position.x}px`,
        top: `${position.y}px`,
      }
    : undefined;
  const beginDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("button")) return;
    const panel = mapRef.current;
    const parent = panel?.offsetParent as HTMLElement | null;
    if (!panel || !parent) return;
    const panelRect = panel.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    dragRef.current = {
      offsetX: event.clientX - panelRect.left,
      offsetY: event.clientY - panelRect.top,
      width: panelRect.width,
      height: panelRect.height,
    };
    onPositionChange({
      x: Math.max(
        0,
        Math.min(parentRect.width - panelRect.width, panelRect.left - parentRect.left),
      ),
      y: Math.max(
        0,
        Math.min(parentRect.height - panelRect.height, panelRect.top - parentRect.top),
      ),
    });
    event.currentTarget.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const dragMap = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const parent = mapRef.current?.offsetParent as HTMLElement | null;
    if (!parent) return;
    const parentRect = parent.getBoundingClientRect();
    const maxX = Math.max(0, parentRect.width - dragRef.current.width);
    const maxY = Math.max(0, parentRect.height - dragRef.current.height);
    onPositionChange({
      x: Math.max(0, Math.min(maxX, event.clientX - parentRect.left - dragRef.current.offsetX)),
      y: Math.max(0, Math.min(maxY, event.clientY - parentRect.top - dragRef.current.offsetY)),
    });
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  if (collapsed) {
    return (
      <button
        type="button"
        className={cn(
          "absolute z-50 hidden items-center gap-2 rounded-md border border-hairline bg-card/95 px-3 py-2 text-xs font-medium text-card-foreground shadow-lg backdrop-blur sm:flex",
          position ? "" : dockClass,
        )}
        style={positionStyle}
        onClick={() => onCollapsedChange(false)}
        data-testid="plan-minimap-collapsed"
        title="Show sheet map"
        aria-label="Show sheet map"
      >
        <MapIcon className="h-3.5 w-3.5" />
        Show Map
        <Badge variant="outline" className="px-1.5 py-0 text-[10px]">
          {measurements.length}
        </Badge>
      </button>
    );
  }

  return (
    <div
      ref={mapRef}
      className={cn(
        "absolute z-50 hidden w-52 overflow-hidden rounded-md border border-hairline bg-card/95 text-card-foreground shadow-lg backdrop-blur sm:block",
        position ? "" : dockClass,
      )}
      style={positionStyle}
      data-testid="plan-minimap"
      title="Sheet map. Drag the header to move it, dock it in a corner, or hide it."
    >
      <div
        className="flex cursor-move touch-none items-center justify-between gap-2 border-b border-hairline bg-surface px-2 py-1.5"
        onPointerDown={beginDrag}
        onPointerMove={dragMap}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        data-testid="plan-minimap-drag-handle"
        title="Drag to move sheet map"
      >
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          <MapIcon className="h-3 w-3" />
          Sheet Map
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-[10px] tabular-nums text-muted-foreground">
            {measurements.length} marks
          </span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-6 px-1.5 text-[10px]"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onDockChange(nextDock);
            }}
            data-testid="plan-minimap-dock"
            title="Dock sheet map in another corner"
            aria-label="Dock sheet map in another corner"
          >
            Corner
          </Button>
          <span
            className="rounded px-1.5 py-1 text-[10px] font-medium text-muted-foreground"
            data-testid="plan-minimap-move"
            title="Drag the Sheet Map header to move it anywhere on the drawing"
          >
            Move
          </span>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onCollapsedChange(true);
            }}
            data-testid="plan-minimap-collapse"
            title="Hide sheet map"
            aria-label="Minimize sheet map"
          >
            <Minimize2 className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <div
        role="button"
        tabIndex={0}
        onPointerDown={jumpFromEvent}
        onPointerMove={(event) => {
          if (event.buttons === 1) jumpFromEvent(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onJump({ x: 0.5, y: 0.5 });
          }
        }}
        title="Click or drag to jump around the sheet"
      >
        <svg
          viewBox={`0 0 ${viewSize.width} ${viewSize.height}`}
          className="block aspect-[4/3] w-full bg-[#fffefa]"
          preserveAspectRatio="xMidYMid meet"
        >
          <rect
            x="0"
            y="0"
            width={viewSize.width}
            height={viewSize.height}
            fill="#fffefa"
            stroke="#ded6c8"
            strokeWidth="8"
          />
          {measurements.slice(0, 60).map((measurement) => (
            <MiniMapMeasurement
              key={measurement.id}
              measurement={measurement}
              viewSize={viewSize}
            />
          ))}
          <rect
            x={viewportFrame.x * viewSize.width}
            y={viewportFrame.y * viewSize.height}
            width={Math.max(18, viewportFrame.width * viewSize.width)}
            height={Math.max(18, viewportFrame.height * viewSize.height)}
            fill="#1b7a6e18"
            stroke="#1b7a6e"
            strokeWidth="10"
            data-testid="plan-minimap-frame"
          />
        </svg>
      </div>
    </div>
  );
}

function MiniMapMeasurement({
  measurement,
  viewSize,
}: {
  measurement: TakeoffMeasurementRow;
  viewSize: ViewSize;
}) {
  const points = geometryPoints(measurement.geometry).map((point) => ({
    x: point.x * viewSize.width,
    y: point.y * viewSize.height,
  }));
  if (points.length === 0) return null;
  const pointText = points.map((point) => `${point.x},${point.y}`).join(" ");

  if (measurement.tool_type === "count") {
    return points.map((point, index) => (
      <circle
        key={`${measurement.id}-${index}`}
        cx={point.x}
        cy={point.y}
        r="14"
        fill={measurement.color}
        opacity="0.7"
      />
    ));
  }

  if (measurement.tool_type === "area" && points.length >= 3) {
    return (
      <polygon
        points={pointText}
        fill={`${measurement.color}24`}
        stroke={measurement.color}
        strokeWidth="8"
      />
    );
  }

  return (
    <polyline
      points={pointText}
      fill="none"
      stroke={measurement.color}
      strokeWidth="10"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  );
}
