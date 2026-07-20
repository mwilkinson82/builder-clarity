import { Button } from "@/components/ui/button";

interface SubcontractFinancialReadStateProps {
  error?: unknown;
  loading?: boolean;
  retrying?: boolean;
  onRetry?: () => void;
}

export function SubcontractFinancialReadState({
  error,
  loading = false,
  retrying = false,
  onRetry,
}: SubcontractFinancialReadStateProps) {
  if (loading) {
    return (
      <section
        role="status"
        aria-live="polite"
        className="rounded-xl border border-hairline bg-card p-5 text-sm text-muted-foreground shadow-card"
      >
        Loading subcontract financials…
      </section>
    );
  }

  const detail =
    error instanceof Error
      ? error.message
      : "Subcontract financials could not be loaded. Refresh and try again.";

  return (
    <section
      role="alert"
      className="rounded-xl border border-destructive/40 bg-destructive/[0.06] p-5 shadow-card"
    >
      <h2 className="font-serif text-xl text-foreground">Subcontract financials unavailable</h2>
      <p className="mt-2 text-sm leading-relaxed text-danger">{detail}</p>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Buyout, payment, budget, and WIP totals and actions are blocked instead of showing a false
        zero or an incomplete ledger.
      </p>
      {onRetry ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="mt-4"
          disabled={retrying}
          onClick={onRetry}
        >
          {retrying ? "Retrying…" : "Retry"}
        </Button>
      ) : null}
    </section>
  );
}
