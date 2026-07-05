import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

// One state vocabulary across the app (POLISH1 Task 1). Modules were each
// inventing their own status pills; this is the shared chip so empty /
// in-progress / complete / blocked always read the same way. Tones match the
// billing stage rail and the getting-started checklist (complete = success,
// blocked = warning, in-progress = accent, empty = muted).
export type StatusTone = "empty" | "in-progress" | "complete" | "blocked";

const TONE_CLASS: Record<StatusTone, string> = {
  empty: "border-muted-foreground/30 bg-muted/40 text-muted-foreground",
  "in-progress": "border-accent/40 bg-accent/10 text-accent",
  complete: "border-success/40 bg-success/10 text-success",
  blocked: "border-warning/40 bg-warning/10 text-warning",
};

export function StatusChip({
  tone,
  icon: Icon,
  children,
  className,
}: {
  tone: StatusTone;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
        TONE_CLASS[tone],
        className,
      )}
    >
      {Icon ? <Icon className="h-3 w-3" /> : null}
      {children}
    </span>
  );
}
