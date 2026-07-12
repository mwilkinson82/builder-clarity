import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Download, Pencil, Mail, FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { sendTransactionalEmail } from "@/lib/email/send";
import { fmtPct, fmtUSD } from "@/lib/format";
import type { ReviewRow, ProjectRow } from "@/lib/projects.functions";
import {
  generateIorPdf,
  downloadPdfBytes,
  type IorPdfStyle,
  type IorPdfInput,
} from "@/lib/ior-pdf";

export function ReviewsTab({
  reviews,
  project,
  buildPdfInput,
  onUpdate,
  pending,
}: {
  reviews: ReviewRow[];
  project: ProjectRow;
  /** Returns the full PDF input for a given review (uses snapshot if present, else live data). */
  buildPdfInput: (review: ReviewRow | null) => IorPdfInput;
  onUpdate: (
    id: string,
    patch: {
      body_markdown?: string;
      status?: string;
      email_recipients?: string[];
      pdf_style?: IorPdfStyle;
    },
  ) => void;
  pending?: boolean;
}) {
  const [editing, setEditing] = useState<ReviewRow | null>(null);
  const [emailing, setEmailing] = useState<ReviewRow | null>(null);

  const downloadReview = async (r: ReviewRow) => {
    const input = buildPdfInput(r);
    const style = (r.pdf_style as IorPdfStyle) ?? "executive";
    const bytes = await generateIorPdf(
      { ...input, narrative: r.body_markdown || r.summary_notes },
      style,
    );
    const date = new Date(r.reviewed_at).toISOString().slice(0, 10);
    downloadPdfBytes(bytes, `IOR_${project.name.replace(/\s+/g, "_")}_${date}.pdf`);
  };

  if (reviews.length === 0) {
    return (
      <div className="rounded-xl border border-hairline bg-card p-10 text-center">
        <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-4 font-serif text-lg text-foreground">No saved IOR reports yet.</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Create the first report to lock the narrative and export the PDF.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-xl border border-hairline bg-card">
        <ul className="divide-y divide-hairline">
          {reviews.map((r) => (
            <li key={r.id} className="px-5 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-foreground">
                    {formatDate(r.reviewed_at)} · {formatTime(r.reviewed_at)}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.reviewer || "—"} ·{" "}
                    {r.status === "draft" ? (
                      <span className="rounded-sm bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warning">
                        draft
                      </span>
                    ) : (
                      <span className="inline-block rounded-full border border-success/40 bg-success/5 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.06em] text-success">
                        Published
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex flex-none items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEditing(r)}
                    className="gap-1.5"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => downloadReview(r)}
                    className="gap-1.5"
                  >
                    <Download className="h-3.5 w-3.5" /> PDF
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setEmailing(r)}
                    className="gap-1.5"
                  >
                    <Mail className="h-3.5 w-3.5" /> Email
                  </Button>
                </div>
              </div>
              {(r.forecast_completion_date_before || r.forecast_completion_date_after) && (
                <div className="mt-1.5 text-xs text-muted-foreground">
                  Forecast completion:{" "}
                  {r.forecast_completion_date_before
                    ? new Date(r.forecast_completion_date_before).toLocaleDateString()
                    : "—"}
                  {" → "}
                  {r.forecast_completion_date_after
                    ? new Date(r.forecast_completion_date_after).toLocaleDateString()
                    : "—"}
                </div>
              )}
              {(r.body_markdown || r.summary_notes) && (
                <p className="mt-3 line-clamp-4 max-w-[82ch] whitespace-pre-wrap border-l-2 border-hairline pl-3.5 text-[13px] leading-relaxed text-muted-foreground">
                  {r.body_markdown || r.summary_notes}
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>

      {editing && (
        <EditReviewDialog
          review={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => {
            onUpdate(editing.id, patch);
            setEditing(null);
          }}
          pending={pending}
        />
      )}

      {emailing && (
        <EmailReviewDialog
          review={emailing}
          project={project}
          buildPdfInput={buildPdfInput}
          onClose={() => setEmailing(null)}
          onSent={(recipients) => {
            onUpdate(emailing.id, { email_recipients: recipients });
            setEmailing(null);
          }}
        />
      )}
    </>
  );
}

function EmailReviewDialog({
  review,
  project,
  buildPdfInput,
  onClose,
  onSent,
}: {
  review: ReviewRow;
  project: ProjectRow;
  buildPdfInput: (review: ReviewRow | null) => IorPdfInput;
  onClose: () => void;
  onSent: (recipients: string[]) => void;
}) {
  const [emails, setEmails] = useState((review.email_recipients ?? []).join(", "));
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);

  const input = buildPdfInput(review);
  const narrative = review.body_markdown || review.summary_notes || "";

  const send = async () => {
    const recipients = parseRecipients(emails);
    if (recipients.length === 0) {
      toast.error("Add at least one recipient", {
        description: "Enter one or more team email addresses before sending.",
      });
      return;
    }

    setSending(true);
    try {
      const reviewedAt = formatDateTime(review.reviewed_at);
      await Promise.all(
        recipients.map(async (recipient, index) => {
          const result = await sendTransactionalEmail({
            templateName: "ior-report-notification",
            recipientEmail: recipient,
            idempotencyKey: `ior-report:${review.id}:${recipient}:${Date.now()}:${index}`,
            templateData: {
              projectName: project.name,
              clientName: project.client,
              jobNumber: project.job_number,
              reviewedAt,
              reviewer: review.reviewer || "PM",
              indicatedGp: fmtUSD(input.rollup.indicatedGP),
              indicatedGpPct: fmtPct(input.rollup.indicatedGPpct),
              gpAtRisk: fmtUSD(input.rollup.gpAtRisk),
              forecastBefore: formatDate(review.forecast_completion_date_before),
              forecastAfter: formatDate(review.forecast_completion_date_after),
              narrative,
              portalUrl: projectUrl(project.id),
              note,
            },
          });

          if (result && typeof result === "object" && "success" in result && !result.success) {
            throw new Error("The email service did not queue one of the report emails.");
          }
        }),
      );

      toast.success("IOR report email queued", {
        description: `${recipients.length} recipient${recipients.length === 1 ? "" : "s"} will receive it from Overwatch.`,
      });
      onSent(recipients);
    } catch (error) {
      toast.error("IOR report email did not queue", {
        description: error instanceof Error ? error.message : "The email service rejected it.",
      });
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <div className="eyebrow">Send through OverWatch</div>
          <DialogTitle className="font-serif text-2xl font-normal">Email IOR report</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="rounded-lg border border-hairline bg-background p-3.5 text-sm">
            <div className="font-semibold text-foreground">{project.name}</div>
            <div className="mt-1 text-xs text-muted-foreground">
              {formatDateTime(review.reviewed_at)} · Indicated GP{" "}
              <span className="tabular font-semibold text-foreground">
                {fmtUSD(input.rollup.indicatedGP)}
              </span>{" "}
              · GP at risk{" "}
              <span className="tabular font-semibold text-foreground">
                {fmtUSD(input.rollup.gpAtRisk)}
              </span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>
              Team recipients <span className="text-muted-foreground">(comma-separated)</span>
            </Label>
            <Input
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="pm@company.com, owner@company.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Optional note</Label>
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add meeting context or what you want the team to review."
            />
          </div>
        </div>
        <DialogFooter className="gap-3 border-t border-hairline pt-4 sm:items-center sm:justify-between">
          <span className="text-[11px] text-muted-foreground">
            Sent from OverWatch with a link to the full report.
          </span>
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={sending}>
              Cancel
            </Button>
            <Button onClick={send} disabled={sending}>
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Mail className="h-4 w-4" />
              )}
              {sending ? "Queueing..." : "Send through OverWatch"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function parseRecipients(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[,\n;]/)
        .map((item) => item.trim().toLowerCase())
        .filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item)),
    ),
  );
}

