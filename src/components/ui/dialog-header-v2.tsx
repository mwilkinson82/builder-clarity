import type { ReactNode } from "react";

import { DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * The v2 house standard for modal headers: an optional mono-clay eyebrow, a serif
 * title, and an optional muted subtitle. Wraps the stock Radix
 * DialogHeader/Title/Description so accessibility (labelling, the close button,
 * focus) is unchanged — only the v2 styling is applied. Adopt this in form dialogs
 * instead of hand-rolling the eyebrow + `font-serif` title each time, so the look
 * stays consistent. See docs/THEMING.md.
 */
export function DialogHeaderV2({
  eyebrow,
  title,
  description,
  className,
  titleClassName,
}: {
  /** Short mono-uppercase-clay lead-in (e.g. "New opportunity"). Omit if none. */
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
  /** Override the serif title size (defaults to text-2xl) for larger detail dialogs. */
  titleClassName?: string;
}) {
  return (
    <DialogHeader className={className}>
      {eyebrow ? <div className="eyebrow">{eyebrow}</div> : null}
      <DialogTitle className={cn("font-serif text-2xl font-normal", titleClassName)}>
        {title}
      </DialogTitle>
      {description ? <DialogDescription>{description}</DialogDescription> : null}
    </DialogHeader>
  );
}
