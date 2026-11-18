import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor() {
    if (!process.env.DATABASE_URL && existsSync('.env')) {
      loadEnvFile('.env');
    }

    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is required to configure Prisma.');
    }

    super({ adapter: new PrismaPg({ connectionString }) });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
