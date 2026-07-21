// PROJECTFILEROOM1 — the project's document library.
//
// One place for every piece of paper the job produces: the prime contract,
// specifications, drawings, QC/QA docs, supplier invoices, receipts. Upload,
// categorize, find, download. Bytes go to the private 'project-docs' bucket
// (client-side, under the session's storage RLS); a server fn records the
// metadata. Removing a document archives it (soft delete) and clears the bytes.
import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Download,
  File as FileIcon,
  FileText,
  Image as ImageIcon,
  Pencil,
  ReceiptText,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { EmptyState } from "@/components/ui/empty-state";
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
import { cn } from "@/lib/utils";
import { formatBillingDate } from "@/lib/billing-format";
import { supabase } from "@/integrations/supabase/client";
import {
  archiveProjectDocument,
  listProjectDocuments,
  PROJECT_DOC_CATEGORIES,
  PROJECT_DOC_CATEGORY_MAX_LENGTH,
  recordProjectDocument,
  updateProjectDocument,
  type ProjectDocCategory,
  type ProjectDocumentRow,
} from "@/lib/project-documents.functions";

const CUSTOM_CATEGORY_VALUE = "__create_custom_category__";

const CATEGORY_LABEL: Record<ProjectDocCategory, string> = {
  prime_contract: "Prime contract",
  specifications: "Specifications",
  drawings: "Drawings",
  qc_qa: "QC / QA",
  invoices: "Invoices",
  receipts: "Receipts",
  compliance: "COIs & lien waivers",
  other: "Other",
};

function categoryLabel(value: string): string {
  return CATEGORY_LABEL[value as ProjectDocCategory] ?? (value.trim() || "Other");
}

function resolveCategoryChoice(
  choice: string,
  customName: string,
  availableCategories: readonly string[],
): string {
  if (choice !== CUSTOM_CATEGORY_VALUE) return choice;
  const typedName = customName.replace(/\s+/g, " ").trim();
  if (!typedName) return "";

  return (
    availableCategories.find(
      (category) =>
        category.localeCompare(typedName, undefined, { sensitivity: "base" }) === 0 ||
        categoryLabel(category).localeCompare(typedName, undefined, { sensitivity: "base" }) === 0,
    ) ?? typedName
  );
}

