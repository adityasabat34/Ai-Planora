import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { paginateByCursor } from '../common/cursor-pagination.js';
import type { CursorPaginationQueryDto } from '../common/dto/cursor-pagination-query.dto.js';
import { InvitationStatus, type EventInvitation } from '../generated/prisma/client.js';
import { getPendingInvitationExpiry } from './invitation-expiry.js';
import { InvitationMailService } from './invitation-mail.service.js';
import { InvitationsRepository } from './invitations.repository.js';

function withCurrentStatus<T extends Pick<EventInvitation, 'status' | 'expiresAt'>>(invitation: T, nowMs = Date.now()) {
  if (invitation.status === InvitationStatus.PENDING && invitation.expiresAt.getTime() <= nowMs) {
    return { ...invitation, status: InvitationStatus.EXPIRED };
  }
  return invitation;
}

@Injectable()
export class InvitationsService {
  constructor(
    private readonly invitationsRepository: InvitationsRepository,
    private readonly invitationMail: InvitationMailService,
  ) {}

  async create(ownerId: string, eventId: string, email: string) {
    const { created, invitation, reservedUntil } = await this.invitationsRepository.withLockedEvent(ownerId, eventId, async (tx, event) => {
      if (!event) throw new NotFoundException('Event not found');
      if (email === event.ownerEmail) throw new BadRequestException('You already organize this event');

      // A repeated send returns the original invitation with its current status and deadline.
      const existing = await this.invitationsRepository.findByEventAndEmail(tx, eventId, email);
      let invitation = existing && withCurrentStatus(existing);
      if (!invitation) {
        // A new invite expires 24 hours from now or at the event start, whichever comes first.
        const inviteeUserId = await this.invitationsRepository.lockRecipientIdByEmail(tx, email);
        const now = new Date();
        const { expiresAt, status } = getPendingInvitationExpiry({
          issuedAt: now, startTime: event.startTime, previousExpiresAt: null, now,
        });
        if (status === InvitationStatus.EXPIRED) throw new ConflictException('The event has already started');
        invitation = await this.invitationsRepository.insert(tx, { eventId, inviteeEmail: email, inviteeUserId, createdAt: now, expiresAt });
      }
      const reservedUntil = invitation.status === InvitationStatus.PENDING
        ? await this.invitationsRepository.reserveEmailAttempt(tx, invitation.id) : undefined;
      return { created: !existing, invitation, reservedUntil };
    });
    if (reservedUntil) await this.invitationMail.deliver(invitation.id, email, reservedUntil);
    return { created, invitation };
  }

  async findForOrganizer(ownerId: string, eventId: string, invitationId: string) {
    const invitation = await this.invitationsRepository.findForOrganizer(ownerId, eventId, invitationId);
    if (!invitation) throw new NotFoundException('Invitation not found');
    return withCurrentStatus(invitation);
  }

  async findPreviewForRecipient(recipientId: string, invitationId: string) {
    const invitation = await this.invitationsRepository.findPreviewForRecipient(recipientId, invitationId);
    if (!invitation) throw new NotFoundException('Invitation not found');

    const { id, status, event } = withCurrentStatus(invitation);
    const { title, startTime, endTime, owner } = event;
    return {
      id, status,
      organizer: owner,
      event: { title, startTime, endTime, timeZone: 'UTC' },
    };
  }

  async listForRecipient(recipientId: string, query: CursorPaginationQueryDto) {
    const { items, nextCursor } = await paginateByCursor(
      query,
      (take, cursor) => this.invitationsRepository.findForRecipient(recipientId, take, cursor),
      'Invalid inbox cursor',
    );
    const nowMs = Date.now();
    return { items: items.map(invitation => withCurrentStatus(invitation, nowMs)), nextCursor };
  }
}
