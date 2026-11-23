import { BadRequestException, Injectable } from '@nestjs/common';
import type { CreateEventDto } from './dto/create-event.dto.js';
import { EventsRepository } from './events.repository.js';

@Injectable()
export class EventsService {
  constructor(private readonly eventsRepository: EventsRepository) { }

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
