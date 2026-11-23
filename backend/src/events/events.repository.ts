import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { isPrismaError, PRISMA_ERROR_CODES } from '../database/prisma-errors.js';
import type { CreateEventInput } from './events.types.js';

@Injectable()
export class EventsRepository {
  constructor(private readonly prisma: PrismaService) { }

  async create(input: CreateEventInput) {
    try {
      return await this.prisma.event.create({
        data: input,
        select: {
          id: true,
          ownerId: true,
          title: true,
          startTime: true,
          endTime: true,
          location: true,
          privateNote: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      // The owner can be deleted after the onboarding guard has checked the account.
      if (isPrismaError(error, PRISMA_ERROR_CODES.FOREIGN_KEY_CONSTRAINT)) {
        throw new UnauthorizedException('Account is no longer available');
      }
      throw error;
    }
  }
}
