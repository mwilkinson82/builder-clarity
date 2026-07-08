import { useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteDailyReport,
  listDailyReports,
  upsertDailyReport,
  type DailyReportAttachment,
  type DailyReportRow,
} from "@/lib/daily-reports.functions";
import {
  downloadPdfBytes,
  generateDailyReportPacketPdf,
  type DailyReportPacketProject,
} from "@/lib/daily-report-packet-pdf";
import { DailyLogWorkLines } from "@/components/outcome/DailyLogWorkLines";
import {
  CalendarDays,
  CheckCircle2,
  Download,
  ExternalLink,
  Eye,
  EyeOff,
  FileText,
  Image as ImageIcon,
  Pencil,
  Save,
  Search,
  Trash2,
  Upload,
  X,
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

type VisibilityFilter = "all" | "client" | "internal";

type DailyReportDraft = {
  report_date: string;
  author: string;
  weather: string;
  crew_count: string;
  manpower: string;
  work_performed: string;
  delays: string;
  safety_notes: string;
  visitors: string;
  quality_notes: string;
  notes: string;
  client_visible: boolean;
  attachment_manifest: DailyReportAttachment[];
};

type ReportFilters = {
  search: string;
  start: string;
  end: string;
  visibility: VisibilityFilter;
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
  manpower: "",
  work_performed: "",
  delays: "",
  safety_notes: "",
  visitors: "",
  quality_notes: "",
  notes: "",
  client_visible: false,
  attachment_manifest: [],
});

