import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";
import { createDraftCostItem, type DraftCostItem } from "@/components/outcome/daily-wip-drafts";
import { fmtUSDCents as fmtUSD } from "@/lib/billing-format";
import { sumLineItems } from "@/lib/daily-wip";

interface ItemizedCostEditorProps {
  label: string;
  help: string;
  placeholder: string;
  items: DraftCostItem[];
  onChange: (items: DraftCostItem[]) => void;
}

export function ItemizedCostEditor({
  label,
  help,
  placeholder,
  items,
  onChange,
}: ItemizedCostEditorProps) {
  const total = sumLineItems(items);
  const update = (clientId: string, patch: Partial<DraftCostItem>) =>
    onChange(items.map((item) => (item.clientId === clientId ? { ...item, ...patch } : item)));
  const removeLine = (clientId: string) =>
    onChange(items.filter((item) => item.clientId !== clientId));

  return (
    <div className="rounded-xl border border-hairline bg-background p-3.5">
      <div className="text-[13px] font-semibold text-foreground">{label}</div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{help}</p>

      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div
            key={item.clientId}
            className="grid grid-cols-[minmax(0,1fr)_32px] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_118px_32px]"
          >
            <div className="col-span-2 min-w-0 sm:col-span-1">
              <Input
                value={item.description}
                placeholder={placeholder}
                onChange={(event) => update(item.clientId, { description: event.target.value })}
              />
              {item.quantity || item.unit ? (
                <div className="mt-1 text-[10px] text-muted-foreground">
                  Field logged: {item.quantity || 0} {item.unit || "qty"}
                </div>
              ) : null}
            </div>
            <div className="relative min-w-0">
              <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <MoneyInput
                value={item.amount}
                onValueChange={(amount) => update(item.clientId, { amount })}
                align="right"
                className="pl-6"
              />
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 shrink-0 text-muted-foreground hover:text-danger"
              aria-label={`Remove ${label.toLowerCase()} line`}
              onClick={() => removeLine(item.clientId)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="mt-2 gap-1.5 text-muted-foreground"
        onClick={() => onChange([...items, createDraftCostItem()])}
      >
        <Plus className="h-3.5 w-3.5" />
        Add {label.toLowerCase()} line
      </Button>

      {total > 0 ? (
        <div className="mt-2 flex items-baseline justify-between border-t border-hairline pt-2 text-xs">
          <span className="text-muted-foreground">{label} subtotal</span>
          <span className="font-semibold tabular-nums text-foreground">{fmtUSD(total)}</span>
        </div>
      ) : null}
    </div>
  );
}
