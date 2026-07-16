import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import type { RevisionOverlayMode } from "./planRoomShared";

export function PlanRevisionModeControls({
  mode,
  opacity,
  hasOverlay,
  onModeChange,
  onOpacityChange,
}: {
  mode: RevisionOverlayMode;
  opacity: number;
  hasOverlay: boolean;
  onModeChange: (mode: RevisionOverlayMode) => void;
  onOpacityChange: (opacity: number) => void;
}) {
  return (
    <>
      <div className="grid grid-cols-3 gap-2" data-testid="plan-revision-mode-controls">
        <Button
          type="button"
          size="sm"
          variant={mode === "redline" ? "default" : "outline"}
          onClick={() => onModeChange("redline")}
          disabled={!hasOverlay}
          data-testid="plan-revision-redline-mode"
        >
          Red / Green
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "compare" ? "default" : "outline"}
          onClick={() => onModeChange("compare")}
          disabled={!hasOverlay}
        >
          Compare
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "ghost" ? "default" : "outline"}
          onClick={() => onModeChange("ghost")}
          disabled={!hasOverlay}
        >
          Ghost
        </Button>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">Overlay opacity</Label>
          <span className="text-xs text-muted-foreground">{opacity}%</span>
        </div>
        <Slider
          min={20}
          max={90}
          step={5}
          value={[opacity]}
          onValueChange={(value) => onOpacityChange(value[0] ?? 65)}
          disabled={!hasOverlay || mode === "redline"}
          data-testid="plan-revision-opacity"
        />
        {mode === "redline" && hasOverlay && (
          <p className="text-[11px] text-muted-foreground">
            Red/green comparison uses full-strength layers so additions, removals, and unchanged
            overlap remain legible.
          </p>
        )}
      </div>
    </>
  );
}
