import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Download, Pencil, Mail, FileText } from "lucide-react";
import type { ReviewRow, ProjectRow } from "@/lib/projects.functions";
import { generateIorPdf, downloadPdfBytes, type IorPdfStyle, type IorPdfInput } from "@/lib/ior-pdf";

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
  onUpdate: (id: string, patch: { body_markdown?: string; status?: string; email_recipients?: string[]; pdf_style?: IorPdfStyle }) => void;
  pending?: boolean;
}) {
  const [editing, setEditing] = useState<ReviewRow | null>(null);

  const downloadReview = async (r: ReviewRow) => {
    const input = buildPdfInput(r);
    const style = (r.pdf_style as IorPdfStyle) ?? "executive";
    const bytes = await generateIorPdf({ ...input, narrative: r.body_markdown || r.summary_notes }, style);
    const date = new Date(r.reviewed_at).toISOString().slice(0, 10);
    downloadPdfBytes(bytes, `IOR_${project.name.replace(/\s+/g, "_")}_${date}.pdf`);
  };

  const emailReview = async (r: ReviewRow) => {
    const subject = encodeURIComponent(`IOR Report — ${project.name} — ${new Date(r.reviewed_at).toLocaleDateString()}`);
    const body = encodeURIComponent(
      `Indicated Outcome Report for ${project.name}.\n\n` +
      `Reviewer: ${r.reviewer || "—"}\n` +
      `Reviewed: ${new Date(r.reviewed_at).toLocaleString()}\n\n` +
      `${r.body_markdown || r.summary_notes || "(See attached PDF — download from the IOR portal and attach.)"}`,
    );
    const to = (r.email_recipients ?? []).join(",");
    window.location.href = `mailto:${to}?subject=${subject}&body=${body}`;
  };

  if (reviews.length === 0) {
    return (
      <div className="rounded-lg border border-hairline bg-card p-10 text-center">
        <FileText className="mx-auto h-8 w-8 text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">
          No reviews yet. Run the first Project Truth Review to log what's changed and produce the first IOR Report.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-hairline bg-card">
        <ul className="divide-y divide-hairline">
          {reviews.map((r) => (
            <li key={r.id} className="px-5 py-4">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-foreground">
                    {new Date(r.reviewed_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {r.reviewer || "—"}
                    {r.status === "draft" && <span className="ml-2 rounded-sm bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warning">draft</span>}
                  </div>

                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(r)} className="gap-1.5">
                    <Pencil className="h-3.5 w-3.5" /> Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => downloadReview(r)} className="gap-1.5">
                    <Download className="h-3.5 w-3.5" /> PDF
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => emailReview(r)} className="gap-1.5">
                    <Mail className="h-3.5 w-3.5" /> Email
                  </Button>
                </div>
              </div>
              {(r.forecast_completion_date_before || r.forecast_completion_date_after) && (
                <div className="mt-1 text-xs text-muted-foreground">
                  Forecast completion:{" "}
                  {r.forecast_completion_date_before ? new Date(r.forecast_completion_date_before).toLocaleDateString() : "—"}
                  {" → "}
                  {r.forecast_completion_date_after ? new Date(r.forecast_completion_date_after).toLocaleDateString() : "—"}
                </div>
              )}
              {(r.body_markdown || r.summary_notes) && (
                <pre className="mt-2 max-h-32 overflow-hidden whitespace-pre-wrap font-sans text-sm text-foreground/85">
                  {r.body_markdown || r.summary_notes}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </div>

      {editing && (
        <EditReviewDialog
          review={editing}
          onClose={() => setEditing(null)}
          onSave={(patch) => { onUpdate(editing.id, patch); setEditing(null); }}
          pending={pending}
        />
      )}
    </>
  );
}

function EditReviewDialog({
  review, onClose, onSave, pending,
}: {
  review: ReviewRow;
  onClose: () => void;
  onSave: (patch: { body_markdown: string; status: string; email_recipients: string[]; pdf_style: IorPdfStyle }) => void;
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
              <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm">
                <option value="published">Published</option>
                <option value="draft">Draft</option>
              </select>
            </div>
            <div />
          </div>

          <div className="space-y-1.5">
            <Label>Default email recipients <span className="text-muted-foreground">(comma-separated)</span></Label>
            <Input value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="owner@example.com, super@example.com" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button disabled={pending} onClick={() => onSave({
            body_markdown: body, status, pdf_style: style,
            email_recipients: emails.split(",").map((s) => s.trim()).filter(Boolean),
          })}>
            {pending ? "Saving…" : "Save & re-publish"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
