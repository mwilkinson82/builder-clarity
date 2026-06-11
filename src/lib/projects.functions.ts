import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type HoldStatus = "Active" | "Released" | "Escalated";
export type HoldType = "E-Hold" | "C-Hold";

export interface ProjectRow {
  id: string;
  name: string;
  client: string;
  original_contract: number;
  original_cost_budget: number;
  forecasted_final_contract: number;
  forecasted_final_cost: number;
  approved_cos: number;
  pending_cos: number;
  schedule_variance_weeks: number;
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

const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));

export const listProjects = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: projects, error } = await context.supabase
      .from("projects")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = (projects ?? []).map((p) => p.id);
    let holdsByProject: Record<string, { type: string; amount: number; status: string }[]> = {};
    if (ids.length) {
      const { data: holds, error: hErr } = await context.supabase
        .from("holds")
        .select("project_id,type,amount,status")
        .in("project_id", ids);
      if (hErr) throw new Error(hErr.message);
      for (const h of holds ?? []) {
        (holdsByProject[h.project_id] ||= []).push({
          type: h.type,
          amount: num(h.amount),
          status: h.status,
        });
      }
    }

    return (projects ?? []).map((p) => {
      const hs = holdsByProject[p.id] ?? [];
      const active = hs.filter((h) => h.status !== "Released");
      const exposure = active.filter((h) => h.type === "E-Hold").reduce((s, h) => s + h.amount, 0);
      const contingency = active.filter((h) => h.type === "C-Hold").reduce((s, h) => s + h.amount, 0);
      const ffc = num(p.forecasted_final_contract);
      const fcost = num(p.forecasted_final_cost);
      const gpBefore = ffc - fcost;
      const indicatedGP = gpBefore - exposure - contingency;
      const originalGP = num(p.original_contract) - num(p.original_cost_budget);
      const indicatedPct = ffc > 0 ? (indicatedGP / ffc) * 100 : 0;
      const originalPct = num(p.original_contract) > 0 ? (originalGP / num(p.original_contract)) * 100 : 0;
      const gpAtRisk = originalGP - indicatedGP;
      return {
        id: p.id,
        name: p.name,
        client: p.client,
        original_contract: num(p.original_contract),
        forecasted_final_contract: ffc,
        indicated_gp: indicatedGP,
        indicated_gp_pct: indicatedPct,
        original_gp_pct: originalPct,
        gp_at_risk: gpAtRisk,
      };
    });
  });

export const getProject = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: project, error } = await context.supabase
      .from("projects")
      .select("*")
      .eq("id", data.projectId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!project) throw new Error("Project not found");

    const { data: holds, error: hErr } = await context.supabase
      .from("holds")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: true });
    if (hErr) throw new Error(hErr.message);

    return {
      project: {
        ...project,
        original_contract: num(project.original_contract),
        original_cost_budget: num(project.original_cost_budget),
        forecasted_final_contract: num(project.forecasted_final_contract),
        forecasted_final_cost: num(project.forecasted_final_cost),
        approved_cos: num(project.approved_cos),
        pending_cos: num(project.pending_cos),
      } as ProjectRow,
      holds: (holds ?? []).map((h) => ({ ...h, amount: num(h.amount) })) as HoldRow[],
    };
  });

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
        forecasted_final_contract: data.original_contract,
        forecasted_final_cost: data.original_cost_budget,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    return { id: row.id };
  });

const updateFinancialsInput = z.object({
  projectId: z.string().uuid(),
  patch: z.object({
    name: z.string().min(1).max(200).optional(),
    client: z.string().max(200).optional(),
    original_contract: z.number().min(0).optional(),
    original_cost_budget: z.number().min(0).optional(),
    forecasted_final_contract: z.number().min(0).optional(),
    forecasted_final_cost: z.number().min(0).optional(),
    approved_cos: z.number().min(0).optional(),
    pending_cos: z.number().min(0).optional(),
    schedule_variance_weeks: z.number().int().optional(),
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
        forecasted_final_contract: 3545000,
        forecasted_final_cost: 3140000,
        approved_cos: 210000,
        pending_cos: 135000,
        schedule_variance_weeks: 6,
      })
      .select("id")
      .single();
    if (pErr) throw new Error(pErr.message);

    const pid = project.id;
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
