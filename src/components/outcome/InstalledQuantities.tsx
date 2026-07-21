interface InstalledQuantity {
  quantity: number;
  unit: string;
  description: string;
}

export function InstalledQuantities({ items }: { items: InstalledQuantity[] }) {
  return (
    <div className="rounded-lg border border-hairline bg-background p-3">
      <div className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
        Installed quantities from the field
      </div>
      <p className="mt-0.5 text-[10px] text-muted-foreground">
        All quantities logged by the superintendent are retained on this work line.
      </p>
      <ul className="mt-2 divide-y divide-hairline">
        {items.map((item, index) => (
          <li
            key={`${item.quantity}-${item.unit}-${item.description}-${index}`}
            className="flex items-baseline justify-between gap-3 py-1.5 first:pt-0 last:pb-0"
          >
            <span className="text-sm font-medium tabular-nums text-foreground">
              {item.quantity} {item.unit || "qty"}
            </span>
            {item.description ? (
              <span className="text-right text-xs text-muted-foreground">{item.description}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
