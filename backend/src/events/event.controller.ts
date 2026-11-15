import { Body, Controller, Get, Post, ValidationPipe } from "@nestjs/common";
import { EventService } from "./event.service.js";
import { CreateEventDto } from "./dto/create-event.dto.js";

@Controller("events")
export class EventController {
    constructor(private readonly eventService: EventService) { }

    @Get()
    getHelloWorld(): string {
        return this.eventService.getHelloworld()
    }

    @Get(":id")
    getEvent(): string {
        return "hello from me"
    }

    @Post()
    createEvent(@Body(new ValidationPipe()) body: CreateEventDto): string {
        return this.eventService.createEvent(body);
    }
}