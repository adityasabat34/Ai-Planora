import type { Request } from 'express';

export type AuthenticatedRequest = Request & {
    user: { id: string };
};

export type CreatePasswordUserInput = {
    fullName: string;
    email: string;
    passwordHash: string;
}

export type CreateSessionInput = {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
};

export type AuthTokens = {
    accessToken: string;
    refreshToken: string;
    refreshTokenHash: string;
    refreshExpiresAt: Date;
};

export type PublicUser = {
    id: string;
    fullName: string;
    email: string;
    username: string | null;
};

export type AuthSession = {
    user: PublicUser;
    accessToken: string;
    refreshToken: string;
    refreshExpiresAt: Date;
};

export type GoogleIdentity = {
    googleSub: string;
    email: string;
    fullName: string;
};

export type CreateGoogleUserInput = GoogleIdentity;
