export type ClientAccessGrantBase = {
  project_id: string;
  contact_id: string;
  email: string;
  role: "client";
  invited_by: string;
};

export type NewClientAccessGrant = ClientAccessGrantBase & {
  status: "pending";
  can_view_change_orders: true;
  can_view_daily_reports: false;
  can_view_billing: false;
};

export function findExactNormalizedEmailRow<T extends { email?: unknown }>(
  rows: T[],
  normalizedEmail: string,
  label: string,
): T | null {
  const matches = rows.filter(
    (row) => typeof row.email === "string" && row.email.trim().toLowerCase() === normalizedEmail,
  );
  if (matches.length > 1) {
    throw new Error(`Multiple active ${label} records exist for this exact email.`);
  }
  return matches[0] ?? null;
}

/**
 * Updating an existing access row must not revoke a working client session.
 * Omitting status, binding, acceptance, and module fields preserves the
 * row's current authorization state. Only a new grant receives defaults.
 */
export function buildClientAccessGrantWrite(
  base: ClientAccessGrantBase,
  existingAccessId: string | null,
): ClientAccessGrantBase | NewClientAccessGrant {
  if (existingAccessId) return base;

  return {
    ...base,
    status: "pending",
    can_view_change_orders: true,
    can_view_daily_reports: false,
    can_view_billing: false,
  };
}
