export type InviteSeatAvailability = {
  seatLimit: number | null;
  activeSeats: number | null;
  pendingInvites: number | null;
  existingPendingInviteId: string | null;
};

export type PendingInviteIdentity = {
  id: string;
  email: string;
};

export function findExactPendingInvite(
  rows: PendingInviteIdentity[],
  normalizedEmail: string,
): PendingInviteIdentity | null {
  const matches = rows.filter((row) => row.email.trim().toLowerCase() === normalizedEmail);
  if (matches.length > 1) {
    throw new Error("Multiple pending invitations exist for this exact email.");
  }
  return matches[0] ?? null;
}

/**
 * Reissuing the exact same pending invite does not claim another seat.
 * Only a genuinely new pending invite is subject to the seat ceiling.
 */
export function assertInviteSeatAvailable(input: InviteSeatAvailability): void {
  if (input.existingPendingInviteId) return;

  const claimedSeats = (input.activeSeats ?? 0) + (input.pendingInvites ?? 0);
  if (input.seatLimit !== null && claimedSeats >= input.seatLimit) {
    throw new Error(
      `This Overwatch company is at its ${input.seatLimit}-seat limit. Revoke an invite or upgrade before adding another person.`,
    );
  }
}
