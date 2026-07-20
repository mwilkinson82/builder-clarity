import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check, Library, Plus, Search, Unlink, Users, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { takeoffUnitsCompatible } from "@/lib/plan-room-math";
import {
  searchCostLibrary,
  type CostLibraryItemRow,
  type EstimateLineItemRow,
} from "@/lib/estimates.functions";
import type { TakeoffMeasurementRow } from "@/lib/plan-room.functions";
import { formatTakeoffDisplayQuantity, unitLongName } from "./planRoomShared";

// One searchable picker, three answers to "what is this measurement?":
// an existing estimate row, a cost library item (creates a priced row), or a
// brand-new $0 "needs pricing" row from the typed text. An empty estimate
// simply has no first section — a blank estimate is a starting point, not a
// dead end.
export function LinkOrCreatePicker({
  lineItems,
  takeoffUnit,
  defaultQuery = "",
  onPickRow,
  onPickLibraryItem,
  onCreateFromLabel,
  pending = false,
  compact = false,
  fillHeight = false,
  workspaceExpanded = false,
  strictUnit = false,
}: {
  lineItems: EstimateLineItemRow[];
  takeoffUnit: string;
  defaultQuery?: string;
  onPickRow: (lineId: string) => void;
  onPickLibraryItem: (item: CostLibraryItemRow) => void;
  onCreateFromLabel: (label: string) => void;
  pending?: boolean;
  compact?: boolean;
  // Full-screen workspaces use their one viewport scroller. Do not add a
  // second height-limited results scroller inside a takeoff card.
  workspaceExpanded?: boolean;
  // Assembly outputs cannot use the takeoff sync override. Hide incompatible
  // destinations so one deterministic unit can never be relabeled as another.
  strictUnit?: boolean;
  // Fill the parent flex column: the results list takes the remaining height
  // and scrolls internally while the search input stays pinned.
  fillHeight?: boolean;
}) {
  const searchLibraryFn = useServerFn(searchCostLibrary);
  const [query, setQuery] = useState(defaultQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(defaultQuery);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const libraryQuery = useQuery({
    queryKey: ["classify-library-search", debouncedQuery, takeoffUnit, strictUnit, compact],
    queryFn: () =>
      searchLibraryFn({
        data: {
          query: debouncedQuery,
          unit: strictUnit ? takeoffUnit : "",
          limit: compact ? 4 : 8,
        },
      }),
    enabled: debouncedQuery.trim().length >= 2,
  });

  const normalizedQuery = query.trim().toLowerCase();
  const matchingRows = lineItems
    .filter((line) => {
      if (strictUnit && !takeoffUnitsCompatible(takeoffUnit, line.unit)) return false;
      if (!normalizedQuery) return true;
      return [line.cost_code, line.description, line.scope_group, line.unit]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .slice(0, compact ? 4 : 8);
  const libraryItems = (libraryQuery.data?.items ?? [])
    .filter((item) => !strictUnit || takeoffUnitsCompatible(takeoffUnit, item.unit))
    .slice(0, compact ? 4 : 8);

  return (
    <div
      className={fillHeight ? "flex min-h-0 flex-1 flex-col gap-2" : "space-y-2"}
      data-testid="link-or-create-picker"
    >
      <div className="relative shrink-0">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Estimate row, cost item, or new row name"
          className="h-8 pl-8 text-sm"
          aria-label="Link or create estimate row"
          data-testid="link-or-create-search"
        />
      </div>
      <div
        className={
          fillHeight
            ? "min-h-0 flex-1 space-y-1 overflow-y-auto"
            : workspaceExpanded
              ? "space-y-1"
              : "max-h-56 space-y-1 overflow-y-auto"
        }
      >
        {strictUnit && (
          <p className="px-1 text-[10px] text-muted-foreground">
            Only estimate rows and cost items priced per {takeoffUnit} are shown.
          </p>
        )}
        {matchingRows.length > 0 && (
          <>
            <p className="eyebrow px-1">Estimate rows</p>
            {matchingRows.map((line) => {
              const mismatch = !takeoffUnitsCompatible(takeoffUnit, line.unit);
              return (
                <button
                  key={line.id}
                  type="button"
                  className="flex w-full items-start gap-2 rounded-md border border-hairline px-2 py-1.5 text-left text-xs hover:bg-surface"
                  onClick={() => onPickRow(line.id)}
                  disabled={pending}
                  data-testid="picker-row-option"
                >
                  <Check className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {line.cost_code ? `${line.cost_code} · ` : ""}
                      {line.description}
                    </span>
                    <span className="text-muted-foreground">per {line.unit}</span>
                    {mismatch && (
                      <span className="mt-0.5 flex items-center gap-1 text-warning">
                        <AlertTriangle className="h-3 w-3" />
                        Measures {unitLongName(takeoffUnit)}; sync will ask first
                      </span>
                    )}
                  </span>
                </button>
              );
            })}
          </>
        )}
        {libraryItems.length > 0 && (
          <>
            <p className="eyebrow px-1 pt-1">Cost library</p>
            {libraryItems.map((item) => (
              <button
                key={item.id}
                type="button"
                className="flex w-full items-start gap-2 rounded-md border border-hairline px-2 py-1.5 text-left text-xs hover:bg-surface"
                onClick={() => onPickLibraryItem(item)}
                disabled={pending}
                data-testid="picker-library-option"
              >
                <Library className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{item.description}</span>
                  <span className="text-muted-foreground">
                    per {item.unit} · creates a priced row
                  </span>
                </span>
              </button>
            ))}
          </>
        )}
        {query.trim().length > 0 && (
          <button
            type="button"
            className="flex w-full items-start gap-2 rounded-md border border-dashed border-hairline px-2 py-1.5 text-left text-xs hover:bg-surface"
            onClick={() => onCreateFromLabel(query.trim())}
            disabled={pending}
            data-testid="picker-create-option"
          >
            <Plus className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
            <span className="min-w-0">
              <span className="block truncate font-medium">
                Create “{query.trim()}” as a new row
              </span>
              <span className="text-muted-foreground">
                $0 pricing for now — label it, price it later
              </span>
            </span>
          </button>
        )}
        {matchingRows.length === 0 && libraryItems.length === 0 && !query.trim() && (
          <p className="px-1 py-2 text-xs text-muted-foreground">
            Type to search estimate rows and your cost library, or to name a new row.
          </p>
        )}
      </div>
    </div>
  );
}

// Group recognition at the finish popover (beta batch 2): when this
// measurement's label matches an existing group with a compatible unit, the
// popover says so and the link was inherited automatically. A same-label
// group with a different unit warns and stays separate.
export type TakeoffPopoverGroupState = {
  kind: "joined" | "unit-mismatch";
  label: string;
  // Both counts INCLUDE this measurement.
  memberCount: number;
  measuredTotal: number;
  unit: string;
  // The unit the existing same-name group measures, for the mismatch copy.
  otherUnit?: string;
};

// The takeoff comes to you: after finishing any takeoff, this compact card
// appears near the final markup point. Measuring never blocks — starting the
// next takeoff dismisses it, and Esc keeps the takeoff, dropping only the
// popover.
export function TakeoffFinishPopover({
  measurement,
  lineItems,
  linkedLine,
  groupState = null,
  groupLabelSuggestions = [],
  onDetach,
  onSaveDetails,
  onPickRow,
  onPickLibraryItem,
  onCreateFromLabel,
  onDismiss,
  pending = false,
}: {
  measurement: TakeoffMeasurementRow;
  lineItems: EstimateLineItemRow[];
  linkedLine: EstimateLineItemRow | null;
  groupState?: TakeoffPopoverGroupState | null;
  // Existing group labels, offered while typing so joining a group is the
  // default gesture and a typo doesn't fork a new group.
  groupLabelSuggestions?: string[];
  // Detach for the intentional same-name-different-thing case: clears the
  // inherited link on this measurement only.
  onDetach?: (() => void) | null;
  onSaveDetails: (details: { label: string; wastePct: number }) => void;
  onPickRow: (lineId: string) => void;
  onPickLibraryItem: (item: CostLibraryItemRow) => void;
  onCreateFromLabel: (label: string) => void;
  onDismiss: () => void;
  pending?: boolean;
}) {
  const [label, setLabel] = useState(measurement.label);
  const [waste, setWaste] = useState(String(measurement.waste_pct || 0));
  const labelRef = useRef<HTMLInputElement | null>(null);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    labelRef.current?.focus();
    labelRef.current?.select();
  }, []);

  const commitDetails = () => {
    const wastePct = Math.max(0, Math.round(Number(waste) || 0));
    onSaveDetails({ label: label.trim() || measurement.label, wastePct });
  };

  return (
    <div
      className="flex max-h-[60vh] w-80 flex-col rounded-lg border border-hairline bg-card p-3 shadow-2xl"
      data-testid="takeoff-finish-popover"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onDismiss();
        }
      }}
    >
      <div className="flex shrink-0 items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {formatTakeoffDisplayQuantity(
              measurement.quantity,
              measurement.unit,
              measurement.tool_type,
            )}{" "}
            measured
          </p>
          <p className="text-xs text-muted-foreground">
            {linkedLine
              ? `Linked to ${linkedLine.description.slice(0, 40)}`
              : "What is this measurement?"}
          </p>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 shrink-0"
          title="Close (keeps the takeoff)"
          aria-label="Close (keeps the takeoff)"
          onClick={onDismiss}
          data-testid="takeoff-popover-close"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {groupState?.kind === "joined" && (
        <div
          className="mt-2 shrink-0 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-2 text-xs"
          data-testid="takeoff-popover-group"
        >
          <p className="flex items-center gap-1.5 font-medium">
            <Users className="h-3.5 w-3.5 shrink-0 text-primary" />
            <span className="min-w-0 truncate">
              Added to <strong>{groupState.label}</strong>
            </span>
          </p>
          <p className="mt-0.5 text-muted-foreground">
            {groupState.memberCount} takeoffs ·{" "}
            {formatTakeoffDisplayQuantity(
              groupState.measuredTotal,
              groupState.unit,
              measurement.tool_type,
            )}{" "}
            total
          </p>
          {onDetach && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="mt-1 h-7 gap-1.5 px-2 text-xs"
              title="Same name, different thing? Detach clears the inherited link on this takeoff only."
              onClick={onDetach}
              disabled={pending}
              data-testid="takeoff-popover-detach"
            >
              <Unlink className="h-3 w-3" />
              Detach from group
            </Button>
          )}
        </div>
      )}
      {groupState?.kind === "unit-mismatch" && (
        <p
          className="mt-2 flex shrink-0 items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2.5 py-2 text-xs"
          data-testid="takeoff-popover-group-mismatch"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <span>
            “{groupState.label}” already measures{" "}
            {unitLongName(groupState.otherUnit ?? groupState.unit)}; this one measures{" "}
            {unitLongName(measurement.unit)}, so it stays its own group. Sync will ask before mixing
            units.
          </span>
        </p>
      )}
      <div className="mt-2 grid shrink-0 grid-cols-[1fr_88px] gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Label</Label>
          <Input
            ref={labelRef}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="h-8 text-sm"
            list={`takeoff-group-labels-${measurement.id}`}
            data-testid="takeoff-popover-label"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitDetails();
                pickerRef.current?.querySelector("input")?.focus();
              }
            }}
          />
          <datalist id={`takeoff-group-labels-${measurement.id}`}>
            {groupLabelSuggestions.map((suggestion) => (
              <option key={suggestion} value={suggestion} />
            ))}
          </datalist>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Waste %</Label>
          <Input
            value={waste}
            onChange={(event) => setWaste(event.target.value)}
            className="h-8 text-sm"
            inputMode="numeric"
            data-testid="takeoff-popover-waste"
          />
        </div>
      </div>
      <div className="mt-2 flex min-h-0 flex-1 flex-col" ref={pickerRef}>
        <LinkOrCreatePicker
          lineItems={lineItems}
          takeoffUnit={measurement.unit}
          defaultQuery=""
          onPickRow={onPickRow}
          onPickLibraryItem={onPickLibraryItem}
          onCreateFromLabel={onCreateFromLabel}
          pending={pending}
          compact
          fillHeight
        />
      </div>
      <Button
        type="button"
        size="sm"
        className="mt-2 w-full shrink-0"
        onClick={() => {
          commitDetails();
          onDismiss();
        }}
        disabled={pending}
        data-testid="takeoff-popover-done"
      >
        Done
      </Button>
    </div>
  );
}
