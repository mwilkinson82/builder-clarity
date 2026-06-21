import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteDailyReport,
  listDailyReports,
  upsertDailyReport,
  type DailyReportRow,
} from "@/lib/daily-reports.functions";
import {
  CalendarDays,
  CheckCircle2,
  ExternalLink,
  FileText,
  Image as ImageIcon,
  Paperclip,
  Pencil,
  Save,
  Trash2,
  Upload,
} from "lucide-react";

const BUCKET = "daily-reports";
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const ALLOWED_TYPES = new Set([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/heic",
]);

type DailyReportDraft = {
  report_date: string;
  author: string;
  weather: string;
  crew_count: string;
  work_performed: string;
  delays: string;
  safety_notes: string;
  notes: string;
  attachment_name: string;
  attachment_path: string;
  attachment_type: string;
};

const localDate = () => {
  const d = new Date();
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
};

const emptyDraft = (): DailyReportDraft => ({
  report_date: localDate(),
  author: "",
  weather: "",
  crew_count: "0",
  work_performed: "",
  delays: "",
  safety_notes: "",
  notes: "",
  attachment_name: "",
  attachment_path: "",
  attachment_type: "",
});

function formatDate(value: string) {
  if (!value) return "-";
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function sanitizeFileName(name: string) {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120);
}

function isImage(type: string) {
  return type.startsWith("image/");
}

function reportToDraft(report: DailyReportRow): DailyReportDraft {
  return {
    report_date: report.report_date,
    author: report.author,
    weather: report.weather,
    crew_count: String(report.crew_count),
    work_performed: report.work_performed,
    delays: report.delays,
    safety_notes: report.safety_notes,
    notes: report.notes,
    attachment_name: report.attachment_name,
    attachment_path: report.attachment_path,
    attachment_type: report.attachment_type,
  };
}

