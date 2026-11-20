import { Injectable, UnauthorizedException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import { REFRESH_TOKEN_TTL_MS } from './auth.constants.js';
import type { AuthTokens } from './auth.types.js';

@Injectable()
export class AuthTokensService {
    constructor(private readonly jwtService: JwtService) { }

    createAccessToken(userId: string): Promise<string> {
        return this.jwtService.signAsync({ sub: userId });
    }

    hashRefreshToken(refreshToken: string): string {
        return createHash('sha256').update(refreshToken).digest('hex');
    }

    async verifyAccessToken(accessToken: string): Promise<string> {
        const payload: unknown = await this.jwtService.verifyAsync(accessToken);

        if (
            typeof payload !== 'object' || payload === null ||
            !('sub' in payload) || typeof payload.sub !== 'string' || !isUUID(payload.sub) ||
            !('exp' in payload) || typeof payload.exp !== 'number'
        ) {
            throw new UnauthorizedException('Invalid or expired access token');
        }

        return payload.sub;
    }


    async createTokens(userId: string): Promise<AuthTokens> {
        const refreshToken = randomBytes(32).toString('hex');
        const refreshTokenHash = this.hashRefreshToken(refreshToken);
        const refreshExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
        const accessToken = await this.createAccessToken(userId);

        return { accessToken, refreshToken, refreshTokenHash, refreshExpiresAt };
    }
}
