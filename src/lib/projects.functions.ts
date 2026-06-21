import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { Json } from "@/integrations/supabase/types";
import {
  computeRollup,
  evaluateWarnings,
  guidanceTargets,
  exposureByCategory,
  exposureAging,
  type Phase,
  type Rollup,
  type Warning,
  type ExposureCategory,
  type ResponsePath,
  type HoldClass,
  type ExposureStatus,
} from "@/lib/ior";

export type COStatus = "Approved" | "Pending" | "Denied";
export type DecisionStatus = "open" | "in_progress" | "resolved" | "overdue";

export interface ProjectRow {
  id: string;
  name: string;
  client: string;
  original_contract: number;
  original_cost_budget: number;
  schedule_variance_weeks: number;
  phase: Phase;
  percent_complete: number;
  hold_variance_note: string;
  last_reviewed_at: string | null;
  next_review_at: string | null;
  forecast_completion_date: string | null;
  baseline_completion_date: string | null;
  last_review_summary: string;
  project_manager: string;
}

export interface ExposureRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  category: ExposureCategory;
  dollar_exposure: number;
  probability: number;
  schedule_impact_weeks: number | null;
  owner: string;
  response_path: ResponsePath;
  release_condition: string;
  hold_class: HoldClass;
  status: ExposureStatus;
  due_date: string | null;
  next_review_at: string | null;
  opened_at: string;
  resolved_at: string | null;
  notes: string;
}

export type COType =
  | "owner_change"
  | "design_error"
  | "design_omission"
  | "unforeseen_condition"
  | "missed_scope"
  | "sub_issued"
  | "other";

export interface ChangeOrderRow {
  id: string;
  project_id: string;
  number: string;
  description: string;
  contract_amount: number;
  cost_amount: number;
  status: COStatus;
  probability: number;
  owner: string;
  notes: string;
  co_type: COType;
}


export interface BucketRow {
  id: string;
  project_id: string;
  bucket: string;
  original_budget: number;
  actual_to_date: number;
  ftc: number;
  sort_order: number;
}

export interface DecisionRow {
  id: string;
  project_id: string;
  decision: string;
  impact: string;
  owner: string;
  due_date: string | null;
  status: DecisionStatus;
  linked_exposure_id: string | null;
  linked_co_id: string | null;
  notes: string;
}

