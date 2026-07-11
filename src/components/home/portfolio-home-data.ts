// View-model types for the redesigned Portfolio / Home screen (design option 6a).
// The values are produced from live data by portfolio-home-metrics.ts (Phase 2b);
// this file just describes the shapes the component renders.

export type Tone = "good" | "crit" | "warn" | "muted";

export type HeroStat = {
  label: string;
  value: string;
  /** Small ticker under the value, e.g. "▲ 4.1%". Stock-ticker logic: direction,
   *  not sign — a falling at-risk count is good (green). */
  ticker?: string;
  tickerTone?: "good" | "crit";
  /** The big number's own tone (risk figures read in the warm on-dark red). */
  valueTone?: "default" | "crit";
};

export type PipelineStage = {
  key: string;
  label: string;
  count: number;
  name?: string;
  meta?: string;
  /** Estimating + Won get a highlighted tile; Estimating also links to Estimates. */
  highlight?: "clay" | "good";
  dim?: boolean;
  estimatesLink?: boolean;
  /** The stage's top opportunity — deep-links the card into the CRM board. */
  oppId?: string;
};

export type PostureTile = {
  key: "indicated-gp" | "open-holds" | "gp-at-risk" | "active" | "at-risk" | "overdue";
  label: string;
  value: string;
  sub?: string;
  subTone?: "good" | "crit" | "muted";
  /** Dark tiles are display-only stat tiles; the light ones are clickable filters. */
  variant: "dark" | "filter";
  labelTone?: "crit";
  valueTone?: "crit";
};

export type WorklistJob = {
  id: string;
  tag: string;
  tone: Tone;
  name: string;
  desc: string;
  value: string;
  atRisk: boolean;
  overdue: boolean;
  /** The owning company's logo + name — shown left of the project name to keep
   *  the list personal to the customer. */
  logoUrl: string;
  orgName: string;
};

export type Pursuit = {
  title: string;
  due: string;
  dueTone?: "crit";
  context: string;
  /** The opportunity this action belongs to — deep-links into the CRM board. */
  oppId?: string;
};
