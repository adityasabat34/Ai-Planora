import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { UsersModule } from '../users/users.module.js';
import { EventsController } from './events.controller.js';
import { EventsRepository } from './events.repository.js';
import { EventsService } from './events.service.js';

@Module({
  imports: [AuthModule, UsersModule, DatabaseModule],
  controllers: [EventsController],
  providers: [EventsService, EventsRepository],
})
export class EventsModule { }
