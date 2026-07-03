// Roles Phase 2: grouped capability checkboxes with plain-language
// descriptions. Role presets pre-fill these boxes; any manual change makes the
// member "Custom (based on <preset>)". Rendering only — the caller owns state
// and persistence, and the database re-checks every change server-side.

import { CAPABILITY_GROUPS, type CapabilityKey, type CapabilitySet } from "@/lib/capabilities";
import { Checkbox } from "@/components/ui/checkbox";

interface CapabilityPickerProps {
  value: CapabilitySet;
  onChange: (next: CapabilitySet) => void;
  disabled?: boolean;
  /** Capability keys that can't be changed here, with the reason shown to the user. */
  lockedKeys?: Partial<Record<CapabilityKey, string>>;
  idPrefix: string;
}

export function CapabilityPicker({
  value,
  onChange,
  disabled = false,
  lockedKeys = {},
  idPrefix,
}: CapabilityPickerProps) {
  const toggle = (key: CapabilityKey, checked: boolean) => {
    const next: CapabilitySet = { ...value };
    if (checked) {
      next[key] = true;
    } else {
      delete next[key];
    }
    onChange(next);
  };

  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {CAPABILITY_GROUPS.map((group) => (
        <fieldset key={group.group} className="min-w-0 rounded-md border border-hairline p-3">
          <legend className="px-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {group.group}
          </legend>
          <div className="space-y-2.5">
            {group.items.map((item) => {
              const lockedReason = lockedKeys[item.key];
              const inputId = `${idPrefix}-${item.key}`;
              return (
                <div key={item.key} className="flex items-start gap-2.5">
                  <Checkbox
                    id={inputId}
                    checked={value[item.key] === true}
                    disabled={disabled || Boolean(lockedReason)}
                    onCheckedChange={(checked) => toggle(item.key, checked === true)}
                    className="mt-0.5"
                  />
                  <label htmlFor={inputId} className="min-w-0 cursor-pointer select-none">
                    <span className="block text-sm font-medium leading-tight">{item.label}</span>
                    <span className="block text-xs leading-snug text-muted-foreground">
                      {item.description}
                    </span>
                    {lockedReason ? (
                      <span className="block text-xs italic text-warning">{lockedReason}</span>
                    ) : null}
                  </label>
                </div>
              );
            })}
          </div>
        </fieldset>
      ))}
    </div>
  );
}
