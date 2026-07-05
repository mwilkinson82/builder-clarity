// Shared presentational atoms for the billing row editors: a read-only
// labelled ledger cell and a blur-committing inline text input. Extracted
// verbatim from the project route during the PROJECTDECOMP1 split.
import { useEffect, useState, type ReactNode } from "react";

import { Input } from "@/components/ui/input";

export function LedgerDetail({
  label,
  value,
  className = "",
}: {
  label: string;
  value: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-md border border-hairline bg-card px-3 py-2 ${className}`}>
      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-1 text-sm font-medium tabular text-foreground">{value}</div>
    </div>
  );
}

export function EditableText({
  value,
  placeholder,
  small,
  onCommit,
}: {
  value: string;
  placeholder?: string;
  small?: boolean;
  onCommit: (value: string) => void;
}) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  return (
    <Input
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onCommit(local);
      }}
      className={`h-8 w-full min-w-0 ${small ? "mt-1 text-xs text-muted-foreground" : ""}`}
    />
  );
}
