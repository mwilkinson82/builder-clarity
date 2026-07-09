import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { COMPANY_ASSET_BUCKET, companyLogoPath, versionAssetUrl } from "@/lib/company-assets";
import {
  ALL_CAPABILITY_KEYS,
  ROLE_PRESETS,
  hasCapability,
  normalizeCapabilities,
  seedCapabilitiesForRole,
  type CapabilityKey,
  type CapabilitySet,
} from "@/lib/capabilities";

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
  updated_at: string;
  name: string;
  slug: string;
  legal_name: string;
  website_url: string;
  office_phone: string;
  address_line1: string;
  address_line2: string;
  city: string;
  state: string;
  postal_code: string;
  country: string;
  license_number: string;
  tax_identifier: string;
  logo_url: string;
  logo_path: string;
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

export interface CompanyWorkspaceContext {
  id: string;
  name: string;
  logo_url: string;
  plan_code: string;
  billing_status: string;
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
  /**
   * Effective capability flags. Read from the membership row once the Phase 2
   * capabilities migration is applied; until then, derived from the role via
   * the same behavior-preserving mapping the migration seeds.
   */
  capabilities: CapabilitySet;
  created_at: string;
}

export interface TeamInvite {
  id: string;
  email: string;
  role: AccountRole;
  status: InviteStatus;
  capabilities: CapabilitySet;
  expires_at: string;
  created_at: string;
}

