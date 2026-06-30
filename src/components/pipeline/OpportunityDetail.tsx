import { Archive, ExternalLink, Save } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { fmtPct } from "@/lib/format";
import type {
  CreateNextActionInput,
  PipelineActivityRow,
  PipelineActionPriority,
  PipelineBidDecision,
  PipelineMember,
  PipelineOpportunityRow,
  PipelineStage,
} from "@/lib/pipeline.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoneyInput } from "@/components/ui/money-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ActivityTimeline } from "./ActivityTimeline";
import { gpToneClass, STAGE_LABELS, STAGE_ORDER, STAGE_PILL_CLASS } from "./pipeline-ui";

type OpportunityPatch = Partial<{
  name: string;
  client: string;
  client_contact_name: string;
  client_contact_email: string;
  client_contact_phone: string;
  stage: PipelineStage;
  estimated_contract: number;
  estimated_cost: number;
  bid_due_date: string | null;
  decision_date: string | null;
  probability: number;
  source: string;
  project_type: string;
  scope_summary: string;
  bid_decision: PipelineBidDecision;
  bid_decision_reason: string;
  bid_decision_date: string | null;
  assigned_to: string;
  notes: string;
}>;

type OpportunityDetailProps = {
  open: boolean;
  opportunity: PipelineOpportunityRow | null;
  activity: PipelineActivityRow[];
  members: PipelineMember[];
  isLoading: boolean;
  isSaving: boolean;
  isAddingNote: boolean;
  isCreatingAction: boolean;
  isConverting: boolean;
  isArchiving: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (patch: OpportunityPatch) => Promise<void>;
  onAddNote: (note: string) => Promise<void>;
  onCreateAction: (input: CreateNextActionInput) => Promise<void>;
  onConvert: () => Promise<void>;
  onArchive: () => Promise<void>;
};

