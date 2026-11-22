import type { CookieOptions } from 'express';
import { ACCESS_TOKEN_TTL_SECONDS, GOOGLE_PROOF_TTL_SECONDS } from './auth.constants.js';

export const AUTH_COOKIE_NAMES = {
    accessToken: 'access_token',
    refreshToken: 'refresh_token',
    googleNonce: 'google_nonce',
    googleSignup: 'google_signup',
} as const;

export function readAccessTokenCookie(cookieHeader: string | undefined): string | undefined {
    const prefix = `${AUTH_COOKIE_NAMES.accessToken}=`;
    const cookie = cookieHeader?.split(';')
        .map(value => value.trim())
        .find(value => value.startsWith(prefix));

    return cookie === undefined ? undefined : decodeURIComponent(cookie.slice(prefix.length));
}

export function createGoogleCookieClearOptions(isProduction: boolean): CookieOptions {
    return {
        ...createAuthCookieClearOptions(isProduction).refreshToken,
        path: '/auth/google',
    };
}

export function createGoogleCookieOptions(isProduction: boolean): CookieOptions {
    return {
        ...createGoogleCookieClearOptions(isProduction),
        maxAge: GOOGLE_PROOF_TTL_SECONDS * 1000,
    };
}

export function createAuthCookieClearOptions(isProduction: boolean) {
    const sharedOptions: CookieOptions = {
        httpOnly: true,
        secure: isProduction,
        sameSite: 'strict',
    };

    return {
        accessToken: {
            ...sharedOptions,
            path: '/',
        },
        refreshToken: {
            ...sharedOptions,
            path: '/auth',
        },
    };
}

export function createAuthCookieOptions(
    isProduction: boolean,
    refreshExpiresAt: Date,
) {
    const cookieOptions = createAuthCookieClearOptions(isProduction);

    return {
        accessToken: {
            ...cookieOptions.accessToken,
            maxAge: ACCESS_TOKEN_TTL_SECONDS * 1000,
        },
        refreshToken: {
            ...cookieOptions.refreshToken,
            expires: refreshExpiresAt,
        },
    };
}
