import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { isPrismaError, PRISMA_ERROR_CODES } from '../database/prisma-errors.js';
import type { CreateEventInput, EventSchedule, UpdateEventInput } from './events.types.js';
import { EVENT_CLEANUP_BATCH_SIZE } from './events.constants.js';
import { INITIAL_INVITATION_LIFETIME_MS } from '../invitations/invitation-expiry.js';

@Injectable()
export class EventsRepository {
  constructor(private readonly prisma: PrismaService) { }

  softDelete(id: string, ownerId: string, deletedAt: Date) {
    return this.prisma.event.updateMany({
      where: { id, ownerId, deletedAt: null },
      data: { deletedAt },
    });
  }

  findRecoverableDeleted(id: string, ownerId: string, cutoff: Date, now: Date) {
    return this.prisma.event.findUnique({
      where: { id, ownerId, deletedAt: { gt: cutoff, lte: now } },
      select: { id: true },
    });
  }

  findTrash(ownerId: string, cutoff: Date, now: Date) {
    return this.prisma.event.findMany({
      where: { ownerId, deletedAt: { gt: cutoff, lte: now } },
      orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true, ownerId: true, title: true, startTime: true, endTime: true,
        location: true, privateNote: true, createdAt: true, updatedAt: true, deletedAt: true,
      },
    });
  }

  async restore(id: string, ownerId: string, cutoff: Date, now: Date) {
    try {
      return await this.prisma.event.update({
        where: { id, ownerId, deletedAt: { gt: cutoff, lte: now } },
        data: { deletedAt: null },
        select: {
          id: true, ownerId: true, title: true, startTime: true, endTime: true,
          location: true, privateNote: true, createdAt: true, updatedAt: true,
        },
      });
    } catch (error) {
      if (isPrismaError(error, PRISMA_ERROR_CODES.RECORD_NOT_FOUND)) return null;
      throw error;
    }
  }

  async deleteExpiredBatch(cutoff: Date) {
    const expired = await this.prisma.event.findMany({
      where: { deletedAt: { lte: cutoff } },
      orderBy: [{ deletedAt: 'asc' }, { id: 'asc' }],
      take: EVENT_CLEANUP_BATCH_SIZE,
      select: { id: true },
    });
    if (expired.length === 0) return { count: 0 };
    // Recheck expiry in the delete itself: a restored event must survive a stale batch selection.
    return this.prisma.event.deleteMany({
      where: { id: { in: expired.map(event => event.id) }, deletedAt: { lte: cutoff } },
    });
  }

  async updateOwned(id: string, ownerId: string, data: UpdateEventInput, expectedSchedule?: EventSchedule) {
    try {
      const updateEvent = this.prisma.event.update({
        // Compare the schedule and write atomically to preserve a valid range under concurrent edits.
        where: { id, ownerId, deletedAt: null, ...expectedSchedule },
        data,
        select: {
          id: true, ownerId: true, title: true, startTime: true, endTime: true,
          location: true, privateNote: true, createdAt: true, updatedAt: true,
        },
      });
      const newStart = data.startTime;
      if (!newStart || newStart.getTime() === expectedSchedule?.startTime.getTime()) return await updateEvent;

      // The event update locks the row first, exactly as invitation creation does.
      // Update all pending deadlines in one statement, preserving a deadline that already elapsed.
      const startInstant = newStart.toISOString();
      const [event] = await this.prisma.$transaction([updateEvent, this.prisma.$executeRaw`
        UPDATE "EventInvitation"
        SET "expiresAt" = CASE WHEN "expiresAt" <= statement_timestamp() THEN "expiresAt"
            ELSE LEAST("createdAt" + ${INITIAL_INVITATION_LIFETIME_MS} * INTERVAL '1 millisecond', ${startInstant}::timestamptz) END,
            "status" = CASE WHEN LEAST("expiresAt", ${startInstant}::timestamptz) <= statement_timestamp()
                THEN 'EXPIRED'::"InvitationStatus" ELSE "status" END
        WHERE "eventId" = ${id}::uuid AND "status" = 'PENDING'`]);
      return event;
    } catch (error) {
      if (isPrismaError(error, PRISMA_ERROR_CODES.RECORD_NOT_FOUND)) return null;
      throw error;
    }
  }

  findOverlapping(ownerId: string, from: Date, to: Date) {
    return this.prisma.event.findMany({
      // Half-open intervals: merely touching either boundary is not an overlap.
      where: { ownerId, deletedAt: null, startTime: { lt: to }, endTime: { gt: from } },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        ownerId: true,
        title: true,
        startTime: true,
        endTime: true,
        location: true,
        privateNote: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  findByIdAndOwner(id: string, ownerId: string) {
    return this.prisma.event.findUnique({
      where: { id, ownerId, deletedAt: null },
      select: {
        id: true,
        ownerId: true,
        title: true,
        startTime: true,
        endTime: true,
        location: true,
        privateNote: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async create(input: CreateEventInput) {
    try {
      return await this.prisma.event.create({
        data: input,
        select: {
          id: true,
          ownerId: true,
          title: true,
          startTime: true,
          endTime: true,
          location: true,
          privateNote: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      // The owner can be deleted after the onboarding guard has checked the account.
      if (isPrismaError(error, PRISMA_ERROR_CODES.FOREIGN_KEY_CONSTRAINT)) {
        throw new UnauthorizedException('Account is no longer available');
      }
      throw error;
    }
  }
}
