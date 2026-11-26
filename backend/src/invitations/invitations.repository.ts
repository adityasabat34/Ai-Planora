import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type EventInvitation } from '../generated/prisma/client.js';

const inboxInvitationSelect = {
  id: true, status: true, createdAt: true, expiresAt: true,
} satisfies Prisma.EventInvitationSelect;

const organizerInvitationSelect = {
  ...inboxInvitationSelect, eventId: true, inviteeEmail: true, respondedAt: true,
} satisfies Prisma.EventInvitationSelect;

type InvitationEvent = { startTime: Date; ownerEmail: string };
type NewInvitation = Pick<EventInvitation, 'eventId' | 'inviteeEmail' | 'inviteeUserId' | 'createdAt' | 'expiresAt'>;

// The PostgreSQL adapter binds JavaScript dates as UTC wall times without an offset.
const invitationTimeZone = Prisma.sql`SET LOCAL TIME ZONE 'UTC'`;

@Injectable()
export class InvitationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  withLockedEvent<T>(
    ownerId: string,
    eventId: string,
    work: (tx: Prisma.TransactionClient, event: InvitationEvent | undefined) => Promise<T>,
  ) {
    return this.prisma.$transaction(async tx => {
      // Read the calendar time in the connection's time zone. Edits and other sends wait until this transaction ends.
      const [event] = await tx.$queryRaw<InvitationEvent[]>`
        SELECT e."startTime", u."email" AS "ownerEmail" FROM "Event" e
        JOIN "User" u ON u."id" = e."ownerId"
        WHERE e."id" = ${eventId}::uuid AND e."ownerId" = ${ownerId}::uuid AND e."deletedAt" IS NULL
        FOR UPDATE OF e`;
      if (event) await tx.$executeRaw(invitationTimeZone);
      return work(tx, event);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
  }

  findByEventAndEmail(tx: Prisma.TransactionClient, eventId: string, email: string) {
    return tx.eventInvitation.findUnique({
      where: { eventId_inviteeEmail: { eventId, inviteeEmail: email } },
      select: organizerInvitationSelect,
    });
  }

  async lockRecipientIdByEmail(tx: Prisma.TransactionClient, email: string) {
    // Keep a matching account alive until the invitation referencing it has been saved.
    const [recipient] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User" WHERE "email" = ${email} FOR KEY SHARE`;
    return recipient?.id ?? null;
  }

  insert(tx: Prisma.TransactionClient, data: NewInvitation) {
    return tx.eventInvitation.create({ data, select: organizerInvitationSelect });
  }

  findForOrganizer(ownerId: string, eventId: string, invitationId: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw(invitationTimeZone);
      return tx.eventInvitation.findFirst({
        where: { id: invitationId, eventId, event: { ownerId, deletedAt: null } },
        select: organizerInvitationSelect,
      });
    });
  }

  findForRecipient(recipientId: string, take: number, cursor?: string) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw(invitationTimeZone);
      return tx.eventInvitation.findMany({
        where: { inviteeUserId: recipientId, event: { deletedAt: null } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        cursor: cursor ? { id: cursor } : undefined,
        take,
        select: inboxInvitationSelect,
      });
    });
  }
}
