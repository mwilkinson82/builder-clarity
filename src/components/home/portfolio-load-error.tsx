import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

// Shared load-failure card for the portfolio surfaces. Rendered instead of a
// falsely-empty dashboard when a query fails, so a read error never reads as
// "$0 / all clear". Reused by both the classic ?tab=projects table and the
// redesigned home (PortfolioHome) so the two never diverge.
export function PortfolioLoadError({
  title,
  description,
  detail,
  onRetry,
}: {
  title: string;
  description: string;
  detail: string;
  onRetry: () => void;
}) {
  return (
    <div className="mb-6 rounded-lg border border-danger/30 bg-danger/10 p-5 text-danger">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="font-serif text-2xl text-danger">{title}</h2>
            <p className="mt-1 max-w-2xl text-sm text-danger/80">{description}</p>
            <pre className="mt-3 max-w-3xl overflow-auto rounded-md border border-danger/20 bg-background/70 p-3 text-left text-xs text-foreground">
              {detail}
            </pre>
          </div>
        </div>
        <Button type="button" variant="outline" onClick={onRetry} className="shrink-0 gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" />
          Retry
        </Button>
      </div>
    </div>
  );
}
