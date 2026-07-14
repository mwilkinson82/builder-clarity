import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarClock, Mail, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { sendTransactionalEmail } from "@/lib/email/send";
import { selectionDateHealth, type SelectionProcurementStatus } from "@/lib/selections-domain";
import {
  deleteProjectSelection,
  listProjectSelections,
  saveProjectSelection,
  sendSelectionForClientDecision,
  updateSelectionProcurementStatus,
  type ProjectSelectionRow,
  type SelectionApprovalGateEntry,
} from "@/lib/selections.functions";
import {
  SelectionEditorDialog,
  type SelectionEditorDraft,
} from "@/components/outcome/SelectionEditorDialog";

interface SelectionsWorkspaceProps {
  projectId: string;
}

type BoardColumn = "draft" | "owner" | "approved" | "ordered" | "complete";

const boardColumns: Array<{ key: BoardColumn; label: string; sub: string }> = [
  { key: "draft", label: "Build package", sub: "Link CPM and define the gate" },
  { key: "owner", label: "Approval gate", sub: "Owner, submittal, or RFI" },
  { key: "approved", label: "Ready to order", sub: "Gate cleared, not released" },
  { key: "ordered", label: "In procurement", sub: "Ordered or shipped" },
  { key: "complete", label: "Received", sub: "Received or installed" },
];

function columnFor(selection: ProjectSelectionRow): BoardColumn {
  if (["received", "installed"].includes(selection.procurement_status)) return "complete";
  if (["ordered", "shipped"].includes(selection.procurement_status)) return "ordered";
  if (selection.decision_status === "approved") return "approved";
  if (["sent", "revision_requested"].includes(selection.decision_status)) return "owner";
  return "draft";
}

function decisionLabel(selection: ProjectSelectionRow) {
  if (selection.approval_gate_override_acknowledged) return "Manual release";
  if (selection.decision_status === "revision_requested") return "Revision requested";
  if (selection.decision_status === "approved") {
    if (selection.approval_gate_type === "submittal") return "Submittal approved";
    if (selection.approval_gate_type === "rfi") return "RFI answered";
    return "Owner approved";
  }
  if (selection.decision_status === "sent") return "Awaiting approval";
  return "Draft";
}

