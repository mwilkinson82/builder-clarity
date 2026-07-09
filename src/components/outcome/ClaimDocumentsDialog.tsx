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
import { ExternalLink, Trash2, Upload } from "lucide-react";
import type { ClaimDocType, ClaimDocumentRow, ClaimRow } from "@/lib/projects.functions";

const DOC_TYPE_LABELS: Record<ClaimDocType, string> = {
  claim: "Claim document",
  supporting: "Supporting",
  correspondence: "Correspondence",
  other: "Other",
};

const DOC_TYPE_ORDER: ClaimDocType[] = ["claim", "supporting", "correspondence", "other"];

export function ClaimDocumentsDialog({
  claim,
  documents,
  onClose,
  onUpload,
  onView,
  onDelete,
  uploading = false,
}: {
  claim: ClaimRow | null;
  documents: ClaimDocumentRow[];
  onClose: () => void;
  onUpload?: (claimId: string, file: File, docType: ClaimDocType, note: string) => void;
  onView?: (path: string) => void;
  onDelete?: (id: string, path: string) => void;
  uploading?: boolean;
}) {
  const [docType, setDocType] = useState<ClaimDocType>("supporting");
  const [note, setNote] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const pickAndUpload = (file: File | undefined) => {
    if (!file || !claim || !onUpload) return;
    onUpload(claim.id, file, docType, note.trim());
    setNote("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const ordered = [...documents].sort((a, b) => b.uploaded_at.localeCompare(a.uploaded_at));

  return (
    <Dialog
      open={claim !== null}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Documents{claim ? ` — ${claim.claim_number || claim.title}` : ""}
          </DialogTitle>
          <DialogDescription>
            Attach the claim package and its supporting documents. Files are private to the project
            team.
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
              <div className="min-w-0">
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
          <div className="mt-2 space-y-3 rounded-lg border border-hairline bg-surface/50 p-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Attach a document
            </p>
            <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
              <div className="space-y-1.5">
                <Label>Type</Label>
                <Select value={docType} onValueChange={(v) => setDocType(v as ClaimDocType)}>
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
                <Label htmlFor="doc-note">Note (optional)</Label>
                <Input
                  id="doc-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="e.g. Schedule analysis rev B"
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
            <div className="flex justify-end">
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
