import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { UsersModule } from '../users/users.module.js';
import { InvitationInboxController } from './invitation-inbox.controller.js';
import { InvitationsController } from './invitations.controller.js';
import { InvitationsRepository } from './invitations.repository.js';
import { InvitationsService } from './invitations.service.js';

@Module({
  imports: [AuthModule, UsersModule, DatabaseModule],
  controllers: [InvitationsController, InvitationInboxController],
  providers: [InvitationsService, InvitationsRepository],
})
export class InvitationsModule {}
