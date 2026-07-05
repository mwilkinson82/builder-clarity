import { createClient } from "@supabase/supabase-js";
import { defineTool, type ToolContext } from "@lovable.dev/mcp-js";

function supabaseForUser(ctx: ToolContext) {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
    global: { headers: { Authorization: `Bearer ${ctx.getToken()}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default defineTool({
  name: "list_projects",
  title: "List projects",
  description:
    "List active (non-archived) Overwatch projects the signed-in user can access.",
  inputSchema: {},
  annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  handler: async (_input, ctx) => {
    if (!ctx.isAuthenticated()) {
      return { content: [{ type: "text", text: "Not authenticated" }], isError: true };
    }
    const supabase = supabaseForUser(ctx);
    const { data, error } = await supabase
      .from("projects")
      .select("id,name,status,client_name,project_number,contract_value,created_at")
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      return { content: [{ type: "text", text: error.message }], isError: true };
    }
    const rows = data ?? [];
    const summary = rows.length
      ? rows
          .map(
            (r) =>
              `• ${r.name ?? "(untitled)"}${r.project_number ? ` [${r.project_number}]` : ""}${r.client_name ? ` — ${r.client_name}` : ""}${r.status ? ` — ${r.status}` : ""}`,
          )
          .join("\n")
      : "No active projects.";
    return {
      content: [{ type: "text", text: summary }],
      structuredContent: { projects: rows },
    };
  },
});
