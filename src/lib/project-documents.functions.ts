// PROJECTFILEROOM1 — server functions for the project file room.
//
// The bytes live in the private 'project-docs' storage bucket (uploaded
// client-side, where the user's session carries the storage RLS). These fns own
// the metadata row: what the file is, its category, who uploaded it, when. Reads
// and writes degrade gracefully before the migration is applied.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type DynamicSupabaseError = { code?: string; message: string };
type DynamicSupabaseResult<T = unknown> = { data: T | null; error: DynamicSupabaseError | null };
type DynamicSupabaseQuery = PromiseLike<DynamicSupabaseResult> & {
  select(columns?: string): DynamicSupabaseQuery;
  insert(values: unknown): DynamicSupabaseQuery;
  update(values: unknown): DynamicSupabaseQuery;
  delete(): DynamicSupabaseQuery;
  eq(column: string, value: unknown): DynamicSupabaseQuery;
  order(column: string, options?: { ascending?: boolean }): DynamicSupabaseQuery;
  single(): Promise<DynamicSupabaseResult>;
};
type DynamicSupabaseClient = { from(relation: string): DynamicSupabaseQuery };
const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as DynamicSupabaseClient).from(relation);

const num = (value: unknown) => {
  const n = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};
const str = (value: unknown, fallback = "") => (typeof value === "string" ? value : fallback);

function isMissingTable(error: DynamicSupabaseError | null) {
  const message = error?.message ?? "";
  return (
    error?.code === "PGRST205" ||
    /project_documents|schema cache|does not exist|relation/i.test(message)
  );
}
const NOT_ENABLED =
  "The file room isn't enabled on this workspace yet — the project_documents migration hasn't been applied.";

// The preset category vocabulary the app supplies. The column is intentionally
// free text so project teams can also create their own categories without a
// migration. `other` remains available as a catch-all.
export const PROJECT_DOC_CATEGORIES = [
  "prime_contract",
  "specifications",
  "drawings",
  "qc_qa",
  "invoices",
  "receipts",
  // COIs + lien waivers filed from the Subcontractors compliance panel land
  // here automatically, so the File Room indexes all the compliance paper.
  "compliance",
  "other",
] as const;
export type ProjectDocCategory = (typeof PROJECT_DOC_CATEGORIES)[number];
export const PROJECT_DOC_CATEGORY_MAX_LENGTH = 80;

const projectDocCategorySchema = z
  .string()
  .max(200)
  .transform((value) => value.replace(/\s+/g, " ").trim())
  .pipe(
    z
      .string()
      .min(1, "Category is required")
      .max(
        PROJECT_DOC_CATEGORY_MAX_LENGTH,
        `Category must be ${PROJECT_DOC_CATEGORY_MAX_LENGTH} characters or less`,
      ),
  );

export interface ProjectDocumentRow {
  id: string;
  project_id: string;
  category: string;
  title: string;
  description: string;
  storage_path: string;
  file_name: string;
  content_type: string;
  size_bytes: number;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

function normalizeDocument(row: Record<string, unknown>): ProjectDocumentRow {
  return {
    id: str(row.id),
    project_id: str(row.project_id),
    category: str(row.category, "other"),
    title: str(row.title),
    description: str(row.description),
    storage_path: str(row.storage_path),
    file_name: str(row.file_name),
    content_type: str(row.content_type),
    size_bytes: num(row.size_bytes),
    uploaded_by: (row.uploaded_by as string | null) ?? null,
    created_at: str(row.created_at),
    updated_at: str(row.updated_at),
  };
}

export const listProjectDocuments = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { projectId: string }) =>
    z.object({ projectId: z.string().uuid() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<ProjectDocumentRow[]> => {
    const { data: rows, error } = await dynamicTable(context.supabase, "project_documents")
      .select("*")
      .eq("project_id", data.projectId)
      .order("created_at", { ascending: false });
    if (error) {
      if (isMissingTable(error)) return [];
      throw new Error(error.message);
    }
    return ((rows ?? []) as Record<string, unknown>[])
      .filter((row) => row.archived_at == null)
      .map(normalizeDocument);
  });

const recordInput = z.object({
  projectId: z.string().uuid(),
  category: projectDocCategorySchema.default("other"),
  title: z.string().max(300).default(""),
  description: z.string().max(2000).default(""),
  storage_path: z.string().min(1).max(500),
  file_name: z.string().min(1).max(300),
  content_type: z.string().max(200).default(""),
  size_bytes: z.number().min(0).default(0),
});

export const recordProjectDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof recordInput>) => recordInput.parse(input))
  .handler(async ({ data, context }): Promise<ProjectDocumentRow> => {
    const { data: row, error } = await dynamicTable(context.supabase, "project_documents")
      .insert({
        project_id: data.projectId,
        category: data.category,
        title: data.title.trim(),
        description: data.description.trim(),
        storage_path: data.storage_path,
        file_name: data.file_name,
        content_type: data.content_type,
        size_bytes: data.size_bytes,
        uploaded_by: context.userId,
      })
      .select("*")
      .single();
    if (error) {
      if (isMissingTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    return normalizeDocument(row as Record<string, unknown>);
  });

const updateInput = z.object({
  id: z.string().uuid(),
  category: projectDocCategorySchema.optional(),
  title: z.string().max(300).optional(),
  description: z.string().max(2000).optional(),
});

export const updateProjectDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: z.input<typeof updateInput>) => updateInput.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.category !== undefined) patch.category = data.category;
    if (data.title !== undefined) patch.title = data.title.trim();
    if (data.description !== undefined) patch.description = data.description.trim();
    const { error } = await dynamicTable(context.supabase, "project_documents")
      .update(patch)
      .eq("id", data.id);
    if (error) {
      if (isMissingTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    return { id: data.id };
  });

// Soft delete — the document is archived (kept), not destroyed. The storage bytes
// are removed client-side (where the session carries storage RLS).
export const archiveProjectDocument = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { id: string }) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { error } = await dynamicTable(context.supabase, "project_documents")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) {
      if (isMissingTable(error)) throw new Error(NOT_ENABLED);
      throw new Error(error.message);
    }
    return { id: data.id };
  });