export interface TeamProject {
  id: string;
  name: string;
  job_number: string;
  client: string;
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

export interface TeamClientContact {
  id: string;
  name: string;
  email: string;
  company: string;
  title: string;
  phone: string;
  status: string;
}

export interface TeamClientProjectAccess {
  id: string;
  project_id: string;
  contact_id: string | null;
  email: string;
  contact_name: string;
  contact_company: string;
  project_name: string;
  project_job_number: string;
  status: "pending" | "active" | "revoked";
  can_view_change_orders: boolean;
  can_view_daily_reports: boolean;
  can_view_billing: boolean;
  accepted_at: string | null;
  last_sent_at: string | null;
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
  "id,updated_at,name,slug,plan_code,billing_status,project_limit,seat_limit,storage_limit_mb,daily_report_limit_per_month,contractor_circle_grant";

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

const ORGANIZATION_IDENTITY_COLUMNS = [
  "legal_name",
  "website_url",
  "office_phone",
  "address_line1",
  "address_line2",
  "city",
  "state",
  "postal_code",
  "country",
  "license_number",
  "tax_identifier",
  "logo_url",
  "logo_path",
] as const;

const ORGANIZATION_COMMERCIAL_SELECT = `${ORGANIZATION_BASE_SELECT},${ORGANIZATION_COMMERCIAL_COLUMNS.join(",")}`;
const ORGANIZATION_SELECT = `${ORGANIZATION_COMMERCIAL_SELECT},${ORGANIZATION_IDENTITY_COLUMNS.join(",")}`;

const isMissingRestColumn = (error: { code?: string; message?: string } | null, column: string) => {
  const message = (error?.message ?? "").toLowerCase();
  const target = column.toLowerCase();
  return (
    (error?.code === "PGRST204" && message.includes(`'${target}' column`)) ||
    message.includes(`column ${target} does not exist`) ||
    message.includes(`.${target} does not exist`)
  );
};

const isMissingRestRelation = (
  error: { code?: string; message?: string } | null,
  relation: string,
) => {
  const message = (error?.message ?? "").toLowerCase();
  const target = relation.toLowerCase();
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    message.includes(`relation "${target}" does not exist`) ||
    message.includes(`could not find the table '${target}'`) ||
    message.includes(`could not find the table '${target}' in the schema cache`) ||
    message.includes(`table ${target} does not exist`)
  );
};

function missingCommercialOrganizationColumn(error: { code?: string; message?: string } | null) {
  return ORGANIZATION_COMMERCIAL_COLUMNS.some((column) => isMissingRestColumn(error, column));
}

function missingIdentityOrganizationColumn(error: { code?: string; message?: string } | null) {
  return ORGANIZATION_IDENTITY_COLUMNS.some((column) => isMissingRestColumn(error, column));
}

function normalizeOrganization(row: Record<string, unknown>): TeamOrganization {
  const contractorCircleGrant = bool(row.contractor_circle_grant);
  const organizationId = row.id as string;

  return {
    id: organizationId,
    updated_at: str(row.updated_at),
    name: str(row.name),
    slug: str(row.slug),
    legal_name: str(row.legal_name),
    website_url: str(row.website_url),
    office_phone: str(row.office_phone),
    address_line1: str(row.address_line1),
    address_line2: str(row.address_line2),
    city: str(row.city),
    state: str(row.state),
    postal_code: str(row.postal_code),
    country: str(row.country),
    license_number: str(row.license_number),
    tax_identifier: str(row.tax_identifier),
    logo_url: str(row.logo_url),
    logo_path: str(row.logo_path) || companyLogoPath(organizationId),
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

function organizationLogoUrl(
  supabase: SupabaseClient,
  organization: Pick<TeamOrganization, "id" | "logo_url" | "updated_at">,
) {
  if (organization.logo_url) return organization.logo_url;
  const { data } = supabase.storage
    .from(COMPANY_ASSET_BUCKET)
    .getPublicUrl(companyLogoPath(organization.id));
  return versionAssetUrl(data.publicUrl, organization.updated_at);
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

type DynamicSupabaseClient = {
  from: (relation: string) => ReturnType<SupabaseClient["from"]>;
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

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

/**
 * Effective capabilities for a membership row: explicit flags when the Phase 2
 * migration has populated them, otherwise the role's behavior-preserving seed
 * mapping (identical to what the migration writes), so gating works the same
 * before and after the migration is applied.
 */
function effectiveCapabilities(row: { role: AccountRole; capabilities?: unknown }): CapabilitySet {
  const explicit = normalizeCapabilities(row.capabilities);
  if (Object.keys(explicit).length > 0) return explicit;
  return seedCapabilitiesForRole(row.role);
}

function isMissingRestFunction(
  error: { code?: string; message?: string } | null,
  fn: string,
): boolean {
  const message = (error?.message ?? "").toLowerCase();
  return error?.code === "PGRST202" || message.includes(`function ${fn.toLowerCase()}`);
}

/**
 * Capability check via public.has_org_capability. Falls back to can_manage_org
 * when the RPC does not exist yet (deploy landed before the Phase 2 migration
 * was applied), which matches pre-migration behavior for both company.*
 * capabilities.
 */
async function requireOrgCapability(
  context: TeamServerContext,
  organizationId: string,
  capability: CapabilityKey,
  message: string,
) {
  const { data: allowed, error } = await context.supabase.rpc("has_org_capability", {
    p_org_id: organizationId,
    p_capability: capability,
  });
  if (error) {
    if (isMissingRestFunction(error, "has_org_capability")) {
      await requireCanManageOrganization(context, organizationId);
      return;
    }
    throw new Error(error.message);
  }
  if (!allowed) throw new Error(message);
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

  if (!extended.error)
    return normalizeOrganization(extended.data as unknown as Record<string, unknown>);
  if (
    !missingIdentityOrganizationColumn(extended.error) &&
    !missingCommercialOrganizationColumn(extended.error)
  ) {
    throw new Error(extended.error.message);
  }

  const commercial = await context.supabase
    .from("organizations")
    .select(ORGANIZATION_COMMERCIAL_SELECT)
    .eq("id", organizationId)
    .single();
  if (!commercial.error) {
    return normalizeOrganization(commercial.data as unknown as Record<string, unknown>);
  }
  if (!missingCommercialOrganizationColumn(commercial.error)) {
    throw new Error(commercial.error.message);
  }

  const fallback = await context.supabase
    .from("organizations")
    .select(ORGANIZATION_BASE_SELECT)
    .eq("id", organizationId)
    .single();
  if (fallback.error) throw new Error(fallback.error.message);
  return normalizeOrganization(fallback.data as Record<string, unknown>);
}

export const getCompanyWorkspaceContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CompanyWorkspaceContext> => {
    const organizationId = await ensureCurrentOrganization(context);
    const organization = await loadOrganization(context, organizationId);

    return {
      id: organization.id,
      name: organization.name || "Company",
      logo_url: organizationLogoUrl(context.supabase, organization),
      plan_code: organization.plan_code,
      billing_status: organization.billing_status,
    };
  });

const activityHeartbeatInput = z.object({
  clientSessionId: z.string().min(8).max(120),
  routePath: z.string().max(500).default("/"),
  pageTitle: z.string().max(200).default(""),
  userAgent: z.string().max(500).default(""),
});

export const recordUserActivity = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => activityHeartbeatInput.parse(data))
  .handler(async ({ data, context }) => {
    const organizationId = await ensureCurrentOrganization(context);
    const profileRes = await context.supabase
      .from("profiles")
      .select("email,full_name")
      .eq("id", context.userId)
      .maybeSingle();
    if (profileRes.error) throw new Error(profileRes.error.message);

    const now = new Date().toISOString();
    const payload = {
      organization_id: organizationId,
      user_id: context.userId,
      client_session_id: data.clientSessionId,
      email: str(profileRes.data?.email),
      full_name: str(profileRes.data?.full_name),
      route_path: data.routePath.trim() || "/",
      page_title: data.pageTitle.trim(),
      user_agent: data.userAgent.trim(),
      last_seen_at: now,
    };

    const { data: activity, error } = await dynamicTable(context.supabase, "user_activity_presence")
      .upsert(payload, { onConflict: "organization_id,user_id,client_session_id" })
      .select("id,last_seen_at")
      .single();

    if (error) {
      if (isMissingRestRelation(error, "user_activity_presence")) {
        return { ok: false, reason: "schema_missing" as const };
      }
      throw new Error(error.message);
    }

    return {
      ok: true,
      id: activity.id as string,
      last_seen_at: str(activity.last_seen_at),
    };
  });

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

function normalizeTeamClientContact(row: Record<string, unknown>): TeamClientContact {
  return {
    id: row.id as string,
    name: str(row.name),
    email: str(row.email),
    company: str(row.company),
    title: str(row.title),
    phone: str(row.phone),
    status: str(row.status, "active"),
  };
}

function normalizeTeamClientProjectAccess(
  row: Record<string, unknown>,
  contactsById: Map<string, TeamClientContact>,
  projectsById: Map<string, TeamProject>,
): TeamClientProjectAccess {
  const contactId = (row.contact_id as string | null) ?? null;
  const contact = contactId ? contactsById.get(contactId) : undefined;
  const projectId = row.project_id as string;
  const project = projectsById.get(projectId);

  return {
    id: row.id as string,
    project_id: projectId,
    contact_id: contactId,
    email: str(row.email, contact?.email ?? ""),
    contact_name: contact?.name ?? "",
    contact_company: contact?.company ?? "",
    project_name: project?.name ?? "Project",
    project_job_number: project?.job_number ?? "",
    status: str(row.status, "pending") as TeamClientProjectAccess["status"],
    can_view_change_orders:
      row.can_view_change_orders == null ? true : bool(row.can_view_change_orders),
    can_view_daily_reports: bool(row.can_view_daily_reports),
    can_view_billing: bool(row.can_view_billing),
    accepted_at: (row.accepted_at as string | null) ?? null,
    last_sent_at: (row.last_sent_at as string | null) ?? null,
    created_at: str(row.created_at),
  };
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
        .select("*")
        .eq("organization_id", organizationId)
        .eq("status", "pending")
        .order("created_at", { ascending: false }),
      context.supabase
        .from("projects")
        .select("id,name,job_number,client,project_manager,owner_id")
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
      client: str(p.client),
      project_manager: str(p.project_manager),
      owner_id: p.owner_id as string,
    }));
    const projectIds = projects.map((p) => p.id);

