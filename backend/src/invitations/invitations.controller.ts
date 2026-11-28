import { Body, Controller, Get, Header, HttpStatus, Param, ParseUUIDPipe, Post, Res, UseGuards, ValidationPipe } from '@nestjs/common';
import type { Response } from 'express';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { EmailDto } from '../common/dto/email.dto.js';
import { UsernameRequiredGuard } from '../users/username-required.guard.js';
import { InvitationsService } from './invitations.service.js';

@Controller('events/:eventId/invitations')
@UseGuards(AccessTokenGuard, UsernameRequiredGuard)
export class InvitationsController {
  constructor(private readonly invitationsService: InvitationsService) {}

  @Post()
  @Header('Cache-Control', 'no-store')
  async create(
    @CurrentUser('id') ownerId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) body: EmailDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { created, invitation } = await this.invitationsService.create(ownerId, eventId, body.email);
    if (created) response.location(`/events/${eventId}/invitations/${invitation.id}`);
    else response.status(HttpStatus.OK);
    return invitation;
  }

  @Get(':invitationId')
  @Header('Cache-Control', 'no-store')
  findForOrganizer(
    @CurrentUser('id') ownerId: string,
    @Param('eventId', ParseUUIDPipe) eventId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
  ) {
    return this.invitationsService.findForOrganizer(ownerId, eventId, invitationId);
  }
}