export interface ReviewRow {
  id: string;
  project_id: string;
  reviewed_at: string;
  reviewer: string;
  forecast_completion_date_before: string | null;
  forecast_completion_date_after: string | null;
  summary_notes: string;
  body_markdown: string;
  status: string;
  email_recipients: string[];
  pdf_style: string;
  kpi_snapshot: Json;
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

const normalizeProject = (p: Record<string, unknown>): ProjectRow => ({
  id: p.id as string,
  name: p.name as string,
  client: str(p.client),
  original_contract: num(p.original_contract),
  original_cost_budget: num(p.original_cost_budget),
  schedule_variance_weeks: num(p.schedule_variance_weeks),
  phase: (p.phase as Phase) ?? "Early",
  percent_complete: num(p.percent_complete),
  hold_variance_note: str(p.hold_variance_note),
  last_reviewed_at: (p.last_reviewed_at as string | null) ?? null,
  next_review_at: (p.next_review_at as string | null) ?? null,
  forecast_completion_date: (p.forecast_completion_date as string | null) ?? null,
  baseline_completion_date: (p.baseline_completion_date as string | null) ?? null,
  last_review_summary: str(p.last_review_summary),
  project_manager: str(p.project_manager),
});

const normalizeExposure = (e: Record<string, unknown>): ExposureRow => ({
  id: e.id as string,
  project_id: e.project_id as string,
  title: str(e.title),
  description: str(e.description),
  category: (e.category as ExposureCategory) ?? "other",
  dollar_exposure: num(e.dollar_exposure),
  probability: num(e.probability),
  schedule_impact_weeks: e.schedule_impact_weeks == null ? null : num(e.schedule_impact_weeks),
  owner: str(e.owner),
  response_path: (e.response_path as ResponsePath) ?? "accept",
  release_condition: str(e.release_condition),
  hold_class: (e.hold_class as HoldClass) ?? "E-Hold",
  status: (e.status as ExposureStatus) ?? "active",
  due_date: (e.due_date as string | null) ?? null,
  next_review_at: (e.next_review_at as string | null) ?? null,
  opened_at: str(e.opened_at, new Date().toISOString()),
  resolved_at: (e.resolved_at as string | null) ?? null,
  notes: str(e.notes),
});

// ---------------- LIST + GET ----------------

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: rawProjects, error } = await context.supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const projects = (rawProjects ?? []).map(normalizeProject);
    const ids = projects.map((p) => p.id);
    if (ids.length === 0) return [];

    const [expRes, cosRes, bucketsRes] = await Promise.all([
      context.supabase
        .from("exposures")
        .select("project_id,category,dollar_exposure,probability,hold_class,status,response_path,opened_at,next_review_at")
        .in("project_id", ids),
      context.supabase
        .from("change_orders")
        .select("project_id,contract_amount,cost_amount,status,probability")
        .in("project_id", ids),
      context.supabase
        .from("cost_buckets")
        .select("project_id,bucket,original_budget,actual_to_date,ftc")
        .in("project_id", ids),
    ]);
    if (expRes.error) throw new Error(expRes.error.message);
    if (cosRes.error) throw new Error(cosRes.error.message);
    if (bucketsRes.error) throw new Error(bucketsRes.error.message);

    type Keyed = { project_id: string };
    const groupBy = <T extends Keyed>(rows: readonly unknown[]): Record<string, T[]> => {
      const m: Record<string, T[]> = {};
      for (const r of rows as T[]) (m[r.project_id] ||= []).push(r);
      return m;
    };
    const eByP = groupBy<{ project_id: string } & Record<string, unknown>>(expRes.data ?? []);
    const cByP = groupBy<{ project_id: string } & Record<string, unknown>>(cosRes.data ?? []);
    const bByP = groupBy<{ project_id: string } & Record<string, unknown>>(bucketsRes.data ?? []);

    return projects.map((p) => {
      const exposures = (eByP[p.id] ?? []).map((e) => ({
        category: (e.category as ExposureCategory) ?? "other",
        dollar_exposure: num(e.dollar_exposure),
        probability: num(e.probability),
        hold_class: (e.hold_class as HoldClass) ?? "E-Hold",
        status: (e.status as ExposureStatus) ?? "active",
        response_path: (e.response_path as ResponsePath) ?? "accept",
        opened_at: (e.opened_at as string | null) ?? null,
        next_review_at: (e.next_review_at as string | null) ?? null,
      }));
      const cos = (cByP[p.id] ?? []).map((c) => ({
        contract_amount: num(c.contract_amount),
        cost_amount: num(c.cost_amount),
        status: (c.status as COStatus) ?? "Pending",
        probability: num(c.probability),
      }));
      const buckets = (bByP[p.id] ?? []).map((b) => ({
        bucket: str(b.bucket),
        original_budget: num(b.original_budget),
        actual_to_date: num(b.actual_to_date),
        ftc: num(b.ftc),
      }));
      const r = computeRollup(p, buckets, cos, exposures);
      const warnings = evaluateWarnings(p, buckets, cos, exposures, r);
      const lastReview = p.last_reviewed_at ? new Date(p.last_reviewed_at).getTime() : null;
      const daysSinceReview = lastReview
        ? Math.floor((Date.now() - lastReview) / 86400000)
        : null;
      const topCat = exposureByCategory(exposures)[0]?.category ?? null;
      const activeScheduleRiskCount = exposures.filter(
        (e) =>
          (e.status === "active" || e.status === "escalated") &&
          (e.category === "schedule_compression" ||
            e.category === "procurement" ||
            e.category === "owner_decision"),
      ).length;
      return {
        id: p.id,
        name: p.name,
        client: p.client,
        phase: p.phase,
        percent_complete: p.percent_complete,
        schedule_variance_weeks: p.schedule_variance_weeks,
        original_contract: p.original_contract,
        forecasted_final_contract: r.forecastedFinalContract,
        indicated_gp: r.indicatedGP,
        indicated_gp_pct: r.indicatedGPpct,
        original_gp_pct: r.originalGPpct,
        gp_at_risk: r.gpAtRisk,
        exposure_holds: r.exposureHolds,
        contingency_hold: r.contingencyHold,
        risk_allocated: r.exposureHolds + r.contingencyHold,
        schedule_risk_count: activeScheduleRiskCount,
        warning_count: warnings.length,
        days_since_review: daysSinceReview,
        top_category: topCat,
      };
    });
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const pid = data.projectId;
    const [pRes, eRes, cRes, bRes, dRes, rRes] = await Promise.all([
      context.supabase.from("projects").select("*").eq("id", pid).maybeSingle(),
      context.supabase.from("exposures").select("*").eq("project_id", pid).order("opened_at", { ascending: false }),
      context.supabase.from("change_orders").select("*").eq("project_id", pid).order("number"),
      context.supabase.from("cost_buckets").select("*").eq("project_id", pid).order("sort_order"),
      context.supabase.from("decisions").select("*").eq("project_id", pid).order("due_date", { ascending: true, nullsFirst: false }),
      context.supabase.from("reviews").select("*").eq("project_id", pid).order("reviewed_at", { ascending: false }).limit(10),
    ]);
    if (pRes.error) throw new Error(pRes.error.message);
    if (!pRes.data) throw new Error("Project not found");
    if (eRes.error) throw new Error(eRes.error.message);
    if (cRes.error) throw new Error(cRes.error.message);
    if (bRes.error) throw new Error(bRes.error.message);
    if (dRes.error) throw new Error(dRes.error.message);
    if (rRes.error) throw new Error(rRes.error.message);

    const project = normalizeProject(pRes.data as Record<string, unknown>);
    const exposures: ExposureRow[] = (eRes.data ?? []).map((r) =>
      normalizeExposure(r as Record<string, unknown>),
    );
    const changeOrders: ChangeOrderRow[] = (cRes.data ?? []).map((c) => {
      const o = c as Record<string, unknown>;
      return {
        id: o.id as string,
        project_id: o.project_id as string,
        number: str(o.number),
        description: str(o.description),
        contract_amount: num(o.contract_amount),
        cost_amount: num(o.cost_amount),
        status: (o.status as COStatus) ?? "Pending",
        probability: num(o.probability),
        owner: str(o.owner),
        notes: str(o.notes),
        co_type: (str(o.co_type, "other") as COType),
      };
    });

    const buckets: BucketRow[] = (bRes.data ?? []).map((b) => {
      const o = b as Record<string, unknown>;
      return {
        id: o.id as string,
        project_id: o.project_id as string,
        bucket: str(o.bucket),
        original_budget: num(o.original_budget),
        actual_to_date: num(o.actual_to_date),
        ftc: num(o.ftc),
        sort_order: num(o.sort_order),
      };
    });
    const decisions: DecisionRow[] = (dRes.data ?? []).map((d) => {
      const o = d as Record<string, unknown>;
      return {
        id: o.id as string,
        project_id: o.project_id as string,
        decision: str(o.decision),
        impact: str(o.impact),
        owner: str(o.owner),
        due_date: (o.due_date as string | null) ?? null,
        status: (o.status as DecisionStatus) ?? "open",
        linked_exposure_id: (o.linked_exposure_id as string | null) ?? null,
        linked_co_id: (o.linked_co_id as string | null) ?? null,
        notes: str(o.notes),
      };
    });
    const reviews: ReviewRow[] = (rRes.data ?? []).map((r) => {
      const o = r as Record<string, unknown>;
      return {
        id: o.id as string,
        project_id: o.project_id as string,
        reviewed_at: str(o.reviewed_at),
        reviewer: str(o.reviewer),
        forecast_completion_date_before: (o.forecast_completion_date_before as string | null) ?? null,
        forecast_completion_date_after: (o.forecast_completion_date_after as string | null) ?? null,
        summary_notes: str(o.summary_notes),
        body_markdown: str(o.body_markdown),
        status: str(o.status, "published"),
        email_recipients: Array.isArray(o.email_recipients) ? (o.email_recipients as string[]) : [],
        pdf_style: str(o.pdf_style, "executive"),
        kpi_snapshot: (o.kpi_snapshot ?? {}) as Json,
      };
    });

    const rollup: Rollup = computeRollup(project, buckets, changeOrders, exposures);
    const guidance = guidanceTargets(project.phase, rollup.remainingCost);
    const warnings: Warning[] = evaluateWarnings(project, buckets, changeOrders, exposures, rollup);
    const byCategory = exposureByCategory(exposures);
    const aging = exposureAging(exposures);

    return {
      project,
      exposures,
      changeOrders,
      buckets,
      decisions,
      reviews,
      rollup,
      guidance,
      warnings,
      byCategory,
      aging,
    };
  });

