import { Transform } from 'class-transformer';
import { IsString, Length } from 'class-validator';
import { EmailDto } from '../../common/dto/email.dto.js';

export class RegisterDto extends EmailDto {
    @Transform(({ value }: { value: unknown }) =>
        typeof value === 'string' ? value.trim() : value,
    )
    @IsString()
    @Length(1, 100)
    fullName!: string;

    @IsString()
    @Length(7, 50)
    password!: string;
}
