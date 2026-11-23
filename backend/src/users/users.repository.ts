import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class UsersRepository {
    constructor(private readonly prisma: PrismaService) { }

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
