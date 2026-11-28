import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Mailer } from '@nestjs/mail';
import { invitationFrontendLink } from './invitation-mail.config.js';
import { InvitationsRepository } from './invitations.repository.js';

@Injectable()
export class InvitationMailService {
  constructor(
    private readonly repository: InvitationsRepository,
    private readonly mailer: Mailer,
    private readonly config: ConfigService,
  ) {}

  async deliver(id: string, to: string, reservedUntil: Date) {
    // Send after commit so a slow mail server never holds the event lock.
    try {
      const link = invitationFrontendLink(this.config);
      await this.mailer.send({
        to,
        subject: 'You have a Planora invitation',
        text: `You have been invited to an event on Planora. Open this link and register or sign in with this email address to see the invitation in your inbox.\n\n${link.href}`,
        idempotencyKey: `invitation-${id}`,
      });
    } catch {
      await this.repository.finishEmailAttempt(id, reservedUntil, new Date());
      throw new ServiceUnavailableException('Could not deliver the invitation email. Please retry.');
    }
    await this.repository.finishEmailAttempt(id, reservedUntil, null);
  }
}
