import { useState } from "react";
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
import { Plus, Trash2 } from "lucide-react";
import type { ClaimEventRow, ClaimEventType, ClaimRow } from "@/lib/projects.functions";

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

export type ClaimEventDraft = {
  event_type: ClaimEventType;
  event_date: string | null;
  revision_number: number;
  note: string;
};

const emptyEventDraft = (): ClaimEventDraft => ({
  event_type: "submitted",
  event_date: null,
  revision_number: 0,
  note: "",
});

export function ClaimCycleLogDialog({
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
          <div className="eyebrow">Claim history</div>
          <DialogTitle className="font-serif text-2xl font-normal">
            Cycle log{claim ? ` — ${claim.claim_number || claim.title}` : ""}
          </DialogTitle>
          <DialogDescription>
            The dated back-and-forth on this claim — sent, received, reviewed, meetings, kickbacks,
            and revised resubmissions.
          </DialogDescription>
        </DialogHeader>

        <div>
          {ordered.length === 0 && (
            <p className="rounded-md border border-dashed border-hairline bg-surface px-3 py-6 text-center text-sm text-muted-foreground">
              No cycle events yet. Log the first one below.
            </p>
          )}
          {ordered.map((event) => (
            <div
              key={event.id}
              className="group flex items-start gap-3 border-t border-hairline py-3 first:border-t-0"
            >
              {/* Timeline: clay dot + hairline rail down to the next event. */}
              <div className="flex self-stretch flex-col items-center pt-[5px]" aria-hidden="true">
                <span className="h-[9px] w-[9px] flex-none rounded-full bg-clay" />
                <span className="mt-1.5 w-px flex-1 bg-hairline group-last:hidden" />
              </div>
              <div className="min-w-0 flex-1">
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
