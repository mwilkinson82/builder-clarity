import type { KeyboardEvent } from "react";
import type { DiscoveryMarkup } from "./useSymbolDiscovery";
import type { ViewSize } from "./planRoomShared";

export function DiscoveryMarkupLayer({
  markups,
  activeClusterIndex,
  viewSize,
  onSelectGroup,
}: {
  markups: DiscoveryMarkup[];
  activeClusterIndex: number | null;
  viewSize: ViewSize;
  onSelectGroup?: (clusterIndex: number) => void;
}) {
  if (markups.length === 0) return null;
  const selectWithKeyboard = (event: KeyboardEvent<SVGGElement>, clusterIndex: number) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    onSelectGroup?.(clusterIndex);
  };
  return (
    <g data-testid="ai-discovery-markup-layer">
      {markups.map((markup) => {
        const active = markup.clusterIndex === activeClusterIndex;
        const cx = markup.x * viewSize.width;
        const cy = markup.y * viewSize.height;
        const label = markup.libraryLabel
          ? `Possible ${markup.libraryLabel}, group ${markup.groupNumber} of ${markup.groupCount}`
          : `Unlabeled AI proposal, group ${markup.groupNumber} of ${markup.groupCount}`;
        return (
          <g
            key={markup.id}
            role="button"
            tabIndex={0}
            aria-label={label}
            className="cursor-pointer outline-none"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onSelectGroup?.(markup.clusterIndex);
            }}
            onKeyDown={(event) => selectWithKeyboard(event, markup.clusterIndex)}
            data-testid={active ? "ai-discovery-markup-active" : "ai-discovery-markup"}
          >
            <title>{label}</title>
            {active && (
              <circle
                cx={cx}
                cy={cy}
                r="19"
                className="fill-none stroke-background"
                strokeWidth="5"
              />
            )}
            <rect
              x={cx - 12}
              y={cy - 12}
              width="24"
              height="24"
              rx="5"
              className={
                active
                  ? "fill-clay/15 stroke-clay"
                  : markup.libraryLabel
                    ? "fill-clay/10 stroke-clay"
                    : "fill-warning/10 stroke-warning"
              }
              strokeWidth={active ? 3 : 2}
              strokeDasharray={active ? "" : "5 3"}
            />
            <text
              x={cx}
              y={cy + 4}
              textAnchor="middle"
              className={active || markup.libraryLabel ? "fill-clay" : "fill-warning"}
              fontSize="10"
              fontWeight="700"
            >
              {markup.groupNumber}
            </text>
          </g>
        );
      })}
    </g>
  );
}
