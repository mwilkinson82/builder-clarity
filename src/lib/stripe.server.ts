import process from "node:process";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export const STRIPE_API_VERSION = "2026-02-25.clover";
export const DEFAULT_APP_ORIGIN = "https://overwatch.alpcontractorcircle.com";

type SupabaseAdmin = SupabaseClient<any>;
type SupabaseAuthed = SupabaseClient<Database>;

export class RouteError extends Error {
  code: string;
  status: number;
  details?: unknown;

  constructor(code: string, message: string, status = 400, details?: unknown) {
    super(message);
    this.name = "RouteError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export type AuthedStripeContext = {
  admin: SupabaseAdmin;
  authed: SupabaseAuthed;
  token: string;
  user: User;
};

export function jsonOk(payload: Record<string, unknown>, init?: ResponseInit) {
  return Response.json({ ok: true, ...payload }, init);
}

export function jsonError(error: unknown) {
  if (error instanceof RouteError) {
    return Response.json(
      {
        ok: false,
        code: error.code,
        error: error.message,
        details: error.details,
      },
      { status: error.status },
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected server error";
  console.error("[Stripe route] unexpected failure", error);
  return Response.json({ ok: false, code: "server_error", error: message }, { status: 500 });
}

export function readServerEnv(name: string) {
  return process.env[name] || import.meta.env[`VITE_${name}`] || "";
}

export function getAppOrigin(request?: Request) {
  const explicit =
    process.env.OVERWATCH_APP_URL ||
    process.env.SITE_URL ||
    process.env.URL ||
    import.meta.env.VITE_OVERWATCH_APP_URL ||
    import.meta.env.VITE_SITE_URL ||
    "";

  const raw = explicit || request?.url || DEFAULT_APP_ORIGIN;
  try {
    return new URL(raw).origin;
  } catch {
    return DEFAULT_APP_ORIGIN;
  }
}

export function requireStripeSecretKey() {
  const key = process.env.STRIPE_SECRET_KEY || "";
  if (!key) {
    throw new RouteError(
      "stripe_not_configured",
      "Stripe is not configured yet. Add STRIPE_SECRET_KEY before enabling paid checkout.",
      503,
    );
  }
  return key;
}

export function requireStripeWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!secret) {
    throw new RouteError(
      "stripe_webhook_not_configured",
      "Stripe webhook verification is not configured yet. Add STRIPE_WEBHOOK_SECRET before enabling webhooks.",
      503,
    );
  }
  return secret;
}

function requireSupabaseConfig() {
  const url = readServerEnv("SUPABASE_URL");
  const publishableKey = readServerEnv("SUPABASE_PUBLISHABLE_KEY");
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

  const missing = [
    ...(!url ? ["SUPABASE_URL"] : []),
    ...(!publishableKey ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ...(!serviceRoleKey ? ["SUPABASE_SERVICE_ROLE_KEY"] : []),
  ];

  if (missing.length > 0) {
    throw new RouteError(
      "supabase_not_configured",
      `Missing Supabase environment variable(s): ${missing.join(", ")}.`,
      500,
    );
  }

  return { url, publishableKey, serviceRoleKey };
}

export function createSupabaseAdminClient() {
  const { url, serviceRoleKey } = requireSupabaseConfig();
  return createClient<Database>(url, serviceRoleKey, {
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function createSupabaseAuthedClient(token: string) {
  const { url, publishableKey } = requireSupabaseConfig();
  return createClient<Database>(url, publishableKey, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
    auth: {
      storage: undefined,
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function requireAuthedStripeContext(request: Request): Promise<AuthedStripeContext> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new RouteError("unauthorized", "Sign in before using this billing action.", 401);
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token)
    throw new RouteError("unauthorized", "Sign in before using this billing action.", 401);

  const admin = createSupabaseAdminClient();
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) {
    throw new RouteError("unauthorized", "Your session expired. Sign in again.", 401);
  }

  return {
    admin,
    authed: createSupabaseAuthedClient(token),
    token,
    user: data.user,
  };
}

export async function requireCanManageProject(context: AuthedStripeContext, projectId: string) {
  const { data, error } = await context.authed.rpc("can_manage_project", {
    p_project_id: projectId,
  });
  if (error) throw new RouteError("project_access_check_failed", error.message, 500);
  if (!data) {
    throw new RouteError(
      "forbidden",
      "You do not have permission to manage billing for this project.",
      403,
    );
  }
}

export async function requireCanManageOrganization(
  context: AuthedStripeContext,
  organizationId: string,
) {
  const { data, error } = await context.authed.rpc("can_manage_org", {
    p_org_id: organizationId,
  });
  if (error) throw new RouteError("organization_access_check_failed", error.message, 500);
  if (!data) {
    throw new RouteError("forbidden", "You do not have permission to manage this company.", 403);
  }
}

export type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  customer?: string | null;
  subscription?: string | null;
  payment_intent?: string | null;
  status?: string | null;
  payment_status?: string | null;
  metadata?: Record<string, string>;
};

export function appendStripeForm(
  form: URLSearchParams,
  key: string,
  value: string | number | boolean | null | undefined,
) {
  if (value === null || value === undefined || value === "") return;
  form.append(key, String(value));
}

export async function stripePost<T>(
  path: string,
  form: URLSearchParams,
  idempotencyKey?: string,
): Promise<T> {
  const secretKey = requireStripeSecretKey();
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Stripe-Version": STRIPE_API_VERSION,
      ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
    },
    body: form,
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const stripeError = payload.error as
      | { message?: string; type?: string; code?: string }
      | undefined;
    throw new RouteError(
      "stripe_api_error",
      stripeError?.message || "Stripe rejected the checkout request.",
      response.status,
      {
        type: stripeError?.type,
        code: stripeError?.code,
      },
    );
  }

  return payload as T;
}

export async function stripeGet<T>(path: string): Promise<T> {
  const secretKey = requireStripeSecretKey();
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\//, "")}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
    },
  });

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const stripeError = payload.error as
      | { message?: string; type?: string; code?: string }
      | undefined;
    throw new RouteError(
      "stripe_api_error",
      stripeError?.message || "Stripe rejected the request.",
      response.status,
      {
        type: stripeError?.type,
        code: stripeError?.code,
      },
    );
  }

  return payload as T;
}

function timingSafeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function hmacSha256Hex(secret: string, payload: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyStripeWebhookPayload(rawBody: string, signatureHeader: string | null) {
  const webhookSecret = requireStripeWebhookSecret();
  if (!signatureHeader) {
    throw new RouteError("stripe_signature_missing", "Missing Stripe-Signature header.", 400);
  }

  const parts = signatureHeader.split(",").reduce<Record<string, string[]>>((acc, part) => {
    const [key, value] = part.split("=");
    if (!key || !value) return acc;
    acc[key] = [...(acc[key] ?? []), value];
    return acc;
  }, {});

  const timestamp = parts.t?.[0];
  const signatures = parts.v1 ?? [];
  if (!timestamp || signatures.length === 0) {
    throw new RouteError("stripe_signature_invalid", "Invalid Stripe-Signature header.", 400);
  }

  const expected = await hmacSha256Hex(webhookSecret, `${timestamp}.${rawBody}`);
  const matched = signatures.some((signature) => timingSafeEqual(signature, expected));
  if (!matched) {
    throw new RouteError(
      "stripe_signature_invalid",
      "Stripe webhook signature verification failed.",
      400,
    );
  }

  return JSON.parse(rawBody) as {
    id: string;
    type: string;
    data?: { object?: Record<string, unknown> };
  };
}
