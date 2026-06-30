import { useMemo, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Bell,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Clock3,
  Link2,
  Mail,
  Pencil,
  Plus,
  Search,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  DecisionOwnerOption,
  DecisionReminderChannel,
  DecisionRow,
  DecisionStatus,
  ExposureRow,
} from "@/lib/projects.functions";

const statusStyles: Record<DecisionStatus, string> = {
  open: "border-hairline bg-secondary text-foreground",
  in_progress: "border-accent/30 bg-accent/15 text-accent",
  resolved: "border-success/30 bg-success/15 text-success",
  overdue: "border-danger/30 bg-danger/15 text-danger",
};

const statusLabels: Record<DecisionStatus, string> = {
  open: "Open",
  in_progress: "In Progress",
  resolved: "Resolved",
  overdue: "Overdue",
};

const reminderChannelLabels: Record<DecisionReminderChannel, string> = {
  none: "No message",
  in_app: "In-app",
  email: "Email",
};

type TodoFilter = "all" | DecisionStatus | "due_soon" | "risk_linked";
type OwnerChoice = {
  value: string;
  label: string;
  email: string;
  role: string;
  scope: "project" | "company" | "record";
  userId: string | null;
};

export type DecisionDraft = {
  decision: string;
  impact: string;
  owner: string;
  owner_email: string;
  owner_user_id: string | null;
  due_date: string | null;
  status: DecisionStatus;
  linked_exposure_id: string | null;
  linked_co_id: string | null;
  reminder_enabled: boolean;
  reminder_at: string | null;
  reminder_channel: DecisionReminderChannel;
  notes: string;
};

const empty: DecisionDraft = {
  decision: "",
  impact: "",
  owner: "",
  owner_email: "",
  owner_user_id: null,
  due_date: null,
  status: "open",
  linked_exposure_id: null,
  linked_co_id: null,
  reminder_enabled: false,
  reminder_at: null,
  reminder_channel: "none",
  notes: "",
};