// ---------------- PROJECT CRUD ----------------

const DEFAULT_BUCKETS = ["Sitework", "Structure", "Envelope", "MEP", "Finishes", "GC/OH"];

const createProjectInput = z.object({
  name: z.string().min(1).max(200),
  client: z.string().max(200).default(""),
  original_contract: z.number().min(0),
  original_cost_budget: z.number().min(0),
});

export const createProject = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => createProjectInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("projects")
      .insert({
        owner_id: context.userId,
        name: data.name,
        client: data.client,
        original_contract: data.original_contract,
        original_cost_budget: data.original_cost_budget,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    const per = data.original_cost_budget / DEFAULT_BUCKETS.length;
    const { error: bErr } = await context.supabase.from("cost_buckets").insert(
      DEFAULT_BUCKETS.map((bucket, i) => ({
        project_id: row.id,
        bucket,
        original_budget: per,
        actual_to_date: 0,
        ftc: per,
        sort_order: i + 1,
      })),
    );
    if (bErr) throw new Error(bErr.message);

    return { id: row.id };
  });

const updateFinancialsInput = z.object({
  projectId: z.string().uuid(),
  patch: z.object({
    name: z.string().min(1).max(200).optional(),
    client: z.string().max(200).optional(),
    original_contract: z.number().min(0).optional(),
    original_cost_budget: z.number().min(0).optional(),
    schedule_variance_weeks: z.number().int().optional(),
    phase: z.enum(["Early", "Middle", "Late"]).optional(),
    percent_complete: z.number().min(0).max(100).optional(),
    hold_variance_note: z.string().max(2000).optional(),
    forecast_completion_date: z.string().optional().nullable(),
    baseline_completion_date: z.string().optional().nullable(),
    last_review_summary: z.string().max(4000).optional(),
    project_manager: z.string().max(200).optional(),
  }),
});

