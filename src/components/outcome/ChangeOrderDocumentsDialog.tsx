import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { ExternalLink, FileText, Trash2, Upload } from "lucide-react";
import type { CoDocType, ChangeOrderDocumentRow, ChangeOrderRow } from "@/lib/projects.functions";

const DOC_TYPE_LABELS: Record<CoDocType, string> = {
  backup: "Cost backup",
  quote: "Quote / proposal",
  correspondence: "Correspondence",
  other: "Other",
};

const DOC_TYPE_ORDER: CoDocType[] = ["backup", "quote", "correspondence", "other"];

export function ChangeOrderDocumentsDialog({
  changeOrder,
  documents,
  onClose,
  onUpload,
  onView,
  onDelete,
  uploading = false,
}: {
  changeOrder: ChangeOrderRow | null;
  documents: ChangeOrderDocumentRow[];
  onClose: () => void;
  onUpload?: (changeOrderId: string, file: File, docType: CoDocType, note: string) => void;
  onView?: (path: string) => void;
  onDelete?: (id: string, path: string) => void;
  uploading?: boolean;
}) {
  const [docType, setDocType] = useState<CoDocType>("backup");
  const [note, setNote] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pickAndUpload = (file: File | undefined) => {
    if (!file || !changeOrder || !onUpload) return;
    onUpload(changeOrder.id, file, docType, note.trim());
    setNote("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const ordered = [...documents].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));

  return (
    <Dialog
      open={changeOrder !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <div className="eyebrow">Backup / supporting documents</div>
          <DialogTitle className="font-serif text-2xl font-normal">
            Documents{changeOrder ? ` — ${changeOrder.number || changeOrder.description}` : ""}
          </DialogTitle>
          <DialogDescription>
            Attach the change-order quote, cost backup, and any correspondence. Files are private to
            the project team.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          {ordered.length === 0 && (
            <p className="rounded-md border border-dashed border-hairline bg-surface px-3 py-6 text-center text-sm text-muted-foreground">
              No documents attached yet.
            </p>
          )}
          {ordered.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center justify-between gap-3 rounded-md border border-hairline bg-card px-3 py-2"
            >
              <FileText className="h-4 w-4 flex-none text-clay" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="truncate text-sm font-medium">{doc.file_name}</span>
                  <span className="rounded-full border border-hairline bg-surface px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                    {DOC_TYPE_LABELS[doc.doc_type]}
                  </span>
                </div>
                {doc.note && (
                  <p className="mt-0.5 truncate text-xs text-muted-foreground">{doc.note}</p>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                {onView && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => onView(doc.storage_path)}
                    title="Open document"
                    aria-label={`Open ${doc.file_name}`}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </Button>
                )}
                {onDelete && (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => onDelete(doc.id, doc.storage_path)}
                    title="Remove document"
                    aria-label={`Remove ${doc.file_name}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </div>
          ))}
        </div>

        {onUpload && (
          <div
            className={`mt-2 space-y-3 rounded-xl border-2 border-dashed p-3.5 ${
              dragActive ? "border-clay/60 bg-clay/5" : "border-hairline bg-surface/50"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragActive(true);
            }}
            onDragLeave={() => setDragActive(false)}
            onDrop={(e) => {
              // Thin wrapper: a dropped file feeds the same handler as the
              // hidden file input's onChange.
              e.preventDefault();
              setDragActive(false);
              if (!uploading) pickAndUpload(e.dataTransfer.files?.[0]);
            }}
          >
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Attach a document
            </p>
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={docType} onValueChange={(v) => setDocType(v as CoDocType)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DOC_TYPE_ORDER.map((t) => (
                      <SelectItem key={t} value={t}>
                        {DOC_TYPE_LABELS[t]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="co-doc-note">Note (optional)</Label>
                <Input
                  id="co-doc-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Sub quote rev B"
                />
              </div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="application/pdf,image/png,image/jpeg,image/webp"
              className="hidden"
              onChange={(e) => pickAndUpload(e.target.files?.[0])}
            />
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="text-xs text-muted-foreground">
                PDF, PNG, JPG or WebP · drag a file here or
              </span>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="h-4 w-4" /> {uploading ? "Uploading…" : "Choose file & upload"}
              </Button>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
