import type { PointerEvent as ReactPointerEvent } from "react";
import { Maximize2, Minimize2, Move, PanelsTopLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CockpitFloatingPanelHeader({
  title,
  closeTestId,
  dragTestId,
  resetTestId,
  maximizeTestId,
  layoutLabel,
  maximized,
  onMoveStart,
  onMove,
  onMoveEnd,
  onReset,
  onToggleMaximize,
  onClose,
}: {
  title: string;
  closeTestId: string;
  dragTestId: string;
  resetTestId: string;
  maximizeTestId: string;
  layoutLabel: string;
  maximized: boolean;
  onMoveStart: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onMoveEnd: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onReset: () => void;
  onToggleMaximize: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={cn(
        "sticky top-0 z-20 col-span-full mb-2 gap-2 rounded-md border border-hairline bg-muted px-3 py-2 shadow-sm",
        maximized ? "flex items-center justify-between" : "grid grid-cols-1",
      )}
    >
      <div
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2",
          maximized ? "cursor-default" : "cursor-move touch-none",
        )}
        title={
          maximized
            ? `${title} is using the full workspace`
            : `Drag ${title} left, right, up, or down`
        }
        onPointerDown={maximized ? undefined : onMoveStart}
        onPointerMove={maximized ? undefined : onMove}
        onPointerUp={maximized ? undefined : onMoveEnd}
        onPointerCancel={maximized ? undefined : onMoveEnd}
        data-testid={dragTestId}
      >
        {maximized ? (
          <PanelsTopLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        ) : (
          <Move className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0">
          <p className="eyebrow truncate">{title}</p>
          <p className="truncate text-[10px] text-muted-foreground">{layoutLabel}</p>
        </div>
      </div>
      <div className={cn("grid shrink-0 grid-cols-3 items-center gap-1", maximized && "flex")}>
        {!maximized && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 min-w-0 px-2 text-xs"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={onReset}
            data-testid={resetTestId}
          >
            Reset
          </Button>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 min-w-0 gap-1.5 px-2 text-xs"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onToggleMaximize}
          aria-label={maximized ? `Restore ${title} to a movable panel` : `Maximize ${title}`}
          data-testid={maximizeTestId}
        >
          {maximized ? (
            <Minimize2 className="h-3.5 w-3.5" />
          ) : (
            <Maximize2 className="h-3.5 w-3.5" />
          )}
          {maximized ? "Restore" : "Full screen"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 min-w-0 gap-1.5 px-2 text-xs"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onClose}
          aria-label={`Minimize ${title}`}
          data-testid={closeTestId}
        >
          <Minimize2 className="h-3.5 w-3.5" />
          Minimize
        </Button>
      </div>
    </div>
  );
}
