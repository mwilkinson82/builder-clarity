import { useState } from "react";
import { Loader2, Paperclip } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import type { CostActualInvoiceAttachment } from "@/components/billing/CostActualInvoiceAttachment";
import { supabase } from "@/integrations/supabase/client";

export function CostActualInvoiceAttachmentLink({
  attachment,
}: {
  attachment: CostActualInvoiceAttachment;
}) {
  const [opening, setOpening] = useState(false);

  const openAttachment = async () => {
    setOpening(true);
    const { data, error } = await supabase.storage
      .from("project-docs")
      .createSignedUrl(attachment.path, 600);
    setOpening(false);
    if (error || !data?.signedUrl) {
      toast.error("Could not open the invoice", {
        description: error?.message ?? "Try again.",
      });
      return;
    }
    window.open(data.signedUrl, "_blank", "noopener,noreferrer");
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 max-w-full gap-1.5"
      disabled={opening}
      onClick={openAttachment}
    >
      {opening ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <Paperclip className="h-3.5 w-3.5" />
      )}
      <span className="truncate">{attachment.name || "Open invoice"}</span>
    </Button>
  );
}
