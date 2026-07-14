import { useRef } from "react";
import { FileImage, FileText, Upload, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { inferAttachmentType, isAllowedAttachmentType } from "@/lib/daily-report-uploads";

export type CostActualInvoiceAttachment = {
  path: string;
  name: string;
  type: string;
  size: number;
};

const MAX_INVOICE_FILE_BYTES = 25 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function InvoiceFileIcon({ type }: { type: string }) {
  return type === "application/pdf" ? (
    <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
  ) : (
    <FileImage className="h-4 w-4 shrink-0 text-muted-foreground" />
  );
}

export function CostActualInvoiceAttachmentPicker({
  attachment,
  pendingFile,
  onPendingFileChange,
  disabled,
}: {
  attachment: CostActualInvoiceAttachment | null;
  pendingFile: File | null;
  onPendingFileChange: (file: File | null) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const pickFile = (file: File | undefined) => {
    if (!file) return;
    const contentType = inferAttachmentType(file.name, file.type);
    if (!isAllowedAttachmentType(contentType)) {
      toast.error("Choose an invoice image or PDF", {
        description: "JPG, PNG, WebP, HEIC, and PDF files are supported.",
      });
      return;
    }
    if (file.size > MAX_INVOICE_FILE_BYTES) {
      toast.error("Invoice file is too large", {
        description: "Choose a file smaller than 25 MB.",
      });
      return;
    }
    onPendingFileChange(file);
  };

  const selected = pendingFile
    ? {
        name: pendingFile.name,
        type: inferAttachmentType(pendingFile.name, pendingFile.type),
        size: pendingFile.size,
      }
    : attachment;

  return (
    <div className="space-y-2 rounded-md border border-hairline bg-surface/60 p-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*,application/pdf,.heic,.heif"
        className="hidden"
        disabled={disabled || Boolean(attachment)}
        onChange={(event) => {
          pickFile(event.target.files?.[0]);
          event.currentTarget.value = "";
        }}
      />
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Invoice backup
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Attach the supplier invoice here so the cost and its backup stay together.
          </p>
        </div>
        {!selected ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-3.5 w-3.5" /> Upload image or PDF
          </Button>
        ) : null}
      </div>
      {selected ? (
        <div className="flex min-w-0 items-center gap-2 rounded-md border border-hairline bg-card px-3 py-2">
          <InvoiceFileIcon type={selected.type} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-foreground">{selected.name}</div>
            <div className="text-[11px] text-muted-foreground">
              {formatBytes(selected.size)}
              {pendingFile ? " · Ready to upload" : " · Attached"}
            </div>
          </div>
          {pendingFile ? (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              disabled={disabled}
              aria-label="Remove selected invoice file"
              onClick={() => onPendingFileChange(null)}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          ) : null}
        </div>
      ) : null}
      {attachment ? (
        <p className="text-[11px] text-muted-foreground">
          This cost already has invoice backup. Open it from the cost ledger below.
        </p>
      ) : null}
    </div>
  );
}
