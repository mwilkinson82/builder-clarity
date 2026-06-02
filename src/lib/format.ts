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

export const fmtPct = (n: number, digits = 1) =>
  `${n.toFixed(digits)}%`;
