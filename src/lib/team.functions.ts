import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const ACCOUNT_ROLES = [
  "owner",
  "admin",
  "executive",
  "project_manager",
  "member",
  "viewer",
] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export type MemberStatus = "pending" | "active" | "disabled";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface TeamOrganization {
  id: string;
  name: string;
  plan_code: string;
  billing_status: string;
  project_limit: number;
  seat_limit: number;
  storage_limit_mb: number;
  daily_report_limit_per_month: number;
  contractor_circle_grant: boolean;
}

export interface TeamMember {
  id: string;
  organization_id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: AccountRole;
  status: MemberStatus;
  created_at: string;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: AccountRole;
  status: InviteStatus;
  expires_at: string;
  created_at: string;
}

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const bool = (v: unknown) => (typeof v === "boolean" ? v : Boolean(v));

export const getTeamWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: organizationId, error: accountError } = await context.supabase.rpc(
      "ensure_current_user_account",
    );
    if (accountError) throw new Error(accountError.message);
    if (!organizationId) throw new Error("No Overwatch team is available for this user.");

    const [orgRes, membersRes, invitesRes, projectsRes] = await Promise.all([
      context.supabase
        .from("organizations")
        .select(
          "id,name,plan_code,billing_status,project_limit,seat_limit,storage_limit_mb,daily_report_limit_per_month,contractor_circle_grant",
        )
        .eq("id", organizationId)
        .single(),
      context.supabase
        .from("organization_memberships")
        .select("*")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: true }),
      context.supabase
        .from("organization_invites")
        .select("id,email,role,status,expires_at,created_at")
        .eq("organization_id", organizationId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      context.supabase
        .from("projects")
        .select("id")
        .eq("organization_id", organizationId)
        .is("archived_at", null),
    ]);

    if (orgRes.error) throw new Error(orgRes.error.message);
    if (membersRes.error) throw new Error(membersRes.error.message);
    if (invitesRes.error) throw new Error(invitesRes.error.message);
    if (projectsRes.error) throw new Error(projectsRes.error.message);

    const projectIds = (projectsRes.data ?? []).map((p) => p.id as string);
    const dailyReportCountRes =
      projectIds.length === 0
        ? { count: 0, error: null }
        : await context.supabase
            .from("daily_reports")
            .select("id", { count: "exact", head: true })
            .in("project_id", projectIds);
    if (dailyReportCountRes.error) throw new Error(dailyReportCountRes.error.message);

    const memberRows = membersRes.data ?? [];
    const userIds = memberRows.map((m) => m.user_id as string);
    const profilesRes =
      userIds.length === 0
        ? { data: [], error: null }
        : await context.supabase.from("profiles").select("id,email,full_name").in("id", userIds);
    if (profilesRes.error) throw new Error(profilesRes.error.message);

    const profilesById = new Map(
      (profilesRes.data ?? []).map((p) => [
        p.id as string,
        { email: str(p.email), full_name: str(p.full_name) },
      ]),
    );

    const organization: TeamOrganization = {
      id: orgRes.data.id as string,
      name: str(orgRes.data.name),
      plan_code: str(orgRes.data.plan_code),
      billing_status: str(orgRes.data.billing_status),
      project_limit: num(orgRes.data.project_limit),
      seat_limit: num(orgRes.data.seat_limit),
      storage_limit_mb: num(orgRes.data.storage_limit_mb),
      daily_report_limit_per_month: num(orgRes.data.daily_report_limit_per_month),
      contractor_circle_grant: bool(orgRes.data.contractor_circle_grant),
    };

    const members: TeamMember[] = memberRows.map((m) => {
      const profile = profilesById.get(m.user_id as string);
      return {
        id: m.id as string,
        organization_id: m.organization_id as string,
        user_id: m.user_id as string,
        email: profile?.email || str(m.invited_email),
        full_name: profile?.full_name || "",
        role: str(m.role, "member") as AccountRole,
        status: str(m.status, "active") as MemberStatus,
        created_at: str(m.created_at),
      };
    });

    const invites: TeamInvite[] = (invitesRes.data ?? []).map((i) => ({
      id: i.id as string,
      email: str(i.email),
      role: str(i.role, "project_manager") as AccountRole,
      status: str(i.status, "pending") as InviteStatus,
      expires_at: str(i.expires_at),
      created_at: str(i.created_at),
    }));

    return {
      organization,
      members,
      invites,
      usage: {
        projects: projectIds.length,
        activeSeats: members.filter((m) => m.status === "active").length,
        pendingInvites: invites.length,
        dailyReports: dailyReportCountRes.count ?? 0,
      },
    };
  });

const teamInviteInput = z.object({
  email: z.string().email().max(254),
  role: z.enum(ACCOUNT_ROLES).default("project_manager"),
});

export const createTeamInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof teamInviteInput>) => teamInviteInput.parse(input))
  .handler(async ({ data, context }) => {
    const inviteEmail = data.email.trim().toLowerCase();
    const { data: organizationId, error: accountError } = await context.supabase.rpc(
      "ensure_current_user_account",
    );
    if (accountError) throw new Error(accountError.message);
    if (!organizationId) throw new Error("No Overwatch team is available for this user.");

    const { data: organization, error: orgError } = await context.supabase
      .from("organizations")
      .select("id, seat_limit")
      .eq("id", organizationId)
      .single();
    if (orgError) throw new Error(orgError.message);

    const [
      { count: activeSeats, error: seatsError },
      { count: pendingInvites, error: invitesError },
    ] = await Promise.all([
      context.supabase
        .from("organization_memberships")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "active"),
      context.supabase
        .from("organization_invites")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("status", "pending"),
    ]);
    if (seatsError) throw new Error(seatsError.message);
    if (invitesError) throw new Error(invitesError.message);

    const claimedSeats = (activeSeats ?? 0) + (pendingInvites ?? 0);
    if (organization.seat_limit !== null && claimedSeats >= organization.seat_limit) {
      throw new Error(
        `This Overwatch team is at its ${organization.seat_limit}-seat limit. Revoke an invite or upgrade before adding another person.`,
      );
    }

    const { data: existing, error: existingError } = await context.supabase
      .from("organization_invites")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("email", inviteEmail)
      .eq("status", "pending")
      .maybeSingle();
    if (existingError) throw new Error(existingError.message);

    if (existing?.id) {
      const { data: updated, error: updateError } = await context.supabase
        .from("organization_invites")
        .update({
          role: data.role,
          invited_by: context.userId,
          expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
        })
        .eq("id", existing.id)
        .select("id,email,role,status,expires_at,created_at")
        .single();
      if (updateError) throw new Error(updateError.message);
      return { invite: updated as TeamInvite };
    }

    const { data: invite, error } = await context.supabase
      .from("organization_invites")
      .insert({
        organization_id: organization.id,
        email: inviteEmail,
        role: data.role,
        invited_by: context.userId,
      })
      .select("id,email,role,status,expires_at,created_at")
      .single();
    if (error) throw new Error(error.message);

    return { invite: invite as TeamInvite };
  });
