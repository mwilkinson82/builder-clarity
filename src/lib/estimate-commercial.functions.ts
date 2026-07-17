import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type DynamicError = { code?: string; message: string };
type DynamicResult<T = unknown> = { data: T | null; error: DynamicError | null };
type DynamicQuery = PromiseLike<DynamicResult> & {
  select(columns?: string): DynamicQuery;
  insert(values: unknown): DynamicQuery;
  update(values: unknown): DynamicQuery;
  delete(): DynamicQuery;
  eq(column: string, value: unknown): DynamicQuery;
  order(column: string, options?: { ascending?: boolean }): DynamicQuery;
  limit(count: number): DynamicQuery;
  single(): Promise<DynamicResult>;
};
type DynamicClient = { from(relation: string): DynamicQuery };

const table = (supabase: unknown, relation: string) => (supabase as DynamicClient).from(relation);
const str = (value: unknown) => (value == null ? "" : String(value));
const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : 0;
};

export type CommercialNoteType = "assumption" | "exclusion" | "clarification";
export type AlternateDecision = "pending" | "included" | "excluded";
export type BidPackageStatus = "draft" | "issued" | "leveled" | "awarded";
export type VendorQuoteStatus = "invited" | "received" | "qualified" | "selected" | "declined";

export interface EstimateCommercialNote {
  id: string;
  estimate_id: string;
  note_type: CommercialNoteType;
  description: string;
  status: "open" | "resolved";
  created_at: string;
}

export interface EstimateAlternate {
  id: string;
  estimate_id: string;
  name: string;
  description: string;
  amount_cents: number;
  decision: AlternateDecision;
  created_at: string;
}

export interface EstimateBidPackage {
  id: string;
  estimate_id: string;
  name: string;
  scope: string;
  status: BidPackageStatus;
  due_date: string | null;
  created_at: string;
}

export interface EstimateVendorQuote {
  id: string;
  estimate_id: string;
  bid_package_id: string | null;
  vendor_name: string;
  amount_cents: number;
  status: VendorQuoteStatus;
  inclusions: string;
  exclusions: string;
  received_at: string | null;
  created_at: string;
}

export interface EstimateVersion {
  id: string;
  estimate_id: string;
  version_no: number;
  name: string;
  note: string;
  subtotal_cents: number;
  total_cents: number;
  created_at: string;
}

export interface EstimateCommercialWorkspaceData {
  ready: boolean;
  notes: EstimateCommercialNote[];
  alternates: EstimateAlternate[];
  bid_packages: EstimateBidPackage[];
  vendor_quotes: EstimateVendorQuote[];
  versions: EstimateVersion[];
}

const emptyWorkspace = (): EstimateCommercialWorkspaceData => ({
  ready: false,
  notes: [],
  alternates: [],
  bid_packages: [],
  vendor_quotes: [],
  versions: [],
});

function schemaPending(error: DynamicError | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return Boolean(
    error &&
    (error.code === "42P01" ||
      error.code === "PGRST205" ||
      message.includes("estimate_commercial_notes") ||
      message.includes("estimate_alternates") ||
      message.includes("estimate_bid_packages") ||
      message.includes("estimate_vendor_quotes") ||
      message.includes("estimate_versions")),
  );
}