function fmtDate(d: string | null) {
  if (!d) return "Unscheduled";
  return new Date(`${d}T00:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

function fmtDateTime(value: string | null) {
  if (!value) return "Not set";
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function isPastDue(row: DecisionRow) {
  if (!row.due_date || row.status === "resolved") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(`${row.due_date}T00:00:00`).getTime() < today.getTime();
}

function isDueSoon(row: DecisionRow) {
  if (!row.due_date || row.status === "resolved") return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const due = new Date(`${row.due_date}T00:00:00`);
  const days = Math.ceil((due.getTime() - today.getTime()) / 86400000);
  return days >= 0 && days <= 7;
}

function toDateTimeInput(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function fromDateTimeInput(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function defaultReminderTime(dueDate: string | null) {
  if (!dueDate) return "";
  return `${dueDate}T08:00`;
}

function getInitials(name: string, email: string) {
  const source = name || email || "Unassigned";
  return source
    .split(/[\s@._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

function riskTitle(exposures: ExposureRow[], id: string | null) {
  if (!id) return "";
  return exposures.find((e) => e.id === id)?.title ?? "Linked risk";
}

function selectedOwnerValue(draft: DecisionDraft, ownerChoices: OwnerChoice[]) {
  if (draft.owner_user_id && ownerChoices.some((owner) => owner.userId === draft.owner_user_id)) {
    return `user:${draft.owner_user_id}`;
  }
  const match = ownerChoices.find(
    (owner) =>
      owner.label === draft.owner ||
      Boolean(draft.owner_email && owner.email === draft.owner_email),
  );
  return match ? match.value : "custom";
}

function normalizeDraftForSave(draft: DecisionDraft): DecisionDraft {
  const reminderAt =
    draft.reminder_enabled && draft.reminder_at
      ? (fromDateTimeInput(draft.reminder_at) ?? draft.reminder_at)
      : null;
  return {
    ...draft,
    decision: draft.decision.trim(),
    impact: draft.impact.trim(),
    owner: draft.owner.trim(),
    owner_email: draft.owner_email.trim().toLowerCase(),
    due_date: draft.due_date || null,
    reminder_enabled: Boolean(draft.reminder_enabled && reminderAt),
    reminder_at: reminderAt,
    reminder_channel: draft.reminder_enabled ? draft.reminder_channel : "none",
    notes: draft.notes.trim(),
  };
}

export function DecisionsTable({
  decisions,
  exposures = [],
  ownerOptions = [],
  projectManager = "",
  onCreate,
  onUpdate,
  onDelete,
}: {
  decisions: DecisionRow[];
  exposures?: ExposureRow[];
  ownerOptions?: DecisionOwnerOption[];
  projectManager?: string;
  onCreate: (d: DecisionDraft) => void;
  onUpdate: (id: string, patch: Partial<DecisionDraft>) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DecisionDraft>(empty);
  const [filter, setFilter] = useState<TodoFilter>("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [query, setQuery] = useState("");

  const ownerChoices = useMemo(() => {
    const choices = new Map<string, OwnerChoice>();
    const addChoice = (choice: OwnerChoice) => {
      const key = `${choice.label.toLowerCase()}|${choice.email.toLowerCase()}`;
      if (!choices.has(key)) choices.set(key, choice);
    };

    ownerOptions.forEach((owner) =>
      addChoice({
        value: `user:${owner.user_id}`,
        label: owner.label,
        email: owner.email,
        role: owner.role,
        scope: owner.scope,
        userId: owner.user_id,
      }),
    );

    if (projectManager.trim()) {
      addChoice({
        value: `record:${projectManager.trim()}`,
        label: projectManager.trim(),
        email: "",
        role: "Project manager",
        scope: "record",
        userId: null,
      });
    }

    decisions.forEach((decision) => {
      if (!decision.owner.trim()) return;
      addChoice({
        value: `record:${decision.owner.trim()}`,
        label: decision.owner.trim(),
        email: decision.owner_email,
        role: "Project owner",
        scope: "record",
        userId: null,
      });
    });

    return Array.from(choices.values()).sort(
      (a, b) =>
        (a.scope === "project" ? 0 : a.scope === "company" ? 1 : 2) -
          (b.scope === "project" ? 0 : b.scope === "company" ? 1 : 2) ||
        a.label.localeCompare(b.label),
    );
  }, [decisions, ownerOptions, projectManager]);

  const knownOwners = useMemo(() => {
    const byName = new Map<string, { label: string; email: string }>();
    ownerChoices.forEach((owner) => {
      byName.set(owner.label, { label: owner.label, email: owner.email });
    });
    decisions.forEach((decision) => {
      const label = decision.owner || "Unassigned";
      if (!byName.has(label)) byName.set(label, { label, email: decision.owner_email });
    });
    return Array.from(byName.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [decisions, ownerChoices]);

  const metrics = useMemo(() => {
    const openCount = decisions.filter((d) => d.status !== "resolved").length;
    const overdueCount = decisions.filter((d) => d.status === "overdue" || isPastDue(d)).length;
    const dueSoonCount = decisions.filter(isDueSoon).length;
    const riskLinkedCount = decisions.filter((d) => Boolean(d.linked_exposure_id)).length;
    return { openCount, overdueCount, dueSoonCount, riskLinkedCount };
  }, [decisions]);

  const filteredDecisions = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return decisions.filter((decision) => {
      const statusMatch =
        filter === "all" ||
        decision.status === filter ||
        (filter === "due_soon" && isDueSoon(decision)) ||
        (filter === "risk_linked" && Boolean(decision.linked_exposure_id));
      const ownerMatch = ownerFilter === "all" || (decision.owner || "Unassigned") === ownerFilter;
      const text = [
        decision.decision,
        decision.impact,
        decision.owner,
        decision.owner_email,
        riskTitle(exposures, decision.linked_exposure_id),
      ]
        .join(" ")
        .toLowerCase();
      return statusMatch && ownerMatch && (!normalizedQuery || text.includes(normalizedQuery));
    });
  }, [decisions, exposures, filter, ownerFilter, query]);

  const openNew = () => {
    setEditingId(null);
    setDraft(empty);
    setOpen(true);
  };

  const openEdit = (d: DecisionRow) => {
    setEditingId(d.id);
    setDraft({
      decision: d.decision,
      impact: d.impact,
      owner: d.owner,
      owner_email: d.owner_email,
      owner_user_id: d.owner_user_id,
      due_date: d.due_date,
      status: d.status,
      linked_exposure_id: d.linked_exposure_id,
      linked_co_id: d.linked_co_id,
      reminder_enabled: d.reminder_enabled,
      reminder_at: toDateTimeInput(d.reminder_at),
      reminder_channel: d.reminder_channel,
      notes: d.notes,
    });
    setOpen(true);
  };

  const save = () => {
    if (!draft.decision.trim()) return;
    const payload = normalizeDraftForSave(draft);
    if (editingId) onUpdate(editingId, payload);
    else onCreate(payload);
    setOpen(false);
  };

  const selectOwner = (value: string) => {
    if (value === "custom") {
      setDraft({ ...draft, owner_user_id: null });
      return;
    }
    const owner = ownerChoices.find((option) => option.value === value);
    if (!owner) return;
    setDraft({
      ...draft,
      owner: owner.label,
      owner_email: owner.email,
      owner_user_id: owner.userId,
    });
  };

  const deleteDecision = (decision: DecisionRow) => {
    if (window.confirm(`Delete "${decision.decision}"?`)) onDelete(decision.id);
  };

  return (
    <div className="w-[calc(100vw-2rem)] min-w-0 max-w-full space-y-4 sm:w-full">
      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-lg border border-hairline bg-card p-4 shadow-card md:p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile icon={CircleDot} label="Open" value={metrics.openCount} />
            <MetricTile
              icon={AlertTriangle}
              label="Overdue"
              value={metrics.overdueCount}
              tone="danger"
            />
            <MetricTile
              icon={Clock3}
              label="Due soon"
              value={metrics.dueSoonCount}
              tone="warning"
            />
            <MetricTile
              icon={Link2}
              label="Risk-linked"
              value={metrics.riskLinkedCount}
              tone="accent"
            />
          </div>
          <Button onClick={openNew} className="w-full shrink-0 gap-1.5 sm:w-auto">
            <Plus className="h-4 w-4" />
            Add to-do
          </Button>
        </div>

        <div className="mt-5 grid gap-3 xl:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)_240px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search to-dos"
              className="pl-9"
            />
          </div>
          <div className="flex gap-1 overflow-x-auto rounded-md border border-hairline bg-surface p-1">
            {[
              ["all", "All"],
              ["open", "Open"],
              ["in_progress", "In progress"],
              ["overdue", "Overdue"],
              ["due_soon", "Due soon"],
              ["risk_linked", "Risk-linked"],
              ["resolved", "Resolved"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                onClick={() => setFilter(value as TodoFilter)}
                className={cn(
                  "h-8 shrink-0 rounded px-3 text-xs font-medium transition",
                  filter === value
                    ? "bg-foreground text-background shadow-sm"
                    : "text-muted-foreground hover:bg-card hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All owners</SelectItem>
              {knownOwners.map((owner) => (
                <SelectItem key={owner.label} value={owner.label}>
                  {owner.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-3 md:hidden">
        {filteredDecisions.map((decision) => (
          <div
            key={decision.id}
            className="rounded-lg border border-hairline bg-card p-3 shadow-card"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium leading-snug text-foreground">{decision.decision}</div>
                {decision.impact && (
                  <div className="mt-1 text-sm leading-5 text-muted-foreground">
                    {decision.impact}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8"
                  onClick={() => openEdit(decision)}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  <span className="sr-only">Edit to-do</span>
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-muted-foreground hover:text-danger"
                  onClick={() => deleteDecision(decision)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span className="sr-only">Delete to-do</span>
                </Button>
              </div>
            </div>

            <div className="mt-3 grid gap-2">
              {decision.linked_exposure_id && (
                <div className="inline-flex w-fit max-w-full items-center gap-1 rounded border border-accent/20 bg-accent/10 px-2 py-1 text-xs font-medium text-accent">
                  <Link2 className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    {riskTitle(exposures, decision.linked_exposure_id)}
                  </span>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface px-2 py-1">
                  <UserRound className="h-3.5 w-3.5" />
                  {decision.owner || "Unassigned"}
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-1 rounded-md border px-2 py-1 font-medium",
                    isPastDue(decision)
                      ? "border-danger/30 bg-danger/10 text-danger"
                      : isDueSoon(decision)
                        ? "border-warning/40 bg-warning/10 text-foreground"
                        : "border-hairline bg-surface text-muted-foreground",
                  )}
                >
                  <CalendarClock className="h-3.5 w-3.5" />
                  {fmtDate(decision.due_date)}
                </span>
                {decision.reminder_enabled && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-hairline bg-surface px-2 py-1">
                    <Bell className="h-3.5 w-3.5" />
                    {fmtDateTime(decision.reminder_at)}
                  </span>
                )}
              </div>
              <Select
                value={decision.status}
                onValueChange={(value) =>
                  onUpdate(decision.id, { status: value as DecisionStatus })
                }
              >
                <SelectTrigger className={cn("h-9 w-full text-xs", statusStyles[decision.status])}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(statusLabels) as DecisionStatus[]).map((status) => (
                    <SelectItem key={status} value={status}>
                      {statusLabels[status]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        ))}
        {filteredDecisions.length === 0 && (
          <div className="rounded-lg border border-hairline bg-card p-6 text-center shadow-card">
            <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md border border-hairline bg-surface">
                <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <div className="font-medium text-foreground">No matching to-dos</div>
                <div className="mt-1 text-sm text-muted-foreground">
                  Clear filters or add the next owned action.
                </div>
              </div>
              <Button onClick={openNew} size="sm" className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add to-do
              </Button>
            </div>
          </div>
        )}
      </div>

      <div className="hidden overflow-x-auto rounded-lg border border-hairline bg-card shadow-card md:block">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface">
              <TableHead className="min-w-[320px]">To-do</TableHead>
              <TableHead className="hidden min-w-[180px] 2xl:table-cell">Risk link</TableHead>
              <TableHead className="min-w-[180px]">Owner</TableHead>
              <TableHead className="min-w-[150px]">Due</TableHead>
              <TableHead className="hidden min-w-[160px] 2xl:table-cell">Reminder</TableHead>
              <TableHead className="min-w-[150px]">Status</TableHead>
              <TableHead className="w-[86px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDecisions.map((decision) => (
              <TableRow key={decision.id} className="align-top">
                <TableCell>
                  <div className="max-w-xl">
                    <div className="font-medium leading-snug text-foreground">
                      {decision.decision}
                    </div>
                    {decision.impact && (
                      <div className="mt-1 line-clamp-2 text-sm leading-5 text-muted-foreground">
                        {decision.impact}
                      </div>
                    )}
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground 2xl:hidden">
                      {decision.linked_exposure_id && (
                        <span className="inline-flex items-center gap-1 rounded border border-accent/20 bg-accent/10 px-2 py-0.5 text-accent">
                          <Link2 className="h-3 w-3" />
                          {riskTitle(exposures, decision.linked_exposure_id)}
                        </span>
                      )}
                      {decision.reminder_enabled && (
                        <span className="inline-flex items-center gap-1 rounded border border-hairline bg-surface px-2 py-0.5">
                          <Bell className="h-3 w-3" />
                          {fmtDateTime(decision.reminder_at)}
                        </span>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden 2xl:table-cell">
                  {decision.linked_exposure_id ? (
                    <div className="max-w-[220px]">
                      <div className="inline-flex items-center gap-1.5 rounded-md border border-accent/20 bg-accent/10 px-2 py-1 text-xs font-medium text-accent">
                        <Link2 className="h-3.5 w-3.5" />
                        <span className="truncate">
                          {riskTitle(exposures, decision.linked_exposure_id)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Standalone</span>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex min-w-0 items-center gap-2">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-hairline bg-surface text-[11px] font-semibold text-muted-foreground">
                      {getInitials(decision.owner, decision.owner_email) || (
                        <UserRound className="h-3.5 w-3.5" />
                      )}
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {decision.owner || "Unassigned"}
                      </div>
                      {decision.owner_email && (
                        <div className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate">{decision.owner_email}</span>
                        </div>
                      )}
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <div
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium",
                      isPastDue(decision)
                        ? "border-danger/30 bg-danger/10 text-danger"
                        : isDueSoon(decision)
                          ? "border-warning/40 bg-warning/10 text-foreground"
                          : "border-hairline bg-surface text-muted-foreground",
                    )}
                  >
                    <CalendarClock className="h-3.5 w-3.5" />
                    {fmtDate(decision.due_date)}
                  </div>
                </TableCell>
                <TableCell className="hidden 2xl:table-cell">
                  {decision.reminder_enabled ? (
                    <div className="text-sm">
                      <div className="flex items-center gap-1.5 font-medium">
                        <Bell className="h-3.5 w-3.5 text-accent" />
                        {reminderChannelLabels[decision.reminder_channel]}
                      </div>
                      <div className="mt-0.5 text-xs text-muted-foreground">
                        {fmtDateTime(decision.reminder_at)}
                      </div>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Off</span>
                  )}
                </TableCell>
                <TableCell>
                  <Select
                    value={decision.status}
                    onValueChange={(value) =>
                      onUpdate(decision.id, { status: value as DecisionStatus })
                    }
                  >
                    <SelectTrigger
                      className={cn("h-8 w-[140px] text-xs", statusStyles[decision.status])}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(statusLabels) as DecisionStatus[]).map((status) => (
                        <SelectItem key={status} value={status}>
                          {statusLabels[status]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => openEdit(decision)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span className="sr-only">Edit to-do</span>
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-muted-foreground hover:text-danger"
                      onClick={() => deleteDecision(decision)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="sr-only">Delete to-do</span>
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {filteredDecisions.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="py-14 text-center">
                  <div className="mx-auto flex max-w-sm flex-col items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-hairline bg-surface">
                      <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div>
                      <div className="font-medium text-foreground">No matching to-dos</div>
                      <div className="mt-1 text-sm text-muted-foreground">
                        Clear filters or add the next owned action.
                      </div>
                    </div>
                    <Button onClick={openNew} size="sm" className="gap-1.5">
                      <Plus className="h-3.5 w-3.5" />
                      Add to-do
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-[1120px] overflow-y-auto p-0">
          <div className="min-w-0 space-y-6 p-6 md:p-8">
            <DialogHeader className="pr-10">
              <DialogTitle className="font-serif text-3xl leading-tight">
                {editingId ? "Edit to-do" : "Add to-do"}
              </DialogTitle>
            </DialogHeader>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.8fr)]">
              <div className="space-y-6">
                <section className="space-y-3">
                  <SectionTitle title="Action" />
                  <Field label="To-do">
                    <Input
                      value={draft.decision}
                      onChange={(event) => setDraft({ ...draft, decision: event.target.value })}
                      placeholder="Submit electrical CO package"
                    />
                  </Field>
                  <Field label="Action detail / impact">
                    <Textarea
                      rows={5}
                      value={draft.impact}
                      onChange={(event) => setDraft({ ...draft, impact: event.target.value })}
                      placeholder="What needs to happen, what risk it offsets, and what gets unlocked."
                    />
                  </Field>
                </section>

                <section className="space-y-3">
                  <SectionTitle title="Risk link" />
                  <Field label="Linked risk">
                    <Select
                      value={draft.linked_exposure_id ?? "none"}
                      onValueChange={(value) =>
                        setDraft({
                          ...draft,
                          linked_exposure_id: value === "none" ? null : value,
                        })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No linked risk</SelectItem>
                        {exposures.map((exposure) => (
                          <SelectItem key={exposure.id} value={exposure.id}>
                            {exposure.title}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </section>

                <section className="space-y-3">
                  <SectionTitle title="Notes" />
                  <Field label="Internal notes">
                    <Textarea
                      rows={4}
                      value={draft.notes}
                      onChange={(event) => setDraft({ ...draft, notes: event.target.value })}
                      placeholder="Meeting notes, escalation path, or follow-up context."
                    />
                  </Field>
                </section>
              </div>

              <div className="space-y-6">
                <section className="space-y-3 rounded-lg border border-hairline bg-surface p-4">
                  <SectionTitle title="Ownership" />
                  <Field label="Team member">
                    <Select
                      value={selectedOwnerValue(draft, ownerChoices)}
                      onValueChange={selectOwner}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ownerChoices.map((owner) => (
                          <SelectItem key={owner.value} value={owner.value}>
                            {owner.label}
                            {owner.scope === "company"
                              ? " · Company"
                              : owner.scope === "project"
                                ? " · Project"
                                : ` · ${owner.role}`}
                          </SelectItem>
                        ))}
                        <SelectItem value="custom">Outside team / manual</SelectItem>
                      </SelectContent>
                    </Select>
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <Field label="Owner name">
                      <Input
                        value={draft.owner}
                        onChange={(event) =>
                          setDraft({ ...draft, owner: event.target.value, owner_user_id: null })
                        }
                        placeholder="Marshall Wilkinson"
                      />
                    </Field>
                    <Field label="Owner email">
                      <Input
                        type="email"
                        value={draft.owner_email}
                        onChange={(event) =>
                          setDraft({ ...draft, owner_email: event.target.value })
                        }
                        placeholder="owner@company.com"
                      />
                    </Field>
                  </div>
                </section>

                <section className="space-y-3 rounded-lg border border-hairline bg-surface p-4">
                  <SectionTitle title="Schedule" />
                  <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                    <Field label="Due date">
                      <Input
                        type="date"
                        value={draft.due_date ?? ""}
                        onChange={(event) => {
                          const dueDate = event.target.value || null;
                          setDraft({
                            ...draft,
                            due_date: dueDate,
                            reminder_at:
                              draft.reminder_enabled && !draft.reminder_at
                                ? defaultReminderTime(dueDate)
                                : draft.reminder_at,
                          });
                        }}
                      />
                    </Field>
                    <Field label="Status">
                      <Select
                        value={draft.status}
                        onValueChange={(value) =>
                          setDraft({ ...draft, status: value as DecisionStatus })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {(Object.keys(statusLabels) as DecisionStatus[]).map((status) => (
                            <SelectItem key={status} value={status}>
                              {statusLabels[status]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                  </div>
                  <div className="rounded-md border border-hairline bg-card p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <Label className="text-sm font-medium">Reminder</Label>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {draft.reminder_enabled
                            ? fmtDateTime(fromDateTimeInput(draft.reminder_at))
                            : "Off"}
                        </div>
                      </div>
                      <Switch
                        checked={draft.reminder_enabled}
                        onCheckedChange={(checked) =>
                          setDraft({
                            ...draft,
                            reminder_enabled: checked,
                            reminder_channel: checked ? "email" : "none",
                            reminder_at:
                              checked && !draft.reminder_at
                                ? defaultReminderTime(draft.due_date)
                                : draft.reminder_at,
                          })
                        }
                      />
                    </div>
                    {draft.reminder_enabled && (
                      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
                        <Field label="Reminder time">
                          <Input
                            type="datetime-local"
                            value={draft.reminder_at ?? ""}
                            onChange={(event) =>
                              setDraft({ ...draft, reminder_at: event.target.value || null })
                            }
                          />
                        </Field>
                        <Field label="Channel">
                          <Select
                            value={draft.reminder_channel}
                            onValueChange={(value) =>
                              setDraft({
                                ...draft,
                                reminder_channel: value as DecisionReminderChannel,
                              })
                            }
                          >
                            <SelectTrigger>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="email">Email</SelectItem>
                              <SelectItem value="in_app">In-app</SelectItem>
                              <SelectItem value="none">No message</SelectItem>
                            </SelectContent>
                          </Select>
                        </Field>
                      </div>
                    )}
                  </div>
                </section>
              </div>
            </div>
          </div>

          <DialogFooter className="border-t border-hairline bg-surface px-6 py-4 md:px-8">
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!draft.decision.trim()}>
              {editingId ? "Save to-do" : "Add to-do"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MetricTile({
  icon: Icon,
  label,
  value,
  tone = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone?: "default" | "accent" | "warning" | "danger";
}) {
  return (
    <div className="rounded-md border border-hairline bg-surface px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
          {label}
        </span>
        <Icon
          className={cn(
            "h-3.5 w-3.5",
            tone === "accent" && "text-accent",
            tone === "warning" && "text-warning",
            tone === "danger" && "text-danger",
            tone === "default" && "text-muted-foreground",
          )}
        />
      </div>
      <div className="mt-1 text-2xl font-semibold tabular text-foreground">{value}</div>
    </div>
  );
}

function SectionTitle({ title }: { title: string }) {
  return <h3 className="font-serif text-xl leading-none text-foreground">{title}</h3>;
}

function Field({
  label,
  children,
  className,
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label>{label}</Label>
      {children}
    </div>
  );
}
