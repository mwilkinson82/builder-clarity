export type StripeMode = "test" | "live";

export type OrganizationStripeColumns = {
  stripe_mode?: string | null;
  stripe_connect_account_id?: string | null;
  stripe_connect_status?: string | null;
  payment_processor_ready?: boolean | null;
  stripe_connect_account_id_test?: string | null;
  stripe_connect_status_test?: string | null;
  stripe_connect_account_id_live?: string | null;
  stripe_connect_status_live?: string | null;
};

export type SelectedStripeConnection = {
  mode: StripeMode;
  accountId: string;
  connectStatus: string;
  ready: boolean;
};

export const ORGANIZATION_STRIPE_SELECT = [
  "stripe_mode",
  "stripe_connect_account_id",
  "stripe_connect_status",
  "payment_processor_ready",
  "stripe_connect_account_id_test",
  "stripe_connect_status_test",
  "stripe_connect_account_id_live",
  "stripe_connect_status_live",
].join(",");

export function normalizeStripeMode(value: unknown): StripeMode {
  return value === "live" ? "live" : "test";
}

export function stripeConnectionForMode(
  row: OrganizationStripeColumns,
  requestedMode?: StripeMode,
): SelectedStripeConnection {
  const mode = requestedMode ?? normalizeStripeMode(row.stripe_mode);

  // Never fall back from live to the legacy account id. During the cutover the
  // legacy columns contain sandbox data, so doing that could create a test
  // charge while the UI says Live. Test mode keeps a legacy fallback solely so
  // code can fail safely if it deploys a few minutes before the backfill.
  const accountId =
    mode === "live"
      ? (row.stripe_connect_account_id_live ?? "")
      : row.stripe_connect_account_id_test || row.stripe_connect_account_id || "";
  const connectStatus =
    mode === "live"
      ? row.stripe_connect_status_live || "not_connected"
      : row.stripe_connect_status_test || row.stripe_connect_status || "not_connected";

  return {
    mode,
    accountId,
    connectStatus,
    ready: Boolean(accountId) && connectStatus === "active",
  };
}

export function stripeModeColumnNames(mode: StripeMode) {
  return mode === "live"
    ? {
        accountId: "stripe_connect_account_id_live" as const,
        status: "stripe_connect_status_live" as const,
      }
    : {
        accountId: "stripe_connect_account_id_test" as const,
        status: "stripe_connect_status_test" as const,
      };
}

export function stripeModePersistencePatch(
  mode: StripeMode,
  accountId: string,
  connectStatus: string,
) {
  const columns = stripeModeColumnNames(mode);
  return {
    [columns.accountId]: accountId,
    [columns.status]: connectStatus,
  };
}