// A type-appropriate icon so the room scans quickly.
function DocIcon({ doc }: { doc: ProjectDocumentRow }) {
  const type = doc.content_type;
  const cls = "h-4 w-4 shrink-0 text-muted-foreground";
  if (type.startsWith("image/")) return <ImageIcon className={cls} />;
  if (doc.category === "invoices" || doc.category === "receipts")
    return <ReceiptText className={cls} />;
  if (doc.category === "qc_qa") return <ShieldCheck className={cls} />;
  if (type === "application/pdf" || doc.category === "prime_contract")
    return <FileText className={cls} />;
  return <FileIcon className={cls} />;
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[i]}`;
}

export function ProjectFileRoom({ projectId }: { projectId: string }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listProjectDocuments);
  const recordFn = useServerFn(recordProjectDocument);
  const updateFn = useServerFn(updateProjectDocument);
  const archiveFn = useServerFn(archiveProjectDocument);

  const docsQuery = useQuery({
    queryKey: ["project-documents", projectId],
    queryFn: () => listFn({ data: { projectId } }),
  });
  const docs = useMemo(() => docsQuery.data ?? [], [docsQuery.data]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ["project-documents", projectId] });

  const [filter, setFilter] = useState<string | null>(null);
  const countByCategory = useMemo(() => {
    const counts = new Map<string, number>();
    for (const d of docs) counts.set(d.category, (counts.get(d.category) ?? 0) + 1);
    return counts;
  }, [docs]);
  const categoryOptions = useMemo(() => {
    const presets = new Set<string>(PROJECT_DOC_CATEGORIES);
    const custom = Array.from(
      new Set(
        docs
          .map((doc) => doc.category.trim())
          .filter((category) => category && !presets.has(category)),
      ),
    ).sort((a, b) => a.localeCompare(b));
    return [...PROJECT_DOC_CATEGORIES, ...custom] as string[];
  }, [docs]);
  const visible = filter === null ? docs : docs.filter((d) => d.category === filter);

  // ── Upload flow ──
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState<string>("other");
  const [uploadCustomCategory, setUploadCustomCategory] = useState("");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadDesc, setUploadDesc] = useState("");
  const [uploading, setUploading] = useState(false);

  const onFilePicked = (file: File) => {
    setPendingFile(file);
    setUploadTitle(file.name.replace(/\.[^.]+$/, ""));
    setUploadCategory(filter ?? "other");
    setUploadCustomCategory("");
    setUploadDesc("");
  };

  const doUpload = async () => {
    if (!pendingFile) return;
    const category = resolveCategoryChoice(uploadCategory, uploadCustomCategory, categoryOptions);
    if (!category) {
      toast.error("Name the new category before uploading");
      return;
    }
    setUploading(true);
    const safeName = pendingFile.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
    const path = `${projectId}/${crypto.randomUUID()}-${safeName}`;
    const { error } = await supabase.storage.from("project-docs").upload(path, pendingFile, {
      contentType: pendingFile.type || "application/octet-stream",
      upsert: false,
    });
    if (error) {
      toast.error("Upload failed", { description: error.message });
      setUploading(false);
      return;
    }
    try {
      await recordFn({
        data: {
          projectId,
          category,
          title: uploadTitle.trim() || pendingFile.name,
          description: uploadDesc,
          storage_path: path,
          file_name: pendingFile.name,
          content_type: pendingFile.type || "",
          size_bytes: pendingFile.size,
        },
      });
      invalidate();
      toast.success("Document uploaded");
      setPendingFile(null);
      setUploadCustomCategory("");
    } catch (err) {
      // The bytes landed but the record didn't — clean them up so we don't orphan.
      await supabase.storage.from("project-docs").remove([path]);
      toast.error("Could not save the document", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    }
    setUploading(false);
  };

  const download = async (doc: ProjectDocumentRow) => {
    const { data, error } = await supabase.storage
      .from("project-docs")
      .createSignedUrl(doc.storage_path, 600);
    if (error || !data?.signedUrl) {
      toast.error("Could not open the file");
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  const remove = async (doc: ProjectDocumentRow) => {
    if (!confirm(`Remove "${doc.title || doc.file_name}"? It's archived, not destroyed.`)) return;
    if (doc.storage_path) await supabase.storage.from("project-docs").remove([doc.storage_path]);
    try {
      await archiveFn({ data: { id: doc.id } });
      invalidate();
      toast.success("Document removed");
    } catch (err) {
      toast.error("Could not remove the document", {
        description: err instanceof Error ? err.message : "Try again.",
      });
    }
  };

  // ── Edit flow ──
  const [editing, setEditing] = useState<ProjectDocumentRow | null>(null);
  const [editCategory, setEditCategory] = useState<string>("other");
  const [editCustomCategory, setEditCustomCategory] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const openEdit = (doc: ProjectDocumentRow) => {
    setEditing(doc);
    setEditCategory(doc.category || "other");
    setEditCustomCategory("");
    setEditTitle(doc.title);
    setEditDesc(doc.description);
  };
  const editMutation = useMutation({
    mutationFn: (input: { id: string; category: string; title: string; description: string }) =>
      updateFn({ data: input }),
    onSuccess: () => {
      invalidate();
      setEditing(null);
      toast.success("Document updated");
    },
    onError: (err) =>
      toast.error("Could not update", {
        description: err instanceof Error ? err.message : "Try again.",
      }),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="eyebrow inline-flex items-center rounded-md border border-hairline px-2 py-0.5">
            Document library
          </span>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFilePicked(file);
              e.target.value = "";
            }}
          />
          <Button className="ml-auto gap-1.5" onClick={() => fileInputRef.current?.click()}>
            <Upload className="h-4 w-4" /> Upload document
          </Button>
        </div>
        <div>
          <h1 className="font-serif text-[30px] font-normal leading-[1.14] text-foreground">
            Every document for the job, in one place.
          </h1>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted-foreground">
            The prime contract, specifications, drawings, QC/QA, supplier invoices, receipts, and
            compliance — uploaded, categorized, and private to your team.
          </p>
        </div>
      </div>

      {/* Category filter chips */}
      <div className="flex flex-wrap gap-2">
        <FilterChip
          label="All"
          count={docs.length}
          active={filter === null}
          onClick={() => setFilter(null)}
        />
        {categoryOptions.map((cat) => {
          const count = countByCategory.get(cat) ?? 0;
          if (count === 0 && filter !== cat) return null;
          return (
            <FilterChip
              key={cat}
              label={categoryLabel(cat)}
              count={count}
              active={filter === cat}
              onClick={() => setFilter(cat)}
            />
          );
        })}
      </div>

      {docsQuery.isLoading ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
      ) : docs.length === 0 ? (
        <div className="rounded-xl border border-hairline bg-card py-10">
          <EmptyState
            icon={Upload}
            title="No documents yet"
            description="Upload the prime contract, specs, drawings, QC/QA docs, supplier invoices, and receipts — anything for this job lives here."
          />
        </div>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          No documents in {categoryLabel(filter ?? "other")} yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-xl border border-hairline bg-card">
          <ul className="divide-y divide-hairline">
            {visible.map((doc) => (
              <li
                key={doc.id}
                className="flex items-center gap-3.5 px-5 py-3.5 transition-colors hover:bg-muted/40"
              >
                <DocIcon doc={doc} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-foreground">
                      {doc.title || doc.file_name}
                    </span>
                    <span className="shrink-0 rounded-sm border border-hairline px-1.5 py-0.5 font-mono text-[11px] font-bold uppercase tracking-[.12em] text-muted-foreground">
                      {categoryLabel(doc.category)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {doc.file_name}
                    {doc.size_bytes ? ` · ${formatBytes(doc.size_bytes)}` : ""}
                    {doc.created_at ? ` · ${formatBillingDate(doc.created_at.slice(0, 10))}` : ""}
                  </div>
                  {doc.description ? (
                    <div className="mt-0.5 truncate text-xs text-muted-foreground/80">
                      {doc.description}
                    </div>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-lg border border-hairline text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    title="Download"
                    onClick={() => download(doc)}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-lg border border-hairline text-muted-foreground hover:bg-muted/50 hover:text-foreground"
                    title="Edit"
                    onClick={() => openEdit(doc)}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 rounded-lg border border-hairline text-danger hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
                    title="Remove"
                    onClick={() => remove(doc)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Upload metadata dialog */}
      <Dialog open={pendingFile !== null} onOpenChange={(o) => !o && setPendingFile(null)}>
        <DialogContent>
          <DialogHeader>
            <p className="eyebrow">Add to the file room</p>
            <DialogTitle className="font-serif text-[22px] font-normal">
              Upload document
            </DialogTitle>
            <DialogDescription className="sr-only">
              Add a document to this project&apos;s private file room.
            </DialogDescription>
          </DialogHeader>
          {pendingFile ? (
            <div className="rounded-xl border-2 border-dashed border-hairline bg-background p-5 text-center">
              <Upload className="mx-auto h-6 w-6 text-muted-foreground" />
              <div className="mt-2 truncate text-sm font-semibold text-foreground">
                {pendingFile.name}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatBytes(pendingFile.size)} · ready to upload ·{" "}
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="border-b border-foreground text-foreground transition-colors hover:border-clay hover:text-clay"
                >
                  choose a different file
                </button>
              </div>
            </div>
          ) : null}
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Category</span>
              <Select
                value={uploadCategory}
                onValueChange={(value) => {
                  setUploadCategory(value);
                  if (value !== CUSTOM_CATEGORY_VALUE) setUploadCustomCategory("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {categoryLabel(cat)}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_CATEGORY_VALUE}>Create a category…</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {uploadCategory === CUSTOM_CATEGORY_VALUE ? (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">New category name</span>
                <Input
                  autoFocus
                  value={uploadCustomCategory}
                  onChange={(event) => setUploadCustomCategory(event.target.value)}
                  placeholder="e.g. Warranty documents"
                  maxLength={PROJECT_DOC_CATEGORY_MAX_LENGTH}
                />
                <span className="block text-[11px] text-muted-foreground">
                  This category will be available for future documents in this file room.
                </span>
              </label>
            ) : null}
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Title</span>
              <Input value={uploadTitle} onChange={(e) => setUploadTitle(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">
                Description (optional)
              </span>
              <Textarea
                value={uploadDesc}
                onChange={(e) => setUploadDesc(e.target.value)}
                rows={2}
              />
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingFile(null)} disabled={uploading}>
              Cancel
            </Button>
            <Button
              onClick={doUpload}
              disabled={
                uploading ||
                !resolveCategoryChoice(uploadCategory, uploadCustomCategory, categoryOptions)
              }
            >
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit metadata dialog */}
      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <p className="eyebrow">Update details</p>
            <DialogTitle className="font-serif text-[22px] font-normal">Edit document</DialogTitle>
            <DialogDescription className="truncate">{editing?.file_name}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Category</span>
              <Select
                value={editCategory}
                onValueChange={(value) => {
                  setEditCategory(value);
                  if (value !== CUSTOM_CATEGORY_VALUE) setEditCustomCategory("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {categoryOptions.map((cat) => (
                    <SelectItem key={cat} value={cat}>
                      {categoryLabel(cat)}
                    </SelectItem>
                  ))}
                  <SelectItem value={CUSTOM_CATEGORY_VALUE}>Create a category…</SelectItem>
                </SelectContent>
              </Select>
            </label>
            {editCategory === CUSTOM_CATEGORY_VALUE ? (
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">New category name</span>
                <Input
                  autoFocus
                  value={editCustomCategory}
                  onChange={(event) => setEditCustomCategory(event.target.value)}
                  placeholder="e.g. Warranty documents"
                  maxLength={PROJECT_DOC_CATEGORY_MAX_LENGTH}
                />
              </label>
            ) : null}
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Title</span>
              <Input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
            </label>
            <label className="block space-y-1">
              <span className="text-xs font-medium text-muted-foreground">Description</span>
              <Textarea value={editDesc} onChange={(e) => setEditDesc(e.target.value)} rows={2} />
            </label>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setEditing(null)}
              disabled={editMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={() =>
                editing &&
                editMutation.mutate({
                  id: editing.id,
                  category: resolveCategoryChoice(
                    editCategory,
                    editCustomCategory,
                    categoryOptions,
                  ),
                  title: editTitle,
                  description: editDesc,
                })
              }
              disabled={
                editMutation.isPending ||
                !resolveCategoryChoice(editCategory, editCustomCategory, categoryOptions)
              }
            >
              {editMutation.isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FilterChip({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors",
        active
          ? "border-accent/50 bg-accent/10 text-clay"
          : "border-hairline bg-surface text-muted-foreground hover:bg-muted",
      )}
    >
      {label}
      <span className="ml-1.5 opacity-70">{count}</span>
    </button>
  );
}
