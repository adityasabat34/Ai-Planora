import { Controller, Get, Header, Param, ParseUUIDPipe, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
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
    @Req() request: AuthenticatedRequest,
    @Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    query: CursorPaginationQueryDto,
  ) {
    return this.invitationsService.listForRecipient(request.user.id, query);
  }

  @Get(':invitationId')
  @Header('Cache-Control', 'no-store')
  findPreview(
    @Req() request: AuthenticatedRequest,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitationsService.findPreviewForRecipient(request.user.id, invitationId);
  }
}