    const [projectMembersRes, dailyReportUsage, contactsRes, clientAccessRes] = await Promise.all([
      projectIds.length === 0
        ? { data: [], error: null }
        : context.supabase
            .from("project_memberships")
            .select("*")
            .in("project_id", projectIds)
            .order("created_at", { ascending: true }),
      loadDailyReportUsage(context, projectIds),
      context.supabase
        .from("client_contacts")
        .select("id,name,email,company,title,phone,status")
        .eq("organization_id", organizationId)
        .neq("status", "inactive")
        .order("created_at", { ascending: false }),
      projectIds.length === 0
        ? { data: [], error: null }
        : context.supabase
            .from("project_client_access")
            .select(
              "id,project_id,contact_id,email,status,can_view_change_orders,can_view_daily_reports,can_view_billing,accepted_at,last_sent_at,created_at",
            )
            .in("project_id", projectIds)
            .neq("status", "revoked")
            .order("created_at", { ascending: false }),
    ]);
    if (projectMembersRes.error) throw new Error(projectMembersRes.error.message);
    if (contactsRes.error) throw new Error(contactsRes.error.message);
    if (clientAccessRes.error) throw new Error(clientAccessRes.error.message);

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
      const role = str(m.role, "member") as AccountRole;
      return {
        id: m.id as string,
        organization_id: m.organization_id as string,
        user_id: m.user_id as string,
        email: profile?.email || str(m.invited_email),
        full_name: profile?.full_name || "",
        role,
        status: str(m.status, "active") as MemberStatus,
        // Cast: the generated row types predate the Phase 2 capabilities
        // column; regenerate after the migration is applied.
        capabilities: effectiveCapabilities({
          role,
          capabilities: (m as Record<string, unknown>).capabilities,
        }),
        created_at: str(m.created_at),
      };
    });

    const currentMember = members.find((member) => member.user_id === context.userId);
    const canManageTeam =
      currentMember?.status === "active" &&
      hasCapability(currentMember.capabilities, "company.manage_team");
    const canManageSettings =
      currentMember?.status === "active" &&
      hasCapability(currentMember.capabilities, "company.manage_settings");
    const canManageBilling =
      currentMember?.status === "active" &&
      hasCapability(currentMember.capabilities, "billing.manage");

    const superAdminRes = await context.supabase.rpc("is_super_admin");
    const isSuperAdmin = !superAdminRes.error && Boolean(superAdminRes.data);

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

    const invites: TeamInvite[] = (invitesRes.data ?? []).map((i) => {
      const role = str(i.role, "project_manager") as AccountRole;
      const explicit = normalizeCapabilities((i as Record<string, unknown>).capabilities);
      return {
        id: i.id as string,
        email: str(i.email),
        role,
        status: str(i.status, "pending") as InviteStatus,
        // Legacy invites without explicit flags land on the role PRESET when
        // accepted (ensure_user_account applies the same fallback).
        capabilities: Object.keys(explicit).length > 0 ? explicit : { ...ROLE_PRESETS[role] },
        expires_at: str(i.expires_at),
        created_at: str(i.created_at),
      };
    });
    const clientContacts: TeamClientContact[] = (contactsRes.data ?? []).map((contact) =>
      normalizeTeamClientContact(contact as Record<string, unknown>),
    );
    const contactsById = new Map(clientContacts.map((contact) => [contact.id, contact]));
    const projectsById = new Map(projects.map((project) => [project.id, project]));
    const clientProjectAccess: TeamClientProjectAccess[] = (clientAccessRes.data ?? []).map(
      (access) =>
        normalizeTeamClientProjectAccess(
          access as Record<string, unknown>,
          contactsById,
          projectsById,
        ),
    );

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
      clientContacts,
      clientProjectAccess,
      currentUserRole: currentMember?.role ?? null,
      currentUserCapabilities: currentMember?.capabilities ?? {},
      canManageTeam,
      canManageSettings,
      canManageBilling,
      isSuperAdmin,
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

