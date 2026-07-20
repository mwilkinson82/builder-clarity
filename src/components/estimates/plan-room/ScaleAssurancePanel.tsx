import { Check, RotateCcw, Ruler, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type { PlanSheetRow } from "@/lib/plan-room.functions";
import {
  isCurrentScaleAssessment,
  SCALE_ASSURANCE_TOLERANCE_PCT,
  type ScaleAssessmentRow,
  type ScaleAssuranceCheckPreview,
} from "@/lib/plan-room-scale-assurance";
import { formatFeetInches } from "@/lib/plan-room-math";
import type { ToolMode } from "./planRoomShared";
import { FeetInchesHint } from "./TakeoffTools";

function varianceTone(variancePct: number) {
  return Math.abs(variancePct) <= SCALE_ASSURANCE_TOLERANCE_PCT ? "text-success" : "text-warning";
}

function checkCopy(check: ScaleAssuranceCheckPreview) {
  return `${formatFeetInches(check.labeled_distance_feet)} labeled · ${formatFeetInches(check.measured_distance_feet)} measured`;
}

export function ScaleAssurancePanel({
  sheet,
  latestAssessment,
  drafts,
  tool,
  selectedPointCount,
  verifyFeet,
  backendReady,
  scaleAssuranceReady,
  pending,
  onVerifyFeetChange,
  onStartCheck,
  onRecordCheck,
  onResetChecks,
}: {
  sheet: PlanSheetRow;
  latestAssessment: ScaleAssessmentRow | null;
  drafts: ScaleAssuranceCheckPreview[];
  tool: ToolMode;
  selectedPointCount: number;
  verifyFeet: string;
  backendReady: boolean;
  scaleAssuranceReady: boolean;
  pending: boolean;
  onVerifyFeetChange: (value: string) => void;
  onStartCheck: () => void;
  onRecordCheck: () => void;
  onResetChecks: () => void;
}) {
  const currentAssessment = isCurrentScaleAssessment(latestAssessment, sheet.scale_revision);
  const verified =
    Boolean(sheet.scale_verified_at) &&
    currentAssessment &&
    latestAssessment?.outcome === "verified";
  const conflicted = currentAssessment && latestAssessment?.outcome === "conflict";
  const nextCheckNumber = Math.min(drafts.length + 1, 2);
  const readyToRecord =
    backendReady &&
    scaleAssuranceReady &&
    !pending &&
    tool === "verify" &&
    selectedPointCount === 2 &&
    Boolean(verifyFeet.trim());

  return (
    <div className="space-y-3" data-testid="scale-assurance-panel">
      <Separator />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="eyebrow">Measurement evidence</div>
          <Label className="mt-1 block font-serif text-lg font-normal">Scale Assurance</Label>
        </div>
        {verified ? (
          <Badge variant="secondary" className="gap-1" data-testid="scale-assurance-status">
            <ShieldCheck className="h-3 w-3" /> Verified · 2 checks
          </Badge>
        ) : conflicted ? (
          <Badge
            variant="outline"
            className="gap-1 text-warning"
            data-testid="scale-assurance-status"
          >
            <TriangleAlert className="h-3 w-3" /> Conflict
          </Badge>
        ) : (
          <Badge variant="outline" data-testid="scale-assurance-status">
            {drafts.length}/2 checks
          </Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Check two different labeled dimensions. Overwatch calculates the variance from the saved
        sheet scale; neither check can declare itself correct.
      </p>

      {!scaleAssuranceReady && (
        <div
          className="rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-xs text-warning"
          data-testid="scale-assurance-migration-pending"
        >
          Scale Assurance is waiting for its Lovable database migration. Existing scale controls
          remain available, but verification is paused.
        </div>
      )}

      {drafts.length > 0 && (
        <div className="space-y-1.5" data-testid="scale-assurance-drafts">
          {drafts.map((check) => (
            <div
              key={check.check_number}
              className="flex items-start justify-between gap-3 rounded-md border border-hairline bg-surface px-3 py-2 text-xs"
            >
              <div>
                <span className="font-medium">Check {check.check_number}</span>
                <p className="mt-0.5 text-muted-foreground">{checkCopy(check)}</p>
              </div>
              <span className={varianceTone(check.variance_pct)}>
                {check.variance_pct >= 0 ? "+" : ""}
                {check.variance_pct.toFixed(2)}%
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-md border border-hairline bg-surface p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium">Check {nextCheckNumber} of 2</p>
            <p className="text-[11px] text-muted-foreground">
              {tool === "verify"
                ? `${selectedPointCount}/2 endpoints selected on the drawing.`
                : "Start the check, then click both ends of a printed dimension."}
            </p>
          </div>
          {tool !== "verify" && (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="gap-1.5"
              onClick={onStartCheck}
              disabled={!backendReady || !scaleAssuranceReady || pending}
              data-testid="scale-assurance-start"
            >
              <Ruler className="h-3.5 w-3.5" /> Start Check
            </Button>
          )}
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <Input
            value={verifyFeet}
            onChange={(event) => onVerifyFeetChange(event.target.value)}
            placeholder={`Labeled dimension, e.g. 12' 6"`}
            aria-label="Labeled dimension in feet and inches"
            data-testid="verify-scale-input"
          />
          <Button
            type="button"
            variant="outline"
            className="w-full gap-1.5 sm:w-auto"
            onClick={onRecordCheck}
            disabled={!readyToRecord}
            data-testid="verify-scale-check"
          >
            <Check className="h-3.5 w-3.5" />
            {drafts.length === 0 ? "Record Check 1" : "Record Check 2 & Verify"}
          </Button>
        </div>
        <FeetInchesHint value={verifyFeet} onAccept={onVerifyFeetChange} />
        <p className="mt-2 text-[11px] text-muted-foreground">
          Both checks and their implied scales must agree within {SCALE_ASSURANCE_TOLERANCE_PCT}%.
        </p>
      </div>

      {(drafts.length > 0 || tool === "verify") && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="gap-1.5"
          onClick={onResetChecks}
          disabled={pending}
          data-testid="scale-assurance-reset"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          {tool === "verify" && drafts.length === 0 ? "Cancel Check" : "Reset Checks"}
        </Button>
      )}

      {latestAssessment && drafts.length === 0 && (
        <div
          className="border-t border-hairline pt-2 text-[11px] text-muted-foreground"
          data-testid="scale-assurance-latest"
        >
          Latest review: {latestAssessment.outcome === "verified" ? "passed" : "conflict"} · max
          variance {latestAssessment.max_variance_pct.toFixed(2)}% · evidence spread{" "}
          {latestAssessment.scale_spread_pct.toFixed(2)}%
          {!currentAssessment ? " · stale after a scale change" : ""}
        </div>
      )}
    </div>
  );
}
