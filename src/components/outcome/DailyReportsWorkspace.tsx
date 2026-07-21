import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
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
import {
  DAILY_REPORT_MAX_FILE_BYTES,
  inferAttachmentType,
  isAllowedAttachmentType,
  mergeAttachmentManifest,
  prepareAttachmentForUpload,
  uploadFilesWithRetry,
} from "@/lib/daily-report-uploads";
import {
  DailyLogWorkLines,
  type DailyLogWorkLinesHandle,
} from "@/components/outcome/DailyLogWorkLines";
import {
  DailyReportsCalendar,
  formatShortDate,
  monthName,
  shiftMonth,
} from "@/components/outcome/DailyReportsCalendar";
import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
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

const pad2 = (value: number) => String(value).padStart(2, "0");

// Noon-anchored so stepping a day never drifts across a DST boundary.
const shiftDay = (date: string, delta: number) => {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
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

function formatDayTitle(value: string) {
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", {
    weekday: "long",
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
  onOpenWipDay,
}: {
  projectId: string;
  project?: DailyReportPacketProject;
  buckets?: { id: string; cost_code: string; bucket: string }[];
  /** Deep link into Daily WIP for a specific day — wired by the route. */
  onOpenWipDay?: (date: string) => void;
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
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(
    null,
  );
  // Days are buckets: null = the calendar landing, a date = that day's bucket.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => localDate().slice(0, 7));

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

  const todayDate = localDate();

  const loggedDates = useMemo(
    () => new Set(reports.map((report) => report.report_date)),
    [reports],
  );

  const firstReportDate = useMemo(
    () =>
      reports.reduce<string | null>(
        (min, report) => (min === null || report.report_date < min ? report.report_date : min),
        null,
      ),
    [reports],
  );

  // Landing "This week" list: the last 5 logged days, most recent first.
  const weekRows = useMemo(
    () => [...reports].sort((a, b) => b.report_date.localeCompare(a.report_date)).slice(0, 5),
    [reports],
  );

  const sinceLabel = firstReportDate
    ? new Date(`${firstReportDate}T12:00:00`).toLocaleDateString(
        "en-US",
        firstReportDate.slice(0, 4) === todayDate.slice(0, 4)
          ? { month: "short" }
          : { month: "short", year: "numeric" },
      )
    : null;

  const daysSinceLatest = metrics.latest
    ? Math.max(
        0,
        Math.round(
          (Date.parse(`${todayDate}T12:00:00`) - Date.parse(`${metrics.latest}T12:00:00`)) /
            86_400_000,
        ),
      )
    : null;

  // "On pace" = at least 4 of the last 7 days logged.
  const onPace = metrics.lastWeekCount >= 4;

  const dayReport = selectedDay
    ? reports.find((report) => report.report_date === selectedDay)
    : undefined;
  // A day with a report reads; an empty day (or an explicit edit) shows the form.
  const showDayForm = selectedDay !== null && (!dayReport || editingId !== null);

  // Bridge to the "Work put in place" compose form so the report Save can
  // commit an un-added work line before it completes (see saveMutation).
  const workLinesRef = useRef<DailyLogWorkLinesHandle>(null);

  const resetForm = () => {
    // Back to a blank bucket for the day being viewed (today on the landing).
    setDraft({ ...emptyDraft(), report_date: selectedDay ?? localDate() });
    setFiles([]);
    setRemovedAttachmentPaths([]);
    setFileInputKey((key) => key + 1);
    setEditingId(null);
  };

  // The save is two-phase so a photo can never take the typed log down with
  // it (field reality: 10 MB camera photos over job-site cellular used to
  // hold the whole report hostage for minutes, and one blip lost everything):
  //   1. the report row upserts immediately — the text is durable in ~1s
  //   2. photos compress and upload through a retrying pool with progress,
  //      then the manifest folds in whatever landed; anything that failed
  //      stays selected so "Save" retries just those files.
  const upsertReport = (manifest: DailyReportAttachment[]) => {
    const primaryAttachment = manifest[0];
    return upsertFn({
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
        attachment_manifest: manifest,
        attachment_name: primaryAttachment?.name ?? "",
        attachment_path: primaryAttachment?.path ?? "",
        attachment_type: primaryAttachment?.type ?? "",
      },
    });
  };

  const uploadOneAttachment = async (file: File): Promise<DailyReportAttachment> => {
    const prepared = await prepareAttachmentForUpload(file);
    const safeName = sanitizeFileName(prepared.uploadName) || "daily-report";
    const path = `${projectId}/${draft.report_date}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from(BUCKET).upload(path, prepared.blob, {
      contentType: prepared.contentType,
      upsert: false,
    });
    if (uploadError) throw new Error(uploadError.message);
    return {
      name: file.name,
      path,
      type: prepared.contentType,
      size: prepared.bytes,
      uploaded_at: new Date().toISOString(),
      client_visible: draft.client_visible,
    };
  };

  const saveMutation = useMutation({
    mutationFn: async (): Promise<{ report: DailyReportRow; failedFiles: File[] }> => {
      if (!draft.report_date) throw new Error("Choose a report date.");

      // Local checks first — instant, nothing saved or uploaded yet.
      for (const file of files) {
        const type = inferAttachmentType(file.name, file.type);
        if (!isAllowedAttachmentType(type)) {
          throw new Error(`${file.name} isn't a supported file. Use PDF, PNG, JPG, WebP, or HEIC.`);
        }
        if (file.size > DAILY_REPORT_MAX_FILE_BYTES) {
          throw new Error(`${file.name} is over 25 MB. Remove it and save again.`);
        }
      }

      // Commit any work line the super typed into "Work put in place" but did
      // not press "Add line" on. The report Save owns this now, so a dirty
      // draft can never be silently dropped when the editor closes on save.
      // Awaited and before the report writes: if the line fails to save we
      // abort here (the typed report is still in the locked form) rather than
      // report a success that lost the line. A no-op for an empty compose form.
      await workLinesRef.current?.flushPendingLine();

      // Saving onto a date that already has a report UPDATES that day, so the
      // carry decision (keep that day's stored photos) must come from the
      // SERVER's view — a still-loading or stale client cache would silently
      // detach (or resurrect) stored photos. If this read fails, stop before
      // anything is written: the typed log is still in the form.
      let freshReports: DailyReportRow[];
      try {
        freshReports = await qc.fetchQuery({
          queryKey: ["daily-reports", projectId],
          queryFn: () => listFn({ data: { projectId } }),
        });
      } catch {
        throw new Error(
          "Could not check this day's saved photos — check your connection and press Save again. Nothing was lost.",
        );
      }
      // Carry the target day's stored photos unless they already live in this
      // draft (editing that very report — removals there are deliberate).
      // Also covers editing a report onto a DIFFERENT day that has its own
      // photos: those must survive the move too.
      const sameDayOther = freshReports.find(
        (existing) => existing.report_date === draft.report_date && existing.id !== editingId,
      );

      // Phase 1: the typed log is durable before any photo touches the wire.
      let report = await upsertReport(
        sameDayOther
          ? mergeAttachmentManifest(sameDayOther.attachment_manifest, draft.attachment_manifest)
          : draft.attachment_manifest,
      );

      // Phase 2: compress + upload photos; a failed file never sinks the rest.
      let failedFiles: File[] = [];
      if (files.length > 0) {
        const outcome = await uploadFilesWithRetry(files, uploadOneAttachment, {
          onProgress: (done, total) => setUploadProgress({ done, total }),
        });
        failedFiles = outcome.failed.map((failure) => failure.file);
        if (outcome.ok.length > 0) {
          // The photos are in storage; one blip on this last small write must
          // not turn a saved log plus landed photos into a false "did not
          // save" — retry it, and on defeat hand every file to the retry flow.
          let folded = false;
          for (let attempt = 1; attempt <= 3 && !folded; attempt += 1) {
            try {
              report = await upsertReport(
                mergeAttachmentManifest(report.attachment_manifest, outcome.ok),
              );
              folded = true;
            } catch {
              if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
            }
          }
          if (!folded) {
            const alreadyFailed = new Set(failedFiles);
            failedFiles = [...failedFiles, ...files.filter((file) => !alreadyFailed.has(file))];
          }
        }
      }

      // Cleaning up attachments the user removed is best-effort — never turn
      // an already-saved report into a "did not save" error over cleanup.
      if (removedAttachmentPaths.length > 0) {
        try {
          await supabase.storage.from(BUCKET).remove([...new Set(removedAttachmentPaths)]);
        } catch {
          // The saved report wins; orphaned files are harmless.
        }
      }

      return { report, failedFiles };
    },
    onSuccess: async ({ report, failedFiles }) => {
      await qc.invalidateQueries({ queryKey: ["daily-reports", projectId] });
      if (failedFiles.length > 0) {
        // The log is saved; keep the leftover photos selected on that day so
        // one more press of Save retries only what's missing.
        setDraft(reportToDraft(report));
        setEditingId(report.id);
        setFiles(failedFiles);
        setRemovedAttachmentPaths([]);
        setFileInputKey((key) => key + 1);
        const names = failedFiles.map((file) => file.name).join(", ");
        toast.error(
          failedFiles.length === 1
            ? "1 photo didn't finish uploading"
            : `${failedFiles.length} photos didn't finish uploading`,
          {
            description: `Your log for ${formatDate(report.report_date)} is saved. ${names} ${
              failedFiles.length === 1 ? "is" : "are"
            } still selected — press Save to retry.`,
          },
        );
        return;
      }
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
    onSettled: () => {
      setUploadProgress(null);
    },
  });

  // Leaving the page mid-save is how logs used to vanish — warn first.
  useEffect(() => {
    if (!saveMutation.isPending) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [saveMutation.isPending]);

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

  // Day-bucket navigation. Blocked mid-save so the two-phase photo pipeline's
  // success handler always lands back on the form it started from.
  const openDay = (date: string) => {
    if (saveMutation.isPending) return;
    setSelectedDay(date);
    setEditingId(null);
    setDraft({ ...emptyDraft(), report_date: date });
    setFiles([]);
    setRemovedAttachmentPaths([]);
    setFileInputKey((key) => key + 1);
  };

  const backToLanding = () => {
    if (saveMutation.isPending) return;
    setSelectedDay(null);
    setEditingId(null);
  };

  const stepDay = (delta: number) => {
    if (selectedDay) openDay(shiftDay(selectedDay, delta));
  };

  const openReportForEdit = (report: DailyReportRow) => {
    if (saveMutation.isPending) return;
    setSelectedDay(report.report_date);
    editReport(report);
  };

  const confirmDelete = (report: DailyReportRow, { toLanding = false } = {}) => {
    if (confirm(`Delete the daily report for ${formatDate(report.report_date)}?`)) {
      deleteMutation.mutate(
        report,
        toLanding ? { onSuccess: () => setSelectedDay(null) } : undefined,
      );
    }
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

  const errorBox = error ? (
    <div className="rounded-md border border-danger/20 bg-danger/5 p-4 text-sm text-danger">
      {missingTable
        ? "Daily Reports are ready in the app, but the project database setup still needs to finish before reports can save."
        : error.message}
    </div>
  ) : null;

  // ————— Landing: calendar of day buckets —————
  if (selectedDay === null) {
    const previousMonth = shiftMonth(calendarMonth, -1);
    return (
      <div className="space-y-4">
        <div>
          <span className="inline-block rounded-md border border-hairline px-2 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-clay">
            Job log
          </span>
          <h2 className="mt-3 font-serif text-3xl font-normal leading-[1.18] text-foreground lg:text-4xl">
            Job log by day
          </h2>
          <p className="mt-2 max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
            {metrics.count} report{metrics.count === 1 ? "" : "s"} on file. Days are{" "}
            <b className="font-semibold text-foreground">buckets</b> — click one to read or fill
            that day. Only this week shows below; older days live in the calendar.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
          <DailyMetric
            label="Reports logged"
            value={String(metrics.count)}
            caption={sinceLabel ? `since ${sinceLabel}` : "—"}
          />
          <DailyMetric
            label="Last 7 days"
            value={String(metrics.lastWeekCount)}
            caption={onPace ? "on pace" : "behind"}
            tone={onPace ? "good" : "warn"}
          />
          <DailyMetric
            label="Latest report"
            value={metrics.latest ? formatDate(metrics.latest) : "-"}
            caption={
              daysSinceLatest === null
                ? "—"
                : daysSinceLatest === 0
                  ? "today"
                  : daysSinceLatest === 1
                    ? "1 day ago"
                    : `${daysSinceLatest} days ago`
            }
          />
          <DailyMetric
            label="Client visible"
            value={String(metrics.clientVisibleCount)}
            caption={
              metrics.clientVisibleCount === 0
                ? "none shared"
                : `${metrics.clientVisibleCount} shared`
            }
          />
          <DailyMetric
            label="Attachments"
            value={String(metrics.attachmentCount)}
            caption="photos + docs"
          />
          <DailyMetric
            label="Storage used"
            value={formatBytes(metrics.storageBytes)}
            caption="used"
          />
        </div>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading daily reports...</p>
        ) : error ? (
          errorBox
        ) : (
          <>
            <DailyReportsCalendar
              month={calendarMonth}
              onMonthChange={setCalendarMonth}
              loggedDates={loggedDates}
              firstReportDate={firstReportDate}
              totalReports={metrics.count}
              sinceLabel={sinceLabel}
              today={todayDate}
              onSelectDay={openDay}
            />

            <section className="rounded-xl border border-hairline bg-card px-5 pb-4 pt-1.5 shadow-card">
              <div className="flex items-center gap-2.5 py-3">
                <div className="text-[13px] font-semibold text-foreground">This week</div>
                <span className="ml-auto text-xs text-muted-foreground">last 5 days</span>
              </div>
              {weekRows.length === 0 ? (
                <div className="border-t border-hairline py-8 text-center text-sm text-muted-foreground">
                  No daily reports logged yet. Click a day on the calendar to fill its report.
                </div>
              ) : (
                weekRows.map((report) => (
                  <button
                    key={report.id}
                    type="button"
                    onClick={() => openDay(report.report_date)}
                    className="flex w-full items-center gap-3.5 border-t border-hairline py-3 text-left transition-colors hover:bg-secondary/50"
                  >
                    <span className="w-[92px] flex-none font-serif text-[15px] text-foreground">
                      {formatShortDate(report.report_date)}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-muted-foreground">
                      {report.work_performed || "—"}
                    </span>
                    {report.delays.trim() ? (
                      <span className="flex-none rounded-full border border-current px-2 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[0.06em] text-danger">
                        Delay logged
                      </span>
                    ) : (
                      <span className="flex-none text-[11.5px] text-muted-foreground">
                        {report.crew_count > 0 ? `${report.crew_count} crew` : "—"}
                      </span>
                    )}
                    <span className="flex-none text-muted-foreground">›</span>
                  </button>
                ))
              )}
              {weekRows.length > 0 ? (
                <div className="mt-3 rounded-[10px] bg-secondary px-3.5 py-2.5 text-center text-xs text-muted-foreground">
                  That's the cutoff — older days live in the calendar above.{" "}
                  <button
                    type="button"
                    onClick={() => setCalendarMonth(previousMonth)}
                    className="font-semibold text-foreground underline underline-offset-2 transition-colors hover:text-clay"
                  >
                    Open the {monthName(previousMonth)} log →
                  </button>
                </div>
              ) : null}
            </section>
          </>
        )}
      </div>
    );
  }

  // ————— Day view: read the day's report, or fill the empty bucket —————
  return (
    <div className="space-y-4">
      <div>
        <button
          type="button"
          onClick={backToLanding}
          disabled={saveMutation.isPending}
          className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
        >
          ← All days
        </button>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <h2 className="font-serif text-3xl font-normal leading-[1.18] text-foreground">
            {formatDayTitle(selectedDay)}
          </h2>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="Previous day"
              onClick={() => stepDay(-1)}
              disabled={saveMutation.isPending}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              aria-label="Next day"
              onClick={() => stepDay(1)}
              disabled={saveMutation.isPending || selectedDay >= todayDate}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {!showDayForm && dayReport ? (
        <div className="space-y-3">
          <DailyReportItem
            report={dayReport}
            onOpenAttachment={openAttachment}
            onEdit={() => openReportForEdit(dayReport)}
            onDelete={() => confirmDelete(dayReport, { toLanding: true })}
            deleting={deleteMutation.isPending}
            hideActions
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              className="gap-1.5 text-muted-foreground"
              onClick={() => confirmDelete(dayReport, { toLanding: true })}
              disabled={deleteMutation.isPending}
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
            <Button className="gap-1.5" onClick={() => openReportForEdit(dayReport)}>
              <Pencil className="h-3.5 w-3.5" />
              Edit this report
            </Button>
          </div>
        </div>
      ) : (
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
              <Button
                variant="outline"
                size="sm"
                onClick={resetForm}
                disabled={saveMutation.isPending}
              >
                Cancel edit
              </Button>
            )}
          </div>

          {/* Everything in this fieldset is captured when Save is pressed —
              lock it while the save runs so nothing typed or picked mid-flight
              can be silently thrown away when the save settles. */}
          <fieldset disabled={saveMutation.isPending} className="contents">
            <div className="grid gap-4 lg:grid-cols-[1fr_1fr_120px]">
              <Field label="Report date">
                <Input
                  type="date"
                  value={draft.report_date}
                  onChange={(e) =>
                    setDraft((current) => ({ ...current, report_date: e.target.value }))
                  }
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
                  onChange={(e) =>
                    setDraft((current) => ({ ...current, crew_count: e.target.value }))
                  }
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
                  onChange={(e) =>
                    setDraft((current) => ({ ...current, manpower: e.target.value }))
                  }
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
                  onChange={(e) =>
                    setDraft((current) => ({ ...current, visitors: e.target.value }))
                  }
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
                      PDF, PNG, JPG, WebP, or HEIC · up to 25&nbsp;MB each · big photos are shrunk
                      automatically for faster upload
                    </span>
                    <input
                      id="daily-report-file-input"
                      key={fileInputKey}
                      type="file"
                      multiple
                      accept="application/pdf,image/png,image/jpeg,image/webp,image/heic"
                      className="sr-only"
                      onChange={(e) => {
                        // Picking again ADDS to the list (supers attach photos in
                        // batches); dedupe so the same pick twice can't double up.
                        const picked = Array.from(e.target.files ?? []);
                        if (picked.length === 0) return;
                        const fileKey = (file: File) =>
                          `${file.name}|${file.size}|${file.lastModified}`;
                        setFiles((current) => {
                          const seen = new Set(current.map(fileKey));
                          return [...current, ...picked.filter((file) => !seen.has(fileKey(file)))];
                        });
                        setFileInputKey((key) => key + 1);
                      }}
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
                      Shares this day's log with the client portal and packet exports. The Work put
                      in place section stays internal — the client never sees it.
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
          </fieldset>

          <div className="mt-4">
            {onOpenWipDay ? (
              <div className="mb-1.5 flex justify-end">
                <button
                  type="button"
                  onClick={() => onOpenWipDay(draft.report_date)}
                  className="text-xs font-medium text-clay transition-colors hover:underline"
                >
                  Open this day in Daily WIP →
                </button>
              </div>
            ) : null}
            <DailyLogWorkLines
              ref={workLinesRef}
              projectId={projectId}
              reportDate={draft.report_date}
              buckets={buckets}
              disabled={saveMutation.isPending}
            />
          </div>

          <div className="mt-5 flex flex-col items-end gap-1.5">
            <Button
              variant="signal"
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
                ? uploadProgress && uploadProgress.total > 0
                  ? `Uploading photo ${Math.min(uploadProgress.done + 1, uploadProgress.total)} of ${
                      uploadProgress.total
                    }...`
                  : "Saving..."
                : editingId
                  ? "Save changes"
                  : "Save daily report"}
            </Button>
            {saveMutation.isPending && uploadProgress ? (
              <p className="text-[11px] text-muted-foreground">
                Your log is saved — photos are still uploading. Keep this page open until they
                finish.
              </p>
            ) : null}
          </div>
        </section>
      )}

      <details className="group rounded-lg border border-hairline bg-card shadow-card">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 p-6 [&::-webkit-details-marker]:hidden">
          <div>
            <h3 className="font-serif text-2xl text-foreground">All reports · search & export</h3>
            <p className="text-sm text-muted-foreground">
              Date-sorted project record for meeting review, dispute support, and job documentation.
            </p>
          </div>
          <span
            aria-hidden
            className="text-muted-foreground transition-transform group-open:rotate-180"
          >
            ▾
          </span>
        </summary>
        <div className="border-t border-hairline px-6 pb-6 pt-4">
          <div className="mb-4 grid gap-2 sm:grid-cols-[minmax(190px,1fr)_140px_140px_150px_auto]">
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

          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading daily reports...</p>
          ) : error ? (
            errorBox
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
                  onEdit={() => openReportForEdit(report)}
                  onDelete={() => confirmDelete(report)}
                  deleting={deleteMutation.isPending}
                />
              ))}
            </div>
          )}
        </div>
      </details>
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

function DailyMetric({
  label,
  value,
  caption,
  tone,
}: {
  label: string;
  value: string;
  caption?: string;
  tone?: "good" | "warn";
}) {
  return (
    <div className="rounded-lg border border-hairline bg-card px-3.5 py-3">
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-serif text-[22px] leading-tight",
          tone === "good" ? "text-success" : tone === "warn" ? "text-warning" : "text-foreground",
        )}
      >
        {value}
      </div>
      {caption ? <div className="mt-0.5 text-[10.5px] text-muted-foreground">{caption}</div> : null}
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
  hideActions,
}: {
  report: DailyReportRow;
  onOpenAttachment: (attachment: DailyReportAttachment) => void;
  onEdit: () => void;
  onDelete: () => void;
  deleting: boolean;
  /** The day view shows its own explicit Edit/Delete buttons instead. */
  hideActions?: boolean;
}) {
  return (
    <article
      className={cn(
        "grid gap-4 rounded-md border border-hairline bg-surface p-4",
        hideActions
          ? "lg:grid-cols-[180px_minmax(0,1fr)]"
          : "lg:grid-cols-[180px_minmax(0,1fr)_auto]",
      )}
    >
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

      {hideActions ? null : (
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
      )}
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
