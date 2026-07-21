import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  base64ToBytes,
  dynamicTable,
  normalizeOperation,
  str,
  type DynamicSupabaseResult,
  type StorageClient,
} from "@/lib/ai-takeoff/ai-takeoff-server-shared";

export const AI_SYMBOL_LIBRARY_BUCKET = "ai-symbol-library";
export const SYMBOL_LIBRARY_SCHEMA_PENDING_MESSAGE =
  "The company symbol library isn't available yet.";

const saveExampleInput = z.object({
  estimate_id: z.string().uuid(),
  plan_sheet_id: z.string().uuid(),
  ai_operation_id: z.string().uuid(),
  label: z.string().trim().min(1).max(240),
  trade: z.string().trim().max(80).default(""),
  unit: z.string().trim().min(1).max(16).default("EA"),
  cost_library_item_id: z.string().uuid().nullable().default(null),
  source_point: z.object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  }),
  exemplar_base64: z.string().min(1).max(1_500_000),
  accepted_count: z.number().int().min(1).max(96),
  rejected_count: z.number().int().min(0).max(96),
});

function isSymbolLibrarySchemaMissing(error: { code?: string; message: string } | null) {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(
    error &&
    (error.code === "42P01" ||
      error.code === "42883" ||
      error.code === "PGRST202" ||
      error.code === "PGRST205" ||
      message.includes("ai_symbol_library") ||
      message.includes("save_ai_symbol_library_example")),
  );
}

type SymbolLibraryRpcClient = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<DynamicSupabaseResult<Array<{ library_item_id: string; example_id: string }>>>;
};

type EstimateManagerRpcClient = {
  rpc(
    name: "can_manage_estimate",
    args: { p_estimate_id: string },
  ): Promise<DynamicSupabaseResult<boolean>>;
};

export const saveAiSymbolLibraryExample = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof saveExampleInput>) => saveExampleInput.parse(input))
  .handler(async ({ data, context }) => {
    const estimateResult = await dynamicTable(context.supabase, "estimates")
      .select("id,organization_id")
      .eq("id", data.estimate_id)
      .maybeSingle();
    if (estimateResult.error || !estimateResult.data) {
      throw new Error(estimateResult.error?.message ?? "Estimate was not found.");
    }
    const organizationId = str((estimateResult.data as Record<string, unknown>).organization_id);
    const managerResult = await (context.supabase as unknown as EstimateManagerRpcClient).rpc(
      "can_manage_estimate",
      { p_estimate_id: data.estimate_id },
    );
    if (managerResult.error) throw new Error(managerResult.error.message);
    if (!managerResult.data) {
      throw new Error("Estimate management access is required to teach the company library.");
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const operationResult = await dynamicTable(supabaseAdmin, "ai_operations")
      .select("*")
      .eq("id", data.ai_operation_id)
      .maybeSingle();
    if (operationResult.error || !operationResult.data) {
      throw new Error(
        operationResult.error?.message ?? "The completed symbol discovery was not found.",
      );
    }
    const operation = normalizeOperation(operationResult.data as Record<string, unknown>);
    if (
      operation.created_by !== context.userId ||
      operation.organization_id !== organizationId ||
      operation.estimate_id !== data.estimate_id ||
      operation.operation_type !== "ai_count_scan" ||
      operation.status !== "succeeded" ||
      !operation.sheet_ids.includes(data.plan_sheet_id)
    ) {
      throw new Error("A completed symbol discovery owned by this estimator is required.");
    }

    const { embedImagesWithClip, isReplicateConfigured } =
      await import("@/lib/ai-takeoff/replicate.server");
    if (!isReplicateConfigured()) {
      throw new Error("The visual identification engine is not configured.");
    }
    const [embedding] = await embedImagesWithClip([
      { base64: data.exemplar_base64, mediaType: "image/png" },
    ]);
    if (!embedding || embedding.length < 64) {
      throw new Error("The accepted symbol example could not be encoded.");
    }

    const storagePath = `${organizationId}/${data.estimate_id}/${data.ai_operation_id}/${crypto.randomUUID()}.png`;
    const storage = (supabaseAdmin as StorageClient).storage.from(AI_SYMBOL_LIBRARY_BUCKET);
    const upload = await storage.upload(storagePath, base64ToBytes(data.exemplar_base64), {
      contentType: "image/png",
      upsert: false,
    });
    if (upload.error) {
      throw new Error(`The accepted symbol example could not be stored: ${upload.error.message}`);
    }

    const rpcResult = await (context.supabase as unknown as SymbolLibraryRpcClient).rpc(
      "save_ai_symbol_library_example",
      {
        p_estimate_id: data.estimate_id,
        p_plan_sheet_id: data.plan_sheet_id,
        p_ai_operation_id: data.ai_operation_id,
        p_label: data.label,
        p_trade: data.trade,
        p_unit: data.unit.toUpperCase(),
        p_cost_library_item_id: data.cost_library_item_id,
        p_source_point: data.source_point,
        p_exemplar_storage_path: storagePath,
        p_embedding: embedding,
        p_accepted_count: data.accepted_count,
        p_rejected_count: data.rejected_count,
      },
    );
    if (rpcResult.error || !rpcResult.data?.[0]) {
      await storage.remove([storagePath]).catch(() => undefined);
      if (isSymbolLibrarySchemaMissing(rpcResult.error)) {
        throw new Error(SYMBOL_LIBRARY_SCHEMA_PENDING_MESSAGE);
      }
      throw new Error(rpcResult.error?.message ?? "The company symbol example did not save.");
    }
    return {
      libraryItemId: str(rpcResult.data[0].library_item_id),
      exampleId: str(rpcResult.data[0].example_id),
    };
  });
