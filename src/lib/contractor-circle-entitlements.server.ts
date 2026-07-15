import type { SupabaseClient } from "@supabase/supabase-js";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DEFAULT_LOOKUP_URL = "https://app.alpcontractorcircle.com/api/public/overwatch/tier-lookup";
const CACHE_WINDOW_MS = 60 * 60 * 1000;
const ELIGIBLE_TIERS = new Set(["circle", "hardcore"]);

type DynamicSupabaseClient = {
  from: (relation: string) => ReturnType<SupabaseClient["from"]>;
};

const dynamicTable = (client: unknown, relation: string) =>
  (client as DynamicSupabaseClient).from(relation);

type EntitlementResult = {
  status: "granted" | "preserved" | "revoked" | "unchanged" | "cached" | "unavailable";
  configured: boolean;
  checked: boolean;
  memberEmail: string;
  tier: string;
  message: string;
};

type HubLookup = {
  email: string;
  tier: string | null;
  eligible: boolean;
};

type PlanRow = {
  code: string;
  project_limit: number | null;
  seat_limit: number | null;
  storage_limit_mb: number | null;
  daily_report_limit_per_month: number | null;
};

function normalizeEmail(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function planPatch(plan: PlanRow) {
  return {
    plan_code: plan.code,
    project_limit: plan.project_limit ?? 0,
    seat_limit: plan.seat_limit ?? 0,
    storage_limit_mb: plan.storage_limit_mb ?? 0,
    daily_report_limit_per_month: plan.daily_report_limit_per_month ?? 0,
  };
}

async function loadPlan(code: "free" | "pro" | "contractor_circle_free") {
  const { data, error } = await dynamicTable(supabaseAdmin, "subscription_plans")
    .select("code,project_limit,seat_limit,storage_limit_mb,daily_report_limit_per_month")
    .eq("code", code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`OverWatch plan ${code} is not configured.`);
  return data as unknown as PlanRow;
}

async function lookupHubMembership(email: string, url: string, secret: string): Promise<HubLookup> {
  const ts = Math.floor(Date.now() / 1000);
  const nonce = crypto.randomUUID();
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret.trim()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign("HMAC", key, encoder.encode(`${email}|${ts}|${nonce}`));
  const signature = Array.from(new Uint8Array(bytes))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-overwatch-signature": signature,
    },
    body: JSON.stringify({ email, ts, nonce }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });
  if (!response.ok) {
    throw new Error(`Contractor Circle Hub lookup returned ${response.status}.`);
  }
  const payload = (await response.json()) as Partial<HubLookup>;
  const tier = typeof payload.tier === "string" ? payload.tier : null;
  return {
    email,
    tier,
    eligible: Boolean(payload.eligible) && Boolean(tier && ELIGIBLE_TIERS.has(tier)),
  };
}

async function memberEmailsForOrganization(organizationId: string): Promise<string[]> {
  const { data: memberships, error: membershipsError } = await dynamicTable(
    supabaseAdmin,
    "organization_memberships",
  )
    .select("user_id,invited_email")
    .eq("organization_id", organizationId)
    .eq("status", "active");
  if (membershipsError) throw new Error(membershipsError.message);

  const rows = (memberships ?? []) as unknown as Array<{
    user_id?: string | null;
    invited_email?: string | null;
  }>;
  const userIds = rows.map((row) => row.user_id).filter((value): value is string => Boolean(value));
  const emails = new Set(rows.map((row) => normalizeEmail(row.invited_email)).filter(Boolean));

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await dynamicTable(supabaseAdmin, "profiles")
      .select("id,email")
      .in("id", userIds);
    if (profilesError) throw new Error(profilesError.message);
    for (const profile of (profiles ?? []) as unknown as Array<{ email?: string | null }>) {
      const email = normalizeEmail(profile.email);
      if (email) emails.add(email);
    }
  }

  return [...emails].sort();
}

