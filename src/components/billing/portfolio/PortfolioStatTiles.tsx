// Stat tile + money cell — the two repeated presentation atoms of the
// Portfolio Billing notebook tabs, per the v2 mock.
import {
  MONO_LABEL,
  STAT_TONE_BORDER,
  STAT_TONE_LABEL,
  type StatTone,
} from "./portfolio-billing-shared";

// Stat tile per mock: mono 8.5px label / serif 23px figure / 11px muted sub.
export function StatTile({
  label,
  value,
  sub = "",
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: StatTone;
}) {
  return (
    <div className={`rounded-xl border bg-card px-4 py-3.5 ${STAT_TONE_BORDER[tone]}`}>
      <div className={`${MONO_LABEL} ${STAT_TONE_LABEL[tone]}`}>{label}</div>
      <div className="mt-2 font-serif text-[23px] leading-none tabular text-foreground">
        {value}
      </div>
      <div className="mt-1.5 min-h-[14px] text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

// A subtle "Sample" marker for seeded Harbor demo rows, so a fresh account never
// mistakes the demo's real-looking money for its own. Accent-toned, tokenized.
export function SamplePill() {
  return (
    <span
      title="Seeded Harbor Residence demo — sample data. Safe to explore, or archive it from the project."
      className="inline-flex shrink-0 items-center rounded-full border border-accent/30 bg-accent/10 px-1.5 py-0.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.1em] text-accent"
    >
      Sample
    </span>
  );
}

// A mono microlabel over a serif figure — the money cell in the mock's tables.
export function MoneyCell({
  label,
  value,
  valueClassName = "",
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div>
      <div className={`${MONO_LABEL} text-muted-foreground`}>{label}</div>
      <div className={`mt-0.5 font-serif text-sm tabular ${valueClassName}`}>{value}</div>
    </div>
  );
}
