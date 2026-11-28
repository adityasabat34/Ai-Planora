import { Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards, ValidationPipe } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
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
  remove(@CurrentUser('id') ownerId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.eventsService.remove(ownerId, id);
  }

  // Keep the static route before GET :id so "trash" is not parsed as a UUID.
  @Get('trash')
  @Header('Cache-Control', 'no-store')
  listTrash(@CurrentUser('id') ownerId: string) {
    return this.eventsService.listTrash(ownerId);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @Header('Cache-Control', 'no-store')
  restore(@CurrentUser('id') ownerId: string, @Param('id', new ParseUUIDPipe()) id: string) {
    return this.eventsService.restore(ownerId, id);
  }

  @Patch(':id')
  @Header('Cache-Control', 'no-store')
  update(
    @CurrentUser('id') ownerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    body: UpdateEventDto,
  ) {
    return this.eventsService.update(ownerId, id, body);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser('id') ownerId: string,
    @Query(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    query: ListEventsQueryDto,
  ) {
    return this.eventsService.list(ownerId, query);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  findById(
    @CurrentUser('id') ownerId: string,
    @Param('id', new ParseUUIDPipe()) id: string,
  ) {
    return this.eventsService.findById(ownerId, id);
  }

  @Post()
  @Header('Cache-Control', 'no-store')
  create(
    @CurrentUser('id') ownerId: string,
    @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }))
    body: CreateEventDto,
  ) {
    return this.eventsService.create(ownerId, body);
  }
}
