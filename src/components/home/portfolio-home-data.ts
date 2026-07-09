// Placeholder data for the redesigned Portfolio / Home screen (design option 6a).
// PHASE 1 is a faithful, client-side build with the mock's numbers — no backend.
// PHASE 2 replaces these with real aggregates (pipeline weighted / avg GP / win
// rate from CRM; indicated GP, GP-at-risk, at-risk & overdue counts from active
// projects). Keep the shapes; swap the source.

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
};

export type PostureTile = {
  key: "indicated-gp" | "gp-at-risk" | "active" | "at-risk" | "overdue";
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
};

export type Pursuit = { title: string; due: string; dueTone?: "crit"; context: string };

export const OWNER_HERO = {
  greeting: "Good morning, Marcus.",
  dateline: "Tuesday · July 9 · 7:58 AM",
  alertKicker: "Needs you · before noon",
  alertBody: "**2 pursuits** and **3 jobs** are waiting on a decision.",
  stats: [
    { label: "Pipeline weighted", value: "$6.24M", ticker: "▲ 4.1%", tickerTone: "good" },
    { label: "Indicated GP", value: "$7.46M", ticker: "▲ 0.6pt", tickerTone: "good" },
    { label: "Jobs at risk", value: "26", valueTone: "crit" },
    { label: "Overdue actions", value: "63", valueTone: "crit" },
  ] as HeroStat[],
};

export const PIPELINE_STAGES: PipelineStage[] = [
  { key: "lead", label: "Lead", count: 0, meta: "No open leads", dim: true },
  {
    key: "qualifying",
    label: "Qualifying",
    count: 1,
    name: "Oak & Pine Retail",
    meta: "$980K · 28%",
  },
  {
    key: "estimating",
    label: "Estimating",
    count: 1,
    name: "North Ridge Clubhouse",
    meta: "$2.40M · 42%",
    highlight: "clay",
    estimatesLink: true,
  },
  { key: "bid", label: "Bid submitted", count: 1, name: "Lakeside Medical", meta: "$1.85M · 58%" },
  {
    key: "negotiating",
    label: "Negotiating",
    count: 1,
    name: "Bayview Townhomes II",
    meta: "$5.40M · 72%",
  },
  {
    key: "won",
    label: "Won →",
    count: 1,
    name: "Harbor Residence",
    meta: "$3.20M · converts",
    highlight: "good",
  },
];

export const POSTURE_TILES: PostureTile[] = [
  {
    key: "indicated-gp",
    label: "Indicated GP",
    value: "$7.46M",
    sub: "▲ 8.9%",
    subTone: "good",
    variant: "dark",
  },
  {
    key: "gp-at-risk",
    label: "GP at Risk",
    value: "$4.40M",
    sub: "59%",
    subTone: "crit",
    variant: "dark",
  },
  {
    key: "active",
    label: "Active",
    value: "33",
    sub: "25 delayed",
    subTone: "muted",
    variant: "filter",
  },
  {
    key: "at-risk",
    label: "At risk",
    value: "26",
    sub: "filter →",
    subTone: "muted",
    variant: "filter",
    labelTone: "crit",
    valueTone: "crit",
  },
  {
    key: "overdue",
    label: "Overdue",
    value: "63",
    sub: "filter →",
    subTone: "muted",
    variant: "filter",
    labelTone: "crit",
    valueTone: "crit",
  },
];

// The field worklist. `atRisk`/`overdue` drive the posture-tile filters.
export const WORKLIST_JOBS: WorklistJob[] = [
  {
    id: "bp-pompano",
    tag: "AT RISK",
    tone: "crit",
    name: "BP · Pompano",
    desc: "Margin erosion $10,240 · daily report stale since Jul 1",
    value: "$10.2K",
    atRisk: true,
    overdue: true,
  },
  {
    id: "harbor",
    tag: "63 OVER",
    tone: "crit",
    name: "Harbor Residence",
    desc: "Finish-phase uncertainty · 3 exposures at $65,000",
    value: "$65K",
    atRisk: true,
    overdue: true,
  },
  {
    id: "ryder-gratigny",
    tag: "NO DAILY",
    tone: "warn",
    name: "Ryder @ BP Gratigny",
    desc: "No job logs filed · E-Hold $11,500 on Concrete Cutting CO",
    value: "$11.5K",
    atRisk: true,
    overdue: false,
  },
  {
    id: "lakeside",
    tag: "ON PLAN",
    tone: "good",
    name: "Lakeside Medical Buildout",
    desc: "On schedule · daily log filed · no open holds",
    value: "On plan",
    atRisk: false,
    overdue: false,
  },
  {
    id: "north-ridge",
    tag: "ON PLAN",
    tone: "good",
    name: "North Ridge Clubhouse",
    desc: "On schedule · daily log filed · 2 to-dos this week",
    value: "On plan",
    atRisk: false,
    overdue: false,
  },
];

export const PURSUITS: Pursuit[] = [
  {
    title: "Send VE alternate log",
    due: "Jul 9",
    dueTone: "crit",
    context: "Bayview Townhomes II · negotiating",
  },
  {
    title: "Confirm decision timeline",
    due: "Jul 10",
    context: "Lakeside Medical · bid submitted",
  },
  { title: "Run bid / no-bid screen", due: "Jul 11", context: "Oak & Pine Retail · qualifying" },
];

export const PM_HERO = {
  greeting: "Morning, Dana.",
  dateline: "Tuesday · July 9 · 7:58 AM",
  alertKicker: "Needs you · today",
  alertBody: "**3 of your 7 jobs** need attention before the day starts.",
  stats: [
    { label: "Your jobs", value: "7" },
    { label: "At risk", value: "3", ticker: "▼ 1", tickerTone: "good", valueTone: "crit" },
    { label: "Overdue to-dos", value: "11", ticker: "▲ 2", tickerTone: "crit", valueTone: "crit" },
    { label: "Logs due today", value: "4" },
  ] as HeroStat[],
};

export const PM_JOBS: WorklistJob[] = [
  {
    id: "bp-pompano",
    tag: "AT RISK",
    tone: "crit",
    name: "BP · Pompano",
    desc: "Margin erosion $10,240 · daily report stale since Jul 1 · 1 to-do due today",
    value: "",
    atRisk: true,
    overdue: true,
  },
  {
    id: "harbor",
    tag: "63 OVER",
    tone: "crit",
    name: "Harbor Residence",
    desc: "Finish-phase uncertainty · 3 exposures at $65,000 · assign action debt",
    value: "",
    atRisk: true,
    overdue: true,
  },
  {
    id: "ryder-gratigny",
    tag: "NO DAILY",
    tone: "warn",
    name: "Ryder @ BP Gratigny",
    desc: "No job logs filed · E-Hold $11,500 on Concrete Cutting CO",
    value: "",
    atRisk: true,
    overdue: false,
  },
  {
    id: "lakeside",
    tag: "ON PLAN",
    tone: "good",
    name: "Lakeside Medical Buildout",
    desc: "On schedule · daily log filed · no open holds",
    value: "",
    atRisk: false,
    overdue: false,
  },
  {
    id: "north-ridge",
    tag: "ON PLAN",
    tone: "good",
    name: "North Ridge Clubhouse",
    desc: "On schedule · daily log filed · 2 to-dos this week",
    value: "",
    atRisk: false,
    overdue: false,
  },
];
