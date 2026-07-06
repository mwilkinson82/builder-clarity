// A table column header with optional plain-English hover help (no internal
// jargon), shared by every report in the suite. Kept in its own file so the
// module exports a single component (fast-refresh friendly).
import type { ReactNode } from "react";
import { Info } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function ColHead({
  children,
  help,
  align = "right",
}: {
  children: ReactNode;
  help?: string;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`whitespace-nowrap px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground ${
        align === "right" ? "text-right" : "text-left"
      }`}
      scope="col"
    >
      {help ? (
        <span
          className={`inline-flex items-center gap-1 ${align === "right" ? "flex-row-reverse" : ""}`}
        >
          {children}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground/70 transition hover:text-foreground"
                aria-label={`About ${typeof children === "string" ? children : "this column"}`}
              >
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-[240px] text-xs leading-snug">{help}</TooltipContent>
          </Tooltip>
        </span>
      ) : (
        children
      )}
    </th>
  );
}
