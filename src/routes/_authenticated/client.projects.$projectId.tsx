import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, LogOut, MessageSquare, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  getClientPortalProject,
  recordClientChangeOrderDecision,
  type ChangeOrderApprovalRow,
  type ClientPortalChangeOrder,
} from "@/lib/client-portal.functions";
import { fmtUSD } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/client/projects/$projectId")({
  head: () => ({
    meta: [
      { title: "Client Portal — Overwatch" },
      {
        name: "description",
        content: "Review project change orders shared through Overwatch.",
      },
    ],
  }),
  component: ClientProjectPage,
});

function statusClass(status: ClientPortalChangeOrder["client_status"]) {
  if (status === "approved") return "border-success/40 bg-success/10 text-success";
  if (status === "rejected") return "border-danger/40 bg-danger/10 text-danger";
  if (status === "sent") return "border-warning/40 bg-warning/10 text-warning";
  return "border-hairline bg-muted/30 text-muted-foreground";
}

function latestApproval(
  approvals: ChangeOrderApprovalRow[],
  changeOrderId: string,
): ChangeOrderApprovalRow | undefined {
  return approvals.find((approval) => approval.change_order_id === changeOrderId);
}

function ClientProjectPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loadProject = useServerFn(getClientPortalProject);
  const recordDecision = useServerFn(recordClientChangeOrderDecision);
  const [notesByCo, setNotesByCo] = useState<Record<string, string>>({});

  const projectQuery = useQuery({
    queryKey: ["client-portal-project", projectId],
    queryFn: () => loadProject({ data: { projectId } }),
  });

  const decisionMutation = useMutation({
    mutationFn: (input: {
      changeOrderId: string;
      decision: "approved" | "rejected" | "comment";
      notes: string;
    }) => recordDecision({ data: input }),
    onSuccess: async (_, input) => {
      setNotesByCo((current) => ({ ...current, [input.changeOrderId]: "" }));
      await queryClient.invalidateQueries({ queryKey: ["client-portal-project", projectId] });
      toast.success(
        input.decision === "approved"
          ? "Change order approved"
          : input.decision === "rejected"
            ? "Change order rejected"
            : "Comment saved",
      );
    },
    onError: (err) =>
      toast.error("Response did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      }),
  });

  const totals = useMemo(() => {
    const changeOrders = projectQuery.data?.changeOrders ?? [];
    return {
      visible: changeOrders.length,
      amount: changeOrders.reduce((total: number, co: ClientPortalChangeOrder) => total + co.contract_amount, 0),
      approved: changeOrders.filter((co: ClientPortalChangeOrder) => co.client_status === "approved").length,
    };
  }, [projectQuery.data?.changeOrders]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  if (projectQuery.isLoading) {
    return (
      <div className="min-h-screen bg-background px-6 py-10 text-foreground">
        <div className="mx-auto max-w-5xl">
          <div className="h-8 w-56 rounded bg-muted" />
          <div className="mt-6 h-44 rounded-lg bg-muted/60" />
        </div>
      </div>
    );
  }

  if (projectQuery.error || !projectQuery.data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6 text-foreground">
        <div className="max-w-md rounded-lg border border-danger/30 bg-danger/10 p-6">
          <h1 className="font-serif text-3xl">Client portal unavailable</h1>
          <p className="mt-2 text-sm text-danger">
            {projectQuery.error instanceof Error
              ? projectQuery.error.message
              : "This project is not available for client review."}
          </p>
          <Button className="mt-5" variant="outline" onClick={signOut}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  const { project, changeOrders, approvals } = projectQuery.data;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-hairline bg-surface-elevated">
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                Overwatch Client Portal
              </div>
              <h1 className="mt-2 font-serif text-4xl leading-tight">{project.name}</h1>
              <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                Review change orders shared by the project team. Your approval or rejection is
                recorded immediately.
              </p>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={signOut}>
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </Button>
          </div>
          <dl className="mt-6 grid gap-3 md:grid-cols-4">
            <ClientMetric label="Client" value={project.client || "Project client"} />
            <ClientMetric label="Job #" value={project.job_number || "Not listed"} />
            <ClientMetric label="COs for review" value={String(totals.visible)} />
            <ClientMetric label="Shared CO value" value={fmtUSD(totals.amount)} />
          </dl>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <section className="rounded-lg border border-hairline bg-card p-6 shadow-card">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-serif text-3xl">Change orders for client response</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {totals.approved} approved of {totals.visible} shared change orders.
              </p>
            </div>
          </div>

          <div className="mt-6 space-y-4">
            {changeOrders.length === 0 ? (
              <div className="rounded-md border border-hairline bg-muted/20 p-6 text-sm text-muted-foreground">
                No change orders have been shared with this client portal yet.
              </div>
            ) : (
              changeOrders.map((co) => {
                const approval = latestApproval(approvals, co.id);
                const note = notesByCo[co.id] ?? "";
                return (
                  <article
                    key={co.id}
                    className="rounded-md border border-hairline bg-background p-5"
                  >
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-serif text-2xl">{co.number || "Change order"}</h3>
                          <span
                            className={`rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${statusClass(co.client_status)}`}
                          >
                            {co.client_status.replace("_", " ")}
                          </span>
                        </div>
                        <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
                          {co.description}
                        </p>
                      </div>
                      <div className="rounded-md border border-hairline bg-muted/30 p-3 text-right">
                        <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                          Contract impact
                        </div>
                        <div className="mt-1 font-serif text-3xl">{fmtUSD(co.contract_amount)}</div>
                      </div>
                    </div>

                    {co.notes && (
                      <div className="mt-4 rounded-md border border-hairline bg-muted/20 p-3 text-sm">
                        {co.notes}
                      </div>
                    )}

                    {approval && (
                      <div className="mt-4 rounded-md border border-hairline bg-muted/20 p-3 text-sm">
                        <div className="flex items-center gap-2 font-medium capitalize">
                          {approval.decision === "approved" ? (
                            <CheckCircle2 className="h-4 w-4 text-success" />
                          ) : approval.decision === "rejected" ? (
                            <XCircle className="h-4 w-4 text-danger" />
                          ) : (
                            <MessageSquare className="h-4 w-4 text-muted-foreground" />
                          )}
                          Latest response: {approval.decision}
                        </div>
                        <p className="mt-1 text-muted-foreground">
                          {approval.notes || "No note was included."}
                        </p>
                      </div>
                    )}

                    <div className="mt-5 space-y-3">
                      <Textarea
                        value={note}
                        placeholder="Optional client note, rejection reason, or approval context."
                        onChange={(event) =>
                          setNotesByCo((current) => ({
                            ...current,
                            [co.id]: event.target.value,
                          }))
                        }
                      />
                      <div className="flex flex-wrap justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-1.5"
                          disabled={decisionMutation.isPending}
                          onClick={() =>
                            decisionMutation.mutate({
                              changeOrderId: co.id,
                              decision: "comment",
                              notes: note,
                            })
                          }
                        >
                          <MessageSquare className="h-3.5 w-3.5" /> Save comment
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          className="gap-1.5 border-danger/40 text-danger hover:bg-danger/10"
                          disabled={decisionMutation.isPending}
                          onClick={() =>
                            decisionMutation.mutate({
                              changeOrderId: co.id,
                              decision: "rejected",
                              notes: note,
                            })
                          }
                        >
                          <XCircle className="h-3.5 w-3.5" /> Reject
                        </Button>
                        <Button
                          type="button"
                          className="gap-1.5"
                          disabled={decisionMutation.isPending}
                          onClick={() =>
                            decisionMutation.mutate({
                              changeOrderId: co.id,
                              decision: "approved",
                              notes: note,
                            })
                          }
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> Approve
                        </Button>
                      </div>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

function ClientMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-card p-3">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 truncate font-serif text-2xl">{value}</dd>
    </div>
  );
}
