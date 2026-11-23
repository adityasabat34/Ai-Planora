import { Transform } from 'class-transformer';
import { IsString, Matches } from 'class-validator';

export class UsernameAvailabilityQueryDto {
    @Transform(({ value }: { value: unknown }) =>
        typeof value === 'string' ? value.trim().toLowerCase() : value,
    )
    @IsString()
    @Matches(/^[a-z0-9_]{3,30}$/, {
        message: 'username must have 3–30 letters, digits, or underscores',
    })
    username!: string;
}
