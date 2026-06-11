import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ClipboardCheck, ChevronLeft, ChevronRight } from "lucide-react";
import type { ProjectRow } from "@/lib/projects.functions";

const STEPS = [
  { key: "schedule", title: "Schedule", q: "Did the forecasted completion date move since last review?" },
  { key: "new_exposure", title: "New exposure", q: "Did any owner decision, design change, trade issue, or procurement slip create new probable cost?" },
  { key: "co_updates", title: "Change orders", q: "Did any pending CO become more or less likely?" },
  { key: "bucket_changes", title: "Bucket forecasts", q: "Did actual-to-date or forecast-to-complete shift materially in any cost bucket?" },
  { key: "resolutions", title: "Resolutions", q: "Did any previously active exposure get recovered, eliminated, or accepted?" },
  { key: "decisions", title: "Required decisions", q: "What are the top three decisions required to protect margin this cycle?" },
] as const;

export function ProjectTruthReview({
  project,
  onSubmit,
  pending,
}: {
  project: ProjectRow;
  onSubmit: (input: {
    reviewer: string;
    forecast_completion_date_before: string | null;
    forecast_completion_date_after: string | null;
    summary_notes: string;
  }) => void;
  pending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [forecastDate, setForecastDate] = useState<string>(project.forecast_completion_date ?? "");
  const [reviewer, setReviewer] = useState("PM");
  const [notes, setNotes] = useState<string[]>(STEPS.map(() => ""));

  const reset = () => {
    setStep(0);
    setForecastDate(project.forecast_completion_date ?? "");
    setNotes(STEPS.map(() => ""));
  };

  const submit = () => {
    const summary = STEPS.map((s, i) => notes[i] ? `${s.title}: ${notes[i]}` : null)
      .filter(Boolean).join("\n");
    onSubmit({
      reviewer,
      forecast_completion_date_before: project.forecast_completion_date,
      forecast_completion_date_after: forecastDate || null,
      summary_notes: summary,
    });
    setOpen(false);
    reset();
  };

  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) reset(); }}>
      <Button onClick={() => setOpen(true)} className="gap-1.5">
        <ClipboardCheck className="h-4 w-4" /> Start Project Truth Review
      </Button>

      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Project Truth Review</DialogTitle>
        </DialogHeader>

        <div className="mb-2 flex items-center gap-1.5">
          {STEPS.map((s, i) => (
            <div
              key={s.key}
              className={`h-1 flex-1 rounded-full ${i <= step ? "bg-accent" : "bg-secondary"}`}
            />
          ))}
        </div>
        <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
          Step {step + 1} of {STEPS.length} · {current.title}
        </div>

        <div className="space-y-4 py-4">
          <p className="font-serif text-xl leading-snug text-foreground">{current.q}</p>

          {current.key === "schedule" && (
            <div className="space-y-1.5">
              <Label>Forecasted completion date</Label>
              <Input type="date" value={forecastDate} onChange={(e) => setForecastDate(e.target.value)} />
              {project.baseline_completion_date && (
                <p className="text-xs text-muted-foreground">
                  Baseline: {new Date(project.baseline_completion_date).toLocaleDateString()}
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label>Notes for this step</Label>
            <Textarea
              rows={4}
              value={notes[step]}
              onChange={(e) => {
                const next = [...notes];
                next[step] = e.target.value;
                setNotes(next);
              }}
              placeholder={
                current.key === "new_exposure"
                  ? "If yes, also log the exposure in the Exposures tab with its dollar consequence."
                  : current.key === "decisions"
                    ? "List the top three decisions and who owns each."
                    : "Briefly describe what changed."
              }
            />
          </div>

          {step === STEPS.length - 1 && (
            <div className="space-y-1.5">
              <Label>Reviewer</Label>
              <Input value={reviewer} onChange={(e) => setReviewer(e.target.value)} />
            </div>
          )}
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <Button
            variant="ghost"
            disabled={step === 0}
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="gap-1.5"
          >
            <ChevronLeft className="h-4 w-4" /> Back
          </Button>
          {isLast ? (
            <Button onClick={submit} disabled={pending}>
              {pending ? "Saving…" : "Submit review"}
            </Button>
          ) : (
            <Button onClick={() => setStep((s) => s + 1)} className="gap-1.5">
              Next <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