function formatDate(value?: string | null) {
  if (!value) return "";
  return new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function formatTime(value?: string | null) {
  if (!value) return "—";
  return new Date(value).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatDateTime(value?: string | null) {
  if (!value) return "Date not recorded";
  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function projectUrl(projectId: string) {
  if (typeof window === "undefined") return `/projects/${projectId}`;
  return `${window.location.origin}/projects/${projectId}`;
}

function EditReviewDialog({
  review,
  onClose,
  onSave,
  pending,
}: {
  review: ReviewRow;
  onClose: () => void;
  onSave: (patch: {
    body_markdown: string;
    status: string;
    email_recipients: string[];
    pdf_style: IorPdfStyle;
  }) => void;
  pending?: boolean;
}) {
  const [body, setBody] = useState(review.body_markdown || review.summary_notes);
  const [emails, setEmails] = useState((review.email_recipients ?? []).join(", "));
  const [style, setStyle] = useState<IorPdfStyle>((review.pdf_style as IorPdfStyle) ?? "executive");
  const [status, setStatus] = useState(review.status || "published");

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-serif text-2xl">Edit review</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4 py-2">
          <div className="space-y-1.5">
            <Label>Narrative / executive summary</Label>
            <Textarea rows={8} value={body} onChange={(e) => setBody(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
              >
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </select>
            </div>
            <div />
          </div>

          <div className="space-y-1.5">
            <Label>
              Default email recipients{" "}
              <span className="text-muted-foreground">(comma-separated)</span>
            </Label>
            <Input
              value={emails}
              onChange={(e) => setEmails(e.target.value)}
              placeholder="owner@example.com, super@example.com"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={pending}
            onClick={() =>
              onSave({
                body_markdown: body,
                status,
                pdf_style: style,
                email_recipients: emails
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
              })
            }
          >
            {pending ? "Saving…" : "Save & re-publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
