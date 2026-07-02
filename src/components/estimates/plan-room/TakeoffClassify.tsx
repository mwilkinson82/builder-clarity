import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Check, Library, Plus, Search, X } from "lucide-react";
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
import { formatQty, unitLongName } from "./planRoomShared";

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
}: {
  lineItems: EstimateLineItemRow[];
  takeoffUnit: string;
  defaultQuery?: string;
  onPickRow: (lineId: string) => void;
  onPickLibraryItem: (item: CostLibraryItemRow) => void;
  onCreateFromLabel: (label: string) => void;
  pending?: boolean;
  compact?: boolean;
}) {
  const searchLibraryFn = useServerFn(searchCostLibrary);
  const [query, setQuery] = useState(defaultQuery);
  const [debouncedQuery, setDebouncedQuery] = useState(defaultQuery);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const libraryQuery = useQuery({
    queryKey: ["classify-library-search", debouncedQuery],
    queryFn: () => searchLibraryFn({ data: { query: debouncedQuery, limit: compact ? 4 : 8 } }),
    enabled: debouncedQuery.trim().length >= 2,
  });

  const normalizedQuery = query.trim().toLowerCase();
  const matchingRows = lineItems
    .filter((line) => {
      if (!normalizedQuery) return true;
      return [line.cost_code, line.description, line.scope_group, line.unit]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    })
    .slice(0, compact ? 4 : 8);
  const libraryItems = libraryQuery.data?.items ?? [];

  return (
    <div className="space-y-2" data-testid="link-or-create-picker">
      <div className="relative">
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
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {matchingRows.length > 0 && (
          <>
            <p className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Estimate rows
            </p>
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
            <p className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Cost library
            </p>
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

// The takeoff comes to you: after finishing any takeoff, this compact card
// appears near the final markup point. Measuring never blocks — starting the
// next takeoff dismisses it, and Esc keeps the takeoff, dropping only the
// popover.
export function TakeoffFinishPopover({
  measurement,
  lineItems,
  linkedLine,
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
      className="w-80 rounded-lg border border-hairline bg-card p-3 shadow-2xl"
      data-testid="takeoff-finish-popover"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onDismiss();
        }
      }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {formatQty(measurement.quantity, measurement.unit)} measured
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
      <div className="mt-2 grid grid-cols-[1fr_88px] gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Label</Label>
          <Input
            ref={labelRef}
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="h-8 text-sm"
            data-testid="takeoff-popover-label"
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                commitDetails();
                pickerRef.current?.querySelector("input")?.focus();
              }
            }}
          />
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
      <div className="mt-2" ref={pickerRef}>
        <LinkOrCreatePicker
          lineItems={lineItems}
          takeoffUnit={measurement.unit}
          defaultQuery=""
          onPickRow={onPickRow}
          onPickLibraryItem={onPickLibraryItem}
          onCreateFromLabel={onCreateFromLabel}
          pending={pending}
          compact
        />
      </div>
      <Button
        type="button"
        size="sm"
        className="mt-2 w-full"
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
