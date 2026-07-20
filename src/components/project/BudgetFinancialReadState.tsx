import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export function BudgetFinancialReadState({
  loading = false,
  retrying = false,
  error,
  onRetry,
}: {
  loading?: boolean;
  retrying?: boolean;
  error?: unknown;
  onRetry?: () => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center gap-2 rounded-md border border-hairline bg-surface p-5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading authoritative budget data…
      </div>
    );
  }

  const message = error instanceof Error ? error.message : "An authoritative budget read failed.";
  return (
    <div
      role="alert"
      className="rounded-md border border-danger/30 bg-danger/5 p-5 text-sm text-foreground"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" />
        <div className="min-w-0 flex-1">
          <div className="font-medium">Budget totals are temporarily unavailable</div>
          <p className="mt-1 text-muted-foreground">
            Overwatch stopped the financial workspace instead of treating missing allocations,
            actual costs, or audit history as zero. Do not rely on Budget, SOV, Billing, or margin
            totals until this read succeeds.
          </p>
          <p className="mt-2 break-words text-xs text-danger">{message}</p>
          {onRetry ? (
            <Button
              className="mt-4 gap-1.5"
              variant="outline"
              size="sm"
              onClick={onRetry}
              disabled={retrying}
            >
              {retrying ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Retry financial reads
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
