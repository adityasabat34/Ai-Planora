import { ConfigService } from '@nestjs/config';
import { invitationFrontendLink } from '../src/invitations/invitation-mail.config.js';

describe('invitation email destination', () => {
  it.each([
    ['development', 'http://localhost:3000/register'],
    ['production', 'https://calendar.example.test/app/join?source=invitation'],
  ])('uses the exact configured %s registration URL', (environment, destination) => {
    const config = new ConfigService({ NODE_ENV: environment, FRONTEND_INVITATION_URL: destination });
    expect(invitationFrontendLink(config).href).toBe(destination);
  });

  it('requires an explicit frontend destination in development', () => {
    vi.stubEnv('FRONTEND_INVITATION_URL', undefined);
    try {
      const config = new ConfigService({ NODE_ENV: 'development', PORT: '3001' });
      expect(() => invitationFrontendLink(config)).toThrow('FRONTEND_INVITATION_URL');
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it.each([
    'http://calendar.example.test/register',
    'https://user:password@calendar.example.test/register',
    'https://calendar.example.test/register#existing',
  ])('rejects an invalid production destination %s', destination => {
    const config = new ConfigService({ NODE_ENV: 'production', FRONTEND_INVITATION_URL: destination });
    expect(() => invitationFrontendLink(config)).toThrow('FRONTEND_INVITATION_URL');
  });
});
