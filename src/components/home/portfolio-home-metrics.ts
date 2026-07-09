// Phase 2b: turn real projects + CRM opportunities into the 6a home view-model.
// The aggregation mirrors the existing portfolio (statusFor / buildPortfolioTotals
// / buildPortfolioCrmTotals in index.tsx) so the home's numbers match the page it
// will replace. Pure module — no React, no side effects.
import type { listProjects } from "@/lib/projects.functions";
import type {
  PipelineCrmSnapshot,
  PipelineOpportunityRow,
  PipelineStage,
} from "@/lib/pipeline.functions";
import type {
  HeroStat,
  PipelineStage as StageCard,
  PostureTile,
  Pursuit,
  WorklistJob,
} from "./portfolio-home-data";

type HomeProject = Awaited<ReturnType<typeof listProjects>>[number];

export type HomeMetrics = {
  ownerAlert: { kicker: string; body: string };
  ownerStats: HeroStat[];
  pipeline: StageCard[];
  handoffName: string | null;
  posture: PostureTile[];
  worklist: WorklistJob[];
  pursuits: Pursuit[];
  pmAlert: { kicker: string; body: string };
  pmStats: HeroStat[];
  pmJobs: WorklistJob[];
  isEmpty: boolean;
};

// ---- formatting -------------------------------------------------------------
function compactUSD(n: number): string {
  const value = Number.isFinite(n) ? n : 0;
  const abs = Math.abs(value);
  if (abs >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `$${Math.round(value / 1_000)}K`;
  return `$${Math.round(value)}`;
}
function pct(n: number, digits = 0): string {
  return `${(Number.isFinite(n) ? n : 0).toFixed(digits)}%`;
}
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}
function shortDate(value: string | null): string {
  if (!value) return "";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
function isPast(value: string | null): boolean {
  if (!value) return false;
  const t = new Date(`${value}T00:00:00`).getTime();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return !Number.isNaN(t) && t < today.getTime();
}

// ---- classification (mirrors index.tsx statusFor / scheduleFor / dailyReportFor)
function riskLabel(originalPct: number, indicatedPct: number): "At Risk" | "Watch" | "Aligned" {
  const erosion = originalPct - indicatedPct;
  if (erosion >= 5) return "At Risk";
  if (erosion >= 2) return "Watch";
  return "Aligned";
}
function scheduleSlipped(weeks: number, riskCount: number): "Slipped" | "Watch" | "On plan" {
  const slip = Math.max(0, weeks);
  const score = Math.max(0, Math.min(100, 100 - slip * 8 - riskCount * 6));
  if (slip >= 4 || score < 65) return "Slipped";
  if (slip > 0 || riskCount > 0) return "Watch";
  return "On plan";
}
function dailyLabel(count: number, daysSince: number | null): "None" | "Stale" | "Current" {
  if (count === 0 || daysSince === null) return "None";
  if (daysSince > 7) return "Stale";
  return "Current";
}

// ---- worklist row -----------------------------------------------------------
function toJob(p: HomeProject): WorklistJob {
  const risk = riskLabel(p.original_gp_pct, p.indicated_gp_pct);
  const sched = scheduleSlipped(p.schedule_variance_weeks, p.schedule_risk_count);
  const daily = dailyLabel(p.daily_report_count, p.days_since_daily_report);
  const overdue = p.overdue_decision_count > 0;
  const atRisk = risk === "At Risk" || risk === "Watch" || sched === "Slipped";

  let tag = "ON PLAN";
  let tone: WorklistJob["tone"] = "good";
  if (risk === "At Risk") {
    tag = "AT RISK";
    tone = "crit";
  } else if (overdue) {
    tag = `${p.overdue_decision_count} OVERDUE`;
    tone = "crit";
  } else if (sched === "Slipped") {
    tag = "SLIPPED";
    tone = "crit";
  } else if (daily === "Stale") {
    tag = "STALE LOG";
    tone = "warn";
  } else if (daily === "None") {
    tag = "NO DAILY";
    tone = "warn";
  } else if (risk === "Watch" || sched === "Watch") {
    tag = "WATCH";
    tone = "warn";
  }

  const bits: string[] = [];
  if (p.gp_at_risk > 0) bits.push(`GP at risk ${compactUSD(p.gp_at_risk)}`);
  if (overdue) bits.push(plural(p.overdue_decision_count, "overdue decision"));
  if (sched === "Slipped") bits.push(`${p.schedule_variance_weeks} wk behind`);
  if (daily === "None") bits.push("no daily log filed");
  else if (daily === "Stale") bits.push("daily log stale");
  const desc = bits.slice(0, 2).join(" · ") || "On schedule · no open holds";

  const value = p.gp_at_risk > 0 ? compactUSD(p.gp_at_risk) : tone === "good" ? "On plan" : "";

  return { id: p.id, tag, tone, name: p.name, desc, value, atRisk, overdue };
}

// severity for sorting: crit worst, then warn, then good; tie-break by GP at risk.
function severity(job: WorklistJob): number {
  return job.tone === "crit" ? 0 : job.tone === "warn" ? 1 : 2;
}

// ---- pipeline ---------------------------------------------------------------
const DISPLAY_STAGES: PipelineStage[] = [
  "lead",
  "qualifying",
  "estimating",
  "bid_submitted",
  "negotiating",
  "won",
];
const STAGE_LABEL: Record<string, string> = {
  lead: "Lead",
  qualifying: "Qualifying",
  estimating: "Estimating",
  bid_submitted: "Bid submitted",
  negotiating: "Negotiating",
  won: "Won →",
};

export function buildHomeMetrics(
  projects: HomeProject[],
  opportunities: PipelineOpportunityRow[],
  snapshot: PipelineCrmSnapshot | null,
): HomeMetrics {
  // ---- project aggregates (mirror buildPortfolioTotals) ----
  const sum = (fn: (p: HomeProject) => number) => projects.reduce((t, p) => t + fn(p), 0);
  const indicatedGP = sum((p) => p.indicated_gp);
  const gpAtRisk = sum((p) => p.gp_at_risk);
  const forecastedContract = sum((p) => p.forecasted_final_contract);
  const overdueActions = sum((p) => p.overdue_decision_count);
  const projectCount = projects.length;
  const atRiskCount = projects.filter(
    (p) => riskLabel(p.original_gp_pct, p.indicated_gp_pct) === "At Risk",
  ).length;
  const slippedCount = projects.filter(
    (p) => p.schedule_variance_weeks > 0 || p.schedule_risk_count > 0,
  ).length;
  const jobsWaiting = projects.filter((p) => p.overdue_decision_count > 0).length;
  const logsDue = projects.filter(
    (p) => dailyLabel(p.daily_report_count, p.days_since_daily_report) !== "Current",
  ).length;
  const indicatedPct = forecastedContract ? (indicatedGP / forecastedContract) * 100 : 0;
  const gpAtRiskPct = indicatedGP + gpAtRisk > 0 ? (gpAtRisk / (indicatedGP + gpAtRisk)) * 100 : 0;

  // ---- CRM aggregates (mirror buildPortfolioCrmTotals) ----
  const activeOpps = opportunities.filter(
    (o) => !o.archived && o.stage !== "won" && o.stage !== "lost" && o.stage !== "no_bid",
  );
  const weighted = activeOpps.reduce((t, o) => t + o.estimated_contract * (o.probability / 100), 0);
  const wonOpps = opportunities.filter((o) => o.stage === "won");
  const openActions = snapshot?.openActions ?? [];
  const pursuitsWaiting = openActions.filter((a) => isPast(a.due_date)).length;

  // ---- worklist ---- (all jobs, worst-first; not capped, so the posture-tile
  // filter counts match the rows shown)
  const allJobs = projects.map(toJob).sort((a, b) => severity(a) - severity(b));
  const worklist = allJobs;
  const pmJobs = allJobs;

  // ---- pipeline cards ----
  const pipeline: StageCard[] = DISPLAY_STAGES.map((stage) => {
    const opps = opportunities.filter((o) => !o.archived && o.stage === stage);
    const top = [...opps].sort(
      (a, b) =>
        b.estimated_contract * (b.probability / 100) - a.estimated_contract * (a.probability / 100),
    )[0];
    const isWon = stage === "won";
    return {
      key: stage,
      label: STAGE_LABEL[stage] ?? stage,
      count: opps.length,
      name: top?.name,
      meta: top
        ? isWon
          ? `${compactUSD(top.estimated_contract)} · converts`
          : `${compactUSD(top.estimated_contract)} · ${Math.round(top.probability)}%`
        : "None open",
      dim: opps.length === 0,
      highlight: stage === "estimating" ? "clay" : isWon ? "good" : undefined,
      estimatesLink: stage === "estimating",
    };
  });

  // ---- pursuits rail ----
  const pursuits: Pursuit[] = [...openActions]
    .sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999"))
    .slice(0, 4)
    .map((a) => ({
      title: a.title || "Follow up",
      due: shortDate(a.due_date) || "—",
      dueTone: isPast(a.due_date) ? "crit" : undefined,
      context: a.opportunity_name || a.account_name || "Pursuit",
    }));

  // ---- hero stats ----
  const ownerStats: HeroStat[] = [
    { label: "Pipeline weighted", value: compactUSD(weighted) },
    { label: "Indicated GP", value: compactUSD(indicatedGP) },
    { label: "Jobs at risk", value: String(atRiskCount), valueTone: "crit" },
    { label: "Overdue actions", value: String(overdueActions), valueTone: "crit" },
  ];
  const pmAttention = projects.filter((p) => {
    const risk = riskLabel(p.original_gp_pct, p.indicated_gp_pct);
    return (
      risk === "At Risk" ||
      risk === "Watch" ||
      p.overdue_decision_count > 0 ||
      dailyLabel(p.daily_report_count, p.days_since_daily_report) !== "Current"
    );
  }).length;
  const pmStats: HeroStat[] = [
    { label: "Your jobs", value: String(projectCount) },
    { label: "At risk", value: String(atRiskCount), valueTone: "crit" },
    { label: "Overdue to-dos", value: String(overdueActions), valueTone: "crit" },
    { label: "Logs due", value: String(logsDue) },
  ];

  // ---- posture tiles ----
  const posture: PostureTile[] = [
    {
      key: "indicated-gp",
      label: "Indicated GP",
      value: compactUSD(indicatedGP),
      sub: pct(indicatedPct, 1),
      subTone: "good",
      variant: "dark",
    },
    {
      key: "gp-at-risk",
      label: "GP at Risk",
      value: compactUSD(gpAtRisk),
      sub: pct(gpAtRiskPct),
      subTone: "crit",
      variant: "dark",
    },
    {
      key: "active",
      label: "Active",
      value: String(projectCount),
      sub: `${slippedCount} delayed`,
      subTone: "muted",
      variant: "filter",
    },
    {
      key: "at-risk",
      label: "At risk",
      value: String(atRiskCount),
      sub: "filter →",
      subTone: "muted",
      variant: "filter",
      labelTone: "crit",
      valueTone: "crit",
    },
    {
      key: "overdue",
      label: "Overdue",
      value: String(overdueActions),
      sub: "filter →",
      subTone: "muted",
      variant: "filter",
      labelTone: "crit",
      valueTone: "crit",
    },
  ];

  const ownerBody =
    pursuitsWaiting + jobsWaiting > 0
      ? `**${plural(pursuitsWaiting, "pursuit")}** and **${plural(jobsWaiting, "job")}** are waiting on a decision.`
      : "You're all caught up — nothing waiting on a decision.";
  const pmBody =
    pmAttention > 0
      ? `**${pmAttention} of your ${projectCount} jobs** need attention.`
      : "All of your jobs are on plan today.";

  return {
    ownerAlert: { kicker: "Needs you", body: ownerBody },
    ownerStats,
    pipeline,
    handoffName: wonOpps.length > 0 ? (wonOpps[0]?.name ?? null) : null,
    posture,
    worklist,
    pursuits,
    pmAlert: { kicker: "Needs you · today", body: pmBody },
    pmStats,
    pmJobs,
    isEmpty: projects.length === 0 && opportunities.length === 0,
  };
}
