// Billing money surfaces always render exact cents. Whole-dollar rounding on
// billing displays hid a fractional-cent invoice defect during founder QA
// (invoice 2601-001); drift must never be able to hide behind rounding again.
// Whole-dollar style stays only on surfaces whose values are verified whole.
export const fmtUSDCents = (n: number, opts: { sign?: boolean } = {}) => {
  const formatted = Math.abs(n).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  if (opts.sign && n > 0) return `+${formatted}`;
  if (n < 0) return `−${formatted}`;
  return formatted;
};