export function OpportunityDetail({
  open,
  opportunity,
  activity,
  members,
  isLoading,
  isSaving,
  isAddingNote,
  isCreatingAction,
  isConverting,
  isArchiving,
  onOpenChange,
  onUpdate,
  onAddNote,
  onCreateAction,
  onConvert,
  onArchive,
}: OpportunityDetailProps) {
  const [draft, setDraft] = useState<OpportunityPatch>({});
  const [actionDraft, setActionDraft] = useState({
    title: "",
    due_date: "",
    priority: "normal" as PipelineActionPriority,
  });
  useEffect(() => {
    if (!opportunity) return;
    setDraft({
      name: opportunity.name,
      client: opportunity.client,
      client_contact_name: opportunity.client_contact_name,
      client_contact_email: opportunity.client_contact_email,
      client_contact_phone: opportunity.client_contact_phone,
      stage: opportunity.stage,
      estimated_contract: opportunity.estimated_contract,
      estimated_cost: opportunity.estimated_cost,
      bid_due_date: opportunity.bid_due_date,
      decision_date: opportunity.decision_date,
      probability: opportunity.probability,
      source: opportunity.source,
      project_type: opportunity.project_type,
      scope_summary: opportunity.scope_summary,
      bid_decision: opportunity.bid_decision,
      bid_decision_reason: opportunity.bid_decision_reason,
      bid_decision_date: opportunity.bid_decision_date,
      assigned_to: opportunity.assigned_to,
      notes: opportunity.notes,
    });
    setActionDraft({
      title: opportunity.next_action_title ? `Follow up: ${opportunity.next_action_title}` : "",
      due_date: "",
      priority: "normal",
    });
  }, [opportunity]);

  const gpPct = useMemo(() => {
    const contract = Number(draft.estimated_contract ?? opportunity?.estimated_contract ?? 0);
    const cost = Number(draft.estimated_cost ?? opportunity?.estimated_cost ?? 0);
    return contract > 0 ? ((contract - cost) / contract) * 100 : 0;
  }, [draft.estimated_contract, draft.estimated_cost, opportunity]);

  const updateDraft = <K extends keyof OpportunityPatch>(key: K, value: OpportunityPatch[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const save = async () => {
    if (!opportunity) return;
    await onUpdate(draft);
  };

  const createAction = async () => {
    if (!opportunity || !actionDraft.title.trim()) return;
    await onCreateAction({
      opportunity_id: opportunity.id,
      account_id: opportunity.account_id,
      contact_id: opportunity.primary_contact_id,
      owner_name: draft.assigned_to ?? opportunity.assigned_to,
      action_type: "follow_up",
      priority: actionDraft.priority,
      title: actionDraft.title.trim(),
      notes: "",
      due_date: actionDraft.due_date || null,
    });
    setActionDraft({ title: "", due_date: "", priority: "normal" });
  };

  const canConvert = opportunity?.stage === "won" && !opportunity.converted_project_id;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {isLoading || !opportunity ? (
          <div className="p-6 text-sm text-muted-foreground">Loading opportunity…</div>
        ) : (
          <div className="space-y-6 pb-8">
            <SheetHeader>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <SheetTitle className="truncate font-serif text-3xl">
                    {opportunity.name}
                  </SheetTitle>
                  <SheetDescription>
                    {opportunity.client || "No client"} · {fmtPct(gpPct)} estimated GP
                  </SheetDescription>
                </div>
                <span
                  className={cn(
                    "inline-flex shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
                    STAGE_PILL_CLASS[opportunity.stage],
                  )}
                >
                  {STAGE_LABELS[opportunity.stage]}
                </span>
              </div>
            </SheetHeader>

            <div className="flex flex-wrap gap-2">
              {opportunity.converted_project_id ? (
                <Button asChild>
                  <a href={`/projects/${opportunity.converted_project_id}`}>
                    <ExternalLink className="mr-1.5 h-4 w-4" />
                    View Project
                  </a>
                </Button>
              ) : (
                <Button type="button" onClick={onConvert} disabled={!canConvert || isConverting}>
                  Convert to Project
                </Button>
              )}
              <Button type="button" variant="outline" onClick={save} disabled={isSaving}>
                <Save className="mr-1.5 h-4 w-4" />
                Save changes
              </Button>
              <Button
                type="button"
                variant="destructive"
                onClick={() => {
                  if (window.confirm("Archive this opportunity?")) onArchive();
                }}
                disabled={isArchiving}
              >
                <Archive className="mr-1.5 h-4 w-4" />
                Archive
              </Button>
            </div>

            <section className="space-y-3">
              <h3 className="font-serif text-xl text-foreground">Pursuit</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Name" className="sm:col-span-2">
                  <Input
                    value={draft.name ?? ""}
                    onChange={(event) => updateDraft("name", event.target.value)}
                  />
                </Field>
                <Field label="Stage">
                  <Select
                    value={draft.stage ?? opportunity.stage}
                    onValueChange={(stage) => {
                      updateDraft("stage", stage as PipelineStage);
                      onUpdate({ stage: stage as PipelineStage });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STAGE_ORDER.map((stage) => (
                        <SelectItem key={stage} value={stage}>
                          {STAGE_LABELS[stage]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Assigned to">
                  <Select
                    value={draft.assigned_to || "unassigned"}
                    onValueChange={(value) =>
                      updateDraft("assigned_to", value === "unassigned" ? "" : value)
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unassigned">Unassigned</SelectItem>
                      {members.map((member) => (
                        <SelectItem key={member.user_id} value={member.label}>
                          {member.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Bid due">
                  <Input
                    type="date"
                    value={draft.bid_due_date ?? ""}
                    onChange={(event) => updateDraft("bid_due_date", event.target.value || null)}
                  />
                </Field>
                <Field label="Decision date">
                  <Input
                    type="date"
                    value={draft.decision_date ?? ""}
                    onChange={(event) => updateDraft("decision_date", event.target.value || null)}
                  />
                </Field>
                <Field label="Probability">
                  <Input
                    type="number"
                    min={0}
                    max={100}
                    value={draft.probability ?? 0}
                    onChange={(event) => updateDraft("probability", Number(event.target.value))}
                  />
                </Field>
                <Field label="Source">
                  <Input
                    value={draft.source ?? ""}
                    onChange={(event) => updateDraft("source", event.target.value)}
                  />
                </Field>
                <Field label="Project type">
                  <Input
                    value={draft.project_type ?? ""}
                    onChange={(event) => updateDraft("project_type", event.target.value)}
                  />
                </Field>
                <Field label="Scope summary" className="sm:col-span-2">
                  <Textarea
                    value={draft.scope_summary ?? ""}
                    onChange={(event) => updateDraft("scope_summary", event.target.value)}
                    className="min-h-24"
                  />
                </Field>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="font-serif text-xl text-foreground">CRM relationship</h3>
              <div className="rounded-md border border-hairline bg-surface px-3 py-3">
                <div className="grid gap-3 text-sm sm:grid-cols-3">
                  <RelationshipStat
                    label="Account"
                    value={opportunity.account_name || opportunity.client || "No account"}
                  />
                  <RelationshipStat
                    label="Primary contact"
                    value={
                      opportunity.primary_contact_name ||
                      opportunity.client_contact_name ||
                      "No contact"
                    }
                  />
                  <RelationshipStat
                    label="Next action"
                    value={opportunity.next_action_title || "No open action"}
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Client">
                  <Input
                    value={draft.client ?? ""}
                    onChange={(event) => updateDraft("client", event.target.value)}
                  />
                </Field>
                <Field label="Contact name">
                  <Input
                    value={draft.client_contact_name ?? ""}
                    onChange={(event) => updateDraft("client_contact_name", event.target.value)}
                  />
                </Field>
                <Field label="Contact email">
                  <Input
                    type="email"
                    value={draft.client_contact_email ?? ""}
                    onChange={(event) => updateDraft("client_contact_email", event.target.value)}
                  />
                </Field>
                <Field label="Contact phone">
                  <Input
                    value={draft.client_contact_phone ?? ""}
                    onChange={(event) => updateDraft("client_contact_phone", event.target.value)}
                  />
                </Field>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="font-serif text-xl text-foreground">Next Action</h3>
              <div className="grid gap-3 rounded-md border border-hairline bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_150px_130px_auto] sm:items-end">
                <Field label="Action">
                  <Input
                    value={actionDraft.title}
                    onChange={(event) =>
                      setActionDraft((current) => ({ ...current, title: event.target.value }))
                    }
                    placeholder="Call, send proposal, confirm decision..."
                  />
                </Field>
                <Field label="Due date">
                  <Input
                    type="date"
                    value={actionDraft.due_date}
                    onChange={(event) =>
                      setActionDraft((current) => ({ ...current, due_date: event.target.value }))
                    }
                  />
                </Field>
                <Field label="Priority">
                  <Select
                    value={actionDraft.priority}
                    onValueChange={(value) =>
                      setActionDraft((current) => ({
                        ...current,
                        priority: value as PipelineActionPriority,
                      }))
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="low">Low</SelectItem>
                      <SelectItem value="normal">Normal</SelectItem>
                      <SelectItem value="high">High</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Button
                  type="button"
                  onClick={createAction}
                  disabled={isCreatingAction || !actionDraft.title.trim()}
                >
                  Add action
                </Button>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="font-serif text-xl text-foreground">Financials</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <Field label="Estimated contract">
                  <MoneyInput
                    value={Number(draft.estimated_contract ?? 0)}
                    onValueChange={(value) => updateDraft("estimated_contract", value)}
                  />
                </Field>
                <Field label="Estimated cost">
                  <MoneyInput
                    value={Number(draft.estimated_cost ?? 0)}
                    onValueChange={(value) => updateDraft("estimated_cost", value)}
                  />
                </Field>
                <Field label="Estimated GP">
                  <div
                    className={cn(
                      "rounded-md border border-input px-3 py-2 text-sm font-semibold tabular-nums",
                      gpToneClass(gpPct),
                    )}
                  >
                    {fmtPct(gpPct)}
                  </div>
                </Field>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="font-serif text-xl text-foreground">Bid / No-Bid</h3>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Decision">
                  <Select
                    value={draft.bid_decision ?? opportunity.bid_decision}
                    onValueChange={(value) => {
                      const decision = value as PipelineBidDecision;
                      updateDraft("bid_decision", decision);
                      onUpdate({ bid_decision: decision });
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="undecided">Undecided</SelectItem>
                      <SelectItem value="bid">Bid</SelectItem>
                      <SelectItem value="no_bid">No-Bid</SelectItem>
                    </SelectContent>
                  </Select>
                </Field>
                <Field label="Decision date">
                  <Input
                    type="date"
                    value={draft.bid_decision_date ?? ""}
                    onChange={(event) =>
                      updateDraft("bid_decision_date", event.target.value || null)
                    }
                  />
                </Field>
                <Field label="Reason" className="sm:col-span-2">
                  <Textarea
                    value={draft.bid_decision_reason ?? ""}
                    onChange={(event) => updateDraft("bid_decision_reason", event.target.value)}
                    className="min-h-20"
                  />
                </Field>
              </div>
            </section>

            <section className="space-y-3">
              <h3 className="font-serif text-xl text-foreground">Activity</h3>
              <ActivityTimeline
                activity={activity}
                isAddingNote={isAddingNote}
                onAddNote={onAddNote}
              />
            </section>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block text-xs font-medium text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function RelationshipStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate font-medium text-foreground">{value}</div>
    </div>
  );
}
