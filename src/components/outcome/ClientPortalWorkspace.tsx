import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Mail,
  ShieldCheck,
  UserPlus,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import {
  getClientPortalManagement,
  grantClientProjectAccess,
  revokeClientProjectAccess,
  setChangeOrderClientVisibility,
  updateClientProjectAccess,
  upsertClientContact,
  type ClientContactRow,
  type ClientPortalChangeOrder,
  type ChangeOrderApprovalRow,
  type ProjectClientAccessRow,
} from "@/lib/client-portal.functions";
import { fmtUSD } from "@/lib/format";

interface ClientPortalWorkspaceProps {
  projectId: string;
}

const blankContact = {
  name: "",
  email: "",
  company: "",
  title: "",
  phone: "",
  notes: "",
};

function approvalLabel(status: ClientPortalChangeOrder["client_status"]) {
  if (status === "approved") return "Approved";
  if (status === "rejected") return "Rejected";
  if (status === "sent") return "Sent";
  return "Not sent";
}

function approvalClass(status: ClientPortalChangeOrder["client_status"]) {
  if (status === "approved") return "border-success/40 bg-success/10 text-success";
  if (status === "rejected") return "border-danger/40 bg-danger/10 text-danger";
  if (status === "sent") return "border-warning/40 bg-warning/10 text-warning";
  return "border-hairline bg-muted/30 text-muted-foreground";
}

function latestApprovalFor(
  approvals: ChangeOrderApprovalRow[],
  changeOrderId: string,
): ChangeOrderApprovalRow | undefined {
  return approvals.find((approval) => approval.change_order_id === changeOrderId);
}

function buildClientPath(projectId: string) {
  return `/client/projects/${projectId}`;
}

