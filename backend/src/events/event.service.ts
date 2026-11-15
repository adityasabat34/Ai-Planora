import { Injectable } from '@nestjs/common';
import { CreateEventDto } from './dto/create-event.dto.js';

@Injectable()
export class EventService {
    getHelloworld(): string {
        return 'Hello World from service!';
    }

    createEvent(body: CreateEventDto): string {
        return `create title ${body.title} and this is the test`
    }
}