import { Controller, Get, Header, Param, ParseUUIDPipe, Query, UseGuards, ValidationPipe } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { CursorPaginationQueryDto } from '../common/dto/cursor-pagination-query.dto.js';
import { UsernameRequiredGuard } from '../users/username-required.guard.js';
import { InvitationsService } from './invitations.service.js';

@Controller('invitations')
@UseGuards(AccessTokenGuard, UsernameRequiredGuard)
export class InvitationInboxController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser('id') recipientId: string,
    @Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    query: CursorPaginationQueryDto,
  ) {
    return this.invitationsService.listForRecipient(recipientId, query);
  }

  @Get(':invitationId')
  @Header('Cache-Control', 'no-store')
  findPreview(
    @CurrentUser('id') recipientId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitationsService.findPreviewForRecipient(recipientId, invitationId);
  }
}
