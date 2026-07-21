import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import {
  jsonError,
  jsonOk,
  requireAuthedStripeContext,
  requireManageSettings,
  RouteError,
} from "@/lib/stripe.server";
import { COMPANY_ASSET_BUCKET, companyLogoPath, versionAssetUrl } from "@/lib/company-assets";

const COMPANY_LOGO_MAX_BYTES = 2 * 1024 * 1024;
const COMPANY_LOGO_TYPES = new Set(["image/png", "image/jpeg"]);

const logoUploadInput = z.object({
  organizationId: z.string().uuid(),
  oldPath: z.string().max(500).optional(),
});

type StorageErrorLike = {
  message?: string;
  statusCode?: string | number;
  status?: string | number;
};

type DynamicUpdateResult = PromiseLike<{ error: { message: string } | null }>;

type DynamicUpdateBuilder = {
  update: (values: Record<string, unknown>) => {
    eq: (column: string, value: unknown) => DynamicUpdateResult;
  };
};

const dynamicTable = (supabase: unknown, relation: string) =>
  (supabase as { from(table: string): DynamicUpdateBuilder }).from(relation);

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "");
}

function storageStatus(error: StorageErrorLike | null | undefined) {
  return Number(error?.statusCode ?? error?.status ?? 0);
}

function isMissingBucketError(error: StorageErrorLike | null | undefined) {
  const message = errorMessage(error).toLowerCase();
  return storageStatus(error) === 404 || message.includes("bucket not found");
}

function isAlreadyExistsError(error: StorageErrorLike | null | undefined) {
  const message = errorMessage(error).toLowerCase();
  return message.includes("already exists") || message.includes("already been taken");
}

function isMissingLogoColumnError(error: { message?: string; code?: string } | null | undefined) {
  const message = (error?.message ?? "").toLowerCase();
  return (
    (error?.code === "PGRST204" || message.includes("schema cache")) &&
    (message.includes("'logo_url'") || message.includes("'logo_path'"))
  );
}

function normalizeStoragePath(path: string | undefined, organizationId: string) {
  const trimmed = path?.trim() || "";
  if (!trimmed.startsWith(`${organizationId}/`)) return "";
  if (trimmed.includes("..") || trimmed.includes("//")) return "";
  return trimmed;
}

async function ensureCompanyAssetBucket(
  storage: Awaited<ReturnType<typeof requireAuthedStripeContext>>["admin"]["storage"],
) {
  const { error: getError } = await storage.getBucket(COMPANY_ASSET_BUCKET);
  if (!getError) return;
  if (!isMissingBucketError(getError)) throw new Error(getError.message);

  const { error: createError } = await storage.createBucket(COMPANY_ASSET_BUCKET, {
    public: true,
    fileSizeLimit: COMPANY_LOGO_MAX_BYTES,
    allowedMimeTypes: Array.from(COMPANY_LOGO_TYPES),
  });
  if (createError && !isAlreadyExistsError(createError)) {
    throw new Error(createError.message);
  }
}

function readLogoFile(formData: FormData) {
  const value = formData.get("logo");
  if (!(value instanceof File)) {
    throw new RouteError("logo_missing", "Choose a PNG or JPG logo file before uploading.", 400);
  }
  if (!COMPANY_LOGO_TYPES.has(value.type)) {
    throw new RouteError("logo_type_invalid", "Company logos must be PNG or JPG files.", 400);
  }
  if (value.size > COMPANY_LOGO_MAX_BYTES) {
    throw new RouteError("logo_too_large", "Company logos must be 2 MB or smaller.", 400);
  }
  return value;
}

export const Route = createFileRoute("/api/company/assets/logo")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const context = await requireAuthedStripeContext(request);
          const formData = await request.formData();
          const input = logoUploadInput.parse({
            organizationId: formData.get("organizationId"),
            oldPath: formData.get("oldPath") || undefined,
          });
          await requireManageSettings(context, input.organizationId);

          const logo = readLogoFile(formData);
          await ensureCompanyAssetBucket(context.admin.storage);

          const path = companyLogoPath(input.organizationId);
          const { error: uploadError } = await context.admin.storage
            .from(COMPANY_ASSET_BUCKET)
            .upload(path, logo, {
              cacheControl: "60",
              contentType: logo.type,
              upsert: true,
            });
          if (uploadError) throw new Error(uploadError.message);

          const { data } = context.admin.storage.from(COMPANY_ASSET_BUCKET).getPublicUrl(path);
          const uploadVersion = Date.now();
          const logoUrl = versionAssetUrl(data.publicUrl, uploadVersion);
          const { error: updateError } = await dynamicTable(context.admin, "organizations")
            .update({ logo_url: logoUrl, logo_path: path, updated_at: new Date().toISOString() })
            .eq("id", input.organizationId);
          if (updateError) {
            if (!isMissingLogoColumnError(updateError)) throw new Error(updateError.message);
            await dynamicTable(context.admin, "organizations")
              .update({ updated_at: new Date().toISOString() })
              .eq("id", input.organizationId);
          }

          const oldPath = normalizeStoragePath(input.oldPath, input.organizationId);
          if (oldPath && oldPath !== path) {
            await context.admin.storage.from(COMPANY_ASSET_BUCKET).remove([oldPath]);
          }

          return jsonOk({ logoUrl, path });
        } catch (error) {
          return jsonError(error);
        }
      },
    },
  },
});