const emptyFilters = (): ReportFilters => ({
  search: "",
  start: "",
  end: "",
  visibility: "all",
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

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return bytes > 0 ? `${bytes} B` : "0 MB";
}

function reportToDraft(report: DailyReportRow): DailyReportDraft {
  return {
    report_date: report.report_date,
    author: report.author,
    weather: report.weather,
    crew_count: String(report.crew_count),
    manpower: report.manpower,
    work_performed: report.work_performed,
    delays: report.delays,
    safety_notes: report.safety_notes,
    visitors: report.visitors,
    quality_notes: report.quality_notes,
    notes: report.notes,
    client_visible: report.client_visible,
    attachment_manifest: report.attachment_manifest,
  };
}

export function DailyReportsWorkspace({
  projectId,
  project,
  buckets = [],
}: {
  projectId: string;
  project?: DailyReportPacketProject;
  buckets?: { id: string; cost_code: string; bucket: string }[];
}) {
  const listFn = useServerFn(listDailyReports);
  const upsertFn = useServerFn(upsertDailyReport);
  const deleteFn = useServerFn(deleteDailyReport);
  const qc = useQueryClient();
  const [draft, setDraft] = useState<DailyReportDraft>(() => emptyDraft());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);
  const [removedAttachmentPaths, setRemovedAttachmentPaths] = useState<string[]>([]);
  const [filters, setFilters] = useState<ReportFilters>(() => emptyFilters());
  const [exportingPacket, setExportingPacket] = useState(false);

  const {
    data: reports = [],
    isLoading,
    error,
  } = useQuery({
    queryKey: ["daily-reports", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });

  const filteredReports = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return reports.filter((report) => {
      if (filters.start && report.report_date < filters.start) return false;
      if (filters.end && report.report_date > filters.end) return false;
      if (filters.visibility === "client" && !report.client_visible) return false;
      if (filters.visibility === "internal" && report.client_visible) return false;
      if (!query) return true;
      const haystack = [
        report.report_date,
        report.author,
        report.weather,
        report.manpower,
        report.work_performed,
        report.delays,
        report.safety_notes,
        report.visitors,
        report.quality_notes,
        report.notes,
        ...report.attachment_manifest.map((attachment) => attachment.name),
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [filters, reports]);

  const metrics = useMemo(() => {
    const attachmentCount = reports.reduce(
      (sum, report) => sum + Math.max(report.attachment_count, report.attachment_manifest.length),
      0,
    );
    const storageBytes = reports.reduce((sum, report) => sum + report.attachment_bytes, 0);
    const clientVisibleCount = reports.filter((report) => report.client_visible).length;
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const lastWeekCount = reports.filter(
      (report) => new Date(`${report.report_date}T12:00:00`) >= sevenDaysAgo,
    ).length;
    return {
      count: reports.length,
      latest: reports[0]?.report_date ?? "",
      attachmentCount,
      storageBytes,
      clientVisibleCount,
      lastWeekCount,
    };
  }, [reports]);

  const resetForm = () => {
    setDraft(emptyDraft());
    setFiles([]);
    setRemovedAttachmentPaths([]);
    setFileInputKey((key) => key + 1);
    setEditingId(null);
  };

  const uploadAttachments = async () => {
    if (files.length === 0) return draft.attachment_manifest;

    for (const file of files) {
      if (!ALLOWED_TYPES.has(file.type)) {
        throw new Error("Daily report uploads must be PDF, PNG, JPG, WebP, or HEIC.");
      }
      if (file.size > MAX_FILE_SIZE) {
        throw new Error("Daily report uploads must be 25 MB or smaller.");
      }
    }

    const uploaded: DailyReportAttachment[] = [];
    for (const file of files) {
      const safeName = sanitizeFileName(file.name) || "daily-report";
      const path = `${projectId}/${draft.report_date}/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, file, {
        contentType: file.type,
        upsert: false,
      });
      if (uploadError) throw new Error(uploadError.message);
      uploaded.push({
        name: file.name,
        path,
        type: file.type,
        size: file.size,
        uploaded_at: new Date().toISOString(),
        client_visible: draft.client_visible,
      });
    }

    return [...draft.attachment_manifest, ...uploaded];
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!draft.report_date) throw new Error("Choose a report date.");
      const attachmentManifest = await uploadAttachments();
      const primaryAttachment = attachmentManifest[0];
      const report = await upsertFn({
        data: {
          projectId,
          report_date: draft.report_date,
          author: draft.author,
          weather: draft.weather,
          crew_count: Number(draft.crew_count) || 0,
          manpower: draft.manpower,
          work_performed: draft.work_performed,
          delays: draft.delays,
          safety_notes: draft.safety_notes,
          visitors: draft.visitors,
          quality_notes: draft.quality_notes,
          notes: draft.notes,
          client_visible: draft.client_visible,
          attachment_manifest: attachmentManifest,
          attachment_name: primaryAttachment?.name ?? "",
          attachment_path: primaryAttachment?.path ?? "",
          attachment_type: primaryAttachment?.type ?? "",
        },
      });

      if (removedAttachmentPaths.length > 0) {
        await supabase.storage.from(BUCKET).remove([...new Set(removedAttachmentPaths)]);
      }

      return report;
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
      const paths = new Set(report.attachment_manifest.map((attachment) => attachment.path));
      if (report.attachment_path) paths.add(report.attachment_path);
      if (paths.size > 0) {
        await supabase.storage.from(BUCKET).remove([...paths]);
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

  const openAttachment = async (attachment: DailyReportAttachment) => {
    const { data, error: signedUrlError } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(attachment.path, 600);
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
    setFiles([]);
    setRemovedAttachmentPaths([]);
    setFileInputKey((key) => key + 1);
    setEditingId(report.id);
  };

  const removeExistingAttachment = (path: string) => {
    setDraft((current) => ({
      ...current,
      attachment_manifest: current.attachment_manifest.filter(
        (attachment) => attachment.path !== path,
      ),
    }));
    setRemovedAttachmentPaths((current) => (current.includes(path) ? current : [...current, path]));
  };

  const removePendingFile = (index: number) => {
    setFiles((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const exportFilteredReports = async () => {
    if (filteredReports.length === 0) {
      toast.error("No reports to export", {
        description: "Adjust the filters or add a daily report first.",
      });
      return;
    }

    setExportingPacket(true);
    try {
      const packetProject = project ?? {
        name: "Daily Reports",
        job_number: projectId.slice(0, 8),
      };
      const pdfBytes = await generateDailyReportPacketPdf({
        project: packetProject,
        reports: filteredReports,
      });
      const projectName = sanitizeFileName(packetProject.name || "daily-reports").toLowerCase();
      downloadPdfBytes(pdfBytes, `${projectName}-daily-reports-${localDate()}.pdf`);
      toast.success("Daily report packet downloaded", {
        description: `${filteredReports.length} report${
          filteredReports.length === 1 ? "" : "s"
        } included.`,
      });
    } catch (err) {
      toast.error("Daily report packet did not download", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setExportingPacket(false);
    }
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
              Capture field activity, manpower, delays, visitors, safety and quality notes, and
              signed PDF or photo documentation.
            </p>
          </div>
          <div className="grid min-w-[320px] grid-cols-2 gap-2 xl:grid-cols-3">
            <DailyMetric label="Reports logged" value={String(metrics.count)} />
            <DailyMetric label="Last 7 days" value={String(metrics.lastWeekCount)} />
            <DailyMetric
              label="Latest report"
              value={metrics.latest ? formatDate(metrics.latest) : "-"}
            />
            <DailyMetric label="Client visible" value={String(metrics.clientVisibleCount)} />
            <DailyMetric label="Attachments" value={String(metrics.attachmentCount)} />
            <DailyMetric label="Storage used" value={formatBytes(metrics.storageBytes)} />
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
              onChange={(e) => setDraft((current) => ({ ...current, report_date: e.target.value }))}
            />
          </Field>
          <Field label="Author / PM">
            <Input
              value={draft.author}
              placeholder="PM, superintendent, or field lead"
              onChange={(e) => setDraft((current) => ({ ...current, author: e.target.value }))}
            />
          </Field>
          <Field label="Crew count">
            <Input
              type="number"
              min={0}
              value={draft.crew_count}
              onChange={(e) => setDraft((current) => ({ ...current, crew_count: e.target.value }))}
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Field label="Weather / site conditions">
            <Input
              value={draft.weather}
              placeholder="Clear, rain delay, high heat, site access, etc."
              onChange={(e) => setDraft((current) => ({ ...current, weather: e.target.value }))}
            />
          </Field>
          <Field label="Manpower by trade">
            <Input
              value={draft.manpower}
              placeholder="3 carpenters, 2 electricians, 1 painter"
              onChange={(e) => setDraft((current) => ({ ...current, manpower: e.target.value }))}
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Field label="Work performed">
            <Textarea
              rows={4}
              value={draft.work_performed}
              placeholder="What happened on site today?"
              onChange={(e) =>
                setDraft((current) => ({ ...current, work_performed: e.target.value }))
              }
            />
          </Field>
          <Field label="Delays / blockers">
            <Textarea
              rows={4}
              value={draft.delays}
              placeholder="Schedule slippage, missing information, trade issues, owner decisions, inspections."
              onChange={(e) => setDraft((current) => ({ ...current, delays: e.target.value }))}
            />
          </Field>
          <Field label="Visitors / inspections">
            <Textarea
              rows={3}
              value={draft.visitors}
              placeholder="Client visits, inspectors, consultants, vendors, deliveries."
              onChange={(e) => setDraft((current) => ({ ...current, visitors: e.target.value }))}
            />
          </Field>
          <Field label="Safety notes">
            <Textarea
              rows={3}
              value={draft.safety_notes}
              placeholder="Incidents, inspections, toolbox talks, safety holds."
              onChange={(e) =>
                setDraft((current) => ({ ...current, safety_notes: e.target.value }))
              }
            />
          </Field>
          <Field label="Quality notes">
            <Textarea
              rows={3}
              value={draft.quality_notes}
              placeholder="Defects, punch items, rework, inspection quality notes."
              onChange={(e) =>
                setDraft((current) => ({ ...current, quality_notes: e.target.value }))
              }
            />
          </Field>
          <Field label="Internal notes">
            <Textarea
              rows={3}
              value={draft.notes}
              placeholder="Private PM notes that should stay in the project record."
              onChange={(e) => setDraft((current) => ({ ...current, notes: e.target.value }))}
            />
          </Field>
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
          <Field label="Attachments">
            <div className="space-y-3">
              <label
                htmlFor="daily-report-file-input"
                className="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-md border border-dashed border-hairline bg-surface px-4 py-6 text-center transition-colors hover:border-accent/60 hover:bg-accent/5"
              >
                <Upload className="h-6 w-6 text-accent" />
                <span className="text-sm font-medium text-foreground">
                  Click to attach photos or documents
                </span>
                <span className="text-[11px] text-muted-foreground">
                  PDF, PNG, JPG, WebP, or HEIC · up to 25&nbsp;MB each
                </span>
                <input
                  id="daily-report-file-input"
                  key={fileInputKey}
                  type="file"
                  multiple
                  accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
                  className="sr-only"
                  onChange={(e) => setFiles(Array.from(e.target.files ?? []))}
                />
              </label>
              {files.length > 0 && (
                <AttachmentList
                  title="Ready to upload"
                  attachments={files.map((file) => ({
                    name: file.name,
                    path: file.name,
                    type: file.type,
                    size: file.size,
                    uploaded_at: "",
                    client_visible: draft.client_visible,
                  }))}
                  onRemove={(_, index) => removePendingFile(index)}
                />
              )}
              {draft.attachment_manifest.length > 0 && (
                <AttachmentList
                  title="Stored on this report"
                  attachments={draft.attachment_manifest}
                  onRemove={(attachment) => removeExistingAttachment(attachment.path)}
                />
              )}
            </div>
          </Field>

          <div className="rounded-md border border-hairline bg-surface p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <Label htmlFor="client-visible-daily-log" className="text-sm font-medium">
                  Client visible
                </Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Shares this day's log with the client portal and packet exports. The Work put in
                  place section stays internal — the client never sees it.
                </p>
              </div>
              <Switch
                id="client-visible-daily-log"
                checked={draft.client_visible}
                onCheckedChange={(checked) =>
                  setDraft((current) => ({ ...current, client_visible: checked }))
                }
              />
            </div>
          </div>
        </div>

        <div className="mt-4">
          <DailyLogWorkLines
            projectId={projectId}
            reportDate={draft.report_date}
            buckets={buckets}
          />
        </div>

        <div className="mt-5 flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            className="gap-1.5"
          >
            {files.length > 0 ? (
              <Upload className="h-3.5 w-3.5" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {saveMutation.isPending
              ? "Saving..."
              : editingId
                ? "Save changes"
                : "Save daily report"}
          </Button>
        </div>
      </section>

      <section className="rounded-lg border border-hairline bg-card p-6 shadow-card">
        <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <h3 className="font-serif text-2xl text-foreground">Daily report history</h3>
            <p className="text-sm text-muted-foreground">
              Date-sorted project record for meeting review, dispute support, and job documentation.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(190px,1fr)_140px_140px_150px_auto]">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={filters.search}
                placeholder="Search reports"
                className="pl-9"
                onChange={(e) => setFilters((current) => ({ ...current, search: e.target.value }))}
              />
            </div>
            <Input
              type="date"
              value={filters.start}
              onChange={(e) => setFilters((current) => ({ ...current, start: e.target.value }))}
            />
            <Input
              type="date"
              value={filters.end}
              onChange={(e) => setFilters((current) => ({ ...current, end: e.target.value }))}
            />
            <Select
              value={filters.visibility}
              onValueChange={(value) =>
                setFilters((current) => ({ ...current, visibility: value as VisibilityFilter }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All reports</SelectItem>
                <SelectItem value="client">Client visible</SelectItem>
                <SelectItem value="internal">Internal only</SelectItem>
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              className="gap-1.5"
              onClick={exportFilteredReports}
              disabled={exportingPacket}
            >
              <Download className="h-3.5 w-3.5" />
              {exportingPacket ? "Preparing..." : "Export PDF"}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading daily reports...</p>
        ) : error ? (
          <div className="rounded-md border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
            {missingTable
              ? "Daily Reports are ready in the app, but the project database setup still needs to finish before reports can save."
              : error.message}
          </div>
        ) : reports.length === 0 ? (
          <div className="rounded-md border border-dashed border-hairline bg-surface p-8 text-center text-sm text-muted-foreground">
            No daily reports logged yet.
          </div>
        ) : filteredReports.length === 0 ? (
          <div className="rounded-md border border-dashed border-hairline bg-surface p-8 text-center text-sm text-muted-foreground">
            No daily reports match the current filters.
          </div>
        ) : (
          <div className="space-y-3">
            {filteredReports.map((report) => (
              <DailyReportItem
                key={report.id}
                report={report}
                onOpenAttachment={openAttachment}
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

function AttachmentList({
  title,
  attachments,
  onRemove,
}: {
  title: string;
  attachments: DailyReportAttachment[];
  onRemove: (attachment: DailyReportAttachment, index: number) => void;
}) {
  return (
    <div className="rounded-md border border-hairline bg-surface p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </div>
      <div className="grid gap-2">
        {attachments.map((attachment, index) => {
          const AttachmentIcon = isImage(attachment.type) ? ImageIcon : FileText;
          return (
            <div
              key={`${attachment.path}-${index}`}
              className="flex min-w-0 items-center gap-2 rounded-md border border-hairline bg-card px-3 py-2 text-xs text-muted-foreground"
            >
              <AttachmentIcon className="h-3.5 w-3.5 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
              <span className="shrink-0 tabular">{formatBytes(attachment.size)}</span>
              <button
                type="button"
                aria-label={`Remove ${attachment.name}`}
                onClick={() => onRemove(attachment, index)}
                className="rounded p-1 hover:bg-background"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DailyReportItem({
  report,
  onOpenAttachment,
  onEdit,
  onDelete,
  deleting,
}: {
  report: DailyReportRow;
  onOpenAttachment: (attachment: DailyReportAttachment) => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
}) {
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
            {report.weather ? ` - ${report.weather}` : ""}
          </div>
          <div
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] ${
              report.client_visible
                ? "border-success/25 bg-success/10 text-success"
                : "border-hairline bg-card text-muted-foreground"
            }`}
          >
            {report.client_visible ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {report.client_visible ? "Client visible" : "Internal"}
          </div>
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        <ReportSnippet label="Work performed" value={report.work_performed} />
        <ReportSnippet label="Manpower" value={report.manpower} />
        <ReportSnippet label="Delays / blockers" value={report.delays} tone="danger" />
        <ReportSnippet label="Visitors" value={report.visitors} />
        <ReportSnippet label="Safety" value={report.safety_notes} />
        <ReportSnippet label="Quality" value={report.quality_notes} />
        <ReportSnippet label="Internal notes" value={report.notes} />
        {report.attachment_manifest.map((attachment, index) => {
          const AttachmentIcon = isImage(attachment.type) ? ImageIcon : FileText;
          return (
            <button
              key={`${attachment.path}-${index}`}
              type="button"
              onClick={() => onOpenAttachment(attachment)}
              className="flex min-w-0 items-center gap-2 rounded-md border border-hairline bg-card px-3 py-2 text-left text-sm hover:bg-background"
            >
              <AttachmentIcon className="h-4 w-4 shrink-0 text-accent" />
              <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
              <ExternalLink className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            </button>
          );
        })}
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
