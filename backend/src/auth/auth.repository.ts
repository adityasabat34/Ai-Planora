import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, SignInMethod } from '../generated/prisma/client.js';
import type { CreatePasswordUserInput, CreateSessionInput } from './auth.types.js';


export class DuplicateAccountError extends Error { }

@Injectable()
export class AuthRepository {
    constructor(private readonly prisma: PrismaService) { }

    async createPasswordUser(input: CreatePasswordUserInput) {
        try {
            return await this.prisma.user.create({
                data: {
                    ...input,
                    signInMethod: SignInMethod.PASSWORD,
                },
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