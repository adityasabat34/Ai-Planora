import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MailModule } from '@nestjs/mail';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { UsersModule } from '../users/users.module.js';
import { InvitationInboxController } from './invitation-inbox.controller.js';
import { invitationMailOptions } from './invitation-mail.config.js';
import { InvitationMailService } from './invitation-mail.service.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsRepository } from './invitations.repository.js';
import { InvitationsService } from './invitations.service.js';

@Module({
  imports: [AuthModule, UsersModule, DatabaseModule, ConfigModule,
    MailModule.forRootAsync({ imports: [ConfigModule], inject: [ConfigService], useFactory: invitationMailOptions, isGlobal: false })],
  controllers: [InvitationsController, InvitationInboxController],
  providers: [InvitationsService, InvitationsRepository, InvitationMailService],
})
export class InvitationsModule {}
