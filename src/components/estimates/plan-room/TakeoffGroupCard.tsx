import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Link2,
  Sparkles,
  Trash2,
  Unlink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { takeoffUnitsCompatible, type TakeoffWorksheetGroup } from "@/lib/plan-room-math";
import type { EstimateLineItemRow } from "@/lib/estimates.functions";
import type { PlanSheetRow, TakeoffMeasurementRow } from "@/lib/plan-room.functions";
import { formatQty, unitLongName } from "./planRoomShared";
import { LinkOrCreatePicker } from "./TakeoffClassify";

// One worksheet card per takeoff group (beta batch 2): rollup quantity,
// member count, source sheets, ONE link-or-create control that answers for
// every member, and an expander for per-member open/detach/delete. Contractors
// measure one quantity in pieces — the card is the quantity, the members are
// the pieces.
export function TakeoffGroupCard({
  group,
  lineItems,
  sheets,
  selectedMeasurementId,
  expanded,
  onToggleExpanded,
  selectMeasurement,
  deleteMeasurement,
  detachMeasurement,
  linkMeasurements,
  classifyMeasurements,
  syncLine,
  classifyPending = false,
}: {
  group: TakeoffWorksheetGroup<TakeoffMeasurementRow>;
  lineItems: EstimateLineItemRow[];
  sheets: PlanSheetRow[];
  selectedMeasurementId: string;
  expanded: boolean;
  onToggleExpanded: () => void;
  selectMeasurement: (measurement: TakeoffMeasurementRow) => void;
  deleteMeasurement: (measurementId: string) => void;
  detachMeasurement: (measurementId: string) => void;
  linkMeasurements: (measurementIds: string[], lineId: string) => void;
  classifyMeasurements: (
    measurementIds: string[],
    source:
      | { type: "library"; library_item_id: string }
      | { type: "label"; description: string; unit: string },
  ) => void;
  syncLine: (lineId: string) => void;
  classifyPending?: boolean;
}) {
  const linkedLine = group.linkedLineId
    ? (lineItems.find((line) => line.id === group.linkedLineId) ?? null)
    : null;
  const isSelected = group.members.some((member) => member.id === selectedMeasurementId);
  const sheetLabels = group.sheetIds
    .map((sheetId) => sheets.find((sheet) => sheet.id === sheetId)?.sheet_number || "?")
    .join(", ");
  const showWasteRollup = Math.abs(group.rollupQuantity - group.measuredQuantity) > 0.0001;
  const memberIds = group.members.map((member) => member.id);
  const untrustedCount = group.members.filter(
    (member) => member.calculation_status !== "current",
  ).length;
  return (
    <div
      role="button"
      tabIndex={0}
      data-testid="takeoff-group-card"
      className={cn(
        "rounded-md border border-hairline p-3 text-left transition",
        isSelected && "border-primary bg-primary/5 shadow-sm",
      )}
      onClick={(event) => {
        const target = event.target as HTMLElement;
        if (target.closest("button,[role='combobox'],input,textarea")) return;
        selectMeasurement(group.members[0]);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          selectMeasurement(group.members[0]);
        }
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span
              className="h-3 w-3 shrink-0 rounded-sm border border-black/15"
              style={{ backgroundColor: group.color }}
              data-testid="takeoff-group-swatch"
            />
            <p className="truncate text-sm font-medium">{group.label}</p>
            {group.members.some((member) => member.created_by_ai) && (
              <Badge
                variant="outline"
                className="shrink-0 gap-1 border-warning/30 bg-warning/10 text-[10px] text-warning"
                title="Part of this group was counted with AI Assist — every point was reviewed and accepted by hand."
                data-testid="takeoff-ai-chip"
              >
                <Sparkles className="h-2.5 w-2.5" />
                AI-assisted
              </Badge>
            )}
            {untrustedCount > 0 && (
              <Badge
                variant="outline"
                className="shrink-0 gap-1 border-warning/40 bg-warning/10 text-[10px] text-warning"
                title="This group contains quantities that must be reviewed before estimate sync."
                data-testid="takeoff-trust-chip"
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                {untrustedCount} to review
              </Badge>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {group.members.length} takeoffs · {formatQty(group.measuredQuantity, group.unit)} total
            {showWasteRollup ? ` · ${formatQty(group.rollupQuantity, group.unit)} with waste` : ""}
          </p>
          <p className="mt-1 truncate text-xs text-muted-foreground">
            {group.sheetIds.length === 1 ? "Sheet" : "Sheets"}: {sheetLabels}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 gap-1 px-2 text-xs"
          title={expanded ? "Hide the individual takeoffs" : "Show the individual takeoffs"}
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpanded();
          }}
          data-testid="takeoff-group-expand"
        >
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
          {group.members.length}
        </Button>
      </div>
      {expanded && (
        <div className="mt-2 space-y-1.5" data-testid="takeoff-group-members">
          {group.members.map((member) => {
            const memberSheet = sheets.find((sheet) => sheet.id === member.plan_sheet_id);
            return (
              <div
                key={member.id}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface/60 px-2 py-1.5 text-xs",
                  member.id === selectedMeasurementId && "border-primary",
                )}
                data-testid="takeoff-group-member"
              >
                <span className="flex min-w-0 items-center gap-1.5">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: member.color }}
                  />
                  <span className="min-w-0 truncate">
                    {formatQty(member.quantity, member.unit)}
                    {memberSheet ? ` · ${memberSheet.sheet_number}` : ""}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    title="Open this takeoff on the drawing"
                    onClick={() => selectMeasurement(member)}
                    data-testid="takeoff-group-member-open"
                  >
                    Open
                  </Button>
                  {member.estimate_line_item_id && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs"
                      title="Same name, different thing? Detach clears the link on this takeoff only."
                      onClick={() => detachMeasurement(member.id)}
                      data-testid="takeoff-group-member-detach"
                    >
                      <Unlink className="h-3 w-3" />
                      Detach
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    title="Delete this takeoff"
                    onClick={() => deleteMeasurement(member.id)}
                    data-testid="takeoff-group-member-delete"
                  >
                    <Trash2 className="h-3 w-3 text-danger" />
                  </Button>
                </span>
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 space-y-2">
        {group.mixedLinks ? (
          <p
            className="rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs"
            data-testid="takeoff-group-mixed-links"
          >
            These takeoffs link to different estimate rows — expand the group to review each one.
          </p>
        ) : linkedLine ? (
          <>
            <div className="flex items-center justify-between gap-2 rounded-md border border-hairline bg-surface px-2 py-1.5 text-xs">
              <span className="min-w-0 truncate">
                Linked: {linkedLine.cost_code ? `${linkedLine.cost_code} · ` : ""}
                {linkedLine.description.slice(0, 50)} · per {linkedLine.unit}
              </span>
            </div>
            {!takeoffUnitsCompatible(group.unit, linkedLine.unit) && (
              <p
                className="flex items-start gap-1.5 rounded-md border border-warning/40 bg-warning/10 px-2 py-1.5 text-xs text-foreground"
                data-testid="takeoff-group-unit-mismatch"
              >
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
                <span>
                  This group measures {unitLongName(group.unit)}, but the row is priced per{" "}
                  {unitLongName(linkedLine.unit)}. Sync will ask before mixing them.
                </span>
              </p>
            )}
            <Button
              size="sm"
              variant="outline"
              className="w-full gap-1.5"
              onClick={() => syncLine(linkedLine.id)}
              disabled={untrustedCount > 0}
              title={
                untrustedCount > 0
                  ? "Review stale or unverified quantities before sending this group."
                  : "Send this takeoff total to the estimate."
              }
            >
              <Link2 className="h-3.5 w-3.5" />
              Send Total Qty to Estimate
            </Button>
          </>
        ) : (
          <div className="space-y-1.5" data-testid="takeoff-group-classify">
            <p className="text-xs font-medium">
              One answer links all {group.members.length} takeoffs.
            </p>
            <LinkOrCreatePicker
              lineItems={lineItems}
              takeoffUnit={group.unit}
              defaultQuery={group.label}
              onPickRow={(lineId) => linkMeasurements(memberIds, lineId)}
              onPickLibraryItem={(item) =>
                classifyMeasurements(memberIds, { type: "library", library_item_id: item.id })
              }
              onCreateFromLabel={(label) =>
                classifyMeasurements(memberIds, {
                  type: "label",
                  description: label,
                  unit: group.unit,
                })
              }
              pending={classifyPending}
              compact
            />
          </div>
        )}
      </div>
    </div>
  );
}
