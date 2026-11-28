import { Injectable } from '@nestjs/common';
import { lockInvitationEmail } from '../database/lock-invitation-email.js';
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
const EMAIL_RETRY_DELAY_MS = 5 * 60 * 1000;

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
    await lockInvitationEmail(tx, email);
    // Keep a matching account alive until the invitation referencing it has been saved.
    const [recipient] = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "User" WHERE "email" = ${email} FOR KEY SHARE`;
    return recipient?.id ?? null;
  }

  insert(tx: Prisma.TransactionClient, data: NewInvitation) {
    return tx.eventInvitation.create({ data: { ...data, emailRetryAt: data.createdAt }, select: organizerInvitationSelect });
  }

  async reserveEmailAttempt(tx: Prisma.TransactionClient, id: string) {
    const now = new Date();
    const reservedUntil = new Date(now.getTime() + EMAIL_RETRY_DELAY_MS);
    // A retry can take over if a sender exits between the database commit and mail delivery.
    const { count } = await tx.eventInvitation.updateMany({
      where: { id, emailRetryAt: { lte: now } },
      data: { emailRetryAt: reservedUntil },
    });
    return count ? reservedUntil : undefined;
  }

  finishEmailAttempt(id: string, reservedUntil: Date, retryAt: Date | null) {
    return this.prisma.$transaction(async tx => {
      await tx.$executeRaw(invitationTimeZone);
      await tx.eventInvitation.updateMany({
        where: { id, emailRetryAt: reservedUntil },
        data: { emailRetryAt: retryAt },
      });
    });
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

  findPreviewForRecipient(recipientId: string, invitationId: string) {
    return this.prisma.$transaction(async tx => {
      const preview = await tx.eventInvitation.findUnique({
        where: { id: invitationId, inviteeUserId: recipientId, event: { deletedAt: null } },
        select: {
          id: true,
          status: true,
          event: {
            select: {
              title: true, startTime: true, endTime: true,
              owner: { select: { fullName: true, username: true, email: true } },
            },
          },
        },
      });
      if (!preview) return null;

      // Read the schedule with the calendar's time zone before switching to UTC for the deadline.
      await tx.$executeRaw(invitationTimeZone);
      const { expiresAt } = await tx.eventInvitation.findUniqueOrThrow({
        where: { id: preview.id }, select: { expiresAt: true },
      });
      return { ...preview, expiresAt };
    }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
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