// The signed-in user's own profile — feeds the avatar / greeting / profile menu
// on the home screen without loading the whole team roster.
export const getMyProfile = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("profiles")
      .select("id,email,full_name,avatar_url,company_title")
      .eq("id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data ?? {}) as Record<string, unknown>;
    return {
      id: context.userId,
      email: str(row.email),
      full_name: str(row.full_name),
      avatar_url: str(row.avatar_url),
      company_title: str(row.company_title),
    };
  });

// The signed-in user's home-screen access: which view they get. The Owner view
// (company-wide posture + the CRM/new-business track) is for users who can see
// all company projects OR work the pipeline (or a super admin); everyone else is
// scoped to their own jobs (the PM view). Lightweight — just the current
// membership row + the super-admin check.
export const getMyHomeAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const organizationId = await ensureCurrentOrganization(context);
    const { data, error } = await context.supabase
      .from("organization_memberships")
      .select("role,status,capabilities")
      .eq("organization_id", organizationId)
      .eq("user_id", context.userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = (data ?? null) as {
      role?: string;
      status?: string;
      capabilities?: unknown;
    } | null;
    const role = (row?.role as AccountRole) ?? "member";
    const active = (row?.status ?? "active") === "active";
    const capabilities = effectiveCapabilities({ role, capabilities: row?.capabilities });

    const superAdminRes = await context.supabase.rpc("is_super_admin");
    const isSuperAdmin = !superAdminRes.error && Boolean(superAdminRes.data);

    const canSeeOwnerView =
      isSuperAdmin ||
      (active &&
        (hasCapability(capabilities, "projects.view_all") ||
          hasCapability(capabilities, "crm.manage")));

    return { role, isSuperAdmin, canSeeOwnerView };
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
  legal_name: z.string().max(200).default(""),
  website_url: z.string().url("Enter a valid website URL.").or(z.literal("")).default(""),
  office_phone: z.string().max(80).default(""),
  address_line1: z.string().max(200).default(""),
  address_line2: z.string().max(200).default(""),
  city: z.string().max(120).default(""),
  state: z.string().max(80).default(""),
  postal_code: z.string().max(40).default(""),
  country: z.string().max(80).default(""),
  license_number: z.string().max(120).default(""),
  tax_identifier: z.string().max(120).default(""),
  logo_url: z.string().url("Logo URL must be valid.").or(z.literal("")).default(""),
  logo_path: z.string().max(500).default(""),
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
    await requireOrgCapability(
      context,
      organizationId,
      "company.manage_settings",
      "You do not have permission to change this company's settings.",
    );

    const cleanSlug = data.slug
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");

    const updatePayload = {
      name: data.name.trim(),
      slug: cleanSlug,
      legal_name: data.legal_name.trim(),
      website_url: data.website_url.trim(),
      office_phone: data.office_phone.trim(),
      address_line1: data.address_line1.trim(),
      address_line2: data.address_line2.trim(),
      city: data.city.trim(),
      state: data.state.trim(),
      postal_code: data.postal_code.trim(),
      country: data.country.trim(),
      license_number: data.license_number.trim(),
      tax_identifier: data.tax_identifier.trim(),
      logo_url: data.logo_url.trim(),
      logo_path: data.logo_path.trim(),
      billing_email: data.billing_email.trim().toLowerCase(),
      billing_contact_name: data.billing_contact_name.trim(),
    };

    const { data: updated, error } = await dynamicTable(context.supabase, "organizations")
      .update(updatePayload)
      .eq("id", organizationId)
      .select(ORGANIZATION_SELECT)
      .single();
    if (error) {
      if (
        !missingIdentityOrganizationColumn(error) &&
        !missingCommercialOrganizationColumn(error)
      ) {
        throw new Error(error.message);
      }

      const commercialPayload = {
        name: updatePayload.name,
        slug: updatePayload.slug,
        billing_email: updatePayload.billing_email,
        billing_contact_name: updatePayload.billing_contact_name,
      };
      const commercial = await dynamicTable(context.supabase, "organizations")
        .update(commercialPayload)
        .eq("id", organizationId)
        .select(ORGANIZATION_COMMERCIAL_SELECT)
        .single();
      if (!commercial.error) {
        return {
          organization: normalizeOrganization(
            commercial.data as unknown as Record<string, unknown>,
          ),
        };
      }
      if (!missingCommercialOrganizationColumn(commercial.error)) {
        throw new Error(commercial.error.message);
      }

      const { data: fallback, error: fallbackError } = await context.supabase
        .from("organizations")
        .update({ name: updatePayload.name, slug: updatePayload.slug })
        .eq("id", organizationId)
        .select(ORGANIZATION_BASE_SELECT)
        .single();
      if (fallbackError) throw new Error(fallbackError.message);

      return { organization: normalizeOrganization(fallback as Record<string, unknown>) };
    }

    return { organization: normalizeOrganization(updated as unknown as Record<string, unknown>) };
  });

