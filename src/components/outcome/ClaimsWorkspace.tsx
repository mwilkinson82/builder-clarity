import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState } from "@/components/ui/empty-state";
import { MoneyInput } from "@/components/ui/money-input";
import { History, Gavel, Pencil, Plus, Trash2 } from "lucide-react";
import { fmtUSD } from "@/lib/format";
import type {
  ClaimEventRow,
  ClaimEventType,
  ClaimRow,
  ClaimStatus,
  ClaimType,
} from "@/lib/projects.functions";

const CLAIM_TYPE_LABELS: Record<ClaimType, string> = {
  delay: "Delay",
  extension_of_time: "Extension of time",
  delay_damages: "Delay damages",
  acceleration: "Acceleration",
  disruption: "Disruption",
  other: "Other",
};

const CLAIM_STATUS_LABELS: Record<ClaimStatus, string> = {
  in_preparation: "In preparation",
  submitted: "Submitted",
  pending_review: "Pending review",
  under_review: "Under review",
  reviewed: "Reviewed",
  resolved: "Resolved",
  rejected: "Rejected",
  withdrawn: "Withdrawn",
};

// Pipeline order for the status picker — preparation → resolution.
const CLAIM_STATUS_ORDER: ClaimStatus[] = [
  "in_preparation",
  "submitted",
  "pending_review",
  "under_review",
  "reviewed",
  "resolved",
  "rejected",
  "withdrawn",
];

const CLAIM_TYPE_ORDER: ClaimType[] = [
  "delay",
  "extension_of_time",
  "delay_damages",
  "acceleration",
  "disruption",
  "other",
];

const EVENT_TYPE_LABELS: Record<ClaimEventType, string> = {
  submitted: "Submitted",
  received: "Received",
  reviewed: "Reviewed",
  meeting: "Meeting",
  returned_for_revision: "Returned for revision",
  resubmitted: "Resubmitted",
  resolved: "Resolved",
  other: "Other",
};

const EVENT_TYPE_ORDER: ClaimEventType[] = [
  "submitted",
  "received",
  "reviewed",
  "meeting",
  "returned_for_revision",
  "resubmitted",
  "resolved",
  "other",
];

const statusStyles: Record<ClaimStatus, string> = {
  in_preparation: "border-hairline bg-surface text-muted-foreground",
  submitted: "border-info/30 bg-info/10 text-info",
  pending_review: "border-warning/30 bg-warning/10 text-warning",
  under_review: "border-warning/30 bg-warning/10 text-warning",
  reviewed: "border-warning/30 bg-warning/10 text-warning",
  resolved: "border-success/30 bg-success/10 text-success",
  rejected: "border-danger/30 bg-danger/10 text-danger",
  withdrawn: "border-hairline bg-surface text-muted-foreground",
};

export type ClaimDraft = {
  claim_number: string;
  title: string;
  description: string;
  claim_type: ClaimType;
  status: ClaimStatus;
  money_claimed: number;
  time_claimed_days: number;
  money_awarded: number;
  time_awarded_days: number;
  outcome: string;
  owner: string;
  submitted_at: string | null;
  resolved_at: string | null;
};

export type ClaimPatch = Partial<ClaimDraft>;

export type ClaimEventDraft = {
  event_type: ClaimEventType;
  event_date: string | null;
  revision_number: number;
  note: string;
};

const emptyDraft = (): ClaimDraft => ({
  claim_number: "",
  title: "",
  description: "",
  claim_type: "delay",
  status: "in_preparation",
  money_claimed: 0,
  time_claimed_days: 0,
  money_awarded: 0,
  time_awarded_days: 0,
  outcome: "",
  owner: "",
  submitted_at: null,
  resolved_at: null,
});

const claimToDraft = (claim: ClaimRow): ClaimDraft => ({
  claim_number: claim.claim_number,
  title: claim.title,
  description: claim.description,
  claim_type: claim.claim_type,
  status: claim.status,
  money_claimed: claim.money_claimed,
  time_claimed_days: claim.time_claimed_days,
  money_awarded: claim.money_awarded,
  time_awarded_days: claim.time_awarded_days,
  outcome: claim.outcome,
  owner: claim.owner,
  submitted_at: claim.submitted_at,
  resolved_at: claim.resolved_at,
});

