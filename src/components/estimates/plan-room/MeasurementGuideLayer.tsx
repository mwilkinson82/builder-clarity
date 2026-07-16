import type { KeyboardEvent } from "react";
import type { MeasurementAssistantSuggestion } from "@/lib/plan-room-measurement-assistant";
import type { ViewSize } from "./planRoomShared";

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
  onSelect,
}: {
  suggestions: MeasurementAssistantSuggestion[];
  activeSuggestionId: string;
  viewSize: ViewSize;
  onSelect?: (suggestionId: string) => void;
}) {
  const guided = suggestions.filter((suggestion) => suggestion.guide);
  return (
    <g data-testid="measurement-guide-layer">
      {guided.map((suggestion, index) => {
        const path = guidePath(suggestion, viewSize);
        const anchor = guideAnchor(suggestion, viewSize);
        const active = suggestion.id === activeSuggestionId;
        const select = () => onSelect?.(suggestion.id);
        const onKeyDown = (event: KeyboardEvent<SVGGElement>) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          select();
        };
        return (
          <g
            key={suggestion.id}
            role="button"
            tabIndex={0}
            aria-label={`Review AI location hint for ${suggestion.label}`}
            aria-pressed={active}
            onClick={select}
            onKeyDown={onKeyDown}
            className="cursor-pointer outline-none focus-visible:[&>path]:stroke-foreground"
            data-testid={`measurement-guide-${suggestion.id}`}
          >
            <title>{suggestion.label} — AI location hint, not measured</title>
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
              vectorEffect="non-scaling-stroke"
              data-testid={`measurement-guide-path-${suggestion.id}`}
            />
            <circle
              cx={anchor.x}
              cy={anchor.y}
              r={active ? 14 : 12}
              className="pointer-events-none fill-card stroke-clay"
              strokeWidth={2}
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
