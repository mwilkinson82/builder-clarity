import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Type-as-you-go dollar input with thousands separators.
 * Stores a clean number; renders the formatted string.
 * Allows decimals and a single leading minus sign.
 */
export interface MoneyInputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> {
  value: number;
  onValueChange: (n: number) => void;
  allowNegative?: boolean;
  align?: "left" | "right";
}

function formatWhileTyping(raw: string, allowNegative: boolean): string {
  let s = raw.replace(/[^\d.\-]/g, "");
  if (!allowNegative) s = s.replace(/-/g, "");
  // Only allow a leading minus
  const neg = s.startsWith("-");
  s = s.replace(/-/g, "");
  // Only one decimal point
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
  }
  const [intPart, decPart] = s.split(".");
  const intClean = intPart.replace(/^0+(?=\d)/, "");
  const withCommas = intClean.length
    ? Number(intClean).toLocaleString("en-US")
    : "";
  let out = withCommas;
  if (s.includes(".")) out += "." + (decPart ?? "").slice(0, 2);
  return (neg ? "-" : "") + out;
}

function parseClean(formatted: string): number {
  const s = formatted.replace(/[^\d.\-]/g, "");
  if (!s || s === "-" || s === "." || s === "-.") return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export const MoneyInput = React.forwardRef<HTMLInputElement, MoneyInputProps>(
  ({ value, onValueChange, allowNegative = false, align = "left", className, onBlur, onFocus, ...rest }, ref) => {
    const [display, setDisplay] = React.useState<string>(() =>
      value === 0 ? "" : value.toLocaleString("en-US"),
    );
    const [focused, setFocused] = React.useState(false);

    // Keep display in sync when external value changes and the field is not focused
    React.useEffect(() => {
      if (!focused) {
        setDisplay(value === 0 ? "" : value.toLocaleString("en-US"));
      }
    }, [value, focused]);

    return (
      <input
        ref={ref}
        type="text"
        inputMode="decimal"
        className={cn(
          "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 tabular-nums",
          align === "right" && "text-right",
          className,
        )}
        value={display}
        onFocus={(e) => { setFocused(true); onFocus?.(e); }}
        onChange={(e) => {
          const next = formatWhileTyping(e.target.value, allowNegative);
          setDisplay(next);
          onValueChange(parseClean(next));
        }}
        onBlur={(e) => {
          setFocused(false);
          const n = parseClean(display);
          setDisplay(n === 0 ? "" : n.toLocaleString("en-US"));
          onValueChange(n);
          onBlur?.(e);
        }}
        {...rest}
      />
    );
  },
);
MoneyInput.displayName = "MoneyInput";
