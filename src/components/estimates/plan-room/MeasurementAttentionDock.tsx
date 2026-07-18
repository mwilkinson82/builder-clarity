import { ChevronLeft, ChevronRight, Eye, EyeOff, Focus, ScanLine, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

export type MeasurementAttentionMode = "all" | "spotlight" | "hidden";

export function MeasurementAttentionDock({
  count,
  activeIndex,
  mode,
  opacity,
  onPrevious,
  onNext,
  onModeChange,
  onOpacityChange,
  onReplay,
}: {
  count: number;
  activeIndex: number;
  mode: MeasurementAttentionMode;
  opacity: number;
  onPrevious: () => void;
  onNext: () => void;
  onModeChange: (mode: MeasurementAttentionMode) => void;
  onOpacityChange: (opacity: number) => void;
  onReplay: () => void;
}) {
  if (count === 0) return null;
  const visibleIndex = Math.max(0, activeIndex) + 1;
  return (
    <section
      className="pointer-events-auto w-[min(680px,calc(100vw-2rem))] rounded-lg border border-clay/30 bg-card/95 p-2 shadow-nav backdrop-blur"
      aria-label="AI drawing attention controls"
      data-testid="measurement-attention-dock"
    >
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <div className="rounded-md bg-clay/10 p-1.5 text-clay">
            <Sparkles className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0">
            <p className="eyebrow truncate">AI attention layer</p>
            <p className="truncate text-[10px] text-muted-foreground">
              Visual callouts only · estimator creates every measurement
            </p>
          </div>
          <Badge variant="outline" className="shrink-0">
            {visibleIndex}/{count}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onPrevious}
            aria-label="Previous AI callout"
            data-testid="measurement-attention-previous"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onNext}
            aria-label="Next AI callout"
            data-testid="measurement-attention-next"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 gap-1 px-2 text-[10px]"
            onClick={onReplay}
            data-testid="measurement-attention-replay"
          >
            <ScanLine className="h-3 w-3" /> Replay scan
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-hairline pt-2">
        <div className="flex items-center rounded-md border border-hairline bg-surface p-0.5">
          <Button
            type="button"
            size="sm"
            variant={mode === "all" ? "secondary" : "ghost"}
            className="h-7 gap-1 px-2 text-[10px]"
            aria-pressed={mode === "all"}
            onClick={() => onModeChange("all")}
            data-testid="measurement-attention-all"
          >
            <Eye className="h-3 w-3" /> All
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "spotlight" ? "secondary" : "ghost"}
            className="h-7 gap-1 px-2 text-[10px]"
            aria-pressed={mode === "spotlight"}
            onClick={() => onModeChange("spotlight")}
            data-testid="measurement-attention-spotlight"
          >
            <Focus className="h-3 w-3" /> Spotlight
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mode === "hidden" ? "secondary" : "ghost"}
            className="h-7 gap-1 px-2 text-[10px]"
            aria-pressed={mode === "hidden"}
            onClick={() => onModeChange("hidden")}
            data-testid="measurement-attention-hide"
          >
            <EyeOff className="h-3 w-3" /> Hide
          </Button>
        </div>
        <label className="flex min-w-[160px] flex-1 items-center gap-2 text-[10px] text-muted-foreground">
          <span className="shrink-0">Callout strength</span>
          <Slider
            value={[opacity]}
            min={25}
            max={100}
            step={5}
            onValueChange={([value]) => onOpacityChange(value)}
            aria-label="AI callout opacity"
            data-testid="measurement-attention-opacity"
          />
          <span className="w-8 text-right font-mono">{opacity}%</span>
        </label>
      </div>
    </section>
  );
}
