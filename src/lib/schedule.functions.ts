import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { HoldClass, ResponsePath } from "@/lib/ior";

export type MilestoneStatus = "on_track" | "at_risk" | "delayed" | "complete";
export type ScheduleRiskKind = "procurement" | "trade_performance" | "critical_decision";

export interface MilestoneRow {
  id: string;
  project_id: string;
  name: string;
  baseline_date: string | null;
  forecast_date: string | null;
  status: MilestoneStatus;
  delay_reason: string;
  owner: string;
  sort_order: number;
}

export interface ScheduleRiskRow {
  id: string;
  project_id: string;
  kind: ScheduleRiskKind;
  title: string;
  detail: string;
  dollar_exposure: number;
  probability: number;
  schedule_impact_weeks: number | null;
  owner: string;
  due_date: string | null;
  response_path: ResponsePath;
  hold_class: HoldClass;
  linked_exposure_id: string | null;
  sort_order: number;
}

const MILESTONE_STATUSES = ["on_track", "at_risk", "delayed", "complete"] as const;
const RISK_KINDS = ["procurement", "trade_performance", "critical_decision"] as const;
const RESPONSE_PATHS = ["eliminate", "recover", "offset", "accept"] as const;
const HOLD_CLASSES = ["E-Hold", "C-Hold", "Both", "None"] as const;

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);

const normalizeScheduleRisk = (r: Record<string, unknown>): ScheduleRiskRow => ({
  id: r.id as string,
  project_id: r.project_id as string,
  kind: str(r.kind, "critical_decision") as ScheduleRiskKind,
  title: str(r.title),
  detail: str(r.detail),
  dollar_exposure: num(r.dollar_exposure),
  probability: r.probability == null ? 100 : num(r.probability),
  schedule_impact_weeks: r.schedule_impact_weeks == null ? null : num(r.schedule_impact_weeks),
  owner: str(r.owner),
  due_date: (r.due_date as string | null) ?? null,
  response_path: str(r.response_path, "recover") as ResponsePath,
  hold_class: str(r.hold_class, "E-Hold") as HoldClass,
  linked_exposure_id: (r.linked_exposure_id as string | null) ?? null,
  sort_order: num(r.sort_order),
});

// ---------- LIST ----------
export const listSchedule = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const [mRes, rRes] = await Promise.all([
      context.supabase
        .from("schedule_milestones")
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order"),
      context.supabase
        .from("schedule_risks")
        .select("*")
        .eq("project_id", data.projectId)
        .order("sort_order"),
    ]);
    if (mRes.error) throw new Error(mRes.error.message);
    if (rRes.error) throw new Error(rRes.error.message);
    return {
      milestones: (mRes.data ?? []) as unknown as MilestoneRow[],
      risks: (rRes.data ?? []).map((r) => normalizeScheduleRisk(r as Record<string, unknown>)),
    };
  });

// ---------- MILESTONES ----------
const milestonePatch = z.object({
  name: z.string().min(1).max(200).optional(),
  baseline_date: z.string().nullable().optional(),
  forecast_date: z.string().nullable().optional(),
  status: z.enum(MILESTONE_STATUSES).optional(),
  delay_reason: z.string().max(2000).optional(),
  owner: z.string().max(200).optional(),
  sort_order: z.number().int().optional(),
});

export const createMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string; name: string }) =>
    z.object({ projectId: z.string().uuid(), name: z.string().min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: last } = await context.supabase
      .from("schedule_milestones")
      .select("sort_order")
      .eq("project_id", data.projectId)
      .order("sort_order", { ascending: false })
      .limit(1)
      .maybeSingle();
    const sort_order = ((last?.sort_order as number | undefined) ?? 0) + 1;
    const { error } = await context.supabase.from("schedule_milestones").insert({
      project_id: data.projectId,
      name: data.name,
      sort_order,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; patch: z.input<typeof milestonePatch> }) =>
    z.object({ id: z.string().uuid(), patch: milestonePatch }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("schedule_milestones")
      .update(data.patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteMilestone = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("schedule_milestones").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

// ---------- RISKS ----------
const riskPatch = z.object({
  title: z.string().min(1).max(200).optional(),
  detail: z.string().max(2000).optional(),
  kind: z.enum(RISK_KINDS).optional(),
  dollar_exposure: z.number().min(0).optional(),
  probability: z.number().min(0).max(100).optional(),
  schedule_impact_weeks: z.number().nullable().optional(),
  owner: z.string().max(200).optional(),
  due_date: z.string().nullable().optional(),
  response_path: z.enum(RESPONSE_PATHS).optional(),
  hold_class: z.enum(HOLD_CLASSES).optional(),
  linked_exposure_id: z.string().uuid().nullable().optional(),
  sort_order: z.number().int().optional(),
});

export const createScheduleRisk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(
    (
      input: { projectId: string; kind: ScheduleRiskKind; title: string } & Partial<
        z.input<typeof riskPatch>
      >,
    ) =>
      z
        .object({
          projectId: z.string().uuid(),
          kind: z.enum(RISK_KINDS),
          title: z.string().min(1).max(200),
        })
        .merge(riskPatch.omit({ kind: true, title: true }).partial())
        .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { projectId, ...rest } = data;
    const { error } = await context.supabase.from("schedule_risks").insert({
      project_id: projectId,
      ...rest,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const updateScheduleRisk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string; patch: z.input<typeof riskPatch> }) =>
    z.object({ id: z.string().uuid(), patch: riskPatch }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("schedule_risks")
      .update(data.patch)
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const deleteScheduleRisk = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase.from("schedule_risks").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
