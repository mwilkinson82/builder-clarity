import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
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

const PROJECT_MEMBER_ROLES = ["owner", "manager", "editor", "viewer"] as const;
const MEMBER_STATUSES = ["active", "disabled"] as const;

export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export type ProjectMemberRole = (typeof PROJECT_MEMBER_ROLES)[number];
export type MemberStatus = "pending" | "active" | "disabled";
export type InviteStatus = "pending" | "accepted" | "revoked" | "expired";

export interface TeamOrganization {
  id: string;
  name: string;
  slug: string;
  plan_code: string;
  billing_status: string;
  billing_email: string;
  billing_contact_name: string;
  stripe_customer_id: string;
  stripe_subscription_id: string;
  stripe_price_id: string;
  stripe_checkout_session_id: string;
  stripe_connect_account_id: string;
  stripe_connect_status: string;
  subscription_current_period_end: string;
  subscription_cancel_at_period_end: boolean;
  payment_processor_ready: boolean;
  project_limit: number;
  seat_limit: number;
  storage_limit_mb: number;
  daily_report_limit_per_month: number;
  contractor_circle_grant: boolean;
}

export interface TeamProfile {
  id: string;
  email: string;
  full_name: string;
  phone: string;
  company_title: string;
  avatar_url: string;
  default_organization_id: string | null;
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

export interface TeamProject {
  id: string;
  name: string;
  job_number: string;
  project_manager: string;
  owner_id: string;
}

export interface TeamProjectMember {
  id: string;
  project_id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: ProjectMemberRole;
  status: MemberStatus;
  created_at: string;
}

const str = (v: unknown, d = "") => (typeof v === "string" ? v : d);
const num = (v: unknown) => (typeof v === "number" ? v : Number(v ?? 0));
const bool = (v: unknown) => (typeof v === "boolean" ? v : Boolean(v));

const CONTRACTOR_CIRCLE_GRANT_LIMITS = {
  projects: 10,
  seats: 10,
  storageMb: 10_240,
  dailyReportsPerMonth: 1_000,
} as const;

const ORGANIZATION_BASE_SELECT =
  "id,name,slug,plan_code,billing_status,project_limit,seat_limit,storage_limit_mb,daily_report_limit_per_month,contractor_circle_grant";

const ORGANIZATION_COMMERCIAL_COLUMNS = [
  "billing_email",
  "billing_contact_name",
  "stripe_customer_id",
  "stripe_subscription_id",
  "stripe_price_id",
  "stripe_checkout_session_id",
  "stripe_connect_account_id",
  "stripe_connect_status",
  "subscription_current_period_end",
  "subscription_cancel_at_period_end",
  "payment_processor_ready",
] as const;

const ORGANIZATION_SELECT = `${ORGANIZATION_BASE_SELECT},${ORGANIZATION_COMMERCIAL_COLUMNS.join(",")}`;

const isMissingRestColumn = (error: { code?: string; message?: string } | null, column: string) => {
  const message = (error?.message ?? "").toLowerCase();
  const target = column.toLowerCase();
  return (
    (error?.code === "PGRST204" && message.includes(`'${target}' column`)) ||
    message.includes(`column ${target} does not exist`) ||
    message.includes(`.${target} does not exist`)
  );
};

function missingCommercialOrganizationColumn(error: { code?: string; message?: string } | null) {
  return ORGANIZATION_COMMERCIAL_COLUMNS.some((column) => isMissingRestColumn(error, column));
}

function normalizeOrganization(row: Record<string, unknown>): TeamOrganization {
  const contractorCircleGrant = bool(row.contractor_circle_grant);

  return {
    id: row.id as string,
    name: str(row.name),
    slug: str(row.slug),
    plan_code: str(row.plan_code),
    billing_status: str(row.billing_status),
    billing_email: str(row.billing_email),
    billing_contact_name: str(row.billing_contact_name),
    stripe_customer_id: str(row.stripe_customer_id),
    stripe_subscription_id: str(row.stripe_subscription_id),
    stripe_price_id: str(row.stripe_price_id),
    stripe_checkout_session_id: str(row.stripe_checkout_session_id),
    stripe_connect_account_id: str(row.stripe_connect_account_id),
    stripe_connect_status: str(row.stripe_connect_status, "not_connected"),
    subscription_current_period_end: str(row.subscription_current_period_end),
    subscription_cancel_at_period_end: bool(row.subscription_cancel_at_period_end),
    payment_processor_ready: bool(row.payment_processor_ready),
    project_limit: contractorCircleGrant
      ? CONTRACTOR_CIRCLE_GRANT_LIMITS.projects
      : num(row.project_limit),
    seat_limit: contractorCircleGrant ? CONTRACTOR_CIRCLE_GRANT_LIMITS.seats : num(row.seat_limit),
    storage_limit_mb: contractorCircleGrant
      ? CONTRACTOR_CIRCLE_GRANT_LIMITS.storageMb
      : num(row.storage_limit_mb),
    daily_report_limit_per_month: contractorCircleGrant
      ? CONTRACTOR_CIRCLE_GRANT_LIMITS.dailyReportsPerMonth
      : num(row.daily_report_limit_per_month),
    contractor_circle_grant: contractorCircleGrant,
  };
}

type DailyReportUsageRow = {
  id?: string;
  report_date?: string | null;
  attachment_count?: number | string | null;
  attachment_bytes?: number | string | null;
};

type TeamServerContext = {
  supabase: SupabaseClient;
  userId: string;
};

async function ensureCurrentOrganization(context: TeamServerContext) {
  const { data: organizationId, error } = await context.supabase.rpc("ensure_current_user_account");
  if (error) throw new Error(error.message);
  if (!organizationId)
    throw new Error("No Overwatch company workspace is available for this user.");
  return organizationId as string;
}

async function requireCanManageOrganization(context: TeamServerContext, organizationId: string) {
  const { data: canManage, error } = await context.supabase.rpc("can_manage_org", {
    p_org_id: organizationId,
  });
  if (error) throw new Error(error.message);
  if (!canManage) throw new Error("You do not have permission to manage this Overwatch company.");
}

async function requireCanManageProject(context: TeamServerContext, projectId: string) {
  const { data: canManage, error } = await context.supabase.rpc("can_manage_project", {
    p_project_id: projectId,
  });
  if (error) throw new Error(error.message);
  if (!canManage) throw new Error("You do not have permission to manage this project.");
}

async function loadOrganization(context: TeamServerContext, organizationId: string) {
  const extended = await context.supabase
    .from("organizations")
    .select(ORGANIZATION_SELECT)
    .eq("id", organizationId)
    .single();

  if (!extended.error) return normalizeOrganization(extended.data as Record<string, unknown>);
  if (!missingCommercialOrganizationColumn(extended.error)) throw new Error(extended.error.message);

  const fallback = await context.supabase
    .from("organizations")
    .select(ORGANIZATION_BASE_SELECT)
    .eq("id", organizationId)
    .single();
  if (fallback.error) throw new Error(fallback.error.message);
  return normalizeOrganization(fallback.data as Record<string, unknown>);
}

function currentMonthBounds() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

async function loadDailyReportUsage(context: TeamServerContext, projectIds: string[]) {
  if (projectIds.length === 0) {
    return {
      total: 0,
      thisMonth: 0,
      attachmentCount: 0,
      storageBytes: 0,
    };
  }

  const reportRes = await context.supabase
    .from("daily_reports")
    .select("id,report_date")
    .in("project_id", projectIds);

  let rows: DailyReportUsageRow[];
  if (reportRes.error) {
    if (
      isMissingRestColumn(reportRes.error, "attachment_count") ||
      isMissingRestColumn(reportRes.error, "attachment_bytes")
    ) {
      const fallbackRes = await context.supabase
        .from("daily_reports")
        .select("id,report_date")
        .in("project_id", projectIds);
      if (fallbackRes.error) throw new Error(fallbackRes.error.message);
      rows = (fallbackRes.data ?? []) as DailyReportUsageRow[];
    } else {
      throw new Error(reportRes.error.message);
    }
  } else {
    rows = (reportRes.data ?? []) as DailyReportUsageRow[];
  }

  const bounds = currentMonthBounds();
  return rows.reduce(
    (usage, row) => {
      const reportDate = str(row.report_date);
      const isThisMonth = reportDate >= bounds.start && reportDate < bounds.end;
      return {
        total: usage.total + 1,
        thisMonth: usage.thisMonth + (isThisMonth ? 1 : 0),
        attachmentCount: usage.attachmentCount + Math.max(0, num(row.attachment_count)),
        storageBytes: usage.storageBytes + Math.max(0, num(row.attachment_bytes)),
      };
    },
    {
      total: 0,
      thisMonth: 0,
      attachmentCount: 0,
      storageBytes: 0,
    },
  );
}

async function assertNotLastOrgOwner(
  context: TeamServerContext,
  membership: { id: string; organization_id: string; role: string; status: string },
  nextRole?: AccountRole,
  nextStatus?: MemberStatus,
) {
  const willRemainActiveOwner =
    (nextRole ?? membership.role) === "owner" && (nextStatus ?? membership.status) === "active";
  if (willRemainActiveOwner || membership.role !== "owner") return;

  const { count, error } = await context.supabase
    .from("organization_memberships")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", membership.organization_id)
    .eq("role", "owner")
    .eq("status", "active")
    .neq("id", membership.id);
  if (error) throw new Error(error.message);
  if ((count ?? 0) < 1) throw new Error("Every Overwatch company needs at least one active owner.");
}

async function assertNotLastProjectOwner(
  context: TeamServerContext,
  membership: { id: string; project_id: string; role: string; status: string },
  nextRole?: ProjectMemberRole,
  nextStatus?: MemberStatus,
) {
  const willRemainActiveOwner =
    (nextRole ?? membership.role) === "owner" && (nextStatus ?? membership.status) === "active";
  if (willRemainActiveOwner || membership.role !== "owner") return;

  const { count, error } = await context.supabase
    .from("project_memberships")
    .select("id", { count: "exact", head: true })
    .eq("project_id", membership.project_id)
    .eq("role", "owner")
    .eq("status", "active")
    .neq("id", membership.id);
  if (error) throw new Error(error.message);
  if ((count ?? 0) < 1) throw new Error("Every project needs at least one active owner.");
}

export const getTeamWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const organizationId = await ensureCurrentOrganization(context);

