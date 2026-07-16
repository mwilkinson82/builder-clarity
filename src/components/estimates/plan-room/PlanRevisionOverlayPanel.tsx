import { Layers } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { PlanRevisionMatchRow } from "@/lib/plan-revision-match.functions";
import type { RevisionScopeAssistantResult } from "@/lib/plan-revision-scope-assistant";
import type { PlanSetRow, PlanSheetRow } from "@/lib/plan-room.functions";
import { planSetStatusLabel, sheetDisplayName, type RevisionOverlayMode } from "./planRoomShared";
import { PlanRevisionModeControls } from "./PlanRevisionModeControls";
import { PlanRevisionReviewPanel } from "./PlanRevisionReviewPanel";

export function PlanRevisionOverlayPanel({
  estimateId,
  currentPlanSet,
  currentSheet,
  planSets,
  sheets,
  processingIdentity,
  overlaySheetId,
  overlaySheet,
  overlayPlanSet,
  overlayMode,
  overlayOpacity,
  revisionSheetOptions,
  onOverlaySheetChange,
  onOverlayModeChange,
  onOverlayOpacityChange,
  onReviewRevisionNotes,
}: {
  estimateId: string;
  currentPlanSet: PlanSetRow | null;
  currentSheet: PlanSheetRow | null;
  planSets: PlanSetRow[];
  sheets: PlanSheetRow[];
  processingIdentity: boolean;
  overlaySheetId: string;
  overlaySheet: PlanSheetRow | null;
  overlayPlanSet: PlanSetRow | null;
  overlayMode: RevisionOverlayMode;
  overlayOpacity: number;
  revisionSheetOptions: Array<{ sheet: PlanSheetRow; planSet: PlanSetRow }>;
  onOverlaySheetChange: (sheetId: string) => void;
  onOverlayModeChange: (mode: RevisionOverlayMode) => void;
  onOverlayOpacityChange: (opacity: number) => void;
  onReviewRevisionNotes: (match: PlanRevisionMatchRow) => Promise<RevisionScopeAssistantResult>;
}) {
  return (
    <section className="rounded-lg border border-hairline bg-card p-4 shadow-card">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Layers className="h-4 w-4" /> Revision Overlay
      </div>
      <p className="mt-1 text-xs text-muted-foreground">
        Pair a revised sheet with its prior version, then review new work in green, prior or removed
        work in red, and unchanged linework in dark overlap.
      </p>
      <div className="mt-3 space-y-3">
        <PlanRevisionReviewPanel
          estimateId={estimateId}
          currentPlanSet={currentPlanSet}
          currentSheet={currentSheet}
          planSets={planSets}
          sheets={sheets}
          processingIdentity={processingIdentity}
          onUseOverlay={onOverlaySheetChange}
          onReviewRevisionNotes={onReviewRevisionNotes}
        />

        <Select
          value={overlaySheetId || "none"}
          onValueChange={(value) => onOverlaySheetChange(value === "none" ? "" : value)}
        >
          <SelectTrigger data-testid="plan-revision-overlay-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">No overlay</SelectItem>
            {revisionSheetOptions.map(({ sheet, planSet }) => (
              <SelectItem key={sheet.id} value={sheet.id}>
                {sheetDisplayName(sheet, planSet).slice(0, 90)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {overlaySheet && overlayPlanSet ? (
          <div className="rounded-md border border-hairline bg-surface p-3 text-xs">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {sheetDisplayName(overlaySheet, overlayPlanSet)}
                </p>
                <p className="mt-1 text-muted-foreground">
                  {overlayMode === "redline"
                    ? "Redline comparison active: green is current, red is prior."
                    : `Showing at ${overlayOpacity}% opacity.`}
                </p>
              </div>
              <Badge variant="outline">{planSetStatusLabel(overlayPlanSet.status)}</Badge>
            </div>
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-hairline bg-surface/50 p-3 text-xs text-muted-foreground">
            Upload a revision set, then choose the matching sheet here to compare changes.
          </div>
        )}

        <PlanRevisionModeControls
          mode={overlayMode}
          opacity={overlayOpacity}
          hasOverlay={Boolean(overlaySheet)}
          onModeChange={onOverlayModeChange}
          onOpacityChange={onOverlayOpacityChange}
        />
      </div>
    </section>
  );
}
