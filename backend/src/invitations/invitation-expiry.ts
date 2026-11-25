export const INITIAL_INVITATION_LIFETIME_MS = 24 * 60 * 60 * 1000;

type PendingInvitationTimes = {
  issuedAt: Date;
  startTime: Date;
  previousExpiresAt: Date | null;
  now: Date;
};

export function getPendingInvitationExpiry({ issuedAt, startTime, previousExpiresAt, now }: PendingInvitationTimes): {
  expiresAt: Date;
  status: 'PENDING' | 'EXPIRED';
} {
  const nowMs = now.getTime();
  const previousDeadline = previousExpiresAt?.getTime();
  // A later start can extend a live invitation within its original 24 hours. A closed window stays closed.
  const deadline = previousDeadline !== undefined && previousDeadline <= nowMs
    ? previousDeadline
    : Math.min(issuedAt.getTime() + INITIAL_INVITATION_LIFETIME_MS, startTime.getTime());

  return { expiresAt: new Date(deadline), status: nowMs < deadline ? 'PENDING' : 'EXPIRED' };
}