    const [orgRes, membersRes, invitesRes, projectsRes] = await Promise.all([
      loadOrganization(context, organizationId),
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
        .select("id,name,job_number,project_manager,owner_id")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .order("name", { ascending: true }),
    ]);

    if (membersRes.error) throw new Error(membersRes.error.message);
    if (invitesRes.error) throw new Error(invitesRes.error.message);
    if (projectsRes.error) throw new Error(projectsRes.error.message);

    const projects: TeamProject[] = (projectsRes.data ?? []).map((p) => ({
      id: p.id as string,
      name: str(p.name),
      job_number: str(p.job_number),
      project_manager: str(p.project_manager),
      owner_id: p.owner_id as string,
    }));
    const projectIds = projects.map((p) => p.id);

    const [projectMembersRes, dailyReportUsage] = await Promise.all([
      projectIds.length === 0
        ? { data: [], error: null }
        : context.supabase
            .from("project_memberships")
            .select("*")
            .in("project_id", projectIds)
            .order("created_at", { ascending: true }),
      loadDailyReportUsage(context, projectIds),
    ]);
    if (projectMembersRes.error) throw new Error(projectMembersRes.error.message);

    const memberRows = membersRes.data ?? [];
    const projectMemberRows = projectMembersRes.data ?? [];
    const userIds = Array.from(
      new Set([
        ...memberRows.map((m) => m.user_id as string),
        ...projectMemberRows.map((m) => m.user_id as string),
      ]),
    );
    const profilesRes =
      userIds.length === 0
        ? { data: [], error: null }
        : await context.supabase
            .from("profiles")
            .select("id,email,full_name,phone,company_title,avatar_url,default_organization_id")
            .in("id", userIds);
    if (profilesRes.error) throw new Error(profilesRes.error.message);

