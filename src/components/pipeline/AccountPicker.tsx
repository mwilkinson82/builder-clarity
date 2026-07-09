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
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pick-or-add client field. Sourced from the CRM accounts already on the org so
 * you reuse an existing client (no more "Hernandez Construction" vs "Hernandez
 * Const." duplicates) — but typing a brand-new name still works and creates it
 * on save (the server already find-or-creates the account by name).
 */
export function AccountPicker({
  value,
  onChange,
  accounts,
  placeholder = "Pick or add a client…",
}: {
  value: string;
  onChange: (name: string) => void;
  accounts: string[];
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const trimmed = query.trim();
  const lower = trimmed.toLowerCase();
  const filtered = trimmed
    ? accounts.filter((name) => name.toLowerCase().includes(lower))
    : accounts;
  const hasExact = accounts.some((name) => name.toLowerCase() === lower);

  const select = (name: string) => {
    onChange(name);
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
          <CommandInput value={query} onValueChange={setQuery} placeholder="Search clients…" />
          <CommandList>
            {filtered.length > 0 && (
              <CommandGroup heading={trimmed ? "Matches" : "Clients"}>
                {filtered.map((name) => (
                  <CommandItem key={name} value={name} onSelect={() => select(name)}>
                    <Check
                      className={cn("mr-2 h-4 w-4", value === name ? "opacity-100" : "opacity-0")}
                    />
                    <span className="truncate">{name}</span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
            {trimmed && !hasExact && (
              <CommandGroup heading="New">
                <CommandItem value={`add:${trimmed}`} onSelect={() => select(trimmed)}>
                  <Plus className="mr-2 h-4 w-4" />
                  <span className="truncate">Add “{trimmed}”</span>
                </CommandItem>
              </CommandGroup>
            )}
            {filtered.length === 0 && !trimmed && (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                No clients yet — type a name to add one.
              </p>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