export const updateProjectFinancials = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => updateFinancialsInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("projects")
      .update(data.patch)
      .eq("id", data.projectId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- EXPOSURES ----------------

const EXPOSURE_CATEGORIES = [
  "owner_decision","design_drift","trade_performance","procurement",
  "schedule_compression","allowance_overrun","field_change","closeout_punch","other",
] as const;
const RESPONSE_PATHS = ["eliminate", "recover", "offset", "accept"] as const;
const HOLD_CLASSES = ["E-Hold", "C-Hold", "Both", "None"] as const;
const EXPOSURE_STATUSES = ["active","escalated","recovered","eliminated","accepted","released"] as const;

const exposureInput = z.object({
  title: z.string().min(1).max(200),
  description: z.string().max(2000).default(""),
  category: z.enum(EXPOSURE_CATEGORIES).default("other"),
  dollar_exposure: z.number().min(0),
  probability: z.number().min(0).max(100).default(100),
  schedule_impact_weeks: z.number().nullable().optional(),
  owner: z.string().max(200).default(""),
  response_path: z.enum(RESPONSE_PATHS),
  release_condition: z.string().max(500).default(""),
  hold_class: z.enum(HOLD_CLASSES).default("E-Hold"),
  status: z.enum(EXPOSURE_STATUSES).default("active"),
  due_date: z.string().nullable().optional(),
  next_review_at: z.string().nullable().optional(),
  notes: z.string().max(2000).default(""),
});

export const createExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string } & z.input<typeof exposureInput>) =>
    z.object({ projectId: z.string().uuid() }).merge(exposureInput).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const { error } = await context.supabase
      .from("exposures")
      .insert({ project_id: projectId, ...rest });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string } & Partial<z.input<typeof exposureInput>>) =>
    z.object({ id: z.string().uuid() }).merge(exposureInput.partial()).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("exposures").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteExposure = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("exposures").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- CHANGE ORDERS ----------------

const CO_TYPES = [
  "owner_change","design_error","design_omission","unforeseen_condition",
  "missed_scope","sub_issued","other",
] as const;

