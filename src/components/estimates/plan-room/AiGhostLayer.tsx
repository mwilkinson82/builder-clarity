// Ghost proposals on the plan canvas (AITAKEOFF1 Task 2).
// Ghosts are visually unmistakable from solid accepted markers: dashed amber
// circles with a "?" that only become ordinary count markers when the human
// accepts them. Low-confidence proposals carry a deeper warning tint.

import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/ai-takeoff/ai-takeoff-domain";
import type { ViewSize } from "./planRoomShared";

export interface AiGhostRender {
  id: string;
  x: number;
  y: number;
  confidence: number;
  status: "pending" | "accepted" | "rejected";
}

const GHOST_COLOR = "#d97706"; // amber — never a takeoff palette color
const GHOST_WARNING_COLOR = "#b45309";

export function AiGhostLayer({
  ghosts,
  activeGhostId,
  viewSize,
  onGhostSelect,
}: {
  ghosts: AiGhostRender[];
  activeGhostId: string | null;
  viewSize: ViewSize;
  onGhostSelect?: (ghostId: string) => void;
}) {
  if (ghosts.length === 0) return null;
  return (
    <g data-testid="ai-ghost-layer">
      {ghosts.map((ghost) => {
        if (ghost.status === "rejected") return null;
        const cx = ghost.x * viewSize.width;
        const cy = ghost.y * viewSize.height;
        const lowConfidence = ghost.confidence < LOW_CONFIDENCE_THRESHOLD;
        const color = lowConfidence ? GHOST_WARNING_COLOR : GHOST_COLOR;
        const active = ghost.id === activeGhostId;
        if (ghost.status === "accepted") {
          // Accepted ghosts render solid until the real marker replaces them
          // after the review finishes and the takeoffs refetch.
          return (
            <g key={ghost.id} data-testid="ai-ghost-accepted">
              <circle cx={cx} cy={cy} r="11" fill={GHOST_COLOR} />
              <text
                x={cx}
                y={cy + 4}
                textAnchor="middle"
                fill="white"
                fontSize="11"
                fontWeight="700"
              >
                ✓
              </text>
            </g>
          );
        }
        return (
          <g
            key={ghost.id}
            data-testid={lowConfidence ? "ai-ghost-low-confidence" : "ai-ghost"}
            className="cursor-pointer"
            onClick={(event) => {
              event.stopPropagation();
              onGhostSelect?.(ghost.id);
            }}
          >
            {active && (
              <>
                <circle cx={cx} cy={cy} r="19" fill="none" stroke="white" strokeWidth="4" />
                <circle cx={cx} cy={cy} r="19" fill="none" stroke="#111827" strokeWidth="1.5" />
              </>
            )}
            <circle
              cx={cx}
              cy={cy}
              r="12"
              fill={color}
              fillOpacity={lowConfidence ? 0.22 : 0.12}
              stroke={color}
              strokeWidth="2"
              strokeDasharray="4 3"
            />
            <text x={cx} y={cy + 4} textAnchor="middle" fill={color} fontSize="12" fontWeight="700">
              ?
            </text>
          </g>
        );
      })}
    </g>
  );
}
