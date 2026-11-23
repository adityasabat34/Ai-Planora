import { Body, Controller, Header, Post, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { UsernameRequiredGuard } from '../users/username-required.guard.js';
import { CreateEventDto } from './dto/create-event.dto.js';
import { EventsService } from './events.service.js';

@Controller('events')
@UseGuards(AccessTokenGuard, UsernameRequiredGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) { }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @Req() request: AuthenticatedRequest,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    body: CreateEventDto,
  ) {
    return this.eventsService.create(request.user.id, body);
  }
}