    const profilesById = new Map(
      (profilesRes.data ?? []).map((p) => [
        p.id as string,
        { email: str(p.email), full_name: str(p.full_name) },
      ]),
    );

    const organization = orgRes;

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

    const currentMember = members.find((member) => member.user_id === context.userId);
    const canManageTeam =
      currentMember?.status === "active" &&
      ["owner", "admin", "executive"].includes(currentMember.role);

    const projectMembers: TeamProjectMember[] = projectMemberRows.map((m) => {
      const profile = profilesById.get(m.user_id as string);
      const orgMember = members.find((member) => member.user_id === (m.user_id as string));
      return {
        id: m.id as string,
        project_id: m.project_id as string,
        user_id: m.user_id as string,
        email: profile?.email || orgMember?.email || "",
        full_name: profile?.full_name || orgMember?.full_name || "",
        role: str(m.role, "viewer") as ProjectMemberRole,
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

    const currentProfileRow = profilesRes.data?.find((p) => p.id === context.userId);
    const currentProfile: TeamProfile = {
      id: context.userId,
      email: str(currentProfileRow?.email),
      full_name: str(currentProfileRow?.full_name),
      phone: str(currentProfileRow?.phone),
      company_title: str(currentProfileRow?.company_title),
      avatar_url: str(currentProfileRow?.avatar_url),
      default_organization_id:
        (currentProfileRow?.default_organization_id as string | null) ?? null,
    };

    return {
      organization,
      currentProfile,
      members,
      invites,
      projects,
      projectMembers,
      currentUserRole: currentMember?.role ?? null,
      canManageTeam,
      usage: {
        projects: projectIds.length,
        activeSeats: members.filter((m) => m.status === "active").length,
        pendingInvites: invites.length,
        dailyReports: dailyReportUsage.total,
        dailyReportsThisMonth: dailyReportUsage.thisMonth,
        dailyReportAttachmentCount: dailyReportUsage.attachmentCount,
        dailyReportStorageBytes: dailyReportUsage.storageBytes,
      },
    };
  });

const profileUpdateInput = z.object({
  full_name: z.string().max(200).default(""),
  phone: z.string().max(50).default(""),
  company_title: z.string().max(120).default(""),
});

export const updateMyProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof profileUpdateInput>) => profileUpdateInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await ensureCurrentOrganization(context);

