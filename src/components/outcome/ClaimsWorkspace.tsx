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
import { EmptyState } from "@/components/ui/empty-state";
import { MoneyInput } from "@/components/ui/money-input";
import {
  FileCheck,
  FileText,
  History,
  Gavel,
  Paperclip,
  Pencil,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { fmtUSD } from "@/lib/format";
import {
  ClaimCycleLogDialog,
  type ClaimEventDraft,
} from "@/components/outcome/ClaimCycleLogDialog";
import { ClaimDocumentsDialog } from "@/components/outcome/ClaimDocumentsDialog";
import type {
  ClaimDocType,
  ClaimDocumentRow,
  ClaimEventRow,
  ClaimRow,
  ClaimStatus,
  ClaimType,
} from "@/lib/projects.functions";

export type { ClaimEventDraft };

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

const statusStyles: Record<ClaimStatus, string> = {
  in_preparation: "border-hairline bg-surface text-muted-foreground",
  submitted: "border-accent/30 bg-accent/10 text-clay",
  pending_review: "border-warning/30 bg-warning/10 text-warning",
  under_review: "border-warning/30 bg-warning/10 text-warning",
  reviewed: "border-warning/30 bg-warning/10 text-warning",
  resolved: "border-success/30 bg-success/10 text-success",
  rejected: "border-danger/30 bg-danger/10 text-danger",
  withdrawn: "border-hairline bg-surface text-muted-foreground",
};

// Shared pill shape for the type / status / relationship badges on a claim card.
const badgePill =
  "inline-flex items-center whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.06em]";

// ── Pipeline stepper (display-only) ─────────────────────────────────────────
// Prep → Submitted → Review → Resolved. Statuses map onto the four stages;
// the status badge on the card carries the exact truth (incl. rejected /
// withdrawn, which land on the Resolved node in danger / muted tone).
const PIPELINE_STAGES = ["Prep", "Submitted", "Review", "Resolved"] as const;

const PIPELINE_STAGE_INDEX: Record<ClaimStatus, number> = {
  in_preparation: 0,
  submitted: 1,
  pending_review: 2,
  under_review: 2,
  reviewed: 2,
  resolved: 3,
  rejected: 3,
  withdrawn: 3,
};

function ClaimPipeline({ status }: { status: ClaimStatus }) {
  const current = PIPELINE_STAGE_INDEX[status];
  return (
    <div className="mt-2.5 flex flex-wrap items-center">
      {PIPELINE_STAGES.map((stage, i) => {
        let node = "border border-hairline text-muted-foreground"; // future
        if (i === current) {
          node = "bg-accent text-accent-foreground"; // clay-filled
          if (i === 3 && status === "rejected") node = "bg-destructive text-destructive-foreground";
          if (i === 3 && status === "withdrawn") node = "bg-muted text-muted-foreground";
        } else if (i < current) {
          node = "border border-clay/40 text-clay"; // done: clay-outline
        }
        return (
          <div key={stage} className="flex items-center">
            {i > 0 && (
              <span
                aria-hidden="true"
                className={`h-px w-4 ${i <= current ? "bg-clay" : "bg-hairline"}`}
              />
            )}
            <span
              className={`whitespace-nowrap rounded-full px-[7px] py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.04em] ${node}`}
            >
              {stage}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Small building blocks ────────────────────────────────────────────────────

function StatTile({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  const valueTone =
    tone === "success" ? "text-success" : tone === "danger" ? "text-danger" : "text-foreground";
  return (
    <div className="rounded-lg border border-hairline bg-card px-[15px] py-[13px]">
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </div>
      <div className={`mt-1.5 font-serif text-[22px] leading-none tabular ${valueTone}`}>
        {value}
      </div>
    </div>
  );
}

function CountPill({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="inline-flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-accent px-[5px] text-[9px] font-bold leading-none text-accent-foreground">
      {count}
    </span>
  );
}

// Clay-outline styling for the "Push to" actions (Send to risk / Promote to CO).
const pushButtonClass =
  "gap-1.5 border-clay/45 bg-clay/5 text-clay hover:bg-clay/10 hover:text-clay";

// Disabled-state pill shown once a claim is already linked.
const linkedPillClass =
  "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-md border border-hairline px-3 text-xs font-semibold text-muted-foreground";

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

// Resolved, rejected, and withdrawn claims are closed; everything else is an
// open dispute (drives Open claims + In dispute).
const isClosed = (s: ClaimStatus) => s === "resolved" || s === "rejected" || s === "withdrawn";

export function ClaimsWorkspace({
  claims,
  events = [],
  documents = [],
  onCreate,
  onUpdate,
  onDelete,
  onCreateEvent,
  onDeleteEvent,
  onUploadDocument,
  onViewDocument,
  onDeleteDocument,
  onSendToRisk,
  onPromoteToChangeOrder,
  uploadingDocument = false,
  saving = false,
}: {
  claims: ClaimRow[];
  events?: ClaimEventRow[];
  documents?: ClaimDocumentRow[];
  onCreate: (draft: ClaimDraft) => void;
  onUpdate: (id: string, patch: ClaimPatch) => void;
  onDelete: (id: string) => void;
  onCreateEvent?: (claimId: string, draft: ClaimEventDraft) => void;
  onDeleteEvent?: (id: string) => void;
  onUploadDocument?: (claimId: string, file: File, docType: ClaimDocType, note: string) => void;
  onViewDocument?: (path: string) => void;
  onDeleteDocument?: (id: string, path: string) => void;
  onSendToRisk?: (claim: ClaimRow) => void;
  onPromoteToChangeOrder?: (claim: ClaimRow) => void;
  uploadingDocument?: boolean;
  saving?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ClaimDraft>(() => emptyDraft());
  const [cycleLogClaimId, setCycleLogClaimId] = useState<string | null>(null);
  const [docsClaimId, setDocsClaimId] = useState<string | null>(null);
  const cycleLogClaim = claims.find((c) => c.id === cycleLogClaimId) ?? null;
  const docsClaim = claims.find((c) => c.id === docsClaimId) ?? null;
  const eventsByClaim = new Map<string, ClaimEventRow[]>();
  for (const event of events) {
    const list = eventsByClaim.get(event.claim_id) ?? [];
    list.push(event);
    eventsByClaim.set(event.claim_id, list);
  }
  const docsByClaim = new Map<string, ClaimDocumentRow[]>();
  for (const doc of documents) {
    const list = docsByClaim.get(doc.claim_id) ?? [];
    list.push(doc);
    docsByClaim.set(doc.claim_id, list);
  }

  // ── Live aggregates for the verdict + stat row ─────────────────────────────
  const openClaims = claims.filter((c) => !isClosed(c.status));
  const totalSought = claims.reduce((s, c) => s + c.money_claimed, 0);
  const totalAwarded = claims.reduce((s, c) => s + c.money_awarded, 0);
  const daysSought = claims.reduce((s, c) => s + c.time_claimed_days, 0);
  const daysAwarded = claims.reduce((s, c) => s + c.time_awarded_days, 0);
  const inDispute = openClaims.reduce((s, c) => s + c.money_claimed, 0);

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
      {/* 1 · Chip + Add claim */}
      <div className="flex items-center gap-2.5">
        <span className="rounded-md border border-hairline px-[7px] py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-clay">
          Dispute resolution
        </span>
        <Button size="sm" className="ml-auto gap-1.5" onClick={openNew}>
          <Plus className="h-4 w-4" /> Add claim
        </Button>
      </div>

      {/* 2 · Verdict headline + muted sub */}
      <div>
        <h2 className="max-w-[36ch] font-serif text-3xl font-normal leading-[1.16]">
          {claims.length === 0 ? (
            <>No claims logged — disputes go here when they start.</>
          ) : (
            <>
              {fmtUSD(totalSought)} and {daysSought} {daysSought === 1 ? "day" : "days"} sought
              across {claims.length} {claims.length === 1 ? "claim" : "claims"} —{" "}
              {totalAwarded === 0 ? "none awarded yet" : `${fmtUSD(totalAwarded)} awarded`}.
            </>
          )}
        </h2>
        <p className="mt-2 max-w-[70ch] text-sm leading-relaxed text-muted-foreground">
          Claims run the contract&apos;s dispute-resolution process for money and time. Track each
          through the pipeline, keep its cycle log and documents, and push it to Risk Tally or a
          Change Order.
        </p>
      </div>

      {/* 3 · Stat row */}
      {claims.length > 0 && (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Open claims" value={String(openClaims.length)} />
          <StatTile label="Amount sought" value={fmtUSD(totalSought)} />
          <StatTile label="Amount awarded" value={fmtUSD(totalAwarded)} tone="success" />
          <StatTile label="Time sought" value={`${daysSought} d`} />
          <StatTile label="Time awarded" value={`${daysAwarded} d`} />
          <StatTile label="In dispute" value={fmtUSD(inDispute)} tone="danger" />
        </div>
      )}

      {/* 4 · One card per claim */}
      <div className="flex flex-col gap-3">
        {claims.map((c) => {
          const eventCount = eventsByClaim.get(c.id)?.length ?? 0;
          const docCount = docsByClaim.get(c.id)?.length ?? 0;
          return (
            <article
              key={c.id}
              className="rounded-xl border border-hairline bg-card px-5 py-[18px]"
            >
              {/* Header row: number · title · type · status · relationships */}
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                {c.claim_number && (
                  <span className="font-mono text-[10px] text-muted-foreground">
                    {c.claim_number}
                  </span>
                )}
                <span className="text-[15px] font-semibold">{c.title}</span>
                <span className={`${badgePill} border-hairline text-muted-foreground`}>
                  {CLAIM_TYPE_LABELS[c.claim_type]}
                </span>
                <span className={`${badgePill} ${statusStyles[c.status]}`}>
                  {CLAIM_STATUS_LABELS[c.status]}
                </span>
                {c.risk_exposure_id && (
                  <span className={`${badgePill} border-accent/30 bg-accent/10 text-clay`}>
                    from Risk Tally
                  </span>
                )}
                {c.change_order_id && (
                  <span className={`${badgePill} border-hairline bg-surface text-muted-foreground`}>
                    in Change Orders
                  </span>
                )}
              </div>

              {c.description && (
                <p className="mt-2 max-w-[66ch] text-[12.5px] leading-relaxed text-muted-foreground">
                  {c.description}
                </p>
              )}

              <ClaimPipeline status={c.status} />

              {/* Mini metric tiles */}
              <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
                <div className="rounded-lg border border-hairline bg-background px-3 py-2.5">
                  <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Amount sought
                  </div>
                  <div className="mt-1 font-serif text-lg leading-tight tabular">
                    {c.money_claimed > 0 ? fmtUSD(c.money_claimed) : "—"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {c.time_claimed_days} d sought
                  </div>
                </div>
                <div className="rounded-lg border border-hairline bg-background px-3 py-2.5">
                  <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Amount awarded
                  </div>
                  <div
                    className={`mt-1 font-serif text-lg leading-tight tabular ${
                      c.money_awarded > 0 ? "text-success" : "text-muted-foreground"
                    }`}
                  >
                    {c.money_awarded > 0 ? fmtUSD(c.money_awarded) : "—"}
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {c.time_awarded_days > 0 ? `${c.time_awarded_days} d awarded` : "— awarded"}
                  </div>
                </div>
                <div className="rounded-lg border border-hairline bg-background px-3 py-2.5">
                  <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Submitted
                  </div>
                  <div className="mt-1.5 text-[13.5px] font-semibold">
                    {c.submitted_at || "Not submitted"}
                  </div>
                </div>
                <div className="rounded-lg border border-hairline bg-background px-3 py-2.5">
                  <div className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted-foreground">
                    Owner
                  </div>
                  <div className="mt-1.5 text-[13.5px] font-semibold">
                    {c.owner || "Unassigned"}
                  </div>
                </div>
              </div>

              {/* Action bar */}
              <div className="mt-3.5 flex flex-wrap items-center gap-2 border-t border-hairline pt-3.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setCycleLogClaimId(c.id)}
                  aria-label={`Open cycle log for ${c.title}`}
                >
                  <History className="h-3.5 w-3.5" /> Cycle log
                  <CountPill count={eventCount} />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => setDocsClaimId(c.id)}
                  aria-label={`Open documents for ${c.title}`}
                >
                  <Paperclip className="h-3.5 w-3.5" /> Documents
                  <CountPill count={docCount} />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => openEdit(c)}
                  aria-label={`Edit claim ${c.title}`}
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => onDelete(c.id)}
                  aria-label={`Delete claim ${c.title}`}
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </Button>
                {(onSendToRisk || onPromoteToChangeOrder) && (
                  <div className="ml-auto flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-clay">
                      Push to →
                    </span>
                    {onSendToRisk &&
                      (c.risk_exposure_id ? (
                        <span className={linkedPillClass}>
                          <ShieldCheck className="h-3.5 w-3.5" /> In risk tally
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className={pushButtonClass}
                          onClick={() => onSendToRisk(c)}
                          aria-label={`Send ${c.title} to the risk tally`}
                        >
                          <ShieldAlert className="h-3.5 w-3.5" /> Send to risk
                        </Button>
                      ))}
                    {onPromoteToChangeOrder &&
                      (c.change_order_id ? (
                        <span className={linkedPillClass}>
                          <FileCheck className="h-3.5 w-3.5" /> In change orders
                        </span>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          className={pushButtonClass}
                          onClick={() => onPromoteToChangeOrder(c)}
                          aria-label={`Promote ${c.title} to a change order`}
                        >
                          <FileText className="h-3.5 w-3.5" /> Promote to CO
                        </Button>
                      ))}
                  </div>
                )}
              </div>
            </article>
          );
        })}

        {claims.length === 0 && (
          <div className="rounded-xl border border-hairline bg-card px-4 py-10">
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
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="eyebrow">Dispute resolution</div>
            <DialogTitle className="font-serif text-2xl font-normal">
              {editingId ? "Edit claim" : "New claim"}
            </DialogTitle>
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

          <DialogFooter className="gap-2 sm:items-center">
            <span className="text-[11.5px] text-muted-foreground sm:mr-auto">
              Cycle log &amp; documents open from the claim row once saved.
            </span>
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

      <ClaimDocumentsDialog
        claim={docsClaim}
        documents={docsClaim ? (docsByClaim.get(docsClaim.id) ?? []) : []}
        onClose={() => setDocsClaimId(null)}
        onUpload={onUploadDocument}
        onView={onViewDocument}
        onDelete={onDeleteDocument}
        uploading={uploadingDocument}
      />
    </div>
  );
}
