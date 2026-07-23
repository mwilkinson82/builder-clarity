import { sendLovableEmail } from "@lovable.dev/email-js";
import { createFileRoute } from "@tanstack/react-router";
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
            if (error) throw error;
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
            // RLS-scoped authed client — the RPC runs as the caller's identity.
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

          findRecentSend: async (email, label, sinceIso) => {
            const { data } = await supabaseAdmin
              .from("email_send_log")
              .select("id,status")
              .eq("recipient_email", email)
              .eq("template_name", label)
              .in("status", ["pending", "sent"])
              .gte("created_at", sinceIso)
              .limit(1)
              .maybeSingle();
            return data ? { id: data.id as string, status: data.status as string } : null;
          },

          createAuthUser: async (email) => {
            const { error } = await supabaseAdmin.auth.admin.createUser({
              email,
              email_confirm: true,
            });
            return { error };
          },

          generateMagicLink: async ({ email, redirectTo }) => {
            const { data, error } = await supabaseAdmin.auth.admin.generateLink({
              type: "magiclink",
              email,
              options: { redirectTo },
            });
            return {
              hashedToken: (data?.properties?.hashed_token as string | undefined) ?? null,
              error,
            };
          },

          insertEmailSendLog: async (row) => {
            await supabaseAdmin.from("email_send_log").insert(row);
          },

          updateEmailSendLogStatus: async (messageId, status) => {
            await supabaseAdmin
              .from("email_send_log")
              .update({ status })
              .eq("message_id", messageId);
          },

          sendEmail: async (payload) => {
            const apiKey = process.env.LOVABLE_API_KEY!;
            await sendLovableEmail(
              payload as Parameters<typeof sendLovableEmail>[0],
              { apiKey, sendUrl: process.env.LOVABLE_SEND_URL },
            );
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
