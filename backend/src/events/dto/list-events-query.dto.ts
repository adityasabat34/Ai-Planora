import { IsISO8601, Matches } from 'class-validator';
import { TIMESTAMP_WITH_OFFSET } from '../events.constants.js';

export class ListEventsQueryDto {
  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(TIMESTAMP_WITH_OFFSET, { message: 'from must include a time and Z or a UTC offset' })
  from!: string;

  @IsISO8601({ strict: true, strictSeparator: true })
  @Matches(TIMESTAMP_WITH_OFFSET, { message: 'to must include a time and Z or a UTC offset' })
  to!: string;
}
