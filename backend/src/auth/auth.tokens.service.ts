import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { REFRESH_TOKEN_TTL_MS } from './auth.constants.js';
import type { AuthTokens } from './auth.types.js';

@Injectable()
export class AuthTokensService {
    constructor(private readonly jwtService: JwtService) { }

    async createTokens(userId: string): Promise<AuthTokens> {
        const refreshToken = randomBytes(32).toString('hex');
        const refreshTokenHash = createHash('sha256')
            .update(refreshToken)
            .digest('hex');
        const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
        const accessToken = await this.jwtService.signAsync({ sub: userId });

        return { accessToken, refreshToken, refreshTokenHash, refreshExpiresAt };
    }
}