const coInput = z.object({
  number: z.string().max(50).default(""),
  description: z.string().min(1).max(500),
  contract_amount: z.number(),
  cost_amount: z.number(),
  status: z.enum(["Approved", "Pending", "Denied"]).default("Pending"),
  probability: z.number().min(0).max(100).default(100),
  owner: z.string().max(200).default(""),
  notes: z.string().max(2000).default(""),
  co_type: z.enum(CO_TYPES).default("other"),
});


export const createChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string } & z.input<typeof coInput>) =>
    z.object({ projectId: z.string().uuid() }).merge(coInput).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const { error } = await context.supabase
      .from("change_orders")
      .insert({ project_id: projectId, ...rest });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string } & Partial<z.input<typeof coInput>>) =>
    z.object({ id: z.string().uuid() }).merge(coInput.partial()).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("change_orders").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteChangeOrder = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("change_orders").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- COST BUCKETS ----------------

const bucketInput = z.object({
  id: z.string().uuid(),
  patch: z.object({
    bucket: z.string().min(1).max(100).optional(),
    original_budget: z.number().min(0).optional(),
    actual_to_date: z.number().min(0).optional(),
    ftc: z.number().min(0).optional(),
  }),
});

export const updateBucket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => bucketInput.parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("cost_buckets")
      .update(data.patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

const createBucketInput = z.object({
  projectId: z.string().uuid(),
  bucket: z.string().min(1).max(100),
  original_budget: z.number().min(0).default(0),
  actual_to_date: z.number().min(0).default(0),
  ftc: z.number().min(0).default(0),
});

export const createBucket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof createBucketInput>) => createBucketInput.parse(input))
  .handler(async ({ data, context }) => {
    const { data: last } = await context.supabase
      .from("cost_buckets")
      .select("sort_order")
      .eq("project_id", data.projectId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sort_order = ((last?.sort_order as number | undefined) ?? 0) + 1;
    const { error } = await context.supabase.from("cost_buckets").insert({
      project_id: data.projectId,
      bucket: data.bucket,
      original_budget: data.original_budget,
      actual_to_date: data.actual_to_date,
      ftc: data.ftc,
      sort_order,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteBucket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("cost_buckets").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- DECISIONS ----------------

const DECISION_STATUSES = ["open", "in_progress", "resolved", "overdue"] as const;

const decisionInput = z.object({
  decision: z.string().min(1).max(500),
  impact: z.string().max(500).default(""),
  owner: z.string().max(200).default(""),
  due_date: z.string().nullable().optional(),
  status: z.enum(DECISION_STATUSES).default("open"),
  linked_exposure_id: z.string().uuid().nullable().optional(),
  linked_co_id: z.string().uuid().nullable().optional(),
  notes: z.string().max(2000).default(""),
});

export const createDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string } & z.input<typeof decisionInput>) =>
    z.object({ projectId: z.string().uuid() }).merge(decisionInput).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const { error } = await context.supabase
      .from("decisions")
      .insert({ project_id: projectId, ...rest });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string } & Partial<z.input<typeof decisionInput>>) =>
    z.object({ id: z.string().uuid() }).merge(decisionInput.partial()).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("decisions").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteDecision = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("decisions").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- REVIEWS ----------------

const submitReviewInput = z.object({
  projectId: z.string().uuid(),
  reviewer: z.string().max(200).default(""),
  forecast_completion_date_before: z.string().nullable().optional(),
  forecast_completion_date_after: z.string().nullable().optional(),
  summary_notes: z.string().max(4000).default(""),
  body_markdown: z.string().max(20000).default(""),
  pdf_style: z.enum(["executive", "structured"]).default("executive"),
  email_recipients: z.array(z.string().email().max(254)).max(20).default([]),
  kpi_snapshot: z.record(z.string(), z.unknown()).default({}),
});

export const submitReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof submitReviewInput>) =>
    submitReviewInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: inserted, error } = await context.supabase.from("reviews").insert({
      project_id: data.projectId,
      reviewer: data.reviewer,
      forecast_completion_date_before: data.forecast_completion_date_before ?? null,
      forecast_completion_date_after: data.forecast_completion_date_after ?? null,
      summary_notes: data.summary_notes,
      body_markdown: data.body_markdown,
      pdf_style: data.pdf_style,
      email_recipients: data.email_recipients,
      kpi_snapshot: data.kpi_snapshot as Json,
      status: "published",
    }).select("id").single();
    if (error) throw new Error(error.message);

    const patch: {
      last_reviewed_at: string;
      last_review_summary: string;
      forecast_completion_date?: string;
    } = {
      last_reviewed_at: new Date().toISOString(),
      last_review_summary: data.summary_notes,
    };
    if (data.forecast_completion_date_after) {
      patch.forecast_completion_date = data.forecast_completion_date_after;
    }
    const { error: pErr } = await context.supabase
      .from("projects")
      .update(patch)
      .eq("id", data.projectId);
    if (pErr) throw new Error(pErr.message);

    return { ok: true, reviewId: inserted.id };
  });

