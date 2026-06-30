import { CheckCircle2, FileEdit, MessageSquarePlus, MoveRight, Send } from "lucide-react";
import { useState } from "react";
import type { PipelineActivityRow } from "@/lib/pipeline.functions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type ActivityTimelineProps = {
  activity: PipelineActivityRow[];
  isAddingNote: boolean;
  onAddNote: (note: string) => Promise<void>;
};

export function ActivityTimeline({ activity, isAddingNote, onAddNote }: ActivityTimelineProps) {
  const [note, setNote] = useState("");
  const submit = async () => {
    const trimmed = note.trim();
    if (!trimmed) return;
    await onAddNote(trimmed);
    setNote("");
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="Add a pursuit note"
          className="min-h-20"
        />
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={submit} disabled={isAddingNote || !note.trim()}>
            <Send className="mr-1.5 h-3.5 w-3.5" />
            Add note
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {activity.length === 0 && (
          <div className="rounded-lg border border-dashed border-hairline p-4 text-sm text-muted-foreground">
            No activity yet.
          </div>
        )}
        {activity.map((item) => (
          <div key={item.id} className="flex gap-3 rounded-lg border border-hairline bg-card p-3">
            <div className="mt-0.5 text-muted-foreground">{iconFor(item.event_type)}</div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-foreground">{titleFor(item)}</div>
              {item.notes && (
                <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
                  {item.notes}
                </div>
              )}
              <div className="mt-1 text-[11px] text-muted-foreground">
                {new Date(item.created_at).toLocaleString()}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function iconFor(type: PipelineActivityRow["event_type"]) {
  if (type === "stage_change") return <MoveRight className="h-4 w-4" />;
  if (type === "note_added") return <MessageSquarePlus className="h-4 w-4" />;
  if (type === "converted") return <CheckCircle2 className="h-4 w-4 text-success" />;
  return <FileEdit className="h-4 w-4" />;
}

function titleFor(item: PipelineActivityRow) {
  if (item.event_type === "stage_change") {
    return `Stage changed from ${item.from_value || "unknown"} to ${item.to_value || "unknown"}`;
  }
  if (item.event_type === "bid_decision") {
    return `Bid decision changed to ${item.to_value || "undecided"}`;
  }
  if (item.event_type === "note_added") return "Note added";
  if (item.event_type === "converted") return "Converted to project";
  if (item.event_type === "created") return "Opportunity created";
  if (item.event_type === "archived") return "Opportunity archived";
  return "Opportunity updated";
}