export function DailyReportsWorkspace({ projectId }: { projectId: string }) {
  const listFn = useServerFn(listDailyReports);
  const upsertFn = useServerFn(upsertDailyReport);
  const deleteFn = useServerFn(deleteDailyReport);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<DailyReportDraft>(() => emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const {
    data: reports = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["daily-reports", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });

  const metrics = useMemo(() => {
    const withAttachments = reports.filter((r) => r.attachment_path).length;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const lastWeekCount = reports.filter(
      (r) => new Date(`${r.report_date}T12:00:00`) >= sevenDaysAgo,
    ).length;
    return {
      count: reports.length,
      latest: reports[0]?.report_date ?? "",
      withAttachments,
      lastWeekCount,
    };
  }, [reports]);

  const resetForm = () => {
    setDraft(emptyDraft());
    setFile(null);
    setEditingId(null);
  };

  const uploadAttachment = async () => {
    if (!file) {
      return {
        attachment_name: draft.attachment_name,
        attachment_path: draft.attachment_path,
        attachment_type: draft.attachment_type,
      };
    }

    if (!ALLOWED_TYPES.has(file.type)) {
      throw new Error("Daily report uploads must be PDF, PNG, JPG, WebP, or HEIC.");
    }
    if (file.size > MAX_FILE_SIZE) {
      throw new Error("Daily report uploads must be 25 MB or smaller.");
    }

    const safeName = sanitizeFileName(file.name) || "daily-report";
    const path = `${projectId}/${draft.report_date}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
      contentType: file.type,
      upsert: false,
    });
    if (uploadError) throw new Error(uploadError.message);

    return {
      attachment_name: file.name,
      attachment_path: path,
      attachment_type: file.type,
    };
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.report_date) throw new Error("Choose a report date.");
      const attachment = await uploadAttachment();
      return upsertFn({
        data: {
          projectId,
          report_date: draft.report_date,
          author: draft.author,
          weather: draft.weather,
          crew_count: Number(draft.crew_count) || 0,
          work_performed: draft.work_performed,
          delays: draft.delays,
          safety_notes: draft.safety_notes,
          notes: draft.notes,
          ...attachment,
        },
      });
    },
    onSuccess: async (report) => {
      await qc.invalidateQueries({ queryKey: ["daily-reports", projectId] });
      toast.success(editingId ? "Daily report updated" : "Daily report saved", {
        description: `${formatDate(report.report_date)} is stored on this job.`,
      });
      resetForm();
    },
    onError: (err) => {
      toast.error("Daily report did not save", {
        description: err instanceof Error ? err.message : "Check the fields and try again.",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (report: DailyReportRow) => {
      if (report.attachment_path) {
        await supabase.storage.from(BUCKET).remove([report.attachment_path]);
      }
      return deleteFn({ data: { id: report.id } });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["daily-reports", projectId] });
      toast.success("Daily report deleted");
      if (editingId) resetForm();
    },
    onError: (err) => {
      toast.error("Daily report did not delete", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    },
  });

  const openAttachment = async (report: DailyReportRow) => {
    if (!report.attachment_path) return;
    const { data, error: signedUrlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(report.attachment_path, 600);
    if (signedUrlError || !data?.signedUrl) {
      toast.error("Attachment could not open", {
        description: signedUrlError?.message ?? "Try again.",
      });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const editReport = (report: DailyReportRow) => {
    setDraft(reportToDraft(report));
    setFile(null);
    setEditingId(report.id);
  };

  const missingTable =
    error instanceof Error &&
    (error.message.includes("daily_reports") || error.message.includes("schema cache"));

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-hairline bg-card p-6 shadow-card">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              Daily Reports
            </div>
            <h2 className="mt-2 font-serif text-4xl text-foreground">Job log by day.</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Fill it out here or upload the signed PDF/photo packet. Every entry is stored by date
              on this project.
            </p>
          </div>
          <div className="grid min-w-[280px] grid-cols-2 gap-2">
            <DailyMetric label="Reports logged" value={String(metrics.count)} />
            <DailyMetric label="Last 7 days" value={String(metrics.lastWeekCount)} />
            <DailyMetric
              label="Latest report"
              value={metrics.latest ? formatDate(metrics.latest) : "-"}
            />
            <DailyMetric label="Attachments" value={String(metrics.withAttachments)} />
          </div>
        </div>
      </section>

      <section className="rounded-lg border border-hairline bg-card p-6 shadow-card">
        <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="font-serif text-2xl text-foreground">
              {editingId ? "Edit daily report" : "Add daily report"}
            </h3>
            <p className="text-sm text-muted-foreground">
              One saved record per calendar day. Saving the same date updates that day.
            </p>
          </div>
          {editingId && (
            <Button variant="outline" size="sm" onClick={resetForm}>
              Cancel edit
            </Button>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-[1fr_1fr_120px]">
          <Field label="Report date">
            <Input
              type="date"
              value={draft.report_date}
              onChange={(e) => setDraft({ ...draft, report_date: e.target.value })}
            />
          </Field>
          <Field label="Author / PM">
            <Input
              value={draft.author}
              placeholder="PM, superintendent, or field lead"
              onChange={(e) => setDraft({ ...draft, author: e.target.value })}
            />
          </Field>
          <Field label="Crew count">
            <Input
              type="number"
              min={0}
              value={draft.crew_count}
              onChange={(e) => setDraft({ ...draft, crew_count: e.target.value })}
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Field label="Weather / site conditions">
            <Input
              value={draft.weather}
              placeholder="Clear, rain delay, high heat, site access, etc."
              onChange={(e) => setDraft({ ...draft, weather: e.target.value })}
            />
          </Field>
          <Field label="Attachment">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                type="file"
                accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
              {(file || draft.attachment_name) && (
                <div className="flex min-h-10 items-center gap-2 rounded-md border border-hairline bg-surface px-3 text-xs text-muted-foreground">
                  <Paperclip className="h-3.5 w-3.5 shrink-0" />
                  <span className="line-clamp-1">{file?.name || draft.attachment_name}</span>
                </div>
              )}
            </div>
          </Field>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Field label="Work performed">
            <Textarea
              rows={4}
              value={draft.work_performed}
              placeholder="What happened on site today?"
              onChange={(e) => setDraft({ ...draft, work_performed: e.target.value })}
            />
          </Field>
          <Field label="Delays / blockers">
            <Textarea
              rows={4}
              value={draft.delays}
              placeholder="Schedule slippage, missing information, trade issues, owner decisions, inspections."
              onChange={(e) => setDraft({ ...draft, delays: e.target.value })}
            />
          </Field>
          <Field label="Safety notes">
            <Textarea
              rows={3}
              value={draft.safety_notes}
              placeholder="Incidents, inspections, toolbox talks, safety holds."
              onChange={(e) => setDraft({ ...draft, safety_notes: e.target.value })}
            />
          </Field>
          <Field label="General notes">
            <Textarea
              rows={3}
              value={draft.notes}
              placeholder="Anything that should survive into the project record."
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="gap-1.5"
          >
            {file ? <Upload className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
            {saveMutation.isPending
              ? "Saving..."
              : editingId
                ? "Save changes"
                : "Save daily report"}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-hairline bg-card p-6 shadow-card">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="font-serif text-2xl text-foreground">Daily report history</h3>
            <p className="text-sm text-muted-foreground">
              Date-sorted project record for meeting review and job documentation.
            </p>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading daily reports...</p>
        ) : error ? (
          <div className="rounded-md border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
            {missingTable
              ? "Daily Reports are ready in the app, but the new Supabase migration still needs to be applied in Lovable/Supabase."
              : error.message}
          </div>
        ) : reports.length === 0 ? (
          <div className="rounded-md border border-dashed border-hairline bg-surface p-8 text-center text-sm text-muted-foreground">
            No daily reports logged yet.
          </div>
        ) : (
          <div className="space-y-3">
            {reports.map((report) => (
              <DailyReportItem
                key={report.id}
                report={report}
                onOpen={() => openAttachment(report)}
                onEdit={() => editReport(report)}
                onDelete={() => {
                  if (confirm(`Delete the daily report for ${formatDate(report.report_date)}?`)) {
                    deleteMutation.mutate(report);
                  }
                }}
                deleting={deleteMutation.isPending}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  );
}

function DailyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-h-[72px] flex-col justify-between rounded-md border border-hairline bg-surface p-3">
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="text-lg font-medium tabular text-foreground">{value}</div>
    </div>
  );
}

function DailyReportItem({
  report,
  onOpen,
  onEdit,
  onDelete,
  deleting,
}: {
  report: DailyReportRow;
  onOpen: () => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
  const AttachmentIcon = isImage(report.attachment_type) ? ImageIcon : FileText;
  return (
    <article className="grid gap-4 rounded-md border border-hairline bg-surface p-4 lg:grid-cols-[180px_minmax(0,1fr)_auto]">
      <div>
        <div className="font-serif text-2xl leading-none text-foreground">
          {formatDate(report.report_date)}
        </div>
        <div className="mt-2 space-y-1 text-xs text-muted-foreground">
          <div>{report.author || "No author recorded"}</div>
          <div>
            {report.crew_count} crew{report.crew_count === 1 ? "" : "s"}
            {report.weather ? ` · ${report.weather}` : ""}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ReportSnippet label="Work performed" value={report.work_performed} />
        <ReportSnippet label="Delays / blockers" value={report.delays} tone="danger" />
        <ReportSnippet label="Safety" value={report.safety_notes} />
        <ReportSnippet label="Notes" value={report.notes} />
        {report.attachment_path && (
          <button
            type="button"
            onClick={onOpen}
            className="flex items-center gap-2 rounded-md border border-hairline bg-card px-3 py-2 text-left text-sm hover:bg-background"
          >
            <AttachmentIcon className="h-4 w-4 shrink-0 text-accent" />
            <span className="min-w-0 flex-1 truncate">{report.attachment_name}</span>
            <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        )}
      </div>

      <div className="flex items-start justify-end gap-1">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onEdit}>
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onDelete}
          disabled={deleting}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </article>
  );
}

function ReportSnippet({ label, value, tone }: { label: string; value: string; tone?: "danger" }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {tone === "danger" ? (
          <span className="h-1.5 w-1.5 rounded-full bg-danger" />
        ) : (
          <CheckCircle2 className="h-3 w-3 text-success" />
        )}
        {label}
      </div>
      <p className="mt-1 line-clamp-3 text-sm text-foreground">{value || "-"}</p>
    </div>
  );
}
