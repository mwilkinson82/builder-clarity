import { Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import type { CreateOpportunityInput, PipelineMember } from "@/lib/pipeline.functions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Textarea } from "@/components/ui/textarea";

type OpportunityCreateDialogProps = {
  members: PipelineMember[];
  isCreating: boolean;
  onCreate: (input: CreateOpportunityInput) => Promise<void>;
};

const emptyDraft: CreateOpportunityInput = {
  name: "",
  client: "",
  client_contact_name: "",
  client_contact_email: "",
  client_contact_phone: "",
  estimated_contract: 0,
  estimated_cost: 0,
  probability: 50,
  source: "",
  project_type: "",
  scope_summary: "",
  assigned_to: "",
  notes: "",
  bid_due_date: null,
  decision_date: null,
};

export function OpportunityCreateDialog({
  members,
  isCreating,
  onCreate,
}: OpportunityCreateDialogProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CreateOpportunityInput>(emptyDraft);
  const update = <K extends keyof CreateOpportunityInput>(
    key: K,
    value: CreateOpportunityInput[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const submit = async () => {
    if (!draft.name.trim()) return;
    await onCreate({
      ...draft,
      name: draft.name.trim(),
      client: draft.client.trim(),
    });
    setDraft(emptyDraft);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" className="gap-1.5">
          <Plus className="h-4 w-4" />
          New Opportunity
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>New opportunity</DialogTitle>
          <DialogDescription>
            Capture the relationship, bid details, and first follow-up before this becomes a job.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Opportunity name" className="sm:col-span-2">
            <Input value={draft.name} onChange={(event) => update("name", event.target.value)} />
          </Field>
          <Field label="Client">
            <Input
              value={draft.client}
              onChange={(event) => update("client", event.target.value)}
            />
          </Field>
          <Field label="Project type">
            <Input
              value={draft.project_type}
              onChange={(event) => update("project_type", event.target.value)}
            />
          </Field>
          <Field label="Contact name">
            <Input
              value={draft.client_contact_name}
              onChange={(event) => update("client_contact_name", event.target.value)}
            />
          </Field>
          <Field label="Contact email">
            <Input
              type="email"
              value={draft.client_contact_email}
              onChange={(event) => update("client_contact_email", event.target.value)}
            />
          </Field>
          <Field label="Contact phone">
            <Input
              value={draft.client_contact_phone}
              onChange={(event) => update("client_contact_phone", event.target.value)}
            />
          </Field>
          <Field label="Source">
            <Input
              value={draft.source}
              onChange={(event) => update("source", event.target.value)}
            />
          </Field>
          <Field label="Bid due">
            <Input
              type="date"
              value={draft.bid_due_date ?? ""}
              onChange={(event) => update("bid_due_date", event.target.value || null)}
            />
          </Field>
          <Field label="Estimated contract">
            <MoneyInput
              value={draft.estimated_contract}
              onValueChange={(value) => update("estimated_contract", value)}
            />
          </Field>
          <Field label="Estimated cost">
            <MoneyInput
              value={draft.estimated_cost}
              onValueChange={(value) => update("estimated_cost", value)}
            />
          </Field>
          <Field label="Assigned to">
            <Select
              value={draft.assigned_to || "unassigned"}
              onValueChange={(value) => update("assigned_to", value === "unassigned" ? "" : value)}
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
          <Field label="Probability">
            <Input
              type="number"
              min={0}
              max={100}
              value={draft.probability}
              onChange={(event) => update("probability", Number(event.target.value))}
            />
          </Field>
          <Field label="Scope summary" className="sm:col-span-2">
            <Textarea
              value={draft.scope_summary}
              onChange={(event) => update("scope_summary", event.target.value)}
              className="min-h-24"
            />
          </Field>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={isCreating || !draft.name.trim()}>
            Create opportunity
          </Button>
        </DialogFooter>
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
