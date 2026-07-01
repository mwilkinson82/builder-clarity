import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { isOverwatchAdminEmail } from "@/lib/admin-access";

type DynamicSupabaseError = { code?: string; message?: string } | null;
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  gte(column: string, value: unknown): DynamicSupabaseQuery;
  in(column: string, values: readonly string[]): DynamicSupabaseQuery;
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean },
  ): DynamicSupabaseQuery;
  limit(count: number): DynamicSupabaseQuery;
  maybeSingle(): Promise<DynamicSupabaseResult>;
};
type DynamicSupabaseClient = {
  from(relation: string): DynamicSupabaseQuery;
};

export interface AdminActivitySession {
  id: string;
  user_id: string;
  organization_id: string;
  organization_name: string;
  email: string;
  full_name: string;
  route_path: string;
  page_title: string;
  user_agent: string;
  login_at: string;
  last_seen_at: string;
}

export interface OverwatchAdminWorkspace {
  schemaReady: boolean;
  generatedAt: string;
  activeWindowSeconds: number;
  rawSessionCount: number;
  organizationCount: number;
  activeSessions: AdminActivitySession[];
}

const ACTIVE_WINDOW_SECONDS = 120;

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

function isMissingRestRelation(error: DynamicSupabaseError, relation: string) {
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
}

async function requireOverwatchAdmin(context: { supabase: unknown; userId: string }) {
  const profileRes = await dynamicTable(context.supabase, "profiles")
    .select("email,full_name")
    .eq("id", context.userId)
    .maybeSingle();

  if (profileRes.error) throw new Error(profileRes.error.message);
  const profile = (profileRes.data ?? {}) as Record<string, unknown>;
  if (!isOverwatchAdminEmail(str(profile.email))) {
    throw new Error("This Overwatch admin workspace is restricted to Marshall Wilkinson.");
  }
}

function normalizeActivitySession(
  row: Record<string, unknown>,
  organizationsById: Map<string, string>,
): AdminActivitySession {
  const organizationId = str(row.organization_id);
  return {
    id: str(row.id),
    user_id: str(row.user_id),
    organization_id: organizationId,
    organization_name: organizationsById.get(organizationId) ?? "Company",
    email: str(row.email),
    full_name: str(row.full_name),
    route_path: str(row.route_path, "/"),
    page_title: str(row.page_title),
    user_agent: str(row.user_agent),
    login_at: str(row.login_at),
    last_seen_at: str(row.last_seen_at),
  };
}

export const getOverwatchAdminWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OverwatchAdminWorkspace> => {
    await requireOverwatchAdmin(context);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const generatedAt = new Date();
    const cutoff = new Date(generatedAt.getTime() - ACTIVE_WINDOW_SECONDS * 1000).toISOString();

    const activityRes = await dynamicTable(supabaseAdmin, "user_activity_presence")
      .select(
        "id,organization_id,user_id,email,full_name,route_path,page_title,user_agent,login_at,last_seen_at",
      )
      .gte("last_seen_at", cutoff)
      .order("last_seen_at", { ascending: false })
      .limit(250);

    if (activityRes.error) {
      if (isMissingRestRelation(activityRes.error, "user_activity_presence")) {
        return {
          schemaReady: false,
          generatedAt: generatedAt.toISOString(),
          activeWindowSeconds: ACTIVE_WINDOW_SECONDS,
          rawSessionCount: 0,
          organizationCount: 0,
          activeSessions: [],
        };
      }
      throw new Error(activityRes.error.message ?? "Could not load active user sessions.");
    }

    const activityRows = ((activityRes.data ?? []) as unknown[]).filter(
      (row): row is Record<string, unknown> => Boolean(row && typeof row === "object"),
    );
    const organizationIds = Array.from(
      new Set(activityRows.map((row) => str(row.organization_id)).filter(Boolean)),
    );

    let organizationRows: Record<string, unknown>[] = [];
    if (organizationIds.length > 0) {
      const organizationRes = await supabaseAdmin
        .from("organizations")
        .select("id,name,slug")
        .in("id", organizationIds);
      if (organizationRes.error) throw new Error(organizationRes.error.message);
      organizationRows = (organizationRes.data ?? []) as Record<string, unknown>[];
    }

    const organizationsById = new Map(
      organizationRows.map((row) => [str(row.id), str(row.name, str(row.slug, "Company"))]),
    );
    const latestByUserId = new Map<string, AdminActivitySession>();

    for (const row of activityRows) {
      const userId = str(row.user_id);
      if (!userId || latestByUserId.has(userId)) continue;
      latestByUserId.set(userId, normalizeActivitySession(row, organizationsById));
    }

    return {
      schemaReady: true,
      generatedAt: generatedAt.toISOString(),
      activeWindowSeconds: ACTIVE_WINDOW_SECONDS,
      rawSessionCount: activityRows.length,
      organizationCount: organizationIds.length,
      activeSessions: Array.from(latestByUserId.values()),
    };
  });
