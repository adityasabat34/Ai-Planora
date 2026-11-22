import { Transform } from 'class-transformer';
import { IsString, Length, Matches } from 'class-validator';

export class GoogleRegisterDto {
    @Transform(({ value }: { value: unknown }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @Length(1, 100)
    fullName!: string;

    @Transform(({ value }: { value: unknown }) =>
        typeof value === 'string' ? value.trim().toLowerCase() : value,
    )
    @IsString()
    @Matches(/^[a-z0-9_]{3,30}$/, {
        message: 'username must have 3–30 letters, digits, or underscores',
    })
    username!: string;
}
