import { createFileRoute, Link, Outlet, useChildMatches } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { EstimateWorkspace } from "@/components/estimates/EstimateWorkspace";
import { Button } from "@/components/ui/button";
import { getEstimate, listEstimateRegions } from "@/lib/estimates.functions";
import { getCompanyWorkspaceContext } from "@/lib/team.functions";

export const Route = createFileRoute("/_authenticated/estimates/$estimateId")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Estimate — Overwatch" },
      {
        name: "description",
        content: "Overwatch spreadsheet estimate workspace.",
      },
    ],
  }),
  component: EstimateDetailRoute,
});

function EstimateDetailRoute() {
  const childMatches = useChildMatches();
  return childMatches.length > 0 ? <Outlet /> : <EstimateDetailPage />;
}

function EstimateDetailPage() {
  const { estimateId } = Route.useParams();
  const loadEstimate = useServerFn(getEstimate);
  const loadRegions = useServerFn(listEstimateRegions);
  const loadCompanyContext = useServerFn(getCompanyWorkspaceContext);

  const estimateQuery = useQuery({
    queryKey: ["estimate", estimateId],
    queryFn: () => loadEstimate({ data: { id: estimateId } }),
  });
  const regionsQuery = useQuery({
    queryKey: ["estimate-regions"],
    queryFn: () => loadRegions(),
  });
  const companyContextQuery = useQuery({
    queryKey: ["company-workspace-context"],
    queryFn: () => loadCompanyContext(),
  });

  if (estimateQuery.isLoading || regionsQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background px-6 py-10 text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (estimateQuery.isError || regionsQuery.isError || !estimateQuery.data) {
    const error =
      estimateQuery.error instanceof Error
        ? estimateQuery.error.message
        : regionsQuery.error instanceof Error
          ? regionsQuery.error.message
          : "Estimate did not load.";
    return (
      <div className="min-h-screen bg-background px-6 py-10">
        <div className="mx-auto max-w-2xl rounded-lg border border-danger/30 bg-danger/5 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-danger" />
            <div>
              <h1 className="font-serif text-2xl">Estimate did not load</h1>
              <p className="mt-2 text-sm text-muted-foreground">{error}</p>
              <Button asChild variant="outline" size="sm" className="mt-4 gap-1.5">
                <Link to="/estimates">
                  <ArrowLeft className="h-3.5 w-3.5" /> Estimates
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <EstimateWorkspace
      estimate={estimateQuery.data.estimate}
      lineItems={estimateQuery.data.line_items}
      totals={estimateQuery.data.totals}
      regions={regionsQuery.data?.regions ?? []}
      companyName={companyContextQuery.data?.name || "Company"}
    />
  );
}
