import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateEventDto } from './dto/create-event.dto.js';
import { EventsRepository } from './events.repository.js';
import type { ListEventsQueryDto } from './dto/list-events-query.dto.js';
import type { UpdateEventDto } from './dto/update-event.dto.js';
import type { UpdateEventInput } from './events.types.js';
import { EVENT_TRASH_RETENTION_MS } from './events.constants.js';

@Injectable()
export class EventsService {
  constructor(private readonly eventsRepository: EventsRepository) { }

  async remove(ownerId: string, id: string) {
    const now = new Date();
    const result = await this.eventsRepository.softDelete(id, ownerId, now);
    if (result.count === 0) {
      const cutoff = new Date(now.getTime() - EVENT_TRASH_RETENTION_MS);
      const deleted = await this.eventsRepository.findRecoverableDeleted(id, ownerId, cutoff, now);
      if (!deleted) throw new NotFoundException('Event not found');
    }
  }

  listTrash(ownerId: string) {
    const now = new Date();
    return this.eventsRepository.findTrash(ownerId, new Date(now.getTime() - EVENT_TRASH_RETENTION_MS), now);
  }

  async restore(ownerId: string, id: string) {
    const now = new Date();
    const event = await this.eventsRepository.restore(
      id, ownerId, new Date(now.getTime() - EVENT_TRASH_RETENTION_MS), now,
    );
    if (!event) throw new NotFoundException('Recoverable event not found');
    return event;
  }

  async update(ownerId: string, id: string, input: UpdateEventDto) {
    if (!Object.values(input).some(value => value !== undefined)) {
      throw new BadRequestException('Provide at least one event field to update');
    }
    const existing = await this.findById(ownerId, id);
    const startTime = input.startTime === undefined ? existing.startTime : new Date(input.startTime);
    const endTime = input.endTime === undefined ? existing.endTime : new Date(input.endTime);
    if (!(startTime.getTime() < endTime.getTime())) {
      throw new BadRequestException('End time must be after start time');
    }

    const data: UpdateEventInput = {};
    if (input.title !== undefined) data.title = input.title;
    if (input.startTime !== undefined) data.startTime = startTime;
    if (input.endTime !== undefined) data.endTime = endTime;
    if (input.location !== undefined) data.location = input.location;
    if (input.privateNote !== undefined) data.privateNote = input.privateNote;

    const changesSchedule = input.startTime !== undefined || input.endTime !== undefined;
    const updated = await this.eventsRepository.updateOwned(
      id, ownerId, data,
      changesSchedule ? { startTime: existing.startTime, endTime: existing.endTime } : undefined,
    );
    if (!updated) {
      await this.findById(ownerId, id);
      throw new ConflictException('Event schedule changed. Reload and retry');
    }
    return updated;
  }

  list(ownerId: string, query: ListEventsQueryDto) {
    const from = new Date(query.from);
    const to = new Date(query.to);
    if (!(from.getTime() < to.getTime())) {
      throw new BadRequestException('to must be after from');
    }
    return this.eventsRepository.findOverlapping(ownerId, from, to);
  }

  async findById(ownerId: string, id: string) {
    const event = await this.eventsRepository.findByIdAndOwner(id, ownerId);
    if (!event) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  create(ownerId: string, input: CreateEventDto) {
    const startTime = new Date(input.startTime);
    const endTime = new Date(input.endTime);
    if (!(startTime.getTime() < endTime.getTime())) {
      throw new BadRequestException('End time must be after start time');
    }

    return this.eventsRepository.create({
      ownerId,
      title: input.title,
      startTime,
      endTime,
      location: input.location,
      privateNote: input.privateNote,
    });
  }
}