function approvalGateLabel(selection: ProjectSelectionRow) {
  if (selection.approval_gate_type === "submittal") return "Submittal gate";
  if (selection.approval_gate_type === "rfi") return "RFI gate";
  return "Owner gate";
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(value: string | null) {
  if (!value) return "Not scheduled";
  return dateFormatter.format(new Date(`${value}T12:00:00`));
}

export function SelectionsWorkspace({ projectId }: SelectionsWorkspaceProps) {
  const queryClient = useQueryClient();
  const loadSelections = useServerFn(listProjectSelections);
  const saveSelection = useServerFn(saveProjectSelection);
  const deleteSelection = useServerFn(deleteProjectSelection);
  const sendSelection = useServerFn(sendSelectionForClientDecision);
  const updateProcurement = useServerFn(updateSelectionProcurementStatus);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSelection, setEditingSelection] = useState<ProjectSelectionRow | null>(null);

  const selectionQuery = useQuery({
    queryKey: ["project-selections", projectId],
    queryFn: () => loadSelections({ data: { projectId } }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["project-selections", projectId] });

  const saveMutation = useMutation({
    mutationFn: (draft: SelectionEditorDraft) =>
      saveSelection({
        data: {
          projectId,
          selectionId: editingSelection?.id,
          ...draft,
          options: draft.options.filter((option) => option.title.trim()),
        },
      }),
    onSuccess: async () => {
      setEditorOpen(false);
      setEditingSelection(null);
      await invalidate();
      toast.success("Selection package saved");
    },
    onError: (error) =>
      toast.error("Selection did not save", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (selectionId: string) => deleteSelection({ data: { selectionId } }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Selection deleted");
    },
    onError: (error) =>
      toast.error("Selection did not delete", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  const procurementMutation = useMutation({
    mutationFn: (input: { selectionId: string; status: SelectionProcurementStatus }) =>
      updateProcurement({ data: input }),
    onSuccess: async () => {
      await invalidate();
      toast.success("Procurement status updated");
    },
    onError: (error) =>
      toast.error("Procurement status did not update", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  const sendMutation = useMutation({
    mutationFn: async (selectionId: string) => {
      const payload = await sendSelection({ data: { selectionId } });
      const portalUrl = `${window.location.origin}/client/projects/${projectId}`;
      await sendTransactionalEmail({
        templateName: "selection-notification",
        recipientEmail: payload.recipientEmail,
        idempotencyKey: `selection-${payload.selectionId}-${payload.clientSentAt}`,
        templateData: { ...payload, portalUrl },
      });
      return payload;
    },
    onSuccess: async (payload) => {
      await invalidate();
      toast.success("Selection sent for owner approval", {
        description: payload.recipientEmail,
      });
    },
    onError: async (error) => {
      await invalidate();
      toast.error("Selection notification did not complete", {
        description:
          error instanceof Error
            ? error.message
            : "The portal record may be ready; check it before retrying the email.",
      });
    },
  });

  const data = selectionQuery.data;
  const selections = useMemo(() => data?.selections ?? [], [data?.selections]);
  const grouped = useMemo(
    () =>
      Object.fromEntries(
        boardColumns.map((column) => [
          column.key,
          selections.filter((selection) => columnFor(selection) === column.key),
        ]),
      ) as Record<BoardColumn, ProjectSelectionRow[]>,
    [selections],
  );
  const overdueCount = selections.filter(
    (selection) =>
      selection.decision_status !== "approved" &&
      selectionDateHealth(selection.client_decision_due_date) === "overdue",
  ).length;

  const openNew = () => {
    setEditingSelection(null);
    setEditorOpen(true);
  };
  const openEdit = (selection: ProjectSelectionRow) => {
    setEditingSelection(selection);
    setEditorOpen(true);
  };

  if (selectionQuery.isLoading) {
    return <div className="h-48 animate-pulse rounded-xl border border-hairline bg-card" />;
  }
  if (selectionQuery.error) {
    return (
      <div className="rounded-xl border border-danger/30 bg-danger/10 p-5 text-sm text-danger">
        {selectionQuery.error instanceof Error
          ? selectionQuery.error.message
          : "Selections did not load."}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 border-b border-hairline pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="eyebrow">Plan & Procurement · Selections and Material Procurement</p>
          <h2 className="font-serif text-3xl">
            Clear the approval gate before materials delay the work.
          </h2>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            The CPM install activity sets the need-on-site date. Overwatch works backward through
            lead time and review time, then holds procurement until the required owner decision,
            submittal approval, or RFI response clears the package for release.
          </p>
        </div>
        <Button variant="signal" onClick={openNew}>
          <Plus className="h-4 w-4" /> Add selection
        </Button>
      </header>

      {data?.migrationRequired ? (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 text-sm">
          The selections code is ready, but the database migration has not been applied yet. Apply
          the merged selections migration through Lovable before using this workspace.
        </div>
      ) : null}

      <section className="grid overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-2">
        <div className="bg-card p-4">
          <p className="eyebrow">Residential approval gate</p>
          <p className="mt-2 text-sm font-semibold">Owner selects and approves an option</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            The client portal records the exact approved option and package version before the
            material moves to Ready to order.
          </p>
        </div>
        <div className="bg-card p-4">
          <p className="eyebrow">Commercial & public works gate</p>
          <p className="mt-2 text-sm font-semibold">Submittal or RFI response authorizes release</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            Approved or approved-as-noted submittals—and answered RFIs when applicable—become the
            procurement release record tied to the material package.
          </p>
        </div>
      </section>

      <div className="grid gap-px overflow-hidden rounded-xl border border-hairline bg-hairline sm:grid-cols-3">
        <Metric
          label="Open packages"
          value={String(
            selections.filter((item) => item.procurement_status !== "installed").length,
          )}
        />
        <Metric label="Waiting on approval" value={String(grouped.owner.length)} />
        <Metric
          label="Overdue decisions"
          value={String(overdueCount)}
          tone={overdueCount > 0 ? "danger" : "default"}
        />
      </div>

      {selections.length === 0 ? (
        <button
          type="button"
          onClick={openNew}
          className="w-full rounded-xl border border-dashed border-hairline bg-card p-10 text-center transition hover:bg-secondary/40"
        >
          <CalendarClock className="mx-auto h-6 w-6 text-clay" />
          <p className="mt-3 font-serif text-xl">No material packages tracked yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Add the first package, connect it to CPM, and define what approval releases it.
          </p>
        </button>
      ) : (
        <div className="grid gap-4 xl:grid-cols-5">
          {boardColumns.map((column) => (
            <section
              key={column.key}
              className="min-w-0 rounded-xl border border-hairline bg-card p-3"
            >
              <div className="mb-3 flex items-start justify-between gap-2 border-b border-hairline pb-3">
                <div>
                  <h3 className="text-sm font-semibold">{column.label}</h3>
                  <p className="text-[11px] text-muted-foreground">{column.sub}</p>
                </div>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold">
                  {grouped[column.key].length}
                </span>
              </div>
              <div className="space-y-3">
                {grouped[column.key].map((selection) => (
                  <SelectionCard
                    key={selection.id}
                    selection={selection}
                    approvalGateEntry={(data?.approvalGateEntries ?? []).find(
                      (entry) => entry.id === selection.approval_gate_entry_id,
                    )}
                    sending={sendMutation.isPending && sendMutation.variables === selection.id}
                    updating={
                      procurementMutation.isPending &&
                      procurementMutation.variables?.selectionId === selection.id
                    }
                    onEdit={() => openEdit(selection)}
                    onSend={() => sendMutation.mutate(selection.id)}
                    onDelete={() => {
                      if (
                        window.confirm(`Delete ${selection.selection_number} — ${selection.title}?`)
                      ) {
                        deleteMutation.mutate(selection.id);
                      }
                    }}
                    onProcurementStatus={(status) =>
                      procurementMutation.mutate({ selectionId: selection.id, status })
                    }
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      <SelectionEditorDialog
        open={editorOpen}
        selection={editingSelection}
        scheduleActivities={data?.scheduleActivities ?? []}
        clientSeats={data?.clientSeats ?? []}
        approvalGateEntries={data?.approvalGateEntries ?? []}
        saving={saveMutation.isPending}
        onOpenChange={(open) => {
          setEditorOpen(open);
          if (!open) setEditingSelection(null);
        }}
        onSave={(draft) => saveMutation.mutate(draft)}
      />
    </div>
  );
}

function SelectionCard({
  selection,
  approvalGateEntry,
  sending,
  updating,
  onEdit,
  onSend,
  onDelete,
  onProcurementStatus,
}: {
  selection: ProjectSelectionRow;
  approvalGateEntry?: SelectionApprovalGateEntry;
  sending: boolean;
  updating: boolean;
  onEdit: () => void;
  onSend: () => void;
  onDelete: () => void;
  onProcurementStatus: (status: SelectionProcurementStatus) => void;
}) {
  const health = selectionDateHealth(selection.client_decision_due_date);
  return (
    <article className="rounded-lg border border-hairline bg-background p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-clay">
            {selection.selection_number} · v{selection.version}
          </p>
          <h4 className="mt-1 text-sm font-semibold leading-snug">{selection.title}</h4>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {[selection.room_area, selection.category].filter(Boolean).join(" · ") ||
              "Uncategorized"}
          </p>
        </div>
        <div className="flex shrink-0">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onEdit}
            aria-label={`Edit ${selection.title}`}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={onDelete}
            aria-label={`Delete ${selection.title}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 space-y-1.5 text-xs">
        <p
          className={cn(
            "flex justify-between gap-2",
            health === "overdue" && selection.decision_status !== "approved"
              ? "font-semibold text-danger"
              : "text-muted-foreground",
          )}
        >
          <span>Approval due</span>
          <span>{formatDate(selection.client_decision_due_date)}</span>
        </p>
        <p className="flex justify-between gap-2 text-muted-foreground">
          <span>Order by</span>
          <span>{formatDate(selection.order_by_date)}</span>
        </p>
        <p className="flex justify-between gap-2 text-muted-foreground">
          <span>Need on site</span>
          <span>{formatDate(selection.need_on_site_date)}</span>
        </p>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <span className="rounded-full border border-hairline px-2 py-0.5 text-[10px] text-muted-foreground">
          {approvalGateLabel(selection)}
        </span>
        <span
          className={cn(
            "rounded-full border px-2 py-0.5 text-[10px] font-semibold",
            selection.decision_status === "approved"
              ? "border-success/40 bg-success/10 text-success"
              : selection.decision_status === "revision_requested"
                ? "border-warning/40 bg-warning/10 text-warning"
                : "border-hairline text-muted-foreground",
          )}
        >
          {decisionLabel(selection)}
        </span>
        <span className="rounded-full border border-hairline px-2 py-0.5 text-[10px] text-muted-foreground">
          {selection.options.length} option{selection.options.length === 1 ? "" : "s"}
        </span>
      </div>

      {approvalGateEntry ? (
        <p className="mt-2 text-[11px] leading-4 text-muted-foreground">
          Release record: {approvalGateEntry.number || approvalGateLabel(selection)} ·{" "}
          {approvalGateEntry.item || approvalGateEntry.description || "Untitled"}
        </p>
      ) : selection.approval_gate_override_acknowledged ? (
        <p className="mt-2 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
          Manual release: {selection.approval_gate_override_reason}
        </p>
      ) : null}

      {selection.approval_gate_type === "owner_selection" &&
      selection.decision_status !== "approved" ? (
        <Button
          className="mt-3 w-full"
          size="sm"
          variant="outline"
          disabled={sending}
          onClick={onSend}
        >
          <Mail className="h-3.5 w-3.5" />{" "}
          {sending
            ? "Sending…"
            : selection.decision_status === "revision_requested"
              ? "Resend revision"
              : selection.decision_status === "sent"
                ? "Resend to owner"
                : "Send to owner"}
        </Button>
      ) : null}

      {selection.decision_status === "approved" ||
      selection.procurement_status !== "not_released" ? (
        <div className="mt-3">
          <Select
            value={selection.procurement_status}
            disabled={updating}
            onValueChange={(value) => onProcurementStatus(value as SelectionProcurementStatus)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="not_released">Ready to order</SelectItem>
              <SelectItem value="ordered">Ordered</SelectItem>
              <SelectItem value="shipped">Shipped</SelectItem>
              <SelectItem value="received">Received</SelectItem>
              <SelectItem value="installed">Installed</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : null}
    </article>
  );
}

function Metric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger";
}) {
  return (
    <div className="bg-card p-4">
      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1 font-serif text-2xl", tone === "danger" && "text-danger")}>{value}</p>
    </div>
  );
}