export async function reconcileContractorCircleEntitlement({
  organizationId,
  force = false,
}: {
  organizationId: string;
  force?: boolean;
}): Promise<EntitlementResult> {
  const lookupUrl = process.env.CONTRACTOR_CIRCLE_TIER_LOOKUP_URL?.trim() || DEFAULT_LOOKUP_URL;
  const sharedSecret = process.env.CONTRACTOR_CIRCLE_SHARED_SECRET?.trim() || "";
  if (!sharedSecret) {
    return {
      status: "unavailable",
      configured: false,
      checked: false,
      memberEmail: "",
      tier: "",
      message: "Contractor Circle membership sync is not configured.",
    };
  }

  const { data: organization, error: organizationError } = await dynamicTable(
    supabaseAdmin,
    "organizations",
  )
    .select(
      "id,entitlement_source,contractor_circle_grant,circle_entitlement_checked_at,circle_entitlement_member_email,circle_entitlement_tier,stripe_subscription_id,billing_status",
    )
    .eq("id", organizationId)
    .maybeSingle();
  if (organizationError) {
    return {
      status: "unavailable",
      configured: true,
      checked: false,
      memberEmail: "",
      tier: "",
      message: "The commercial entitlement migration has not been applied yet.",
    };
  }
  if (!organization) throw new Error("OverWatch company not found.");

  const org = organization as unknown as Record<string, unknown>;
  const checkedAt = Date.parse(String(org.circle_entitlement_checked_at ?? ""));
  if (!force && Number.isFinite(checkedAt) && Date.now() - checkedAt < CACHE_WINDOW_MS) {
    return {
      status: "cached",
      configured: true,
      checked: true,
      memberEmail: normalizeEmail(org.circle_entitlement_member_email),
      tier: String(org.circle_entitlement_tier ?? ""),
      message: "Contractor Circle membership was checked within the last hour.",
    };
  }

  const emails = await memberEmailsForOrganization(organizationId);
  if (emails.length === 0) {
    return {
      status: "unavailable",
      configured: true,
      checked: false,
      memberEmail: "",
      tier: "",
      message: "No active company-member email is available for membership matching.",
    };
  }

  let lookups: HubLookup[];
  try {
    lookups = await Promise.all(
      emails.map((email) => lookupHubMembership(email, lookupUrl, sharedSecret)),
    );
  } catch (error) {
    console.error("Contractor Circle entitlement lookup failed open", {
      organization_id: organizationId,
      error,
    });
    return {
      status: "unavailable",
      configured: true,
      checked: false,
      memberEmail: "",
      tier: "",
      message: "The Hub could not be reached. Existing access was left unchanged.",
    };
  }

  const now = new Date().toISOString();
  const match = lookups.find((lookup) => lookup.eligible);
  if (match?.tier) {
    const circlePlan = await loadPlan("contractor_circle_free");
    const preserveAdminGrant = org.entitlement_source === "admin";
    const { error } = await dynamicTable(supabaseAdmin, "organizations")
      .update({
        ...planPatch(circlePlan),
        contractor_circle_grant: true,
        entitlement_source: preserveAdminGrant ? "admin" : "contractor_circle",
        entitlement_expires_at: null,
        billing_grace_ends_at: null,
        circle_entitlement_checked_at: now,
        circle_entitlement_member_email: match.email,
        circle_entitlement_tier: match.tier,
      })
      .eq("id", organizationId);
    if (error) throw new Error(error.message);
    return {
      status: preserveAdminGrant ? "preserved" : "granted",
      configured: true,
      checked: true,
      memberEmail: match.email,
      tier: match.tier,
      message: preserveAdminGrant
        ? "The existing rollout grant remains protected and its Hub match is verified."
        : "Contractor Circle membership now includes OverWatch Pro for this company.",
    };
  }

  if (org.entitlement_source === "contractor_circle") {
    const hasActiveProSubscription =
      Boolean(String(org.stripe_subscription_id ?? "")) &&
      ["active", "past_due"].includes(String(org.billing_status ?? ""));
    const fallbackPlan = await loadPlan(hasActiveProSubscription ? "pro" : "free");
    const { error } = await dynamicTable(supabaseAdmin, "organizations")
      .update({
        ...planPatch(fallbackPlan),
        contractor_circle_grant: false,
        entitlement_source: hasActiveProSubscription ? "stripe" : "free",
        entitlement_expires_at: null,
        billing_grace_ends_at: null,
        billing_status: hasActiveProSubscription ? org.billing_status : "active",
        circle_entitlement_checked_at: now,
        circle_entitlement_member_email: "",
        circle_entitlement_tier: "",
      })
      .eq("id", organizationId);
    if (error) throw new Error(error.message);
    return {
      status: "revoked",
      configured: true,
      checked: true,
      memberEmail: "",
      tier: "",
      message: hasActiveProSubscription
        ? "Circle access ended; the company's existing OverWatch Pro subscription remains active."
        : "Circle access ended; the company returned to OverWatch Free.",
    };
  }

  const { error } = await dynamicTable(supabaseAdmin, "organizations")
    .update({
      circle_entitlement_checked_at: now,
      circle_entitlement_member_email: "",
      circle_entitlement_tier: "",
    })
    .eq("id", organizationId);
  if (error) throw new Error(error.message);
  return {
    status: org.entitlement_source === "admin" ? "preserved" : "unchanged",
    configured: true,
    checked: true,
    memberEmail: "",
    tier: "",
    message:
      org.entitlement_source === "admin"
        ? "No Hub match was found; the protected rollout grant remains unchanged."
        : "No active Circle or Hardcore membership was found for this company.",
  };
}
