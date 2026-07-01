export const OVERWATCH_ADMIN_EMAIL = "wilkinson.marshall@gmail.com";

export function isOverwatchAdminEmail(email: string | null | undefined) {
  return email?.trim().toLowerCase() === OVERWATCH_ADMIN_EMAIL;
}