const updateReviewInput = z.object({
  id: z.string().uuid(),
  patch: z.object({
    body_markdown: z.string().max(20000).optional(),
    status: z.enum(["draft", "published"]).optional(),
    email_recipients: z.array(z.string().email().max(254)).max(20).optional(),
    pdf_style: z.enum(["executive", "structured"]).optional(),
  }),
});

export const updateReview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateReviewInput>) =>
    updateReviewInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("reviews")
      .update(data.patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- SOV IMPORT ----------------

const importBucketRow = z.object({
  bucket: z.string().min(1).max(200),
  original_budget: z.number().min(0),
  actual_to_date: z.number().min(0),
  ftc: z.number().min(0),
  sort_order: z.number().int().min(0),
});

const importInput = z.object({
  projectId: z.string().uuid(),
  mode: z.enum(["replace", "append"]).default("replace"),
  rows: z.array(importBucketRow).min(1).max(500),
});

export const importCostBuckets = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof importInput>) => importInput.parse(input))
  .handler(async ({ data, context }) => {
    if (data.mode === "replace") {
      const { error: delErr } = await context.supabase
        .from("cost_buckets")
        .delete()
        .eq("project_id", data.projectId);
      if (delErr) throw new Error(delErr.message);
    }
    const baseOrder =
      data.mode === "append"
        ? await context.supabase
            .from("cost_buckets")
            .select("sort_order")
            .eq("project_id", data.projectId)
            .order("sort_order", { ascending: false })
            .limit(1)
            .maybeSingle()
            .then((res) => (res.data?.sort_order ?? 0) as number)
        : 0;

    const insertRows = data.rows.map((r, i) => ({
      project_id: data.projectId,
      bucket: r.bucket,
      original_budget: r.original_budget,
      actual_to_date: r.actual_to_date,
      ftc: r.ftc,
      sort_order: baseOrder + i + 1,
    }));
    const { error } = await context.supabase.from("cost_buckets").insert(insertRows);
    if (error) throw new Error(error.message);

    // Treat the imported SOV as the source of truth for the project's
    // Original Cost Budget so Day-1 GP At Risk is $0. We use forecasted cost
    // (actual + FTC), not scheduled value, because forecasted cost is what
    // rolls into Indicated GP — anchoring Original to the same number means
    // any future drift shows up as real margin erosion.
    const { data: allBuckets, error: sumErr } = await context.supabase
      .from("cost_buckets")
      .select("actual_to_date, ftc")
      .eq("project_id", data.projectId);
    if (sumErr) throw new Error(sumErr.message);
    const total = (allBuckets ?? []).reduce(
      (s, b) => s + Number(b.actual_to_date ?? 0) + Number(b.ftc ?? 0),
      0,
    );
    const { error: updErr } = await context.supabase
      .from("projects")
      .update({ original_cost_budget: total })
      .eq("id", data.projectId);
    if (updErr) throw new Error(updErr.message);

    return { ok: true, inserted: insertRows.length, originalCostBudget: total };
  });

// ---------------- DEMO SEED (no-op if any project exists) ----------------
// The DB trigger seeds a demo project on user creation; this fn is kept
// for parity with old call sites and just reports state.

export const seedDemoIfEmpty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count, error: cErr } = await context.supabase
      .from("projects")
      .select("id", { count: "exact", head: true });
    if (cErr) throw new Error(cErr.message);
    return { seeded: false as const, exists: (count ?? 0) > 0 };
  });
