import {
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  FileText,
  Link2,
  Mail,
  Save,
  Send,
  Sparkles,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";
import type {
  CrmFollowupPlaybook,
  CrmPreparedFollowup,
  CrmValueAsset,
} from "@/lib/crm-followup.functions";
import { appendValueAssetToBody, followupTiming } from "@/lib/crm-followup-domain";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { shortDate } from "./pipeline-ui";

export type FollowupOutcome =
  "sent" | "connected" | "no_response" | "meeting_scheduled" | "not_interested" | "other";

export function PreparedFollowupCard({
  action,
  assets,
  isSaving,
  isCompleting,
  onSave,
  onComplete,
  onOpenOpportunity,
}: {
  action: CrmPreparedFollowup;
  assets: CrmValueAsset[];
  isSaving: boolean;
  isCompleting: boolean;
  onSave: (draft: {
    id: string;
    subject: string;
    body: string;
    assetId: string | null;
  }) => Promise<unknown>;
  onComplete: (outcome: FollowupOutcome, notes: string) => Promise<unknown>;
  onOpenOpportunity: () => void;
}) {
  const [open, setOpen] = useState(followupTiming(action.due_date) !== "upcoming");
  const [subject, setSubject] = useState(action.subject);
  const [body, setBody] = useState(action.body);
  const [assetId, setAssetId] = useState(action.value_asset_id ?? "none");
  const [outcome, setOutcome] = useState<FollowupOutcome>("sent");
  const [outcomeNotes, setOutcomeNotes] = useState("");

  useEffect(() => {
    setSubject(action.subject);
    setBody(action.body);
    setAssetId(action.value_asset_id ?? "none");
  }, [action.body, action.subject, action.value_asset_id]);

  const selectedAsset = assets.find((asset) => asset.id === assetId) ?? null;
  const save = () =>
    onSave({ id: action.id, subject, body, assetId: assetId === "none" ? null : assetId });

  const prepareBody = async () => {
    if (!selectedAsset) return body;
    const url = await assetUrl(selectedAsset, 7 * 24 * 60 * 60);
    return appendValueAssetToBody(body, selectedAsset.title, url);
  };

  const copyDraft = async () => {
    const readyBody = await prepareBody();
    await navigator.clipboard.writeText(`${subject}\n\n${readyBody}`);
    toast.success("Follow-up copied");
  };

  const openEmail = async () => {
    if (!action.contact_email) return;
    await save();
    const readyBody = await prepareBody();
    window.location.assign(
      `mailto:${encodeURIComponent(action.contact_email)}?subject=${encodeURIComponent(
        subject,
      )}&body=${encodeURIComponent(readyBody)}`,
    );
  };

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-hairline bg-surface shadow-card"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-start gap-3 px-4 py-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="mt-0.5 rounded-md border border-hairline bg-muted p-2 text-clay">
            <Mail className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-semibold text-foreground">{action.title}</span>
              <span className="rounded-full border border-hairline px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
                Day {action.day_offset}
              </span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {action.opportunity_name} · {action.contact_name || "Contact missing"} ·{" "}
              {shortDate(action.due_date)}
            </div>
          </div>
          <span className="shrink-0 text-xs font-semibold text-clay">
            {open ? "Close" : "Prepare"}
          </span>
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t border-hairline px-4 py-4">
        <div className="grid gap-4 xl:grid-cols-[0.7fr_1.3fr]">
          <div className="space-y-4">
            <div>
              <div className="eyebrow">Why this touch matters</div>
              <p className="mt-2 text-sm leading-6 text-foreground">{action.purpose}</p>
              <p className="mt-2 border-l-2 border-clay/40 pl-3 text-xs leading-5 text-muted-foreground">
                {action.value_angle}
              </p>
            </div>
            <Field label="Useful resource">
              <Select value={assetId} onValueChange={setAssetId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No resource attached</SelectItem>
                  {assets.map((asset) => (
                    <SelectItem key={asset.id} value={asset.id}>
                      {asset.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Button type="button" variant="outline" className="w-full" onClick={onOpenOpportunity}>
              Open opportunity
            </Button>
          </div>
          <div className="space-y-3">
            <Field label="Subject">
              <Input value={subject} onChange={(event) => setSubject(event.target.value)} />
            </Field>
            <Field label="Prepared message">
              <Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={9} />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" className="gap-1.5" onClick={copyDraft}>
                <Copy className="h-3.5 w-3.5" /> Copy
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-1.5"
                disabled={isSaving}
                onClick={save}
              >
                <Save className="h-3.5 w-3.5" /> {isSaving ? "Saving…" : "Save draft"}
              </Button>
              <Button
                type="button"
                className="gap-1.5"
                disabled={!action.contact_email || isSaving}
                onClick={openEmail}
              >
                <Send className="h-3.5 w-3.5" /> Open email draft
              </Button>
            </div>
            {!action.contact_email && (
              <p className="text-xs text-danger">
                Add the contact's email before preparing this message for delivery.
              </p>
            )}
            <div className="grid gap-2 border-t border-hairline pt-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
              <Field label="Outcome">
                <Select
                  value={outcome}
                  onValueChange={(value) => setOutcome(value as FollowupOutcome)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="sent">Email sent</SelectItem>
                    <SelectItem value="connected">Connected</SelectItem>
                    <SelectItem value="no_response">No response</SelectItem>
                    <SelectItem value="meeting_scheduled">Meeting scheduled</SelectItem>
                    <SelectItem value="not_interested">Not interested</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Outcome note">
                <Input
                  value={outcomeNotes}
                  onChange={(event) => setOutcomeNotes(event.target.value)}
                  placeholder="What happened?"
                />
              </Field>
              <Button
                type="button"
                variant="secondary"
                className="gap-1.5"
                disabled={isCompleting}
                onClick={() => onComplete(outcome, outcomeNotes)}
              >
                <CheckCircle2 className="h-3.5 w-3.5" />
                {isCompleting ? "Logging…" : "Log outcome"}
              </Button>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function PlaybookCard({ playbook }: { playbook: CrmFollowupPlaybook }) {
  return (
    <div className="rounded-xl border border-hairline bg-surface p-5 shadow-card">
      <div className="flex items-start gap-3">
        <div className="rounded-md border border-hairline bg-muted p-2 text-clay">
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h3 className="font-serif text-xl text-foreground">{playbook.name}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">{playbook.description}</p>
        </div>
      </div>
      <div className="mt-4 border-t border-hairline">
        {playbook.steps.map((step) => (
          <div
            key={step.id}
            className="grid grid-cols-[58px_1fr] gap-3 border-b border-hairline py-3 last:border-0"
          >
            <div className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-clay">
              Day {step.day_offset}
            </div>
            <div>
              <div className="text-sm font-semibold text-foreground">{step.title}</div>
              <div className="mt-1 text-xs leading-5 text-muted-foreground">{step.value_angle}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function ValueAssetRow({ asset }: { asset: CrmValueAsset }) {
  const view = async () => {
    const url = await assetUrl(asset, 10 * 60);
    window.open(url, "_blank", "noopener,noreferrer");
  };
  return (
    <div className="flex items-start gap-3 rounded-xl border border-hairline bg-surface px-4 py-3 shadow-card">
      <div className="mt-0.5 rounded-md border border-hairline bg-muted p-2 text-clay">
        {asset.source_type === "upload" ? (
          <FileText className="h-4 w-4" />
        ) : (
          <Link2 className="h-4 w-4" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-foreground">{asset.title}</div>
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {asset.description || asset.audience || "Approved follow-up resource"}
        </p>
        {asset.tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {asset.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-full border border-hairline bg-background px-2 py-0.5 text-[10px] text-muted-foreground"
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>
      <Button type="button" variant="ghost" size="sm" className="gap-1" onClick={view}>
        View <ExternalLink className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}

export function QueueHeading({
  timing,
  count,
}: {
  timing: ReturnType<typeof followupTiming>;
  count: number;
}) {
  const labels = {
    overdue: "Overdue — recover these relationships",
    today: "Ready today",
    upcoming: "Upcoming",
    unscheduled: "Needs a date",
  };
  return (
    <div className="flex items-center gap-2 pt-1">
      <Clock3 className={cn("h-3.5 w-3.5", timing === "overdue" ? "text-danger" : "text-clay")} />
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {labels[timing]} · {count}
      </div>
    </div>
  );
}

export function StudioMetric({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: number;
  tone?: "default" | "warning" | "danger";
}) {
  return (
    <div className="bg-surface px-4 py-4">
      <div
        className={cn(
          "font-serif text-3xl tabular-nums text-foreground",
          tone === "warning" && "text-warning",
          tone === "danger" && "text-danger",
        )}
      >
        {value}
      </div>
      <div className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export function SectionLead({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string;
  title: string;
  description: string;
}) {
  return (
    <div>
      <div className="eyebrow">{eyebrow}</div>
      <h2 className="mt-1 font-serif text-2xl text-foreground">{title}</h2>
      <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <Label className="mb-1.5 block text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function EmptyPanel({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-xl border border-dashed border-hairline bg-background px-5 py-8 text-center">
      <div className="font-serif text-xl text-foreground">{title}</div>
      <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted-foreground">{description}</p>
    </div>
  );
}

export function SurfaceMessage({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: "default" | "danger";
}) {
  return (
    <div
      className={cn(
        "rounded-xl border border-hairline bg-surface p-6 text-sm text-muted-foreground",
        tone === "danger" && "border-danger/30 bg-danger/5 text-danger",
      )}
    >
      {children}
    </div>
  );
}

async function assetUrl(asset: CrmValueAsset, expiresIn: number) {
  if (asset.external_url) return asset.external_url;
  if (!asset.storage_path) throw new Error("This resource does not have a file or link.");
  const { data, error } = await supabase.storage
    .from("crm-assets")
    .createSignedUrl(asset.storage_path, expiresIn);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}
