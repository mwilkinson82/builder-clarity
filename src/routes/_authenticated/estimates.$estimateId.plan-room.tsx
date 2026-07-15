import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, ArrowLeft } from "lucide-react";
import { PlanRoomWorkspace } from "@/components/estimates/plan-room/PlanRoomWorkspace";
import { Button } from "@/components/ui/button";
import { getEstimate } from "@/lib/estimates.functions";
import { getPlanRoom } from "@/lib/plan-room.functions";
import { getCompanyWorkspaceContext } from "@/lib/team.functions";

export const Route = createFileRoute("/_authenticated/estimates/$estimateId/plan-room")({
  ssr: false,
  // ?line=<estimate line id> focuses that line's takeoff (sheet + measurement).
  // ?upload=true opens the drawing upload flow directly (first-run launcher).
  validateSearch: (search: Record<string, unknown>): { line?: string; upload?: boolean } => ({
    ...(typeof search.line === "string" && search.line ? { line: search.line } : {}),
    ...(search.upload === true || search.upload === "true" ? { upload: true } : {}),
  }),
  head: () => ({
    meta: [
      { title: "Plan Room — Overwatch" },
      {
        name: "description",
        content: "Overwatch plan room and takeoff workspace for estimate quantities.",
      },
    ],
  }),
  component: PlanRoomPage,
});

function PlanRoomPage() {
  const { estimateId } = Route.useParams();
  const { line: focusLineItemId, upload: autoOpenUpload } = Route.useSearch();
  const loadEstimate = useServerFn(getEstimate);
  const loadPlanRoom = useServerFn(getPlanRoom);
  const loadCompanyContext = useServerFn(getCompanyWorkspaceContext);

  const estimateQuery = useQuery({
    queryKey: ["estimate", estimateId],
    queryFn: () => loadEstimate({ data: { id: estimateId } }),
  });
  const planRoomQuery = useQuery({
    queryKey: ["plan-room", estimateId],
    queryFn: () => loadPlanRoom({ data: { estimate_id: estimateId } }),
  });
  const companyQuery = useQuery({
    queryKey: ["company-workspace-context"],
    queryFn: () => loadCompanyContext(),
  });

  if (estimateQuery.isLoading || planRoomQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background px-6 py-10 text-sm text-muted-foreground">
        Loading Plan Room...
      </div>
    );
  }

  if (
    estimateQuery.isError ||
    planRoomQuery.isError ||
    !estimateQuery.data ||
    !planRoomQuery.data
  ) {
    const error =
      estimateQuery.error instanceof Error
        ? estimateQuery.error.message
        : planRoomQuery.error instanceof Error
          ? planRoomQuery.error.message
          : "Plan Room did not load.";
    return (
      <div className="min-h-screen bg-background px-6 py-10">
        <div className="mx-auto max-w-2xl rounded-lg border border-danger/30 bg-danger/5 p-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="mt-0.5 h-5 w-5 text-danger" />
            <div>
              <h1 className="font-serif text-2xl">Plan Room did not load</h1>
              <p className="mt-2 text-sm text-muted-foreground">{error}</p>
              <Button asChild variant="outline" size="sm" className="mt-4 gap-1.5">
                <Link to="/estimates/$estimateId" params={{ estimateId }}>
                  <ArrowLeft className="h-3.5 w-3.5" /> Estimate
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <PlanRoomWorkspace
      estimate={estimateQuery.data.estimate}
      lineItems={estimateQuery.data.line_items}
      planSets={planRoomQuery.data.plan_sets}
      sheets={planRoomQuery.data.sheets}
      measurements={planRoomQuery.data.measurements}
      scaleAssessments={planRoomQuery.data.scale_assessments}
      scaleAssuranceReady={planRoomQuery.data.scale_assurance_ready}
      schemaReady={planRoomQuery.data.schema_ready}
      schemaMessage={planRoomQuery.data.schema_message}
      companyName={companyQuery.data?.name || "Company"}
      focusLineItemId={focusLineItemId}
      autoOpenUpload={Boolean(autoOpenUpload)}
    />
  );
}
