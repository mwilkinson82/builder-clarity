import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Copy, ExternalLink, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { sendOverwatchMagicLink } from "@/lib/auth/magic-link";
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

type AccessPermissionField =
  "can_view_change_orders" | "can_view_daily_reports" | "can_view_billing" | "can_view_selections";

interface AccessPermissionInput {
  accessId: string;
  field: AccessPermissionField;
  value: boolean;
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

function seatStatusClass(status: ProjectClientAccessRow["status"]) {
  if (status === "active") return "border-success/40 bg-success/10 text-success";
  if (status === "pending") return "border-warning/40 bg-warning/10 text-warning";
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

function contactSubLine(contact: ClientContactRow | undefined, email: string) {
  const descriptor = contact ? [contact.title, contact.company].filter(Boolean).join(", ") : "";
  return [email, descriptor].filter(Boolean).join(" · ");
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
  const [addSeatOpen, setAddSeatOpen] = useState(false);

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
      setAddSeatOpen(false);
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
      await sendOverwatchMagicLink({
        email: access.email,
        next: buildClientPath(projectId),
        context: "client_portal",
      });
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
    mutationFn: (input: AccessPermissionInput) =>
      updateAccess({ data: { accessId: input.accessId, [input.field]: input.value } }),
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
  const savingPermissionKey =
    accessPermissionMutation.isPending && accessPermissionMutation.variables
      ? `${accessPermissionMutation.variables.accessId}:${accessPermissionMutation.variables.field}`
      : "";
  const isPermissionSaving = (accessId: string, field: AccessPermissionField) =>
    savingPermissionKey === `${accessId}:${field}`;

  const contactsById = useMemo(() => {
    const map = new Map<string, ClientContactRow>();
    for (const contact of data?.contacts ?? []) map.set(contact.id, contact);
    return map;
  }, [data?.contacts]);
  const contactsByEmail = useMemo(() => {
    const map = new Map<string, ClientContactRow>();
    for (const contact of data?.contacts ?? []) map.set(contact.email.toLowerCase(), contact);
    return map;
  }, [data?.contacts]);
  const seatEmails = useMemo(() => {
    const set = new Set<string>();
    for (const access of data?.access ?? []) set.add(access.email.toLowerCase());
    return set;
  }, [data?.access]);
  const contactsWithoutSeat = (data?.contacts ?? []).filter(
    (contact: ClientContactRow) => !seatEmails.has(contact.email.toLowerCase()),
  );
  const contactForAccess = (access: ProjectClientAccessRow) =>
    (access.contact_id ? contactsById.get(access.contact_id) : undefined) ??
    contactsByEmail.get(access.email.toLowerCase());

  const visibleCount = (data?.changeOrders ?? []).filter(
    (co: ClientPortalChangeOrder) => co.client_visible,
  ).length;
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

  const matrixColumns = 7;

  return (
    <div className="space-y-5">
      <div className="rounded-lg border border-hairline bg-card p-6 shadow-card">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <span className="eyebrow rounded-md border border-hairline px-2 py-0.5">
              Control side
            </span>
            <h2 className="mt-3 max-w-[32ch] font-serif text-3xl font-normal leading-[1.16]">
              One matrix — every client seat, and exactly what each can see.
            </h2>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Turn a module on per seat, then send the magic link. Anything not switched on here
              never reaches the client.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 lg:w-[440px]">
            <PortalMetric label="Client seats" value={String(data.access.length)} />
            <PortalMetric label="Shared COs" value={String(visibleCount)} />
            <PortalMetric label="Approved" value={String(approvedCount)} />
          </div>
        </div>
      </div>

      <section className="overflow-hidden rounded-xl border border-hairline bg-card shadow-card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead>
              <tr className="border-b border-hairline text-left">
                <MatrixHeader>Client seat</MatrixHeader>
                <MatrixHeader center>Change orders</MatrixHeader>
                <MatrixHeader center>Daily reports</MatrixHeader>
                <MatrixHeader center>Billing</MatrixHeader>
                <MatrixHeader center>Selections</MatrixHeader>
                <MatrixHeader center>Status</MatrixHeader>
                <MatrixHeader center>Link</MatrixHeader>
              </tr>
            </thead>
            <tbody>
              {data.access.length === 0 && contactsWithoutSeat.length === 0 ? (
                <tr>
                  <td
                    colSpan={matrixColumns}
                    className="px-4 py-8 text-center text-sm text-muted-foreground"
                  >
                    No client contacts yet. Add a client seat below to invite the owner or client
                    rep.
                  </td>
                </tr>
              ) : (
                <>
                  {data.access.map((access: ProjectClientAccessRow) => {
                    const contact = contactForAccess(access);
                    const displayName = contact?.name || access.email;
                    return (
                      <tr key={access.id} className="border-b border-hairline last:border-b-0">
                        <td className="px-4 py-3.5">
                          <div className="text-[13.5px] font-semibold text-foreground">
                            {displayName}
                          </div>
                          <div className="mt-0.5 text-xs text-muted-foreground">
                            {contactSubLine(contact, access.email)}
                          </div>
                        </td>
                        <MatrixSwitchCell
                          checked={access.can_view_change_orders}
                          saving={isPermissionSaving(access.id, "can_view_change_orders")}
                          ariaLabel={`Change orders for ${displayName}`}
                          onChange={(value) =>
                            accessPermissionMutation.mutate({
                              accessId: access.id,
                              field: "can_view_change_orders",
                              value,
                            })
                          }
                        />
                        <MatrixSwitchCell
                          checked={access.can_view_daily_reports}
                          saving={isPermissionSaving(access.id, "can_view_daily_reports")}
                          ariaLabel={`Daily reports for ${displayName}`}
                          onChange={(value) =>
                            accessPermissionMutation.mutate({
                              accessId: access.id,
                              field: "can_view_daily_reports",
                              value,
                            })
                          }
                        />
                        <MatrixSwitchCell
                          checked={access.can_view_billing}
                          saving={isPermissionSaving(access.id, "can_view_billing")}
                          ariaLabel={`Billing for ${displayName}`}
                          onChange={(value) =>
                            accessPermissionMutation.mutate({
                              accessId: access.id,
                              field: "can_view_billing",
                              value,
                            })
                          }
                        />
                        <MatrixSwitchCell
                          checked={access.can_view_selections}
                          saving={isPermissionSaving(access.id, "can_view_selections")}
                          ariaLabel={`Selections for ${displayName}`}
                          onChange={(value) =>
                            accessPermissionMutation.mutate({
                              accessId: access.id,
                              field: "can_view_selections",
                              value,
                            })
                          }
                        />
                        <td className="px-4 py-3.5 text-center">
                          <span
                            className={`inline-flex rounded-full border px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.06em] ${seatStatusClass(access.status)}`}
                          >
                            {access.status}
                          </span>
                        </td>
                        <td className="px-4 py-3.5 text-center">
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex items-center gap-1">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs font-semibold text-clay hover:text-clay"
                                disabled={sendLinkMutation.isPending}
                                onClick={() => sendLinkMutation.mutate(access)}
                              >
                                {access.status === "active" && access.last_sent_at
                                  ? "Resend"
                                  : "Send link"}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground"
                                disabled={revokeAccessMutation.isPending}
                                onClick={() => revokeAccessMutation.mutate(access.id)}
                              >
                                Revoke
                              </Button>
                            </div>
                            {access.last_sent_at ? (
                              <span className="text-[10px] text-muted-foreground">
                                Sent {access.last_sent_at.slice(0, 10)}
                              </span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {contactsWithoutSeat.map((contact: ClientContactRow) => (
                    <tr key={contact.id} className="border-b border-hairline last:border-b-0">
                      <td className="px-4 py-3.5">
                        <div className="text-[13.5px] font-semibold text-foreground">
                          {contact.name}
                        </div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {contactSubLine(contact, contact.email)}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 text-center text-xs text-muted-foreground">—</td>
                      <td className="px-4 py-3.5 text-center text-xs text-muted-foreground">—</td>
                      <td className="px-4 py-3.5 text-center text-xs text-muted-foreground">—</td>
                      <td className="px-4 py-3.5 text-center text-xs text-muted-foreground">—</td>
                      <td className="px-4 py-3.5 text-center">
                        <span className="inline-flex rounded-full border border-hairline bg-muted/30 px-2.5 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.06em] text-muted-foreground">
                          No seat
                        </span>
                      </td>
                      <td className="px-4 py-3.5 text-center">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs font-semibold text-clay hover:text-clay"
                          disabled={grantAccessMutation.isPending}
                          onClick={() => grantAccessMutation.mutate(contact.id)}
                        >
                          Grant access
                        </Button>
                      </td>
                    </tr>
                  ))}
                </>
              )}
            </tbody>
          </table>
        </div>
        {addSeatOpen ? (
          <form
            className="space-y-4 border-t border-hairline p-4"
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
              <Field label="Phone">
                <Input
                  value={contactDraft.phone}
                  onChange={(event) =>
                    setContactDraft((draft) => ({ ...draft, phone: event.target.value }))
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
            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={saveContactMutation.isPending}>
                {saveContactMutation.isPending ? "Saving..." : "Save client contact"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => setAddSeatOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <button
            type="button"
            className="flex w-full items-center gap-2 border-t border-hairline px-4 py-3.5 text-left text-[13px] font-semibold text-clay hover:bg-muted/30"
            onClick={() => setAddSeatOpen(true)}
          >
            + Add a client seat
          </button>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <section className="rounded-xl border border-hairline bg-card p-5 shadow-card">
          <h3 className="font-serif text-xl font-normal">Change orders to share</h3>
          <div className="mt-3">
            {data.changeOrders.length === 0 ? (
              <div className="border-t border-hairline py-5 text-sm text-muted-foreground">
                No change orders are logged yet.
              </div>
            ) : (
              data.changeOrders.map((co: ClientPortalChangeOrder) => (
                <div key={co.id} className="flex items-center gap-3 border-t border-hairline py-3">
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-foreground">
                    {[co.number || "CO", co.description.split("\n")[0].trim()]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="shrink-0 font-serif text-sm">{fmtUSD(co.contract_amount)}</span>
                  <Switch
                    checked={co.client_visible}
                    disabled={visibilityMutation.isPending}
                    className="data-[state=checked]:bg-success"
                    aria-label={`Share ${co.number || "change order"} with the client`}
                    onCheckedChange={(value) =>
                      visibilityMutation.mutate({
                        changeOrderId: co.id,
                        client_visible: value,
                      })
                    }
                  />
                </div>
              ))
            )}
          </div>

          {data.changeOrders.length > 0 ? (
            <details className="mt-4 rounded-md border border-hairline">
              <summary className="cursor-pointer select-none px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                Response detail
              </summary>
              <div className="overflow-x-auto border-t border-hairline">
                <table className="w-full min-w-[640px] text-sm">
                  <thead className="bg-muted/45 text-left font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    <tr>
                      <th className="px-3 py-3 font-bold">CO</th>
                      <th className="px-3 py-3 font-bold">Amount</th>
                      <th className="px-3 py-3 font-bold">Internal status</th>
                      <th className="px-3 py-3 font-bold">Client status</th>
                      <th className="px-3 py-3 font-bold">Latest response</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.changeOrders.map((co: ClientPortalChangeOrder) => {
                      const approval = latestApprovalFor(data.approvals, co.id);
                      return (
                        <tr key={co.id} className="border-t border-hairline">
                          <td className="px-3 py-3 align-top">
                            <div className="font-medium text-foreground">{co.number || "CO"}</div>
                            <div className="mt-1 max-w-md text-xs text-muted-foreground">
                              {co.description}
                            </div>
                          </td>
                          <td className="px-3 py-3 align-top font-serif">
                            {fmtUSD(co.contract_amount)}
                          </td>
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
                              <span className="text-xs text-muted-foreground">
                                No response yet.
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </section>

        <section className="rounded-xl border border-hairline bg-background p-5 shadow-card">
          <div className="eyebrow">Client link · read-only</div>
          <div className="mt-2 truncate text-[13px] text-foreground">{portalUrl}</div>
          <div className="mt-3 flex flex-wrap gap-2">
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
              <ExternalLink className="h-3.5 w-3.5" /> Preview as client
            </Button>
          </div>
          <p className="mt-3.5 text-xs leading-relaxed text-muted-foreground">
            A seat only sees the modules switched on in its row. The link is per-person and expires
            — nothing is public.
          </p>
        </section>
      </div>
    </div>
  );
}

function MatrixHeader({ children, center }: { children: ReactNode; center?: boolean }) {
  return (
    <th
      className={`px-4 py-3 font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground ${center ? "text-center" : "text-left"}`}
    >
      {children}
    </th>
  );
}

function MatrixSwitchCell({
  checked,
  saving,
  ariaLabel,
  onChange,
}: {
  checked: boolean;
  saving: boolean;
  ariaLabel: string;
  onChange: (value: boolean) => void;
}) {
  return (
    <td className="px-4 py-3.5 text-center">
      <Switch
        checked={checked}
        disabled={saving}
        className="data-[state=checked]:bg-success"
        aria-label={ariaLabel}
        onCheckedChange={onChange}
      />
    </td>
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

function PortalMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-hairline bg-muted/30 p-3">
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 font-serif text-2xl text-foreground">{value}</div>
    </div>
  );
}
