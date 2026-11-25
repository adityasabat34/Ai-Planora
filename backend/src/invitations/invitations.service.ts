import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { InvitationStatus, Prisma } from '../generated/prisma/client.js';
import { getPendingInvitationExpiry } from './invitation-expiry.js';

const organizerInvitationSelect = {
  id: true, eventId: true, inviteeEmail: true, status: true,
  createdAt: true, expiresAt: true, respondedAt: true,
} satisfies Prisma.EventInvitationSelect;

type OrganizerInvitation = Prisma.EventInvitationGetPayload<{ select: typeof organizerInvitationSelect }>;

// The PostgreSQL adapter binds JavaScript dates as UTC wall times without an offset.
const invitationTimeZone = Prisma.sql`SET LOCAL TIME ZONE 'UTC'`;

function withCurrentStatus(invitation: OrganizerInvitation): OrganizerInvitation {
  if (invitation.status === InvitationStatus.PENDING && invitation.expiresAt.getTime() <= Date.now()) {
    return { ...invitation, status: InvitationStatus.EXPIRED };
  }
  return invitation;
}

@Injectable()
export class InvitationsService {
  constructor(private readonly prisma: PrismaService) {}

  create(ownerId: string, eventId: string, email: string) {
    return this.prisma.$transaction(async tx => {
      // Find the organizer's event outside the recycle bin and lock it so edits wait.
      // Read its start time for the invite deadline and the organizer's email to reject self-invites.
      const [event] = await tx.$queryRaw<{ startTime: Date; ownerEmail: string }[]>`
        SELECT e."startTime", u."email" AS "ownerEmail" FROM "Event" e
        JOIN "User" u ON u."id" = e."ownerId"
        WHERE e."id" = ${eventId}::uuid AND e."ownerId" = ${ownerId}::uuid AND e."deletedAt" IS NULL
        FOR UPDATE OF e`;
      if (!event) throw new NotFoundException('Event not found');
      if (email === event.ownerEmail) throw new BadRequestException('You already organize this event');

      // Switch to UTC for invitation timestamps. If this email already has an invite to this event,
      // return the saved invite with its current status and keep its existing deadline.
      await tx.$executeRaw(invitationTimeZone);
      const existing = await tx.eventInvitation.findUnique({
        where: { eventId_inviteeEmail: { eventId, inviteeEmail: email } },
        select: organizerInvitationSelect,
      });
      if (existing) return { created: false, invitation: withCurrentStatus(existing) };

      // Look up the recipient by email and prevent deletion of a matching account while saving the invite.
      // The deadline is 24 hours from now or when the event starts, whichever comes first.
      // Reject a new invite if the event has already started.
      const [recipient] = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "User" WHERE "email" = ${email} FOR KEY SHARE`;
      const now = new Date();
      const { expiresAt, status } = getPendingInvitationExpiry({
        issuedAt: now, startTime: event.startTime, previousExpiresAt: null, now,
      });
      if (status === InvitationStatus.EXPIRED) throw new ConflictException('The event has already started');

      // Save a pending invite by email, linking the recipient's user ID if they have an account.
      // Return it as newly created. Committing releases the event lock so a waiting retry can find it.
      const invitation = await tx.eventInvitation.create({
        data: { eventId, inviteeEmail: email, inviteeUserId: recipient?.id ?? null, createdAt: now, expiresAt },
        select: organizerInvitationSelect,
      });
      return { created: true, invitation };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  async findForOrganizer(ownerId: string, eventId: string, invitationId: string) {
    const invitation = await this.prisma.$transaction(async tx => {
      await tx.$executeRaw(invitationTimeZone);
      return tx.eventInvitation.findFirst({
        where: { id: invitationId, eventId, event: { ownerId, deletedAt: null } },
        select: organizerInvitationSelect,
      });
    });
    if (!invitation) throw new NotFoundException('Invitation not found');
    return withCurrentStatus(invitation);
  }
}
