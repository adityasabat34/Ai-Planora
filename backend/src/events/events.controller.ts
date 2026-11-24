import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { UsernameRequiredGuard } from '../users/username-required.guard.js';
import { CreateEventDto } from './dto/create-event.dto.js';
import { EventsService } from './events.service.js';
import { ListEventsQueryDto } from './dto/list-events-query.dto.js';
import { UpdateEventDto } from './dto/update-event.dto.js';

@Controller('events')
@UseGuards(AccessTokenGuard, UsernameRequiredGuard)
export class EventsController {
  constructor(private readonly eventsService: EventsService) { }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Header('Cache-Control', 'no-store')
  remove(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.eventsService.remove(request.user.id, id);
  }

  // Keep the static route before GET :id so "trash" is not parsed as a UUID.
  @Get('trash')
  @Header('Cache-Control', 'no-store')
  listTrash(@Req() request: AuthenticatedRequest) {
    return this.eventsService.listTrash(request.user.id);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  restore(@Req() request: AuthenticatedRequest, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.eventsService.restore(request.user.id, id);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    body: UpdateEventDto,
  ) {
    return this.eventsService.update(request.user.id, id, body);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Req() request: AuthenticatedRequest,
    @Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    query: ListEventsQueryDto,
  ) {
    return this.eventsService.list(request.user.id, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  findById(
    @Req() request: AuthenticatedRequest,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.eventsService.findById(request.user.id, id);
  }

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
