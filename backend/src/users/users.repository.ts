import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma } from '../generated/prisma/client.js';

export class UsernameTakenError extends Error { }
export class UsernameAssignmentRejectedError extends Error { }

@Injectable()
export class UsersRepository {
    constructor(private readonly prisma: PrismaService) { }

    async setInitialUsername(id: string, username: string) {
        try {
            return await this.prisma.user.update({
                // Check and write together so concurrent requests cannot replace a claimed username.
                where: { id, OR: [{ username: null }, { username }] },
                data: { username },
                select: { id: true, fullName: true, email: true, username: true },
            });
        } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError) {
                if (error.code === 'P2002') throw new UsernameTakenError();
                if (error.code === 'P2025') throw new UsernameAssignmentRejectedError();
            }
            throw error;
        }
    }

    findUserIdByUsername(username: string) {
        return this.prisma.user.findUnique({
            where: { username },
            select: { id: true },
        });
    }

    findPublicUserById(id: string) {
        return this.prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                fullName: true,
                email: true,
                username: true,
            },
        });
    }
}