const normalizeNote = (row: Record<string, unknown>): EstimateCommercialNote => ({
  id: str(row.id),
  estimate_id: str(row.estimate_id),
  note_type: str(row.note_type) as CommercialNoteType,
  description: str(row.description),
  status: str(row.status) === "resolved" ? "resolved" : "open",
  created_at: str(row.created_at),
});
const normalizeAlternate = (row: Record<string, unknown>): EstimateAlternate => ({
  id: str(row.id),
  estimate_id: str(row.estimate_id),
  name: str(row.name),
  description: str(row.description),
  amount_cents: num(row.amount_cents),
  decision: str(row.decision) as AlternateDecision,
  created_at: str(row.created_at),
});
const normalizePackage = (row: Record<string, unknown>): EstimateBidPackage => ({
  id: str(row.id),
  estimate_id: str(row.estimate_id),
  name: str(row.name),
  scope: str(row.scope),
  status: str(row.status) as BidPackageStatus,
  due_date: row.due_date ? str(row.due_date) : null,
  created_at: str(row.created_at),
});
const normalizeQuote = (row: Record<string, unknown>): EstimateVendorQuote => ({
  id: str(row.id),
  estimate_id: str(row.estimate_id),
  bid_package_id: row.bid_package_id ? str(row.bid_package_id) : null,
  vendor_name: str(row.vendor_name),
  amount_cents: num(row.amount_cents),
  status: str(row.status) as VendorQuoteStatus,
  inclusions: str(row.inclusions),
  exclusions: str(row.exclusions),
  received_at: row.received_at ? str(row.received_at) : null,
  created_at: str(row.created_at),
});
const normalizeVersion = (row: Record<string, unknown>): EstimateVersion => ({
  id: str(row.id),
  estimate_id: str(row.estimate_id),
  version_no: num(row.version_no),
  name: str(row.name),
  note: str(row.note),
  subtotal_cents: num(row.subtotal_cents),
  total_cents: num(row.total_cents),
  created_at: str(row.created_at),
});

const estimateIdInput = z.object({ estimate_id: z.string().uuid() });

export const getEstimateCommercialWorkspace = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof estimateIdInput>) => estimateIdInput.parse(input))
  .handler(async ({ data, context }) => {
    const relations = [
      "estimate_commercial_notes",
      "estimate_alternates",
      "estimate_bid_packages",
      "estimate_vendor_quotes",
      "estimate_versions",
    ] as const;
    const results = await Promise.all(
      relations.map((relation) =>
        table(context.supabase, relation)
          .select("*")
          .eq("estimate_id", data.estimate_id)
          .order("created_at", { ascending: relation !== "estimate_versions" })
          .limit(500),
      ),
    );
    const pending = results.find((result) => schemaPending(result.error));
    if (pending) return emptyWorkspace();
    const failed = results.find((result) => result.error);
    if (failed?.error) throw new Error(failed.error.message);
    const rows = results.map((result) => (result.data ?? []) as Record<string, unknown>[]);
    return {
      ready: true,
      notes: rows[0].map(normalizeNote),
      alternates: rows[1].map(normalizeAlternate),
      bid_packages: rows[2].map(normalizePackage),
      vendor_quotes: rows[3].map(normalizeQuote),
      versions: rows[4].map(normalizeVersion),
    } satisfies EstimateCommercialWorkspaceData;
  });

const createItemInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("note"),
    estimate_id: z.string().uuid(),
    note_type: z.enum(["assumption", "exclusion", "clarification"]),
    description: z.string().trim().min(1).max(2000),
  }),
  z.object({
    kind: z.literal("alternate"),
    estimate_id: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).default(""),
    amount_cents: z.number().int().min(-99999999999).max(99999999999),
  }),
  z.object({
    kind: z.literal("package"),
    estimate_id: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
    scope: z.string().trim().max(4000).default(""),
    due_date: z.string().date().nullable().default(null),
  }),
  z.object({
    kind: z.literal("quote"),
    estimate_id: z.string().uuid(),
    bid_package_id: z.string().uuid().nullable(),
    vendor_name: z.string().trim().min(1).max(200),
    amount_cents: z.number().int().min(0).max(99999999999),
    inclusions: z.string().trim().max(4000).default(""),
    exclusions: z.string().trim().max(4000).default(""),
  }),
]);

export const createEstimateCommercialItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof createItemInput>) => createItemInput.parse(input))
  .handler(async ({ data, context }) => {
    const relation =
      data.kind === "note"
        ? "estimate_commercial_notes"
        : data.kind === "alternate"
          ? "estimate_alternates"
          : data.kind === "package"
            ? "estimate_bid_packages"
            : "estimate_vendor_quotes";
    const { kind: _kind, ...row } = data;
    const result = await table(context.supabase, relation).insert(row).select("*").single();
    if (result.error) {
      if (schemaPending(result.error)) throw new Error("Commercial controls are being enabled.");
      throw new Error(result.error.message);
    }
    return { ok: true };
  });

const updateItemInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("note"),
    id: z.string().uuid(),
    status: z.enum(["open", "resolved"]),
  }),
  z.object({
    kind: z.literal("alternate"),
    id: z.string().uuid(),
    decision: z.enum(["pending", "included", "excluded"]),
  }),
  z.object({
    kind: z.literal("package"),
    id: z.string().uuid(),
    status: z.enum(["draft", "issued", "leveled", "awarded"]),
  }),
  z.object({
    kind: z.literal("quote"),
    id: z.string().uuid(),
    status: z.enum(["invited", "received", "qualified", "selected", "declined"]),
  }),
]);

export const updateEstimateCommercialItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateItemInput>) => updateItemInput.parse(input))
  .handler(async ({ data, context }) => {
    const relation =
      data.kind === "note"
        ? "estimate_commercial_notes"
        : data.kind === "alternate"
          ? "estimate_alternates"
          : data.kind === "package"
            ? "estimate_bid_packages"
            : "estimate_vendor_quotes";
    const { kind: _kind, id, ...patch } = data;
    const result = await table(context.supabase, relation).update(patch).eq("id", id);
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  });

const deleteItemInput = z.object({
  kind: z.enum(["note", "alternate", "package", "quote"]),
  id: z.string().uuid(),
});

export const deleteEstimateCommercialItem = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof deleteItemInput>) => deleteItemInput.parse(input))
  .handler(async ({ data, context }) => {
    const relation = {
      note: "estimate_commercial_notes",
      alternate: "estimate_alternates",
      package: "estimate_bid_packages",
      quote: "estimate_vendor_quotes",
    }[data.kind];
    const result = await table(context.supabase, relation).delete().eq("id", data.id);
    if (result.error) throw new Error(result.error.message);
    return { ok: true };
  });

const versionInput = z.object({
  estimate_id: z.string().uuid(),
  name: z.string().trim().min(1).max(200),
  note: z.string().trim().max(2000).default(""),
});

export const createEstimateVersion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof versionInput>) => versionInput.parse(input))
  .handler(async ({ data, context }) => {
    const [estimateResult, linesResult, versionsResult] = await Promise.all([
      table(context.supabase, "estimates").select("*").eq("id", data.estimate_id).single(),
      table(context.supabase, "estimate_line_items")
        .select("*")
        .eq("estimate_id", data.estimate_id)
        .order("sort_order", { ascending: true })
        .limit(5000),
      table(context.supabase, "estimate_versions")
        .select("version_no")
        .eq("estimate_id", data.estimate_id)
        .order("version_no", { ascending: false })
        .limit(1),
    ]);
    if (estimateResult.error || !estimateResult.data) {
      throw new Error(estimateResult.error?.message ?? "Estimate not found.");
    }
    if (linesResult.error) throw new Error(linesResult.error.message);
    if (versionsResult.error && !schemaPending(versionsResult.error)) {
      throw new Error(versionsResult.error.message);
    }
    const previous = ((versionsResult.data ?? []) as Record<string, unknown>[])[0];
    const estimate = estimateResult.data as Record<string, unknown>;
    const result = await table(context.supabase, "estimate_versions")
      .insert({
        estimate_id: data.estimate_id,
        version_no: num(previous?.version_no) + 1,
        name: data.name,
        note: data.note,
        subtotal_cents: num(estimate.subtotal_cents),
        total_cents: num(estimate.total_with_markups_cents),
        estimate_snapshot: estimate,
        line_items_snapshot: linesResult.data ?? [],
      })
      .select("*")
      .single();
    if (result.error) {
      if (schemaPending(result.error)) throw new Error("Estimate versions are being enabled.");
      throw new Error(result.error.message);
    }
    return { version: normalizeVersion(result.data as Record<string, unknown>) };
  });
