import { ExternalLink, Mail, Phone, Save, Trash2 } from "lucide-react";
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ActivityTimeline } from "./ActivityTimeline";
import {
  gpToneClass,
  isDemoOpportunityId,
  STAGE_LABELS,
  STAGE_ORDER,
  STAGE_PILL_CLASS,
} from "./pipeline-ui";

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
  isCreatingEstimate: boolean;
  isConverting: boolean;
  isDeleting: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdate: (patch: OpportunityPatch) => Promise<void>;
  onAddNote: (note: string) => Promise<void>;
  onCreateAction: (input: CreateNextActionInput) => Promise<void>;
  onCreateEstimate: () => Promise<void>;
  onConvert: () => Promise<void>;
  onDelete: () => Promise<void>;
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
  isCreatingEstimate,
  isConverting,
  isDeleting,
  onOpenChange,
  onUpdate,
  onAddNote,
  onCreateAction,
  onCreateEstimate,
  onConvert,
  onDelete,
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
  const isSampleOpportunity = Boolean(opportunity && isDemoOpportunityId(opportunity.id));
  const contactName =
    draft.client_contact_name ||
    opportunity?.primary_contact_name ||
    opportunity?.client_contact_name ||
    "";
  const contactEmail = (
    draft.client_contact_email ||
    opportunity?.primary_contact_email ||
    opportunity?.client_contact_email ||
    ""
  ).trim();
  const contactPhone = (
    draft.client_contact_phone ||
    opportunity?.client_contact_phone ||
    ""
  ).trim();
  const emailHref = contactEmail
    ? `mailto:${contactEmail}?subject=${encodeURIComponent(
        `Regarding ${draft.name || opportunity?.name || "Overwatch opportunity"}`,
      )}`
    : "";
  const phoneHref = phoneHrefFor(contactPhone);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] w-[calc(100vw-2rem)] max-w-[1320px] overflow-x-hidden overflow-y-auto p-0">
        {isLoading || !opportunity ? (
          <div className="p-6">
            <DialogHeader className="sr-only">
              <DialogTitle>Loading opportunity</DialogTitle>
              <DialogDescription>Loading CRM opportunity details.</DialogDescription>
            </DialogHeader>
            <div className="text-sm text-muted-foreground">Loading opportunity...</div>
          </div>
        ) : (
          <div className="min-w-0 space-y-6 p-6 md:p-8">
            <DialogHeader className="pr-12">
              <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                <div className="min-w-0">
                  <DialogTitle className="font-serif text-3xl leading-tight">
                    {opportunity.name}
                  </DialogTitle>
                  <DialogDescription>
                    {opportunity.client || "No client"} · {fmtPct(gpPct)} estimated GP
                  </DialogDescription>
                </div>
                <span
                  className={cn(
                    "inline-flex w-fit shrink-0 rounded-full border px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em]",
                    STAGE_PILL_CLASS[opportunity.stage],
                  )}
                >
                  {STAGE_LABELS[opportunity.stage]}
                </span>
              </div>
            </DialogHeader>

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
              <Button
                type="button"
                variant="outline"
                onClick={onCreateEstimate}
                disabled={isCreatingEstimate}
              >
                Create Estimate
              </Button>
              <Button type="button" variant="outline" onClick={save} disabled={isSaving}>
                <Save className="mr-1.5 h-4 w-4" />
                Save changes
              </Button>
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button type="button" variant="destructive" disabled={isDeleting}>
                    <Trash2 className="mr-1.5 h-4 w-4" />
                    Delete
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  {isSampleOpportunity ? (
                    <AlertDialogHeader>
                      <AlertDialogTitle>Remove this sample opportunity?</AlertDialogTitle>
                      <AlertDialogDescription>
                        “{opportunity.name}” is sample data that shows how the pipeline works.
                        Removing it hides it from your pipeline on this device. Your own
                        opportunities are not affected.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                  ) : (
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this opportunity?</AlertDialogTitle>
                      <AlertDialogDescription>
                        “{opportunity.name}” will be removed from your pipeline. It moves to
                        Archived — turn on the Archived switch above the pipeline to see it again.
                        Nothing is permanently erased.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                  )}
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      disabled={isDeleting}
                      className="bg-danger text-destructive-foreground hover:bg-danger/90"
                      onClick={(event) => {
                        event.preventDefault();
                        void onDelete();
                      }}
                    >
                      {isDeleting
                        ? isSampleOpportunity
                          ? "Removing…"
                          : "Deleting…"
                        : isSampleOpportunity
                          ? "Remove sample"
                          : "Delete opportunity"}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(420px,0.85fr)]">
              <div className="space-y-6">
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
                        onChange={(event) =>
                          updateDraft("bid_due_date", event.target.value || null)
                        }
                      />
                    </Field>
                    <Field label="Decision date">
                      <Input
                        type="date"
                        value={draft.decision_date ?? ""}
                        onChange={(event) =>
                          updateDraft("decision_date", event.target.value || null)
                        }
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
                      <RelationshipStat label="Primary contact" value={contactName || "No contact"}>
                        {contactEmail && (
                          <a
                            href={emailHref}
                            className="mt-1 inline-flex max-w-full items-center gap-1.5 truncate text-xs font-medium text-accent hover:underline"
                          >
                            <Mail className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{contactEmail}</span>
                          </a>
                        )}
                      </RelationshipStat>
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
                        onChange={(event) =>
                          updateDraft("client_contact_email", event.target.value)
                        }
                      />
                      {contactEmail && (
                        <ContactLink href={emailHref} icon={<Mail className="h-3.5 w-3.5" />}>
                          Email {contactEmail}
                        </ContactLink>
                      )}
                    </Field>
                    <Field label="Contact phone">
                      <Input
                        value={draft.client_contact_phone ?? ""}
                        onChange={(event) =>
                          updateDraft("client_contact_phone", event.target.value)
                        }
                      />
                      {phoneHref && (
                        <ContactLink href={phoneHref} icon={<Phone className="h-3.5 w-3.5" />}>
                          Call on device
                        </ContactLink>
                      )}
                    </Field>
                  </div>
                </section>

                <section className="space-y-3">
                  <h3 className="font-serif text-xl text-foreground">Communications</h3>
                  <ActivityTimeline
                    activity={activity}
                    isAddingNote={isAddingNote}
                    onAddNote={onAddNote}
                  />
                </section>
              </div>

              <div className="space-y-6">
                <section className="space-y-3">
                  <h3 className="font-serif text-xl text-foreground">Next Action</h3>
                  <div className="grid gap-3 rounded-md border border-hairline bg-surface p-3 sm:grid-cols-2">
                    <Field label="Action" className="sm:col-span-2">
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
                          setActionDraft((current) => ({
                            ...current,
                            due_date: event.target.value,
                          }))
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
                      className="w-full sm:col-span-2"
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
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
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

function ContactLink({
  href,
  icon,
  children,
}: {
  href: string;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <a
      href={href}
      className="mt-1 inline-flex max-w-full items-center gap-1.5 rounded-md border border-hairline bg-background px-2 py-1 text-xs font-medium text-accent hover:border-accent/40 hover:underline"
    >
      {icon}
      <span className="truncate">{children}</span>
    </a>
  );
}

function RelationshipStat({
  label,
  value,
  children,
}: {
  label: string;
  value: string;
  children?: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 truncate font-medium text-foreground">{value}</div>
      {children}
    </div>
  );
}

function phoneHrefFor(phone: string) {
  const dialable = phone.replace(/[^\d+]/g, "");
  return dialable ? `tel:${dialable}` : "";
}
