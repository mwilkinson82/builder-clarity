import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CheckCircle2, Clock3, MessageSquare } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  listClientSelections,
  recordClientSelectionDecision,
  type ProjectSelectionRow,
} from "@/lib/selections.functions";

interface ClientSelectionsPanelProps {
  projectId: string;
}

const dateFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function formatDate(value: string | null) {
  return value ? dateFormatter.format(new Date(`${value}T12:00:00`)) : "Not scheduled";
}

function formatMoney(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function ClientSelectionsPanel({ projectId }: ClientSelectionsPanelProps) {
  const queryClient = useQueryClient();
  const loadSelections = useServerFn(listClientSelections);
  const recordDecision = useServerFn(recordClientSelectionDecision);
  const [choiceBySelection, setChoiceBySelection] = useState<Record<string, string>>({});
  const [notesBySelection, setNotesBySelection] = useState<Record<string, string>>({});

  const selectionQuery = useQuery({
    queryKey: ["client-selections", projectId],
    queryFn: () => loadSelections({ data: { projectId } }),
  });

  const decisionMutation = useMutation({
    mutationFn: (input: {
      selectionId: string;
      optionId: string | null;
      decision: "approved" | "revision_requested";
      notes: string;
    }) => recordDecision({ data: input }),
    onSuccess: async (_, input) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["client-selections", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project-selections", projectId] }),
      ]);
      toast.success(input.decision === "approved" ? "Selection approved" : "Revision request sent");
    },
    onError: (error) =>
      toast.error("Your decision did not save", {
        description: error instanceof Error ? error.message : "Try again.",
      }),
  });

  const selections = selectionQuery.data?.selections ?? [];
  if (selectionQuery.isLoading) {
    return <div className="h-36 animate-pulse rounded-xl border border-hairline bg-card" />;
  }
  if (selectionQuery.error || selectionQuery.data?.migrationRequired || selections.length === 0) {
    return null;
  }

  return (
    <section className="space-y-4">
      <div>
        <p className="eyebrow">Selections requiring your decision</p>
        <h2 className="mt-2 font-serif text-3xl">Keep procurement and the schedule moving.</h2>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Review the project team's options. Your approval is recorded with the exact option and
          package version you saw.
        </p>
      </div>

      {selections.map((selection) => {
        const selectedOptionId =
          choiceBySelection[selection.id] ?? selection.selected_option_id ?? "";
        const notes = notesBySelection[selection.id] ?? "";
        const isPending =
          decisionMutation.isPending && decisionMutation.variables?.selectionId === selection.id;
        return (
          <article
            key={selection.id}
            className="overflow-hidden rounded-xl border border-hairline bg-card shadow-card"
          >
            <div className="border-b border-hairline p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-clay">
                    {selection.selection_number} · version {selection.version}
                  </p>
                  <h3 className="mt-1 font-serif text-2xl">{selection.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {[selection.room_area, selection.category].filter(Boolean).join(" · ")}
                  </p>
                </div>
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 self-start rounded-full border px-2.5 py-1 text-xs font-semibold",
                    selection.decision_status === "approved"
                      ? "border-success/40 bg-success/10 text-success"
                      : "border-warning/40 bg-warning/10 text-warning",
                  )}
                >
                  {selection.decision_status === "approved" ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <Clock3 className="h-3.5 w-3.5" />
                  )}
                  {selection.decision_status === "approved" ? "Approved" : "Decision needed"}
                </span>
              </div>
              {selection.description ? (
                <p className="mt-4 text-sm leading-6">{selection.description}</p>
              ) : null}
              <div className="mt-4 grid gap-px overflow-hidden rounded-lg border border-hairline bg-hairline sm:grid-cols-3">
                <DateCell
                  label="Decision due"
                  value={formatDate(selection.client_decision_due_date)}
                />
                <DateCell label="Order by" value={formatDate(selection.order_by_date)} />
                <DateCell label="Needed on site" value={formatDate(selection.need_on_site_date)} />
              </div>
            </div>

            <div className="p-5">
              <RadioGroup
                value={selectedOptionId}
                onValueChange={(value) =>
                  setChoiceBySelection((current) => ({ ...current, [selection.id]: value }))
                }
                className="grid gap-3 md:grid-cols-2"
              >
                {selection.options.map((option) => (
                  <Label
                    key={option.id}
                    htmlFor={`selection-${selection.id}-${option.id}`}
                    className={cn(
                      "cursor-pointer rounded-xl border p-4 transition",
                      selectedOptionId === option.id
                        ? "border-clay bg-secondary/60"
                        : "border-hairline hover:bg-secondary/30",
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <RadioGroupItem
                        id={`selection-${selection.id}-${option.id}`}
                        value={option.id}
                        className="mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <p className="font-semibold">{option.title}</p>
                          <p className="font-serif text-lg">{formatMoney(option.price_cents)}</p>
                        </div>
                        {option.is_recommended ? (
                          <span className="mt-1 inline-flex rounded-full border border-success/40 bg-success/10 px-2 py-0.5 text-[10px] font-semibold text-success">
                            Contractor recommended
                          </span>
                        ) : null}
                        {[option.manufacturer, option.model_number, option.finish].filter(Boolean)
                          .length > 0 ? (
                          <p className="mt-2 text-xs text-muted-foreground">
                            {[option.manufacturer, option.model_number, option.finish]
                              .filter(Boolean)
                              .join(" · ")}
                          </p>
                        ) : null}
                        {option.description ? (
                          <p className="mt-2 text-sm leading-5">{option.description}</p>
                        ) : null}
                      </div>
                    </div>
                  </Label>
                ))}
              </RadioGroup>

              {selection.decision_status !== "approved" ? (
                <div className="mt-5 space-y-3 border-t border-hairline pt-4">
                  <div>
                    <Label htmlFor={`selection-notes-${selection.id}`}>
                      Comments for the project team
                    </Label>
                    <Textarea
                      id={`selection-notes-${selection.id}`}
                      className="mt-1.5"
                      value={notes}
                      onChange={(event) =>
                        setNotesBySelection((current) => ({
                          ...current,
                          [selection.id]: event.target.value,
                        }))
                      }
                      placeholder="Questions, requested changes, or approval notes"
                    />
                  </div>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button
                      variant="outline"
                      disabled={isPending || notes.trim().length === 0}
                      onClick={() =>
                        decisionMutation.mutate({
                          selectionId: selection.id,
                          optionId: null,
                          decision: "revision_requested",
                          notes,
                        })
                      }
                    >
                      <MessageSquare className="h-4 w-4" /> Request a revision
                    </Button>
                    <Button
                      variant="signal"
                      disabled={isPending || !selectedOptionId}
                      onClick={() =>
                        decisionMutation.mutate({
                          selectionId: selection.id,
                          optionId: selectedOptionId,
                          decision: "approved",
                          notes,
                        })
                      }
                    >
                      <CheckCircle2 className="h-4 w-4" /> Approve selected option
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function DateCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-background p-3">
      <p className="font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-serif text-lg">{value}</p>
    </div>
  );
}
