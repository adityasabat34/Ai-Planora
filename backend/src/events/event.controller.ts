import { Body, Controller, Get, Param, Post, ValidationPipe } from "@nestjs/common";
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
    getEvent(@Param("id") id: string) {
        return this.eventService.getHelloWorldById(id)
    }

    @Post()
    createEvent(@Body(new ValidationPipe()) body: CreateEventDto) {
        return this.eventService.createEvent(body);
    }
}