import { getPendingInvitationExpiry } from '../src/invitations/invitation-expiry.js';

describe('Initial invitation expiry', () => {
  const issuedAt = new Date('2026-11-24T09:00:00Z');
  const dayLimit = new Date('2026-11-25T09:00:00Z');
  const sameDayStart = new Date('2026-11-24T15:00:00Z');
  const laterStart = new Date('2026-11-27T09:00:00Z');
  const invitation = { issuedAt, startTime: laterStart, previousExpiresAt: null, now: issuedAt };

  it.each([
    ['24 hours after issue', laterStart, dayLimit],
    ['an earlier event start', sameDayStart, sameDayStart],
  ] as const)('uses %s as the deadline', (_reason, startTime, expiresAt) => {
    expect(getPendingInvitationExpiry({ ...invitation, startTime })).toEqual({ status: 'PENDING', expiresAt });
  });

  it.each([sameDayStart, dayLimit])('allows a response only before the cutoff %s', startTime => {
    const pending = { ...invitation, startTime };
    const justBefore = new Date(startTime.getTime() - 1);
    expect(getPendingInvitationExpiry({ ...pending, now: justBefore }).status).toBe('PENDING');
    expect(getPendingInvitationExpiry({ ...pending, now: startTime }).status).toBe('EXPIRED');
  });

  it('extends a live invitation only up to 24 hours from its original issue time', () => {
    const now = new Date('2026-11-24T12:00:00Z');
    expect(getPendingInvitationExpiry({ ...invitation, previousExpiresAt: sameDayStart, now }))
      .toEqual({ status: 'PENDING', expiresAt: dayLimit });
  });

  it('shortens a live deadline when an event moves earlier', () => {
    expect(getPendingInvitationExpiry({ ...invitation, previousExpiresAt: dayLimit, startTime: sameDayStart }))
      .toEqual({ status: 'PENDING', expiresAt: sameDayStart });
  });

  it('expires immediately when an event moves to a time that has already passed', () => {
    const now = new Date('2026-11-24T16:00:00Z');
    expect(getPendingInvitationExpiry({ ...invitation, previousExpiresAt: dayLimit, startTime: sameDayStart, now }))
      .toEqual({ status: 'EXPIRED', expiresAt: sameDayStart });
  });

  it.each([sameDayStart, new Date('2026-11-24T16:00:00Z')])('keeps the elapsed deadline when rescheduled at %s', now => {
    expect(getPendingInvitationExpiry({ ...invitation, previousExpiresAt: sameDayStart, now }))
      .toEqual({ status: 'EXPIRED', expiresAt: sameDayStart });
  });

  it('counts elapsed hours across a UTC offset change', () => {
    const sentBeforeClockChange = new Date('2026-10-31T15:00:00-04:00');
    const dayAfter = new Date('2026-11-01T14:00:00-05:00');
    expect(getPendingInvitationExpiry({ ...invitation, issuedAt: sentBeforeClockChange, now: dayAfter }))
      .toEqual({ status: 'EXPIRED', expiresAt: dayAfter });
  });
});