    const { data: updated, error } = await context.supabase
      .from("profiles")
      .update({
        full_name: data.full_name.trim(),
        phone: data.phone.trim(),
        company_title: data.company_title.trim(),
        default_organization_id: organizationId,
      })
      .eq("id", context.userId)
      .select("id,email,full_name,phone,company_title,avatar_url,default_organization_id")
      .single();
    if (error) throw new Error(error.message);

    return { profile: updated as TeamProfile };
  });

const organizationUpdateInput = z.object({
  name: z.string().min(1, "Enter a company name.").max(160),
  slug: z.string().max(120).default(""),
  billing_email: z.string().email("Enter a valid billing email.").or(z.literal("")).default(""),
  billing_contact_name: z.string().max(160).default(""),
});

export const updateOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof organizationUpdateInput>) =>
    organizationUpdateInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await ensureCurrentOrganization(context);
    await requireCanManageOrganization(context, organizationId);

    const cleanSlug = data.slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const updatePayload = {
      name: data.name.trim(),
      slug: cleanSlug,
      billing_email: data.billing_email.trim().toLowerCase(),
      billing_contact_name: data.billing_contact_name.trim(),
    };

    const { data: updated, error } = await context.supabase
      .from("organizations")
      .update(updatePayload)
      .eq("id", organizationId)
      .select(ORGANIZATION_SELECT)
      .single();
    if (error) {
      if (!missingCommercialOrganizationColumn(error)) throw new Error(error.message);

      const { data: fallback, error: fallbackError } = await context.supabase
        .from("organizations")
        .update({ name: updatePayload.name, slug: updatePayload.slug })
        .eq("id", organizationId)
        .select(ORGANIZATION_BASE_SELECT)
        .single();
      if (fallbackError) throw new Error(fallbackError.message);

      return { organization: normalizeOrganization(fallback as Record<string, unknown>) };
    }

    return { organization: normalizeOrganization(updated as Record<string, unknown>) };
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
    const organizationId = await ensureCurrentOrganization(context);
    await requireCanManageOrganization(context, organizationId);

    const { data: organization, error: orgError } = await context.supabase
      .from("organizations")
      .select("id, seat_limit, contractor_circle_grant")
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
    if (
      !bool(organization.contractor_circle_grant) &&
      organization.seat_limit !== null &&
      claimedSeats >= organization.seat_limit
    ) {
      throw new Error(
        `This Overwatch company is at its ${organization.seat_limit}-seat limit. Revoke an invite or upgrade before adding another person.`,
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

const teamMemberUpdateInput = z
  .object({
    membershipId: z.string().uuid(),
    role: z.enum(ACCOUNT_ROLES).optional(),
    status: z.enum(MEMBER_STATUSES).optional(),
  })
  .refine((v) => v.role || v.status, "Choose a role or status to update.");

export const updateTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof teamMemberUpdateInput>) =>
    teamMemberUpdateInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await ensureCurrentOrganization(context);
    await requireCanManageOrganization(context, organizationId);

    const { data: membership, error: membershipError } = await context.supabase
      .from("organization_memberships")
      .select("id,organization_id,user_id,role,status")
      .eq("id", data.membershipId)
      .single();
    if (membershipError) throw new Error(membershipError.message);
    if (membership.organization_id !== organizationId) {
      throw new Error("That company member does not belong to this Overwatch company.");
    }

    await assertNotLastOrgOwner(context, membership, data.role, data.status);

    const changes: { role?: AccountRole; status?: MemberStatus } = {};
    if (data.role) changes.role = data.role;
    if (data.status) changes.status = data.status;

    const { data: updated, error } = await context.supabase
      .from("organization_memberships")
      .update(changes)
      .eq("id", data.membershipId)
      .select("id,organization_id,user_id,role,status,created_at")
      .single();
    if (error) throw new Error(error.message);

    return { member: updated };
  });

