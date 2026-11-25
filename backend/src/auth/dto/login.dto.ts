import { IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { EmailDto } from '../../common/dto/email.dto.js';

export class LoginDto extends EmailDto {
    @IsString()
    @IsNotEmpty()
    @MaxLength(72)
    password!: string;
}
