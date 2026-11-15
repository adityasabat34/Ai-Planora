import { IsISO8601, IsNotEmpty, IsString } from 'class-validator';

export class CreateEventDto {
    @IsString()
    @IsNotEmpty()
    title!: string;

    //   @IsISO8601()
    //   startTime!: string;

    //   @IsISO8601()
    //   endTime!: string;
}