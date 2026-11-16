import { randomUUID } from 'node:crypto';
import { BadRequestException, Injectable } from '@nestjs/common';
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

    getHelloWorldById(id: string): string {
        return `hello world, event ID: ${id}`;
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