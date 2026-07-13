import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { CostLineItem } from "@/lib/daily-wip";

let editorItemSequence = 0;

function createBlankItem(): FieldResourceDraft {
  editorItemSequence += 1;
  return {
    clientId: `field-resource-editor-${editorItemSequence}`,
    description: "",
    quantity: 0,
    unit: "",
    amount: 0,
  };
}

export interface FieldResourceDraft extends CostLineItem {
  clientId: string;
  quantity: number;
  unit: string;
}

interface FieldResourceEditorProps {
  label: string;
  help: string;
  descriptionPlaceholder: string;
  items: FieldResourceDraft[];
  onChange: (items: FieldResourceDraft[]) => void;
}

export function FieldResourceEditor({
  label,
  help,
  descriptionPlaceholder,
  items,
  onChange,
}: FieldResourceEditorProps) {
  const update = (clientId: string, patch: Partial<FieldResourceDraft>) =>
    onChange(items.map((item) => (item.clientId === clientId ? { ...item, ...patch } : item)));
  const remove = (clientId: string) => onChange(items.filter((item) => item.clientId !== clientId));

  return (
    <div className="rounded-md border border-hairline bg-background p-3">
      <div className="text-xs font-semibold text-foreground">{label}</div>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{help}</p>
      <div className="mt-2 space-y-2">
        {items.map((item) => (
          <div
            key={item.clientId}
            className="grid grid-cols-[minmax(0,1fr)_92px_32px] items-center gap-2 sm:grid-cols-[minmax(0,1fr)_72px_92px_32px]"
          >
            <Input
              value={item.description}
              placeholder={descriptionPlaceholder}
              className="col-span-3 sm:col-span-1"
              aria-label={`${label} description`}
              onChange={(event) => update(item.clientId, { description: event.target.value })}
            />
            <Input
              type="number"
              min={0}
              step="0.01"
              value={item.quantity || ""}
              placeholder="Qty"
              aria-label={`${label} quantity`}
              onChange={(event) =>
                update(item.clientId, { quantity: Number(event.target.value) || 0 })
              }
            />
            <Input
              value={item.unit}
              placeholder="Unit"
              aria-label={`${label} unit`}
              onChange={(event) => update(item.clientId, { unit: event.target.value })}
            />
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-8 w-8 text-muted-foreground hover:text-danger"
              aria-label={`Remove ${label.toLowerCase()} line`}
              onClick={() => remove(item.clientId)}
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
        onClick={() => onChange([...items, createBlankItem()])}
      >
        <Plus className="h-3.5 w-3.5" />
        Add {label.toLowerCase()} line
      </Button>
    </div>
  );
}
