import { Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isEmail } from 'class-validator';
import { OAuth2Client } from 'google-auth-library';
import type { GoogleIdentity } from './auth.types.js';

@Injectable()
export class GoogleIdentityService {
    constructor(
        private readonly config: ConfigService,
        private readonly client: OAuth2Client,
    ) { }

    getClientId(): string {
        const clientId = this.config.get<string>('GOOGLE_CLIENT_ID')?.trim();
        if (!clientId) {
            throw new ServiceUnavailableException('Google sign-in is not configured');
        }
        return clientId;
    }

    async verify(idToken: string, expectedNonce: string): Promise<GoogleIdentity> {
        const audience = this.getClientId();
        try {
            const ticket = await this.client.verifyIdToken({ idToken, audience });
            const payload = ticket.getPayload();
            if (
                typeof payload?.sub !== 'string' || !payload.sub || payload.sub.length > 255 ||
                typeof payload.email !== 'string' || !isEmail(payload.email) || payload.email.length > 254 ||
                payload.email_verified !== true || payload.nonce !== expectedNonce
            ) {
                throw new Error('Invalid Google identity');
            }

            return {
                googleSub: payload.sub,
                email: payload.email.trim().toLowerCase(),
                fullName: typeof payload.name === 'string' ? payload.name.trim().slice(0, 100) : '',
            };
        } catch {
            throw new UnauthorizedException('Invalid or expired Google identity token');
        }
    }
}
