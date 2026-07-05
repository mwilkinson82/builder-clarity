export const fmtUSD = (n: number, opts: { sign?: boolean } = {}) => {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  if (opts.sign && n > 0) return `+${formatted}`;
  if (n < 0) return `−${formatted}`;
  return formatted;
};

export const fmtPct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;

// Compact "YYYY-MM-DD HH:MM" rendering of a stored ISO timestamp for billing
// event/history rows. Extracted from the project route (PROJECTDECOMP1).
export function formatShortDateTime(value: string) {
  if (!value) return "Date not recorded";
  const compact = value.replace("T", " ").slice(0, 16);
  return compact || "Date not recorded";
}
