import {
    BadRequestException,
    ConflictException,
    Injectable,
    UnauthorizedException
} from '@nestjs/common';
import bcrypt from 'bcrypt';
import { AuthRepository, DuplicateAccountError } from './auth.repository.js';
import type { RegisterDto } from './dto/register.dto.js';
import { SignInMethod } from '../generated/prisma/client.js';
import type { LoginDto } from './dto/login.dto.js';

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

    async validateCredential({ email, password }: LoginDto) {
        const user = await this.authRepository.findUserByEmail(email)

        if (!user) {
            throw new UnauthorizedException("Invalid email or password")
        }

        if (user.signInMethod === SignInMethod.GOOGLE) {
            throw new UnauthorizedException("Continue with Google to sign in")
        }

        if (!user.passwordHash) {
            throw new UnauthorizedException("Invalid email or password")
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash)

        if (!isPasswordValid) {
            throw new UnauthorizedException('Invalid email or password');
        }

        return {
            id: user.id,
            fullName: user.fullName,
            email: user.email,
            username: user.username,
        };

    }
}