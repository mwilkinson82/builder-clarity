import type { ComponentType, ReactNode } from "react";

import { cn } from "@/lib/utils";

// One empty-state language across the app (POLISH1 Task 4): an empty table
// should teach — a short icon, what the table is for, and the action that
// fills it — never a blank set of zero rows. Mirrors the getting-started
// checklist so onboarding and empty states read the same way.
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ComponentType<{ className?: string }>;
  title: string;
  description: string;
  /** The action control (a Button or Link) supplied by the caller so routing/handlers stay typed. */
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "mx-auto flex max-w-sm flex-col items-center gap-3 py-2 text-center",
        className,
      )}
    >
      {Icon ? (
        <div className="flex h-10 w-10 items-center justify-center rounded-md border border-hairline bg-surface">
          <Icon className="h-5 w-5 text-muted-foreground" />
        </div>
      ) : null}
      <div>
        <div className="font-medium text-foreground">{title}</div>
        <div className="mt-1 text-sm text-muted-foreground">{description}</div>
      </div>
      {action}
    </div>
  );
}
