import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class UsersRepository {
    constructor(private readonly prisma: PrismaService) { }

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
