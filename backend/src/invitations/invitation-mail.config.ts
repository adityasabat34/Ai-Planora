import type { ConfigService } from '@nestjs/config';
import { FileMailTransport, SmtpTransport, type MailModuleOptions } from '@nestjs/mail';

export function invitationFrontendLink(config: ConfigService): URL {
  const link = new URL(config.getOrThrow<string>('FRONTEND_INVITATION_URL'));
  const allowHttp = config.get('NODE_ENV') !== 'production' && link.protocol === 'http:';
  if ((link.protocol !== 'https:' && !allowHttp) || link.username || link.password || link.hash) {
    throw new Error('FRONTEND_INVITATION_URL must be a web URL without credentials or a fragment and must use HTTPS in production');
  }
  return link;
}

export function invitationMailOptions(config: ConfigService): MailModuleOptions {
  const production = config.get('NODE_ENV') === 'production';
  const smtpUrl = config.get<string>('SMTP_URL')?.trim();
  const from = config.get<string>('MAIL_FROM')?.trim();
  if (production && (!smtpUrl || !from)) throw new Error('Set SMTP_URL and MAIL_FROM to send invitation email in production');
  return {
    from: from || 'Planora <invites@planora.test>',
    transport: smtpUrl ? new SmtpTransport({ url: smtpUrl }) : new FileMailTransport({ directory: 'var/mail', log: false }),
  };
}
