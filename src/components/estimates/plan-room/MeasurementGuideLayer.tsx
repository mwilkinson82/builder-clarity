import { useEffect, useState, type KeyboardEvent } from "react";
import type { MeasurementAssistantSuggestion } from "@/lib/plan-room-measurement-assistant";
import type { ViewSize } from "./planRoomShared";
import type { MeasurementAttentionMode } from "./MeasurementAttentionDock";

const guidePath = (suggestion: MeasurementAssistantSuggestion, viewSize: ViewSize) => {
  const points = suggestion.guide?.points ?? [];
  if (points.length === 0) return "";
  const commands = points.map(
    (point, index) =>
      `${index === 0 ? "M" : "L"} ${point.x * viewSize.width} ${point.y * viewSize.height}`,
  );
  if (suggestion.guide?.kind === "area_region") commands.push("Z");
  return commands.join(" ");
};

const guideAnchor = (suggestion: MeasurementAssistantSuggestion, viewSize: ViewSize) => {
  const points = suggestion.guide?.points ?? [];
  if (points.length === 0) return { x: 0, y: 0 };
  return {
    x: (points.reduce((sum, point) => sum + point.x, 0) / points.length) * viewSize.width,
    y: (points.reduce((sum, point) => sum + point.y, 0) / points.length) * viewSize.height,
  };
};

export function MeasurementGuideLayer({
  suggestions,
  activeSuggestionId,
  viewSize,
  mode = "all",
  opacity = 70,
  scanNonce = 0,
  onSelect,
}: {
  suggestions: MeasurementAssistantSuggestion[];
  activeSuggestionId: string;
  viewSize: ViewSize;
  mode?: MeasurementAttentionMode;
  opacity?: number;
  scanNonce?: number;
  onSelect?: (suggestionId: string) => void;
}) {
  const guided = suggestions.filter((suggestion) => suggestion.guide);
  const focusedId = guided.some((suggestion) => suggestion.id === activeSuggestionId)
    ? activeSuggestionId
    : (guided[0]?.id ?? "");
  const visible =
    mode === "hidden"
      ? []
      : mode === "spotlight"
        ? guided.filter((suggestion) => suggestion.id === focusedId)
        : guided;
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const query = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!query) return;
    const update = () => setPrefersReducedMotion(query.matches);
    update();
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);

  const boundedOpacity = Math.min(1, Math.max(0.25, opacity / 100));
  return (
    <g data-testid="measurement-guide-layer">
      <defs>
        <linearGradient id="measurement-attention-sweep" x1="0" x2="1">
          <stop offset="0" stopColor="var(--clay)" stopOpacity="0" />
          <stop offset="0.5" stopColor="var(--clay)" stopOpacity="0.3" />
          <stop offset="1" stopColor="var(--clay)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {mode !== "hidden" && scanNonce > 0 && !prefersReducedMotion && (
        <rect
          key={`attention-scan-${scanNonce}`}
          x={-viewSize.width * 0.22}
          y={0}
          width={viewSize.width * 0.22}
          height={viewSize.height}
          fill="url(#measurement-attention-sweep)"
          pointerEvents="none"
          data-testid="measurement-attention-scan"
        >
          <animate
            attributeName="x"
            from={String(-viewSize.width * 0.22)}
            to={String(viewSize.width)}
            dur="1.15s"
            fill="freeze"
          />
          <animate attributeName="opacity" values="0;1;0" dur="1.15s" fill="freeze" />
        </rect>
      )}
      {visible.map((suggestion) => {
        const index = guided.findIndex((candidate) => candidate.id === suggestion.id);
        const path = guidePath(suggestion, viewSize);
        const anchor = guideAnchor(suggestion, viewSize);
        const active = suggestion.id === activeSuggestionId;
        const pathOpacity = active ? boundedOpacity : Math.max(0.25, boundedOpacity * 0.58);
        const select = () => onSelect?.(suggestion.id);
        const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          select();
        };
        return (
          <g
            key={`${suggestion.id}-${scanNonce}`}
            role="button"
            tabIndex={0}
            aria-label={`Review AI-drawn scope markup for ${suggestion.label}`}
            aria-pressed={active}
            onClick={select}
            onKeyDown={onKeyDown}
            className="cursor-pointer outline-none focus-visible:[&>path]:stroke-foreground"
            data-testid={`measurement-guide-${suggestion.id}`}
          >
            <title>{suggestion.label} — AI-drawn scope markup, not measured</title>
            <path
              d={path}
              fill="none"
              stroke="transparent"
              strokeWidth={18}
              vectorEffect="non-scaling-stroke"
              pointerEvents="stroke"
            />
            <path
              d={path}
              className={
                suggestion.guide?.kind === "area_region"
                  ? "pointer-events-none fill-clay/10 stroke-clay"
                  : "pointer-events-none fill-none stroke-clay"
              }
              strokeWidth={active ? 4 : 3}
              strokeDasharray={active ? "10 5" : "7 6"}
              opacity={pathOpacity}
              vectorEffect="non-scaling-stroke"
              style={
                active
                  ? {
                      filter:
                        "drop-shadow(0 0 6px color-mix(in srgb, var(--clay) 58%, transparent))",
                    }
                  : undefined
              }
              data-testid={`measurement-guide-path-${suggestion.id}`}
            >
              {scanNonce > 0 && !prefersReducedMotion && (
                <>
                  <animate
                    attributeName="stroke-dashoffset"
                    from="80"
                    to="0"
                    dur="0.9s"
                    fill="freeze"
                  />
                  <animate
                    attributeName="opacity"
                    values={`0.12;${pathOpacity}`}
                    dur="0.9s"
                    fill="freeze"
                  />
                </>
              )}
            </path>
            <circle
              cx={anchor.x}
              cy={anchor.y}
              r={active ? 14 : 12}
              className="pointer-events-none fill-card stroke-clay"
              strokeWidth={2}
              opacity={pathOpacity}
              vectorEffect="non-scaling-stroke"
            />
            <text
              x={anchor.x}
              y={anchor.y}
              textAnchor="middle"
              dominantBaseline="central"
              className="pointer-events-none fill-foreground text-[11px] font-semibold"
            >
              {index + 1}
            </text>
          </g>
        );
      })}
    </g>
  );
}
