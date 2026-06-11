import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  computeRollup,
  evaluateWarnings,
  guidanceTargets,
  type Phase,
  type Rollup,
  type Warning,
} from "@/lib/ior";

export type HoldStatus = "Active" | "Released" | "Escalated";
export type HoldType = "E-Hold" | "C-Hold";
export type COStatus = "Approved" | "Pending" | "Denied";

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
}

export interface HoldRow {
  id: string;
  project_id: string;
  type: HoldType;
  description: string;
  amount: number;
  reason: string;
  owner: string;
  release_condition: string;
  status: HoldStatus;
}

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

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

const normalizeProject = (p: Record<string, unknown>): ProjectRow => ({
  id: p.id as string,
  name: p.name as string,
  client: (p.client as string) ?? "",
  original_contract: num(p.original_contract),
  original_cost_budget: num(p.original_cost_budget),
  schedule_variance_weeks: num(p.schedule_variance_weeks),
  phase: (p.phase as Phase) ?? "Early",
  percent_complete: num(p.percent_complete),
  hold_variance_note: (p.hold_variance_note as string) ?? "",
  last_reviewed_at: (p.last_reviewed_at as string | null) ?? null,
  next_review_at: (p.next_review_at as string | null) ?? null,
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

    const [holdsRes, cosRes, bucketsRes] = await Promise.all([
      context.supabase.from("holds").select("project_id,type,amount,status").in("project_id", ids),
      context.supabase
        .from("change_orders")
        .select("project_id,contract_amount,cost_amount,status,probability")
        .in("project_id", ids),
      context.supabase
        .from("cost_buckets")
        .select("project_id,bucket,original_budget,actual_to_date,ftc")
        .in("project_id", ids),
    ]);
    if (holdsRes.error) throw new Error(holdsRes.error.message);
    if (cosRes.error) throw new Error(cosRes.error.message);
    if (bucketsRes.error) throw new Error(bucketsRes.error.message);

    const groupBy = <T extends { project_id: string }>(rows: T[]) => {
      const m: Record<string, T[]> = {};
      for (const r of rows) (m[r.project_id] ||= []).push(r);
      return m;
    };
    const hByP = groupBy(holdsRes.data ?? []);
    const cByP = groupBy(cosRes.data ?? []);
    const bByP = groupBy(bucketsRes.data ?? []);

    return projects.map((p) => {
      const holds = (hByP[p.id] ?? []).map((h) => ({
        type: h.type as HoldType,
        amount: num(h.amount),
        status: h.status as HoldStatus,
      }));
      const cos = (cByP[p.id] ?? []).map((c) => ({
        contract_amount: num(c.contract_amount),
        cost_amount: num(c.cost_amount),
        status: c.status as COStatus,
        probability: num(c.probability),
      }));
      const buckets = (bByP[p.id] ?? []).map((b) => ({
        bucket: b.bucket as string,
        original_budget: num(b.original_budget),
        actual_to_date: num(b.actual_to_date),
        ftc: num(b.ftc),
      }));
      const r = computeRollup(p, buckets, cos, holds);
      const warnings = evaluateWarnings(p, buckets, cos, r);
      return {
        id: p.id,
        name: p.name,
        client: p.client,
        phase: p.phase,
        original_contract: p.original_contract,
        forecasted_final_contract: r.forecastedFinalContract,
        indicated_gp: r.indicatedGP,
        indicated_gp_pct: r.indicatedGPpct,
        original_gp_pct: r.originalGPpct,
        gp_at_risk: r.gpAtRisk,
        warning_count: warnings.length,
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
    const [pRes, hRes, cRes, bRes] = await Promise.all([
      context.supabase.from("projects").select("*").eq("id", pid).maybeSingle(),
      context.supabase.from("holds").select("*").eq("project_id", pid).order("created_at"),
      context.supabase.from("change_orders").select("*").eq("project_id", pid).order("number"),
      context.supabase.from("cost_buckets").select("*").eq("project_id", pid).order("sort_order"),
    ]);
    if (pRes.error) throw new Error(pRes.error.message);
    if (!pRes.data) throw new Error("Project not found");
    if (hRes.error) throw new Error(hRes.error.message);
    if (cRes.error) throw new Error(cRes.error.message);
    if (bRes.error) throw new Error(bRes.error.message);

    const project = normalizeProject(pRes.data);
    const holds: HoldRow[] = (hRes.data ?? []).map((h) => ({
      ...(h as Record<string, unknown>),
      amount: num((h as Record<string, unknown>).amount),
    })) as unknown as HoldRow[];
    const changeOrders: ChangeOrderRow[] = (cRes.data ?? []).map((c) => ({
      ...(c as Record<string, unknown>),
      contract_amount: num((c as Record<string, unknown>).contract_amount),
      cost_amount: num((c as Record<string, unknown>).cost_amount),
      probability: num((c as Record<string, unknown>).probability),
    })) as unknown as ChangeOrderRow[];
    const buckets: BucketRow[] = (bRes.data ?? []).map((b) => ({
      ...(b as Record<string, unknown>),
      original_budget: num((b as Record<string, unknown>).original_budget),
      actual_to_date: num((b as Record<string, unknown>).actual_to_date),
      ftc: num((b as Record<string, unknown>).ftc),
      sort_order: num((b as Record<string, unknown>).sort_order),
    })) as unknown as BucketRow[];

    const rollup: Rollup = computeRollup(project, buckets, changeOrders, holds);
    const guidance = guidanceTargets(project.phase, rollup.remainingCost);
    const warnings: Warning[] = evaluateWarnings(project, buckets, changeOrders, rollup);

    return { project, holds, changeOrders, buckets, rollup, guidance, warnings };
  });

// ---------------- PROJECT CRUD ----------------

const DEFAULT_BUCKETS = [
  "Sitework",
  "Structure",
  "Envelope",
  "MEP",
  "Finishes",
  "GC/OH",
];

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

    // Seed six empty buckets, distributing original_cost_budget evenly
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

// ---------------- HOLDS ----------------

const holdInput = z.object({
  type: z.enum(["E-Hold", "C-Hold"]),
  description: z.string().min(1).max(500),
  amount: z.number().min(0),
  reason: z.string().max(2000).default(""),
  owner: z.string().max(200).default(""),
  release_condition: z.string().max(500).default(""),
  status: z.enum(["Active", "Released", "Escalated"]).default("Active"),
});

export const createHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string } & z.input<typeof holdInput>) =>
    z.object({ projectId: z.string().uuid() }).merge(holdInput).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const { error } = await context.supabase
      .from("holds")
      .insert({ project_id: projectId, ...rest });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string } & Partial<z.input<typeof holdInput>>) =>
    z.object({ id: z.string().uuid() }).merge(holdInput.partial()).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { id, ...patch } = data;
    const { error } = await context.supabase.from("holds").update(patch).eq("id", id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteHold = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("holds").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------------- CHANGE ORDERS ----------------

const coInput = z.object({
  number: z.string().max(50).default(""),
  description: z.string().min(1).max(500),
  contract_amount: z.number(),
  cost_amount: z.number(),
  status: z.enum(["Approved", "Pending", "Denied"]).default("Pending"),
  probability: z.number().min(0).max(100).default(100),
  owner: z.string().max(200).default(""),
  notes: z.string().max(2000).default(""),
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

// ---------------- DEMO SEED ----------------

export const seedDemoIfEmpty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { count, error: cErr } = await context.supabase
      .from("projects")
      .select("id", { count: "exact", head: true });
    if (cErr) throw new Error(cErr.message);
    if ((count ?? 0) > 0) return { seeded: false as const };

    const { data: project, error: pErr } = await context.supabase
      .from("projects")
      .insert({
        owner_id: context.userId,
        name: "Harbor Residence",
        client: "Private Luxury Residence",
        original_contract: 3200000,
        original_cost_budget: 2720000,
        schedule_variance_weeks: 6,
        phase: "Middle",
        percent_complete: 60,
      })
      .select("id")
      .single();
    if (pErr) throw new Error(pErr.message);

    const pid = project.id;

    const buckets = [
      { bucket: "Sitework", original_budget: 220000, actual_to_date: 215000, ftc: 8000, sort_order: 1 },
      { bucket: "Structure", original_budget: 540000, actual_to_date: 520000, ftc: 35000, sort_order: 2 },
      { bucket: "Envelope", original_budget: 430000, actual_to_date: 300000, ftc: 160000, sort_order: 3 },
      { bucket: "MEP", original_budget: 480000, actual_to_date: 260000, ftc: 240000, sort_order: 4 },
      { bucket: "Finishes", original_budget: 780000, actual_to_date: 180000, ftc: 690000, sort_order: 5 },
      { bucket: "GC/OH", original_budget: 270000, actual_to_date: 150000, ftc: 142000, sort_order: 6 },
    ].map((b) => ({ ...b, project_id: pid }));
    const { error: bErr } = await context.supabase.from("cost_buckets").insert(buckets);
    if (bErr) throw new Error(bErr.message);

    const cos = [
      { number: "CO-001", description: "Owner-requested wine room expansion", contract_amount: 145000, cost_amount: 122000, status: "Approved", probability: 100, owner: "PM" },
      { number: "CO-002", description: "Upgraded primary bath stone package", contract_amount: 65000, cost_amount: 58000, status: "Approved", probability: 100, owner: "PM" },
      { number: "CO-003", description: "Pool equipment relocation", contract_amount: 85000, cost_amount: 72000, status: "Pending", probability: 75, owner: "PM" },
      { number: "CO-004", description: "Outdoor kitchen scope add", contract_amount: 120000, cost_amount: 98000, status: "Pending", probability: 50, owner: "PM" },
    ].map((c) => ({ ...c, project_id: pid }));
    const { error: coErr } = await context.supabase.from("change_orders").insert(cos);
    if (coErr) throw new Error(coErr.message);

    const holds = [
      { type: "E-Hold", description: "Window delivery delay", amount: 18000, reason: "Manufacturer pushed ship date 5 weeks; risk of acceleration cost.", owner: "K. Alvarez", release_condition: "Windows delivered and inspected on site", status: "Active" },
      { type: "E-Hold", description: "Lighting allowance overrun", amount: 22000, reason: "Owner selections trending 30% over allowance.", owner: "M. Chen", release_condition: "Final lighting package signed and POs issued", status: "Active" },
      { type: "E-Hold", description: "Unapproved electrical changes", amount: 9500, reason: "Field changes not yet captured in COs.", owner: "J. Patel", release_condition: "CO package submitted and approved", status: "Escalated" },
      { type: "E-Hold", description: "Weak drywall subcontractor", amount: 15000, reason: "Quality issues may require supplemental crew.", owner: "R. Singh", release_condition: "Punchlist cleared on level 2 hangs", status: "Active" },
      { type: "E-Hold", description: "Late appliance selection", amount: 12000, reason: "Selection delay threatens MEP rough-in sequence.", owner: "K. Alvarez", release_condition: "Appliance package locked & released", status: "Active" },
      { type: "C-Hold", description: "Remaining finish-phase uncertainty", amount: 65000, reason: "General contingency for trim, paint, and closeout variability.", owner: "PM", release_condition: "Substantial completion + punch", status: "Active" },
    ].map((h) => ({ ...h, project_id: pid }));
    const { error: hErr } = await context.supabase.from("holds").insert(holds);
    if (hErr) throw new Error(hErr.message);

    return { seeded: true as const, projectId: pid };
  });
