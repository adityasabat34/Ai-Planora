import { Transform } from 'class-transformer';
import { IsISO8601, IsString, Length, Matches, MaxLength, ValidateIf } from 'class-validator';

import { TIMESTAMP_WITH_OFFSET } from '../events.constants.js';

export class CreateEventDto {
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @Length(1, 200)
  title!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(TIMESTAMP_WITH_OFFSET, { message: 'startTime must include a time and Z or a UTC offset' })
  startTime!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(TIMESTAMP_WITH_OFFSET, { message: 'endTime must include a time and Z or a UTC offset' })
  endTime!: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString()
  @MaxLength(500)
  location?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @MaxLength(10000)
  privateNote?: string;
}