function buildCallbackUrl(projectId: string) {
  const next = buildClientPath(projectId);
  return `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

export function ClientPortalWorkspace({ projectId }: ClientPortalWorkspaceProps) {
  const queryClient = useQueryClient();
  const loadPortal = useServerFn(getClientPortalManagement);
  const saveContact = useServerFn(upsertClientContact);
  const grantAccess = useServerFn(grantClientProjectAccess);
  const updateAccess = useServerFn(updateClientProjectAccess);
  const revokeAccess = useServerFn(revokeClientProjectAccess);
  const setVisibility = useServerFn(setChangeOrderClientVisibility);
  const [contactDraft, setContactDraft] = useState(blankContact);

  const portalQuery = useQuery({
    queryKey: ["client-portal-management", projectId],
    queryFn: () => loadPortal({ data: { projectId } }),
  });

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["client-portal-management", projectId] }),
      queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
    ]);
  };

  const saveContactMutation = useMutation({
    mutationFn: () => saveContact({ data: { projectId, ...contactDraft } }),
    onSuccess: async () => {
      setContactDraft(blankContact);
      await invalidate();
      toast.success("Client contact saved");
    },
    onError: (err) =>
      toast.error("Client contact did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      }),
  });

  const grantAccessMutation = useMutation({
    mutationFn: (contactId: string) => grantAccess({ data: { projectId, contactId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Client access granted");
    },
    onError: (err) =>
      toast.error("Client access did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      }),
  });

  const revokeAccessMutation = useMutation({
    mutationFn: (accessId: string) => revokeAccess({ data: { accessId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Client access revoked");
    },
    onError: (err) =>
      toast.error("Client access did not revoke", {
        description: err instanceof Error ? err.message : "Try again.",
      }),
  });

  const visibilityMutation = useMutation({
    mutationFn: (input: { changeOrderId: string; client_visible: boolean }) =>
      setVisibility({ data: input }),
    onSuccess: async (_, input) => {
      await invalidate();
      toast.success(input.client_visible ? "Change order shared" : "Change order hidden");
    },
    onError: (err) =>
      toast.error("Client visibility did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      }),
  });

  const sendLinkMutation = useMutation({
    mutationFn: async (access: ProjectClientAccessRow) => {
      const { error } = await supabase.auth.signInWithOtp({
        email: access.email,
        options: {
          emailRedirectTo: buildCallbackUrl(projectId),
          shouldCreateUser: true,
        },
      });
      if (error) throw error;
      await updateAccess({
        data: {
          accessId: access.id,
          status: "pending",
          last_sent_at: new Date().toISOString(),
        },
      });
    },
    onSuccess: async (_, access) => {
      await invalidate();
      toast.success("Client magic link sent", {
        description: access.email,
      });
    },
    onError: (err) =>
      toast.error("Client magic link did not send", {
        description: err instanceof Error ? err.message : "Try again.",
      }),
  });

  const accessPermissionMutation = useMutation({
    mutationFn: (input: {
      accessId: string;
      patch: Partial<
        Pick<
          ProjectClientAccessRow,
          "can_view_change_orders" | "can_view_daily_reports" | "can_view_billing"
        >
      >;
    }) => updateAccess({ data: { accessId: input.accessId, ...input.patch } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Client permissions updated");
    },
    onError: (err) =>
      toast.error("Client permissions did not save", {
        description: err instanceof Error ? err.message : "Try again.",
      }),
  });

  const portalUrl = useMemo(() => {
    if (typeof window === "undefined") return buildClientPath(projectId);
    return `${window.location.origin}${buildClientPath(projectId)}`;
  }, [projectId]);

  const data = portalQuery.data;
  const accessByEmail = useMemo(() => {
    const map = new Map<string, ProjectClientAccessRow>();
    for (const access of data?.access ?? []) map.set(access.email.toLowerCase(), access);
    return map;
  }, [data?.access]);

  const visibleCount = (data?.changeOrders ?? []).filter((co: ClientPortalChangeOrder) => co.client_visible).length;
  const approvedCount = (data?.changeOrders ?? []).filter(
    (co: ClientPortalChangeOrder) => co.client_status === "approved",
  ).length;

  if (portalQuery.isLoading) {
    return (
      <div className="rounded-lg border border-hairline bg-card p-6 shadow-card">
        <div className="h-6 w-44 rounded bg-muted" />
        <div className="mt-4 h-24 rounded bg-muted/60" />
      </div>
    );
  }

  if (portalQuery.error || !data) {
    return (
      <div className="rounded-lg border border-danger/30 bg-danger/10 p-5 text-sm text-danger">
        {portalQuery.error instanceof Error
          ? portalQuery.error.message
          : "Client portal data did not load."}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-hairline bg-card p-6 shadow-card">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Client Portal
            </div>
            <h2 className="mt-2 font-serif text-3xl leading-tight">Client-facing approvals</h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Share only the change orders the client should see. They get a magic link, review the
              request, and approve or reject from a clean external portal.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:w-[440px]">
            <PortalMetric label="Client seats" value={String(data.access.length)} />
            <PortalMetric label="Shared COs" value={String(visibleCount)} />
            <PortalMetric label="Approved" value={String(approvedCount)} />
          </div>
        </div>
        <div className="mt-5 flex flex-col gap-2 rounded-md border border-hairline bg-muted/25 p-3 text-sm md:flex-row md:items-center md:justify-between">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              Client link
            </div>
            <div className="truncate text-foreground">{portalUrl}</div>
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                navigator.clipboard?.writeText(portalUrl);
                toast.success("Client link copied");
              }}
            >
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => window.open(portalUrl, "_blank", "noopener,noreferrer")}
            >
              <ExternalLink className="h-3.5 w-3.5" /> Preview
            </Button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-serif text-2xl">Client contacts</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Add the owner or client rep who should approve COs.
              </p>
            </div>
            <UserPlus className="h-5 w-5 text-accent" />
          </div>
          <form
            className="mt-5 space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              saveContactMutation.mutate();
            }}
          >
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name">
                <Input
                  required
                  value={contactDraft.name}
                  onChange={(event) =>
                    setContactDraft((draft) => ({ ...draft, name: event.target.value }))
                  }
                />
              </Field>
              <Field label="Email">
                <Input
                  required
                  type="email"
                  value={contactDraft.email}
                  onChange={(event) =>
                    setContactDraft((draft) => ({ ...draft, email: event.target.value }))
                  }
                />
              </Field>
              <Field label="Company">
                <Input
                  value={contactDraft.company}
                  onChange={(event) =>
                    setContactDraft((draft) => ({ ...draft, company: event.target.value }))
                  }
                />
              </Field>
              <Field label="Title">
                <Input
                  value={contactDraft.title}
                  onChange={(event) =>
                    setContactDraft((draft) => ({ ...draft, title: event.target.value }))
                  }
                />
              </Field>
            </div>
            <Field label="Notes">
              <Textarea
                value={contactDraft.notes}
                onChange={(event) =>
                  setContactDraft((draft) => ({ ...draft, notes: event.target.value }))
                }
              />
            </Field>
            <Button type="submit" disabled={saveContactMutation.isPending} className="gap-1.5">
              <UserPlus className="h-3.5 w-3.5" />
              {saveContactMutation.isPending ? "Saving..." : "Save client contact"}
            </Button>
          </form>

          <div className="mt-6 overflow-hidden rounded-md border border-hairline">
            {data.contacts.length === 0 ? (
              <div className="p-5 text-sm text-muted-foreground">No client contacts yet.</div>
            ) : (
              data.contacts.map((contact: ClientContactRow) => {
                const access = accessByEmail.get(contact.email.toLowerCase());
                return (
                  <div
                    key={contact.id}
                    className="flex flex-col gap-3 border-b border-hairline p-4 last:border-b-0 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="font-medium text-foreground">{contact.name}</div>
                      <div className="truncate text-sm text-muted-foreground">{contact.email}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {[contact.company, contact.title].filter(Boolean).join(" · ") || "Client"}
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {access ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="gap-1.5"
                            disabled={sendLinkMutation.isPending}
                            onClick={() => sendLinkMutation.mutate(access)}
                          >
                            <Mail className="h-3.5 w-3.5" /> Send magic link
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={revokeAccessMutation.isPending}
                            onClick={() => revokeAccessMutation.mutate(access.id)}
                          >
                            Revoke
                          </Button>
                        </>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={grantAccessMutation.isPending}
                          onClick={() => grantAccessMutation.mutate(contact.id)}
                        >
                          Grant access
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
          <h3 className="font-serif text-2xl">Client access ledger</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Toggle exactly what this client seat can see before sending the magic link.
          </p>
          <div className="mt-5 overflow-hidden rounded-md border border-hairline">
            {data.access.length === 0 ? (
              <div className="p-5 text-sm text-muted-foreground">
                Grant access to a contact to create the first client seat.
              </div>
            ) : (
              data.access.map((access: ProjectClientAccessRow) => (
                <div
                  key={access.id}
                  className="grid gap-3 border-b border-hairline p-4 text-sm last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(280px,360px)_110px_150px]"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium text-foreground">{access.email}</div>
                    <div className="text-xs text-muted-foreground">
                      Last link:{" "}
                      {access.last_sent_at ? access.last_sent_at.slice(0, 10) : "not sent"}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <PermissionButton
                      label="COs"
                      active={access.can_view_change_orders}
                      disabled={accessPermissionMutation.isPending}
                      onClick={() =>
                        accessPermissionMutation.mutate({
                          accessId: access.id,
                          patch: { can_view_change_orders: !access.can_view_change_orders },
                        })
                      }
                    />
                    <PermissionButton
                      label="Daily"
                      active={access.can_view_daily_reports}
                      disabled={accessPermissionMutation.isPending}
                      onClick={() =>
                        accessPermissionMutation.mutate({
                          accessId: access.id,
                          patch: { can_view_daily_reports: !access.can_view_daily_reports },
                        })
                      }
                    />
                    <PermissionButton
                      label="Billing"
                      active={access.can_view_billing}
                      disabled={accessPermissionMutation.isPending}
                      onClick={() =>
                        accessPermissionMutation.mutate({
                          accessId: access.id,
                          patch: { can_view_billing: !access.can_view_billing },
                        })
                      }
                    />
                  </div>
                  <span className="rounded-full border border-hairline px-2.5 py-1 text-center text-xs font-semibold uppercase tracking-[0.12em]">
                    {access.status}
                  </span>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={sendLinkMutation.isPending}
                      onClick={() => sendLinkMutation.mutate(access)}
                    >
                      Send link
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={revokeAccessMutation.isPending}
                      onClick={() => revokeAccessMutation.mutate(access.id)}
                    >
                      Revoke
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="rounded-lg border border-hairline bg-card p-5 shadow-card">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <h3 className="font-serif text-2xl">Client-visible change orders</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Share pending COs when they are ready for client review. Approval history is audited.
            </p>
          </div>
        </div>
        <div className="mt-5 overflow-x-auto rounded-md border border-hairline">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-muted/45 text-left text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <tr>
                <th className="px-3 py-3">CO</th>
                <th className="px-3 py-3">Amount</th>
                <th className="px-3 py-3">Internal status</th>
                <th className="px-3 py-3">Client status</th>
                <th className="px-3 py-3">Latest response</th>
                <th className="px-3 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {data.changeOrders.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                    No change orders are logged yet.
                  </td>
                </tr>
              ) : (
                data.changeOrders.map((co: ClientPortalChangeOrder) => {
                  const approval = latestApprovalFor(data.approvals, co.id);
                  return (
                    <tr key={co.id} className="border-t border-hairline">
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium text-foreground">{co.number || "CO"}</div>
                        <div className="mt-1 max-w-md text-xs text-muted-foreground">
                          {co.description}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top tabular">{fmtUSD(co.contract_amount)}</td>
                      <td className="px-3 py-3 align-top">{co.status}</td>
                      <td className="px-3 py-3 align-top">
                        <span
                          className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold ${approvalClass(co.client_status)}`}
                        >
                          {approvalLabel(co.client_status)}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top">
                        {approval ? (
                          <div className="max-w-xs">
                            <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-foreground">
                              {approval.decision === "approved" ? (
                                <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                              ) : approval.decision === "rejected" ? (
                                <XCircle className="h-3.5 w-3.5 text-danger" />
                              ) : null}
                              {approval.decision}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {approval.notes || "No client note."}
                            </div>
                          </div>
                        ) : (
                          <span className="text-xs text-muted-foreground">No response yet.</span>
                        )}
                      </td>
                      <td className="px-3 py-3 text-right align-top">
                        <Button
                          type="button"
                          size="sm"
                          variant={co.client_visible ? "outline" : "default"}
                          disabled={visibilityMutation.isPending}
                          onClick={() =>
                            visibilityMutation.mutate({
                              changeOrderId: co.id,
                              client_visible: !co.client_visible,
                            })
                          }
                        >
                          {co.client_visible ? "Hide from client" : "Share with client"}
                        </Button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function PermissionButton({
  label,
  active,
  disabled,
  onClick,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant={active ? "default" : "outline"}
      disabled={disabled}
      className="h-8 min-w-20 justify-center gap-1.5"
      onClick={onClick}
    >
      {label}
      <span className="text-[10px] uppercase tracking-[0.12em] opacity-70">
        {active ? "on" : "off"}
      </span>
    </Button>
  );
}

function PortalMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-muted/30 p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-serif text-2xl text-foreground">{value}</div>
    </div>
  );
}
