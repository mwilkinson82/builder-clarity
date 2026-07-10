import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Check, ChevronsUpDown, HardHat, Plus, Store } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pick-or-add vendor field for cost entry (field request, DB3T 2026-07-09:
 * "have this be a dropdown... and can pick either vendors or subs"). Offers
 * the org's vendor directory AND its subcontractor directory in one list —
 * a cost's payee is one or the other — and typing a brand-new name still
 * works (the save path enrolls it as a vendor). Mirrors the CRM AccountPicker
 * interaction so the app has ONE way dropdowns like this behave.
 */
export function VendorPicker({
  value,
  onChange,
  vendors,
  subcontractors,
  placeholder = "Pick or add a vendor…",
}: {
  value: string;
  /** Called with the chosen name; `isSub` is true when it came from the
   * subcontractor directory (callers can default the cost category). */
  onChange: (name: string, isSub: boolean) => void;
  vendors: string[];
  subcontractors: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const matching = (names: string[]) =>
    trimmed ? names.filter((name) => name.toLowerCase().includes(lower)) : names;
  const vendorMatches = matching(vendors);
  const subMatches = matching(subcontractors);
  const hasExact = [...vendors, ...subcontractors].some((name) => name.toLowerCase() === lower);

  const select = (name: string, isSub: boolean) => {
    onChange(name, isSub);
    setQuery("");
    setOpen(false);
  };

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full justify-between gap-2 px-3 text-left font-normal"
        >
          <span className={cn("min-w-0 truncate text-sm", !value && "text-muted-foreground")}>
            {value || placeholder}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] max-w-[calc(100vw-2rem)] p-0"
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Search vendors and subs…"
          />
          <CommandList>
            {vendorMatches.length > 0 && (
              <CommandGroup heading="Vendors">
                {vendorMatches.map((name) => (
                  <CommandItem
                    key={`v:${name}`}
                    value={`v:${name}`}
                    onSelect={() => select(name, false)}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4", value === name ? "opacity-100" : "opacity-0")}
                    />
                    <Store className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate">{name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {subMatches.length > 0 && (
              <CommandGroup heading="Subcontractors">
                {subMatches.map((name) => (
                  <CommandItem
                    key={`s:${name}`}
                    value={`s:${name}`}
                    onSelect={() => select(name, true)}
                  >
                    <Check
                      className={cn("mr-2 h-4 w-4", value === name ? "opacity-100" : "opacity-0")}
                    />
                    <HardHat className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    <span className="truncate">{name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {trimmed && !hasExact && (
              <CommandGroup heading="New">
                <CommandItem value={`add:${trimmed}`} onSelect={() => select(trimmed, false)}>
                  <Plus className="mr-2 h-4 w-4" />
                  <span className="truncate">Add “{trimmed}” as a vendor</span>
                </CommandItem>
              </CommandGroup>
            )}
            {vendorMatches.length === 0 && subMatches.length === 0 && !trimmed && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No vendors or subs yet — type a name to add one.
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