const capabilitiesInput = z.record(z.string(), z.boolean());

const teamInviteInput = z.object({
  email: z.string().email().max(254),
  role: z.enum(ACCOUNT_ROLES).default("project_manager"),
  capabilities: capabilitiesInput.optional(),
});

export const createTeamInvite = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof teamInviteInput>) => teamInviteInput.parse(input))
  .handler(async ({ data, context }) => {
    const inviteEmail = data.email.trim().toLowerCase();
    const organizationId = await ensureCurrentOrganization(context);
    await requireOrgCapability(
      context,
      organizationId,
      "company.manage_team",
      "You do not have permission to invite people to this Overwatch company.",
    );
    const inviteCapabilities = data.capabilities
      ? normalizeCapabilities(data.capabilities)
      : { ...ROLE_PRESETS[data.role] };

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
      const updatePayload: Record<string, unknown> = {
        role: data.role,
        capabilities: inviteCapabilities,
        invited_by: context.userId,
        expires_at: new Date(Date.now() + 14 * 86400000).toISOString(),
      };
      let updateRes = await dynamicTable(context.supabase, "organization_invites")
        .update(updatePayload)
        .eq("id", existing.id)
        .select("*")
        .single();
      if (updateRes.error && isMissingRestColumn(updateRes.error, "capabilities")) {
        // Deploy landed before the Phase 2 migration: keep invites working.
        delete updatePayload.capabilities;
        updateRes = await dynamicTable(context.supabase, "organization_invites")
          .update(updatePayload)
          .eq("id", existing.id)
          .select("*")
          .single();
      }
      if (updateRes.error) throw new Error(updateRes.error.message);
      const updatedRow = updateRes.data as Record<string, unknown>;
      return {
        invite: {
          ...(updatedRow as unknown as TeamInvite),
          capabilities: normalizeCapabilities(updatedRow.capabilities),
        },
      };
    }

    const insertPayload: Record<string, unknown> = {
      organization_id: organization.id,
      email: inviteEmail,
      role: data.role,
      capabilities: inviteCapabilities,
      invited_by: context.userId,
    };
    let insertRes = await dynamicTable(context.supabase, "organization_invites")
      .insert(insertPayload)
      .select("*")
      .single();
    if (insertRes.error && isMissingRestColumn(insertRes.error, "capabilities")) {
      delete insertPayload.capabilities;
      insertRes = await dynamicTable(context.supabase, "organization_invites")
        .insert(insertPayload)
        .select("*")
        .single();
    }
    if (insertRes.error) throw new Error(insertRes.error.message);
    const insertedRow = insertRes.data as Record<string, unknown>;

    return {
      invite: {
        ...(insertedRow as unknown as TeamInvite),
        capabilities: normalizeCapabilities(insertedRow.capabilities),
      },
    };
  });

