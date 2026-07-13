import { Input } from "@/components/ui/input";

export interface ProjectSubcontractorOption {
  id: string;
  label: string;
}

interface PerformedByFieldProps {
  subcontractorId: string;
  unmatchedVendorName: string;
  options: ProjectSubcontractorOption[];
  onChange: (next: { subcontractorId: string; unmatchedVendorName: string }) => void;
  labelClassName?: string;
  helpText?: string;
  flagUnmatched?: boolean;
}

const selectClass =
  "rounded-md border border-hairline bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/40";

export function PerformedByField({
  subcontractorId,
  unmatchedVendorName,
  options,
  onChange,
  labelClassName = "text-xs text-muted-foreground",
  helpText,
  flagUnmatched = false,
}: PerformedByFieldProps) {
  return (
    <div className="flex flex-col gap-1">
      <span className={labelClassName}>Performed by</span>
      <select
        value={subcontractorId}
        onChange={(event) =>
          onChange({
            subcontractorId: event.target.value,
            unmatchedVendorName: event.target.value ? "" : unmatchedVendorName,
          })
        }
        className={selectClass}
        aria-label="Performed by subcontractor"
      >
        <option value="">
          {options.length === 0
            ? "Self-perform (no subcontractors bought out yet)"
            : "Self-perform or vendor not listed"}
        </option>
        {options.map((sub) => (
          <option key={sub.id} value={sub.id}>
            {sub.label}
          </option>
        ))}
      </select>
      <Input
        value={unmatchedVendorName}
        placeholder="Vendor not listed? Enter the company name"
        aria-label="Unlisted vendor name"
        onChange={(event) =>
          onChange({
            subcontractorId: event.target.value.trim() ? "" : subcontractorId,
            unmatchedVendorName: event.target.value,
          })
        }
      />
      {flagUnmatched && unmatchedVendorName ? (
        <span className="text-[10px] text-warning">
          Not matched to a project buyout yet. Select the subcontractor above after the PM adds it.
        </span>
      ) : helpText ? (
        <span className="text-[11px] text-muted-foreground">{helpText}</span>
      ) : null}
    </div>
  );
}
