import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { SelectionClientSeat } from "@/lib/selections.functions";

export function SelectionClientApproverField({
  value,
  clientSeats,
  className = "",
  onChange,
}: {
  value: string | null;
  clientSeats: SelectionClientSeat[];
  className?: string;
  onChange: (contactId: string | null) => void;
}) {
  return (
    <div className={className}>
      <Label className="mb-1.5 block">Client approver</Label>
      <Select
        value={value ?? "unassigned"}
        onValueChange={(nextValue) => onChange(nextValue === "unassigned" ? null : nextValue)}
      >
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="unassigned">Choose before sending</SelectItem>
          {clientSeats
            .filter((seat) => seat.contactId)
            .map((seat) => (
              <SelectItem key={seat.accessId} value={seat.contactId!}>
                {seat.name} · {seat.email}
              </SelectItem>
            ))}
        </SelectContent>
      </Select>
      {clientSeats.length === 0 ? (
        <p className="mt-1 text-xs text-muted-foreground">
          Add the client in Client Portal first so Overwatch can send a secure approval link.
        </p>
      ) : null}
    </div>
  );
}
