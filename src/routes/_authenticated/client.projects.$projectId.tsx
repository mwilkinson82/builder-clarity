import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileText,
  LogOut,
  MessageSquare,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  getClientPortalProject,
  recordClientChangeOrderDecision,
  type ChangeOrderApprovalRow,
  type ClientPortalBillingApplication,
  type ClientPortalChangeOrder,
  type ClientPortalDailyReport,
  type ClientPortalDailyReportAttachment,
} from "@/lib/client-portal.functions";
import { downloadPdfBytes, generateDailyReportPacketPdf } from "@/lib/daily-report-packet-pdf";
import { fmtUSD } from "@/lib/format";

const DAILY_REPORT_BUCKET = "daily-reports";

const clientDateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

const safeFileName = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();

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

function formatClientDate(value: string) {
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return value || "No date";
  return clientDateFormatter.format(date);
}

function ClientProjectPage() {
  const { projectId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const loadProject = useServerFn(getClientPortalProject);
  const recordDecision = useServerFn(recordClientChangeOrderDecision);
  const [notesByCo, setNotesByCo] = useState<Record<string, string>>({});
  const [exportingDailyPacket, setExportingDailyPacket] = useState(false);

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
    const dailyReports = projectQuery.data?.dailyReports ?? [];
    const billingApplications = projectQuery.data?.billingApplications ?? [];
    const totalBilled = billingApplications.reduce(
      (total: number, app: ClientPortalBillingApplication) => total + app.amount_billed,
      0,
    );
    const paidToDate = billingApplications.reduce(
      (total: number, app: ClientPortalBillingApplication) => total + app.paid_to_date,
      0,
    );
    const retainage = billingApplications.reduce(
      (total: number, app: ClientPortalBillingApplication) => total + app.retainage,
      0,
    );
    return {
      visible: changeOrders.length,
      amount: changeOrders.reduce(
        (total: number, co: ClientPortalChangeOrder) => total + co.contract_amount,
        0,
      ),
      approved: changeOrders.filter(
        (co: ClientPortalChangeOrder) => co.client_status === "approved",
      ).length,
      dailyReports: dailyReports.length,
      payApps: billingApplications.length,
      totalBilled,
      paidToDate,
      retainage,
      outstanding: Math.max(0, totalBilled - paidToDate - retainage),
    };
  }, [
    projectQuery.data?.billingApplications,
    projectQuery.data?.changeOrders,
    projectQuery.data?.dailyReports,
  ]);

  const signOut = async () => {
    await supabase.auth.signOut();
    navigate({ to: "/auth" });
  };

  const openDailyAttachment = async (attachment: ClientPortalDailyReportAttachment) => {
    const { data, error } = await supabase.storage
      .from(DAILY_REPORT_BUCKET)
      .createSignedUrl(attachment.path, 600);
    if (error || !data?.signedUrl) {
      toast.error("Attachment could not open", {
        description: error?.message ?? "Try again.",
      });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const downloadDailyReportPacket = async () => {
    const data = projectQuery.data;
    if (!data || data.dailyReports.length === 0) {
      toast.error("No daily reports to download");
      return;
    }

    setExportingDailyPacket(true);
    try {
      const pdfBytes = await generateDailyReportPacketPdf({
        project: data.project,
        reports: data.dailyReports,
        title: "Client Daily Report Packet",
      });
      const projectName = safeFileName(data.project.name || "overwatch-project");
      downloadPdfBytes(pdfBytes, `${projectName}-daily-report-packet.pdf`);
      toast.success("Daily report packet downloaded");
    } catch (err) {
      toast.error("Daily report packet did not download", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setExportingDailyPacket(false);
    }
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

  const { project, changeOrders, approvals, billingApplications, dailyReports, portalPermissions } =
    projectQuery.data;
  const canViewChangeOrders = portalPermissions?.canViewChangeOrders ?? true;
  const canViewDailyReports = portalPermissions?.canViewDailyReports ?? true;
  const canViewBilling = portalPermissions?.canViewBilling ?? false;

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
                Review change orders and daily reports shared by the project team. Your approval or
                rejection is recorded immediately.
              </p>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={signOut}>
              <LogOut className="h-3.5 w-3.5" /> Sign out
            </Button>
          </div>
          <dl className="mt-6 grid gap-3 md:grid-cols-6">
            <ClientMetric label="Client" value={project.client || "Project client"} />
            <ClientMetric label="Job #" value={project.job_number || "Not listed"} />
            <ClientMetric label="COs for review" value={String(totals.visible)} />
            <ClientMetric label="Shared CO value" value={fmtUSD(totals.amount)} />
            <ClientMetric
              label="Pay apps"
              value={canViewBilling ? String(totals.payApps) : "Off"}
            />
            <ClientMetric
              label="Daily reports"
              value={canViewDailyReports ? String(totals.dailyReports) : "Off"}
            />
          </dl>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-6 px-6 py-8">
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
            {!canViewChangeOrders ? (
              <div className="rounded-md border border-hairline bg-muted/20 p-6 text-sm text-muted-foreground">
                Change orders are not enabled for this client seat yet.
              </div>
            ) : changeOrders.length === 0 ? (
              <div className="rounded-md border border-hairline bg-muted/20 p-6 text-sm text-muted-foreground">
                No change orders are currently awaiting your review.
              </div>
            ) : (
              changeOrders.map((co: ClientPortalChangeOrder) => {
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

        <section className="rounded-lg border border-hairline bg-card p-6 shadow-card">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-serif text-3xl">Billing shared with client</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Pay application status, payment posture, retainage, and open balance.
              </p>
            </div>
          </div>

          <div className="mt-6">
            {!canViewBilling ? (
              <div className="rounded-md border border-hairline bg-muted/20 p-6 text-sm text-muted-foreground">
                Billing is not enabled for this client seat yet.
              </div>
            ) : billingApplications.length === 0 ? (
              <div className="rounded-md border border-hairline bg-muted/20 p-6 text-sm text-muted-foreground">
                No pay applications are currently shared with you.
              </div>
            ) : (
              <div className="space-y-5">
                <dl className="grid gap-3 md:grid-cols-4">
                  <ClientMetric label="Billed to date" value={fmtUSD(totals.totalBilled)} />
                  <ClientMetric label="Paid to date" value={fmtUSD(totals.paidToDate)} />
                  <ClientMetric label="Retainage" value={fmtUSD(totals.retainage)} />
                  <ClientMetric label="Outstanding" value={fmtUSD(totals.outstanding)} />
                </dl>
                <div className="overflow-x-auto rounded-md border border-hairline">
                  <table className="w-full min-w-[760px] text-sm">
                    <thead className="bg-muted/45 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                      <tr>
                        <th className="px-3 py-3">Pay app</th>
                        <th className="px-3 py-3">Invoice</th>
                        <th className="px-3 py-3">Submitted / due</th>
                        <th className="px-3 py-3 text-right">Billed</th>
                        <th className="px-3 py-3 text-right">Paid</th>
                        <th className="px-3 py-3 text-right">Retainage</th>
                        <th className="px-3 py-3 text-right">Open</th>
                        <th className="px-3 py-3">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {billingApplications.map((app: ClientPortalBillingApplication) => {
                        const open = Math.max(
                          0,
                          app.amount_billed - app.paid_to_date - app.retainage,
                        );
                        return (
                          <tr key={app.id} className="border-t border-hairline">
                            <td className="px-3 py-3 align-top">
                              <div className="font-medium text-foreground">
                                {app.application_number || "Pay application"}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">
                                {app.billing_period || "Current billing cycle"}
                              </div>
                            </td>
                            <td className="px-3 py-3 align-top">
                              {app.invoice_number || "Not issued"}
                            </td>
                            <td className="px-3 py-3 align-top text-xs text-muted-foreground">
                              <div>
                                Submitted{" "}
                                {app.submitted_date
                                  ? formatClientDate(app.submitted_date)
                                  : "not set"}
                              </div>
                              <div>
                                Due {app.due_date ? formatClientDate(app.due_date) : "not set"}
                              </div>
                            </td>
                            <td className="px-3 py-3 text-right align-top tabular">
                              {fmtUSD(app.amount_billed)}
                            </td>
                            <td className="px-3 py-3 text-right align-top tabular">
                              {fmtUSD(app.paid_to_date)}
                            </td>
                            <td className="px-3 py-3 text-right align-top tabular">
                              {fmtUSD(app.retainage)}
                            </td>
                            <td className="px-3 py-3 text-right align-top tabular font-medium">
                              {fmtUSD(open)}
                            </td>
                            <td className="px-3 py-3 align-top">
                              <span className="inline-flex rounded-md border border-hairline bg-muted/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em]">
                                {app.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-hairline bg-card p-6 shadow-card">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="font-serif text-3xl">Daily reports shared with client</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Field updates marked client-visible by the project team.
              </p>
            </div>
            {canViewDailyReports && dailyReports.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                disabled={exportingDailyPacket}
                onClick={downloadDailyReportPacket}
              >
                <Download className="h-3.5 w-3.5" />
                {exportingDailyPacket ? "Preparing..." : "Download packet"}
              </Button>
            )}
          </div>

          <div className="mt-6 space-y-3">
            {!canViewDailyReports ? (
              <div className="rounded-md border border-hairline bg-muted/20 p-6 text-sm text-muted-foreground">
                Daily reports are not enabled for this client seat yet.
              </div>
            ) : dailyReports.length === 0 ? (
              <div className="rounded-md border border-hairline bg-muted/20 p-6 text-sm text-muted-foreground">
                No daily reports are currently shared with you.
              </div>
            ) : (
              dailyReports.map((report: ClientPortalDailyReport) => (
                <DailyReportCard
                  key={report.id}
                  report={report}
                  onOpenAttachment={openDailyAttachment}
                />
              ))
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

function DailyReportCard({
  report,
  onOpenAttachment,
}: {
  report: ClientPortalDailyReport;
  onOpenAttachment: (attachment: ClientPortalDailyReportAttachment) => void;
}) {
  const visibleNotes = [
    ["Work performed", report.work_performed],
    ["Manpower", report.manpower],
    ["Delays / blockers", report.delays],
    ["Safety", report.safety_notes],
    ["Visitors", report.visitors],
    ["Quality", report.quality_notes],
  ].filter(([, value]) => value);

  return (
    <article className="rounded-md border border-hairline bg-background p-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <h3 className="font-serif text-2xl">{formatClientDate(report.report_date)}</h3>
          <div className="mt-1 text-sm text-muted-foreground">
            {[report.author, report.weather, `${report.crew_count} crew`]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        {report.attachments.length > 0 && (
          <div className="flex flex-wrap justify-start gap-2 md:justify-end">
            {report.attachments.map((attachment) => (
              <Button
                key={attachment.path}
                type="button"
                variant="outline"
                size="sm"
                className="gap-1.5"
                onClick={() => onOpenAttachment(attachment)}
              >
                <FileText className="h-3.5 w-3.5" />
                <span className="max-w-[180px] truncate">{attachment.name}</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </Button>
            ))}
          </div>
        )}
      </div>

      {visibleNotes.length > 0 ? (
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {visibleNotes.map(([label, value]) => (
            <div key={label} className="rounded-md border border-hairline bg-muted/20 p-3">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {label}
              </div>
              <p className="mt-1 text-sm text-foreground">{value}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          This report was shared without additional field notes.
        </p>
      )}
    </article>
  );
}
