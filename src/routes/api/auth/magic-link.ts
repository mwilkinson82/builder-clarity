import { sendLovableEmail } from "@lovable.dev/email-js";
import { createFileRoute } from "@tanstack/react-router";
import { handleMagicLinkRequest, type MagicLinkDeps } from "@/lib/auth/magic-link-handler";

const AUTH_USER_LOOKUP_ERROR = "Unable to verify the sign-in account.";

type ExactAuthUserLookup = (email: string) => Promise<{
  data: Array<{ user_id: string; email_confirmed: boolean }> | null;
  error: unknown | null;
}>;

type AuthMaintenanceRpcClient = {
  rpc(
    fn: "lookup_auth_user_by_email_exact",
    args: { p_email: string },
  ): Promise<{
    data: Array<{ user_id: string; email_confirmed: boolean }> | null;
    error: unknown | null;
  }>;
  rpc(
    fn: "reserve_auth_magic_link_send",
    args: {
      p_dedupe_key: string;
      p_message_id: string;
      p_template_name: string;
      p_recipient_email: string;
      p_metadata: Record<string, unknown>;
    },
  ): {
    single(): Promise<{
      data: { reserved: boolean; message_id: string } | null;
      error: { message?: string } | null;
    }>;
  };
};

export async function lookupExistingAuthUserByEmail(
  email: string,
  exactLookup: ExactAuthUserLookup,
): Promise<{ id: string; emailConfirmed: boolean } | null> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) return null;

  try {
    const result = await exactLookup(normalizedEmail);
    if (result.error) throw new Error(AUTH_USER_LOOKUP_ERROR);
    const found = result.data?.[0];
    return found
      ? {
          id: found.user_id,
          emailConfirmed: Boolean(found.email_confirmed),
        }
      : null;
  } catch {
    // The login response must fail closed without relaying provider
    // diagnostics, which can contain secrets or request context.
    throw new Error(AUTH_USER_LOOKUP_ERROR);
  }
}