const inviteIdInput = z.object({
  inviteId: z.string().uuid(),
});

export const revokeTeamInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof inviteIdInput>) => inviteIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const organizationId = await ensureCurrentOrganization(context);
    await requireCanManageOrganization(context, organizationId);

    const { data: invite, error: inviteError } = await context.supabase
      .from("organization_invites")
      .select("id,organization_id,status")
      .eq("id", data.inviteId)
      .single();
    if (inviteError) throw new Error(inviteError.message);
    if (invite.organization_id !== organizationId) {
      throw new Error("That invite does not belong to this Overwatch company.");
    }

    const { error } = await context.supabase
      .from("organization_invites")
      .update({ status: "revoked" })
      .eq("id", data.inviteId);
    if (error) throw new Error(error.message);

    return { id: data.inviteId };
  });

const projectMemberAssignInput = z.object({
  projectId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(PROJECT_MEMBER_ROLES).default("viewer"),
});

export const assignProjectMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof projectMemberAssignInput>) =>
    projectMemberAssignInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    await requireCanManageProject(context, data.projectId);

    const { data: project, error: projectError } = await context.supabase
      .from("projects")
      .select("id,organization_id")
      .eq("id", data.projectId)
      .single();
    if (projectError) throw new Error(projectError.message);
    if (!project.organization_id)
      throw new Error("This project is not attached to an Overwatch company.");

    const { data: teamMember, error: teamMemberError } = await context.supabase
      .from("organization_memberships")
      .select("id,status")
      .eq("organization_id", project.organization_id)
      .eq("user_id", data.userId)
      .eq("status", "active")
      .maybeSingle();
    if (teamMemberError) throw new Error(teamMemberError.message);
    if (!teamMember) throw new Error("Only active company members can be assigned to projects.");

    const { data: membership, error } = await context.supabase
      .from("project_memberships")
      .upsert(
        {
          project_id: data.projectId,
          user_id: data.userId,
          role: data.role,
          status: "active",
        },
        { onConflict: "project_id,user_id" },
      )
      .select("id,project_id,user_id,role,status,created_at")
      .single();
    if (error) throw new Error(error.message);

    return { member: membership };
  });

const projectMemberUpdateInput = z
  .object({
    membershipId: z.string().uuid(),
    role: z.enum(PROJECT_MEMBER_ROLES).optional(),
    status: z.enum(MEMBER_STATUSES).optional(),
  })
  .refine((v) => v.role || v.status, "Choose a project role or status to update.");

export const updateProjectMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof projectMemberUpdateInput>) =>
    projectMemberUpdateInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: membership, error: membershipError } = await context.supabase
      .from("project_memberships")
      .select("id,project_id,user_id,role,status")
      .eq("id", data.membershipId)
      .single();
    if (membershipError) throw new Error(membershipError.message);

    await requireCanManageProject(context, membership.project_id);
    await assertNotLastProjectOwner(context, membership, data.role, data.status);

    const changes: { role?: ProjectMemberRole; status?: MemberStatus } = {};
    if (data.role) changes.role = data.role;
    if (data.status) changes.status = data.status;

    const { data: updated, error } = await context.supabase
      .from("project_memberships")
      .update(changes)
      .eq("id", data.membershipId)
      .select("id,project_id,user_id,role,status,created_at")
      .single();
    if (error) throw new Error(error.message);

    return { member: updated };
  });

const projectMemberRemoveInput = z.object({
  membershipId: z.string().uuid(),
});

export const removeProjectMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof projectMemberRemoveInput>) =>
    projectMemberRemoveInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const { data: membership, error: membershipError } = await context.supabase
      .from("project_memberships")
      .select("id,project_id,user_id,role,status")
      .eq("id", data.membershipId)
      .single();
    if (membershipError) throw new Error(membershipError.message);

    await requireCanManageProject(context, membership.project_id);
    await assertNotLastProjectOwner(context, membership, undefined, "disabled");

    const { error } = await context.supabase
      .from("project_memberships")
      .delete()
      .eq("id", data.membershipId);
    if (error) throw new Error(error.message);

    return { id: data.membershipId };
  });
