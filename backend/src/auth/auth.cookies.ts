import type { CookieOptions } from 'express';
import { ACCESS_TOKEN_TTL_SECONDS } from './auth.constants.js';

export const AUTH_COOKIE_NAMES = {
    accessToken: 'access_token',
    refreshToken: 'refresh_token',
} as const;

export function createAuthCookieOptions(
    isProduction: boolean,
    refreshExpiresAt: Date,
) {
    const sharedOptions: CookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
    };

    return {
        accessToken: {
            ...sharedOptions,
            path: '/',
            maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
        },
        refreshToken: {
            ...sharedOptions,
            path: '/auth',
            expires: refreshExpiresAt,
        },
    };
}
