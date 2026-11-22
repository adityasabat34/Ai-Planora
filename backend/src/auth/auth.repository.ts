import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, SignInMethod } from '../generated/prisma/client.js';
import type { CreateGoogleUserInput, CreatePasswordUserInput, CreateSessionInput } from './auth.types.js';


export class DuplicateAccountError extends Error { }

@Injectable()
export class AuthRepository {
    constructor(private readonly prisma: PrismaService) { }

    createPasswordUser(input: CreatePasswordUserInput) {
        return this.createUser({ ...input, signInMethod: SignInMethod.PASSWORD });
    }

    createGoogleUser(input: CreateGoogleUserInput) {
        return this.createUser({ ...input, signInMethod: SignInMethod.GOOGLE });
    }

    private async createUser(input: Prisma.UserCreateInput) {
        try {
            return await this.prisma.user.create({
                data: input,
                select: {
                    id: true,
                    fullName: true,
                    email: true,
                    username: true,
                },
            });
        } catch (error) {
            if (
                error instanceof Prisma.PrismaClientKnownRequestError &&
                error.code === 'P2002'
            ) {
                throw new DuplicateAccountError('Email or username is already in use');
            }

            throw error;
        }
    }

    findUserByGoogleSub(googleSub: string) {
        return this.prisma.user.findUnique({
            where: { googleSub, signInMethod: SignInMethod.GOOGLE },
            select: { id: true, fullName: true, email: true, username: true },
        });
    }

    async findUserByEmail(email: string) {
        return this.prisma.user.findUnique({
            where: { email },
            select: {
                id: true,
                fullName: true,
                email: true,
                username: true,
                signInMethod: true,
                passwordHash: true,
            },
        });
    }

    async findSessionByRefreshTokenHash(refreshTokenHash: string) {
        return this.prisma.session.findUnique({
            where: { refreshTokenHash },
            select: {
                userId: true,
                expiresAt: true,
            },
        });
    }

    async deleteSessionByRefreshTokenHash(refreshTokenHash: string) {
        return this.prisma.session.deleteMany({
            where: { refreshTokenHash },
        });
    }

    async createSession(input: CreateSessionInput) {
        return await this.prisma.session.create({
            data: input,
            select: {
                id: true,
                expiresAt: true
            }
        })
    }
}