export const Route = createFileRoute("/api/auth/magic-link")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await request.json().catch(() => null);

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const { createClient } = await import("@supabase/supabase-js");

        const deps: MagicLinkDeps = {
          now: () => Date.now(),
          randomUUID: () => crypto.randomUUID(),
          isProd: process.env.NODE_ENV === "production",
          apiKey: process.env.LOVABLE_API_KEY,
          supabaseUrl: process.env.SUPABASE_URL!,
          supabasePublishableKey: process.env.SUPABASE_PUBLISHABLE_KEY!,
          sendUrl: process.env.LOVABLE_SEND_URL,

          getAuthUserFromBearer: async (bearer) => {
            const { data, error } = await supabaseAdmin.auth.getUser(bearer);
            return { user: data.user ? { id: data.user.id } : null, error };
          },

          fetchInviteById: async (inviteId) => {
            const { data, error } = await supabaseAdmin
              .from("organization_invites")
              .select("id, organization_id, email, status, expires_at, invited_by, role")
              .eq("id", inviteId)
              .maybeSingle();
            if (error) throw new Error(error.message);
            return data
              ? {
                  id: data.id as string,
                  organization_id: data.organization_id as string,
                  email: data.email as string,
                  status: data.status as string,
                  expires_at: data.expires_at as string | null,
                  invited_by: (data.invited_by as string | null) ?? null,
                  role: data.role as string,
                }
              : null;
          },

          callerHasManageTeam: async ({ bearer, organizationId }) => {
            const authedForCap = createClient(
              process.env.SUPABASE_URL!,
              process.env.SUPABASE_PUBLISHABLE_KEY!,
              {
                global: { headers: { Authorization: `Bearer ${bearer}` } },
                auth: {
                  storage: undefined,
                  persistSession: false,
                  autoRefreshToken: false,
                },
              },
            );
            const { data, error } = await authedForCap.rpc("has_org_capability", {
              p_org_id: organizationId,
              p_capability: "company.manage_team",
            });
            if (error) throw new Error(error.message);
            return Boolean(data);
          },

          fetchClientAccessById: async (accessId) => {
            // Join to projects to resolve the access row's owning
            // organization for the capability check. The service-role
            // client bypasses RLS; it's used only after the handler
            // has proven the caller is authenticated via Bearer.
            const { data, error } = await supabaseAdmin
              .from("project_client_access")
              .select(
                "id, project_id, email, status, client_user_id, projects!inner(organization_id)",
              )
              .eq("id", accessId)
              .maybeSingle();
            if (error) throw new Error(error.message);
            if (!data) return null;
            const projectsRel = (data as { projects?: { organization_id?: string } | null })
              .projects;
            const organizationId = projectsRel?.organization_id ?? null;
            if (!organizationId) return null;
            return {
              id: data.id as string,
              project_id: data.project_id as string,
              organization_id: organizationId as string,
              email: data.email as string,
              status: data.status as string,
              client_user_id: (data.client_user_id as string | null) ?? null,
            };
          },

          callerHasClientAccessManagement: async ({ bearer, organizationId }) => {
            const authedForCap = createClient(
              process.env.SUPABASE_URL!,
              process.env.SUPABASE_PUBLISHABLE_KEY!,
              {
                global: { headers: { Authorization: `Bearer ${bearer}` } },
                auth: {
                  storage: undefined,
                  persistSession: false,
                  autoRefreshToken: false,
                },
              },
            );
            const { data, error } = await authedForCap.rpc("has_org_capability", {
              p_org_id: organizationId,
              p_capability: "client_portal.manage",
            });
            if (error) throw new Error(error.message);
            return Boolean(data);
          },

          lookupExistingAuthUser: async (email) => {
            // Public login may proceed only for a proven existing Auth user.
            // The service-role-only exact lookup avoids the O(N) Admin
            // listUsers scan and remains invisible to browser roles.
            const authRpc = supabaseAdmin as unknown as AuthMaintenanceRpcClient;
            return lookupExistingAuthUserByEmail(email, (normalizedEmail) =>
              authRpc.rpc("lookup_auth_user_by_email_exact", {
                p_email: normalizedEmail,
              }),
            );
          },

          reserveSend: async ({ messageId, email, label, dedupeKey, metadata }) => {
            const authRpc = supabaseAdmin as unknown as AuthMaintenanceRpcClient;
            const { data, error } = await authRpc
              .rpc("reserve_auth_magic_link_send", {
                p_dedupe_key: dedupeKey,
                p_message_id: messageId,
                p_template_name: label,
                p_recipient_email: email,
                p_metadata: metadata,
              })
              .single();
            if (error || !data?.message_id) {
              throw new Error("Unable to reserve the sign-in email.");
            }
            return {
              reserved: Boolean(data.reserved),
              messageId: data.message_id,
            };
          },

          generateMagicLink: async ({ email, redirectTo, kind }) => {
            const { data, error } = await supabaseAdmin.auth.admin.generateLink({
              type: kind === "invite" ? "invite" : "magiclink",
              email,
              options: { redirectTo },
            });
            if (error) {
              return {
                hashedToken: null,
                userId: null,
                error: { message: error.message, code: (error as { code?: string }).code },
              };
            }
            const hashedToken = (data?.properties?.hashed_token as string | undefined) ?? null;
            const userId = (data?.user?.id as string | undefined) ?? null;
            const providerVerificationType = data?.properties?.verification_type;
            const verificationType =
              providerVerificationType === "invite" || providerVerificationType === "magiclink"
                ? providerVerificationType
                : kind;
            return { hashedToken, userId, verificationType, error: null };
          },

          updateEmailSendLogStatus: async (messageId, status, metadata) => {
            const { error } = await supabaseAdmin
              .from("email_send_log")
              .update({ status, metadata: metadata as never })
              .eq("message_id", messageId);
            if (error) throw new Error(error.message);
          },

          updateEmailSendLogFailed: async (messageId, errorMessage, metadata) => {
            const { error } = await supabaseAdmin
              .from("email_send_log")
              .update({
                status: "failed",
                error_message: errorMessage,
                metadata: metadata as never,
              })
              .eq("message_id", messageId);
            if (error) throw new Error(error.message);
          },

          sendEmail: async (payload) => {
            const apiKey = process.env.LOVABLE_API_KEY!;
            const result = (await sendLovableEmail(
              payload as Parameters<typeof sendLovableEmail>[0],
              { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
            )) as { success?: boolean; error?: { message?: string; code?: string } } | undefined;
            if (result && result.success === false) {
              const err = new Error(result.error?.message ?? "Email provider send failed");
              (err as Error & { code?: string }).code = result.error?.code;
              throw err;
            }
          },

          logInfo: (msg, meta) => console.log(msg, meta),
          logError: (msg, meta) => console.error(msg, meta),
        };

        const result = await handleMagicLinkRequest({
          requestUrl: request.url,
          body,
          authorizationHeader: request.headers.get("authorization"),
          deps,
        });

        return Response.json(result.body, { status: result.status });
      },
    },
  },
});
