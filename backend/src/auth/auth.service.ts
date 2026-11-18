import {
    BadRequestException,
    ConflictException,
    Injectable,
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import { AuthRepository, DuplicateAccountError } from './auth.repository.js';
import type { RegisterDto } from './dto/register.dto.js';

const BCRYPT_COST = 12;

@Injectable()
export class AuthService {
    constructor(private readonly authRepository: AuthRepository) { }

    async register({ fullName, email, username, password }: RegisterDto) {
        if (Buffer.byteLength(password, 'utf8') > 72) {
            throw new BadRequestException('Password must be at most 72 UTF-8 bytes');
        }

        const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

        try {
            return await this.authRepository.createPasswordUser({
                fullName,
                email,
                username,
                passwordHash,
            });
        } catch (error) {
            if (error instanceof DuplicateAccountError) {
                throw new ConflictException(error.message);
            }

            throw error;
        }
    }
}