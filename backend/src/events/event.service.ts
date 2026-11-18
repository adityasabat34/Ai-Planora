import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateEventDto } from './dto/create-event.dto.js';

type Event = {
    id: string;
    title: string;
    startTime: string;
    endTime: string;
};

@Injectable()
export class EventService {
    private readonly events: Event[] = [];

    getHelloworld(): string {
        return 'Hello World from service!';
    }

    getHelloWorldById(id: string): Event {
        const event = this.events.find((event) => event.id === id);
        if (!event) {
            throw new NotFoundException(`Event with this ${id} does not exist`)
        }
        return event;
    }

    createEvent(body: CreateEventDto): Event {
        const { title, startTime, endTime } = body;

        if (!(Date.parse(startTime) < Date.parse(endTime))) {
            throw new BadRequestException('End time must be after start time');
        }

        const event = { id: randomUUID(), title, startTime, endTime };
        this.events.push(event);
        return event;
    }
}