const teamMemberUpdateInput = z
  .object({
    membershipId: z.string().uuid(),
    role: z.enum(ACCOUNT_ROLES).optional(),
    status: z.enum(MEMBER_STATUSES).optional(),
    capabilities: capabilitiesInput.optional(),
  })
  .refine((v) => v.role || v.status || v.capabilities, "Choose a change to apply.");

export const updateTeamMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof teamMemberUpdateInput>) =>
    teamMemberUpdateInput.parse(input),
  )
  .handler(async ({ data, context }) => {
    const organizationId = await ensureCurrentOrganization(context);
    await requireOrgCapability(
      context,
      organizationId,
      "company.manage_team",
      "You do not have permission to change company access.",
    );

    const { data: membership, error: membershipError } = await context.supabase
      .from("organization_memberships")
      .select("*")
      .eq("id", data.membershipId)
      .single();
    if (membershipError) throw new Error(membershipError.message);
    if (membership.organization_id !== organizationId) {
      throw new Error("That company member does not belong to this Overwatch company.");
    }

    const currentRole = str(membership.role, "member") as AccountRole;

    // Nobody edits an owner's access. Owners hold the full capability set by
    // definition; changing that means changing who the owner is, which is not
    // a checkbox operation.
    if (currentRole === "owner") {
      throw new Error("Company owner access can't be edited.");
    }

    // Nobody removes their own team-management access — that path strands a
    // company with no one able to manage it from the screen they just used.
    if (membership.user_id === context.userId) {
      const currentCaps = effectiveCapabilities({
        role: currentRole,
        capabilities: (membership as Record<string, unknown>).capabilities,
      });
      const nextCaps = data.capabilities
        ? normalizeCapabilities(data.capabilities)
        : data.role
          ? ROLE_PRESETS[data.role]
          : undefined;
      if (
        hasCapability(currentCaps, "company.manage_team") &&
        nextCaps &&
        !hasCapability(nextCaps, "company.manage_team")
      ) {
        throw new Error("You can't remove your own people-management access.");
      }
    }

    await assertNotLastOrgOwner(context, membership, data.role, data.status);

    const changes: { role?: AccountRole; status?: MemberStatus; capabilities?: CapabilitySet } = {};
    if (data.role) changes.role = data.role;
    if (data.status) changes.status = data.status;
    if (data.capabilities) {
      changes.capabilities = normalizeCapabilities(data.capabilities);
    } else if (data.role) {
      // Choosing a preset fills the boxes: a role change without explicit
      // flags applies that role's preset.
      changes.capabilities = { ...ROLE_PRESETS[data.role] };
    }

    let updateRes = await dynamicTable(context.supabase, "organization_memberships")
      .update(changes)
      .eq("id", data.membershipId)
      .select("id,organization_id,user_id,role,status,created_at")
      .single();
    if (updateRes.error && isMissingRestColumn(updateRes.error, "capabilities")) {
      // Deploy landed before the Phase 2 migration: apply the role/status
      // part so the screen keeps working; capabilities arrive with the
      // migration.
      delete changes.capabilities;
      if (!data.role && !data.status) throw new Error(updateRes.error.message);
      updateRes = await dynamicTable(context.supabase, "organization_memberships")
        .update(changes)
        .eq("id", data.membershipId)
        .select("id,organization_id,user_id,role,status,created_at")
        .single();
    }
    if (updateRes.error) throw new Error(updateRes.error.message);

    return { member: updateRes.data };
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
