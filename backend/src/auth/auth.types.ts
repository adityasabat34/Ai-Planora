export type CreatePasswordUserInput = {
    fullName: string;
    email: string;
    username: string;
    passwordHash: string;
}


export type CreateSessionInput = {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
};