const fmtDays = (days: number) => (days > 0 ? `${days} d` : "—");

export function ClaimsWorkspace({
  claims,
  events = [],
  onCreate,
  onUpdate,
  onDelete,
  onCreateEvent,
  onDeleteEvent,
  saving = false,
}: {
  claims: ClaimRow[];
  events?: ClaimEventRow[];
  onCreate: (draft: ClaimDraft) => void;
  onUpdate: (id: string, patch: ClaimPatch) => void;
  onDelete: (id: string) => void;
  onCreateEvent?: (claimId: string, draft: ClaimEventDraft) => void;
  onDeleteEvent?: (id: string) => void;
  saving?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClaimDraft>(() => emptyDraft());
  const [cycleLogClaimId, setCycleLogClaimId] = useState<string | null>(null);
  const cycleLogClaim = claims.find((c) => c.id === cycleLogClaimId) ?? null;
  const eventsByClaim = new Map<string, ClaimEventRow[]>();
  for (const event of events) {
    const list = eventsByClaim.get(event.claim_id) ?? [];
    list.push(event);
    eventsByClaim.set(event.claim_id, list);
  }

  const openNew = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setOpen(true);
  };
  const openEdit = (claim: ClaimRow) => {
    setEditingId(claim.id);
    setDraft(claimToDraft(claim));
    setOpen(true);
  };
  const save = () => {
    if (!draft.title.trim()) return;
    // Clear empty date strings back to null so the column stays clean.
    const next: ClaimDraft = {
      ...draft,
      submitted_at: draft.submitted_at || null,
      resolved_at: draft.resolved_at || null,
    };
    if (editingId) onUpdate(editingId, next);
    else onCreate(next);
    setOpen(false);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-end">
        <Button size="sm" className="gap-1.5" onClick={openNew}>
          <Plus className="h-4 w-4" /> Add claim
        </Button>
      </div>

      <div className="overflow-hidden rounded-lg border border-hairline bg-card">
        <Table>
          <TableHeader>
            <TableRow className="bg-surface">
              <TableHead className="w-[90px]">Claim #</TableHead>
              <TableHead>Claim</TableHead>
              <TableHead className="hidden lg:table-cell">Type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount sought</TableHead>
              <TableHead className="text-right">Time sought</TableHead>
              <TableHead className="hidden md:table-cell">Submitted</TableHead>
              <TableHead className="w-[130px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {claims.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {c.claim_number || "—"}
                </TableCell>
                <TableCell className="font-medium">{c.title}</TableCell>
                <TableCell className="hidden lg:table-cell text-xs text-muted-foreground">
                  {CLAIM_TYPE_LABELS[c.claim_type]}
                </TableCell>
                <TableCell>
                  <span
                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${statusStyles[c.status]}`}
                  >
                    {CLAIM_STATUS_LABELS[c.status]}
                  </span>
                </TableCell>
                <TableCell className="text-right tabular">
                  {c.money_claimed > 0 ? fmtUSD(c.money_claimed) : "—"}
                </TableCell>
                <TableCell className="text-right tabular text-sm">
                  {fmtDays(c.time_claimed_days)}
                </TableCell>
                <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                  {c.submitted_at || "Not submitted"}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="relative h-7 w-7"
                      onClick={() => setCycleLogClaimId(c.id)}
                      title="Cycle log"
                      aria-label={`Open cycle log for ${c.title}`}
                    >
                      <History className="h-3.5 w-3.5" />
                      {(eventsByClaim.get(c.id)?.length ?? 0) > 0 && (
                        <span className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-none text-accent-foreground">
                          {eventsByClaim.get(c.id)?.length}
                        </span>
                      )}
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => openEdit(c)}
                      aria-label={`Edit claim ${c.title}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      onClick={() => onDelete(c.id)}
                      aria-label={`Delete claim ${c.title}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
            {claims.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="p-0">
                  <div className="px-4 py-10">
                    <EmptyState
                      icon={Gavel}
                      title="No claims yet"
                      description="Log a delay claim, extension-of-time request, or delay-damages claim to track it through the dispute-resolution process."
                      action={
                        <Button size="sm" className="gap-1.5" onClick={openNew}>
                          <Plus className="h-4 w-4" /> Add claim
                        </Button>
                      }
                    />
                  </div>
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit claim" : "New claim"}</DialogTitle>
            <DialogDescription>
              A claim runs the contract's dispute-resolution process for money and/or time. Track
              where it sits and what's being sought.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="claim-number">Claim #</Label>
                <Input
                  id="claim-number"
                  value={draft.claim_number}
                  onChange={(e) => setDraft({ ...draft, claim_number: e.target.value })}
                  placeholder="CLM-001"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="claim-title">Title</Label>
                <Input
                  id="claim-title"
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  placeholder="Extension of time — foundation delay"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="claim-description">Description</Label>
              <Textarea
                id="claim-description"
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                rows={3}
                placeholder="What happened, what's being claimed, and the basis for it."
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Claim type</Label>
                <Select
                  value={draft.claim_type}
                  onValueChange={(v) => setDraft({ ...draft, claim_type: v as ClaimType })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAIM_TYPE_ORDER.map((t) => (
                      <SelectItem key={t} value={t}>
                        {CLAIM_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Status</Label>
                <Select
                  value={draft.status}
                  onValueChange={(v) => setDraft({ ...draft, status: v as ClaimStatus })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CLAIM_STATUS_ORDER.map((s) => (
                      <SelectItem key={s} value={s}>
                        {CLAIM_STATUS_LABELS[s]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="claim-money-claimed">Amount sought</Label>
                <MoneyInput
                  id="claim-money-claimed"
                  value={draft.money_claimed}
                  onValueChange={(v) => setDraft({ ...draft, money_claimed: v })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="claim-time-claimed">Time sought (days)</Label>
                <Input
                  id="claim-time-claimed"
                  type="number"
                  min={0}
                  value={draft.time_claimed_days || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      time_claimed_days: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="claim-money-awarded">Amount awarded</Label>
                <MoneyInput
                  id="claim-money-awarded"
                  value={draft.money_awarded}
                  onValueChange={(v) => setDraft({ ...draft, money_awarded: v })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="claim-time-awarded">Time awarded (days)</Label>
                <Input
                  id="claim-time-awarded"
                  type="number"
                  min={0}
                  value={draft.time_awarded_days || ""}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      time_awarded_days: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="claim-submitted">Submitted date</Label>
                <Input
                  id="claim-submitted"
                  type="date"
                  value={draft.submitted_at ?? ""}
                  onChange={(e) => setDraft({ ...draft, submitted_at: e.target.value || null })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="claim-resolved">Resolved date</Label>
                <Input
                  id="claim-resolved"
                  type="date"
                  value={draft.resolved_at ?? ""}
                  onChange={(e) => setDraft({ ...draft, resolved_at: e.target.value || null })}
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="claim-owner">Owner</Label>
                <Input
                  id="claim-owner"
                  value={draft.owner}
                  onChange={(e) => setDraft({ ...draft, owner: e.target.value })}
                  placeholder="PM"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="claim-outcome">Outcome / resolution</Label>
              <Textarea
                id="claim-outcome"
                value={draft.outcome}
                onChange={(e) => setDraft({ ...draft, outcome: e.target.value })}
                rows={2}
                placeholder="How it resolved — award, settlement, denial, or withdrawal."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button onClick={save} disabled={saving || !draft.title.trim()}>
              {editingId ? "Save changes" : "Add claim"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClaimCycleLogDialog
        claim={cycleLogClaim}
        events={cycleLogClaim ? (eventsByClaim.get(cycleLogClaim.id) ?? []) : []}
        onClose={() => setCycleLogClaimId(null)}
        onCreateEvent={onCreateEvent}
        onDeleteEvent={onDeleteEvent}
      />
    </div>
  );
}

const emptyEventDraft = (): ClaimEventDraft => ({
  event_type: "submitted",
  event_date: null,
  revision_number: 0,
  note: "",
});

function ClaimCycleLogDialog({
  claim,
  events,
  onClose,
  onCreateEvent,
  onDeleteEvent,
}: {
  claim: ClaimRow | null;
  events: ClaimEventRow[];
  onClose: () => void;
  onCreateEvent?: (claimId: string, draft: ClaimEventDraft) => void;
  onDeleteEvent?: (id: string) => void;
}) {
  const [eventDraft, setEventDraft] = useState<ClaimEventDraft>(() => emptyEventDraft());

  // Oldest → newest, undated entries last, so the log reads as a timeline.
  const ordered = [...events].sort((a, b) => {
    if (!a.event_date && !b.event_date) return 0;
    if (!a.event_date) return 1;
    if (!b.event_date) return -1;
    return a.event_date.localeCompare(b.event_date);
  });

  const addEvent = () => {
    if (!claim || !onCreateEvent) return;
    onCreateEvent(claim.id, {
      ...eventDraft,
      event_date: eventDraft.event_date || null,
    });
    setEventDraft(emptyEventDraft());
  };

  return (
    <Dialog
      open={claim !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Cycle log{claim ? ` — ${claim.claim_number || claim.title}` : ""}
          </DialogTitle>
          <DialogDescription>
            The dated back-and-forth on this claim — sent, received, reviewed, meetings, kickbacks,
            and revised resubmissions.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {ordered.length === 0 && (
            <p className="rounded-md border border-dashed border-hairline bg-surface px-3 py-6 text-center text-sm text-muted-foreground">
              No cycle events yet. Log the first one below.
            </p>
          )}
          {ordered.map((event) => (
            <div
              key={event.id}
              className="flex items-start justify-between gap-3 rounded-md border border-hairline bg-card px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{EVENT_TYPE_LABELS[event.event_type]}</span>
                  <span className="text-xs text-muted-foreground">
                    {event.event_date || "No date"}
                  </span>
                  {event.revision_number > 0 && (
                    <span className="rounded-full border border-hairline bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                      Rev {event.revision_number}
                    </span>
                  )}
                </div>
                {event.note && <p className="mt-1 text-sm text-foreground/80">{event.note}</p>}
              </div>
              {onDeleteEvent && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7 shrink-0"
                  onClick={() => onDeleteEvent(event.id)}
                  aria-label="Delete cycle event"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>

        {onCreateEvent && (
          <div className="mt-2 space-y-3 rounded-lg border border-hairline bg-surface/50 p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Log an event
            </p>
            <div className="grid gap-3 sm:grid-cols-[1fr_140px_90px]">
              <div className="space-y-1.5">
                <Label>Event</Label>
                <Select
                  value={eventDraft.event_type}
                  onValueChange={(v) =>
                    setEventDraft({ ...eventDraft, event_type: v as ClaimEventType })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPE_ORDER.map((t) => (
                      <SelectItem key={t} value={t}>
                        {EVENT_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-date">Date</Label>
                <Input
                  id="event-date"
                  type="date"
                  value={eventDraft.event_date ?? ""}
                  onChange={(e) =>
                    setEventDraft({ ...eventDraft, event_date: e.target.value || null })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="event-rev">Rev</Label>
                <Input
                  id="event-rev"
                  type="number"
                  min={0}
                  value={eventDraft.revision_number || ""}
                  onChange={(e) =>
                    setEventDraft({
                      ...eventDraft,
                      revision_number: Math.max(0, Number(e.target.value) || 0),
                    })
                  }
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="event-note">Note</Label>
              <Textarea
                id="event-note"
                value={eventDraft.note}
                onChange={(e) => setEventDraft({ ...eventDraft, note: e.target.value })}
                rows={2}
                placeholder="What happened at this step."
              />
            </div>
            <div className="flex justify-end">
              <Button size="sm" className="gap-1.5" onClick={addEvent}>
                <Plus className="h-4 w-4" /> Log event
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
