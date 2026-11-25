import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { EventsModule } from './events/events.module.js';
import { InvitationsModule } from './invitations/invitations.module.js';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [ScheduleModule.forRoot(), AuthModule, UsersModule, EventsModule, InvitationsModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
