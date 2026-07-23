import { sendLovableEmail } from "@lovable.dev/email-js";
import { createFileRoute } from "@tanstack/react-router";
import { findExistingAuthUserByEmail } from "@/lib/auth/find-existing-auth-user";
import { handleMagicLinkRequest, type MagicLinkDeps } from "@/lib/auth/magic-link-handler";

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
              .select("id, project_id, email, status, projects!inner(organization_id)")
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

          lookupExistingAuthUser: (email) =>
            // Exhaustive paginated exact-case-insensitive lookup — see
            // src/lib/auth/find-existing-auth-user.ts. The pinned
            // @supabase/auth-js has no email filter on listUsers, so
            // this is the only correct existence check.
            findExistingAuthUserByEmail((args) => supabaseAdmin.auth.admin.listUsers(args), email),

          findRecentSend: async ({ email, label, dedupeKey, sinceIso }) => {
            // Dedupe identity includes exact context+id via the metadata
            // dedupe_key, so a different invite/client access can never
            // suppress each other's send.
            const { data, error } = await supabaseAdmin
              .from("email_send_log")
              .select("id,status,metadata")
              .eq("recipient_email", email)
              .eq("template_name", label)
              .in("status", ["pending", "sent"])
              .gte("created_at", sinceIso)
              .order("created_at", { ascending: false })
              .limit(20);
            if (error) throw new Error(error.message);
            const match = (data ?? []).find((row) => {
              const md = (row as { metadata?: { dedupe_key?: string } | null }).metadata;
              return md?.dedupe_key === dedupeKey;
            });
            return match ? { id: match.id as string, status: match.status as string } : null;
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
            return { hashedToken, userId, error: null };
          },

          insertEmailSendLog: async (row) => {
            const { error } = await supabaseAdmin.from("email_send_log").insert(row as never);
            if (error) throw new Error(error.message);
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
