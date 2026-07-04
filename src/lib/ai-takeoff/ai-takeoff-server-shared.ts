// Shared server-side plumbing for the AI takeoff server functions
// (mechanical split out of ai-takeoff.functions.ts before AITAKEOFF3 —
// zero behavior change). Supabase row/query shims, the ai_operations row
// normalizer, and the best-effort scan-diagnostics storage helpers live
// here so the scan functions and the diagnostics reader can share them
// without a circular import.

export type DynamicSupabaseError = { code?: string; message: string };
export type DynamicSupabaseResult<T = unknown> = {
  data: T | null;
  error: DynamicSupabaseError | null;
};
export type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  is(column: string, value: null): DynamicSupabaseQuery;
  in(column: string, values: readonly string[]): DynamicSupabaseQuery;
  single(): Promise<DynamicSupabaseResult>;
  maybeSingle(): Promise<DynamicSupabaseResult>;
};

export const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as { from(table: string): DynamicSupabaseQuery }).from(relation);

export const str = (value: unknown, fallback = "") => (value == null ? fallback : String(value));
export const num = (value: unknown, fallback = 0) => {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
};

export function isMissingCreditsSchema(error: DynamicSupabaseError | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return (
    error?.code === "42P01" ||
    error?.code === "PGRST205" ||
    ((message.includes("does not exist") || message.includes("schema cache")) &&
      (message.includes("credit_ledger") || message.includes("ai_operations")))
  );
}

export const CREDITS_SCHEMA_PENDING_MESSAGE =
  "AI credits are still being set up for this workspace. Try again after the latest database migration is applied.";

export interface AiOperationRow {
  id: string;
  organization_id: string;
  created_by: string | null;
  operation_type: string;
  estimate_id: string | null;
  sheet_ids: string[];
  sheets_completed: number;
  model_used: string;
  input_tokens: number;
  output_tokens: number;
  api_cost_cents: number;
  credits_charged: number;
  status: "pending" | "succeeded" | "failed";
  error: string;
  created_at: string;
  updated_at: string;
}

export const normalizeOperation = (row: Record<string, unknown>): AiOperationRow => ({
  id: str(row.id),
  organization_id: str(row.organization_id),
  created_by: (row.created_by as string | null) ?? null,
  operation_type: str(row.operation_type, "ai_count_scan"),
  estimate_id: (row.estimate_id as string | null) ?? null,
  sheet_ids: Array.isArray(row.sheet_ids) ? row.sheet_ids.map((id) => str(id)) : [],
  sheets_completed: Math.max(0, Math.round(num(row.sheets_completed))),
  model_used: str(row.model_used),
  input_tokens: Math.max(0, Math.round(num(row.input_tokens))),
  output_tokens: Math.max(0, Math.round(num(row.output_tokens))),
  api_cost_cents: Math.max(0, Math.round(num(row.api_cost_cents))),
  credits_charged: Math.max(0, Math.round(num(row.credits_charged))),
  status: (str(row.status, "pending") as AiOperationRow["status"]) || "pending",
  error: str(row.error),
  created_at: str(row.created_at),
  updated_at: str(row.updated_at),
});

// --- Scan diagnostics storage (AITAKEOFF2 Task 4) ---
// Transient artifacts in the existing plan-room bucket, one folder per
// operation: the exemplar image actually sent, every tile with its
// sheet-space frame, the raw model response, and the mapped positions.
// Uploads are strictly best-effort — diagnostics must never fail a scan.

export const AI_DIAGNOSTICS_BUCKET = "plan-room";
export const AI_DIAGNOSTICS_PREFIX = "ai-diagnostics";
export const AI_DIAGNOSTICS_RETENTION_MS = 24 * 60 * 60 * 1000;

export type StorageClient = {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Uint8Array,
        options?: { contentType?: string; upsert?: boolean },
      ): Promise<{ error: { message: string } | null }>;
      list(
        path: string,
        options?: { limit?: number },
      ): Promise<{
        data: Array<{ name: string; created_at?: string }> | null;
        error: { message: string } | null;
      }>;
      remove(paths: string[]): Promise<{ error: { message: string } | null }>;
      download(path: string): Promise<{ data: Blob | null; error: { message: string } | null }>;
      createSignedUrl(
        path: string,
        expiresIn: number,
      ): Promise<{ data: { signedUrl: string } | null; error: { message: string } | null }>;
    };
  };
};

export function diagnosticsFolder(organizationId: string, operationId: string) {
  return `${AI_DIAGNOSTICS_PREFIX}/${organizationId}/${operationId}`;
}

// atob/TextEncoder are Node globals too; keeps this file off Buffer typings.
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function uploadDiagnostic(
  admin: unknown,
  path: string,
  body: Uint8Array,
  contentType: string,
) {
  try {
    await (admin as StorageClient).storage
      .from(AI_DIAGNOSTICS_BUCKET)
      .upload(path, body, { contentType, upsert: true });
  } catch {
    // Best-effort only.
  }
}

/** 24h cleanup: drop whole diagnostic folders whose files are all stale. */
export async function pruneOldDiagnostics(admin: unknown, organizationId: string) {
  try {
    const storage = (admin as StorageClient).storage.from(AI_DIAGNOSTICS_BUCKET);
    const orgPrefix = `${AI_DIAGNOSTICS_PREFIX}/${organizationId}`;
    const { data: folders } = await storage.list(orgPrefix, { limit: 12 });
    if (!folders) return;
    const cutoff = Date.now() - AI_DIAGNOSTICS_RETENTION_MS;
    for (const folder of folders) {
      if (!folder.name) continue;
      const folderPath = `${orgPrefix}/${folder.name}`;
      const { data: files } = await storage.list(folderPath, { limit: 100 });
      if (!files || files.length === 0) continue;
      const allStale = files.every((file) => {
        const created = Date.parse(file.created_at ?? "");
        return Number.isFinite(created) && created < cutoff;
      });
      if (!allStale) continue;
      await storage.remove(files.map((file) => `${folderPath}/${file.name}`));
    }
  } catch {
    // Best-effort only.
  }
}
