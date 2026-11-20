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
import { AuthTokensService } from './auth.tokens.service.js';

const BCRYPT_COST = 12;

@Injectable()
export class AuthService {
    constructor(
        private readonly authRepository: AuthRepository,
        private readonly authTokensService: AuthTokensService,
    ) { }

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

    async login(input: LoginDto) {
        const user = await this.validateCredential(input);
        const tokens = await this.authTokensService.createTokens(user.id);

        await this.authRepository.createSession({
            userId: user.id,
            refreshTokenHash: tokens.refreshTokenHash,
            expiresAt: tokens.refreshExpiresAt,
        });

        return {
            user,
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            refreshExpiresAt: tokens.refreshExpiresAt,
        };
    }

    async logout(refreshToken: unknown): Promise<void> {
        if (typeof refreshToken !== 'string' || !/^[a-f0-9]{64}$/.test(refreshToken)) {
            return;
        }

        const refreshTokenHash = this.authTokensService.hashRefreshToken(refreshToken);
        await this.authRepository.deleteSessionByRefreshTokenHash(refreshTokenHash);
    }

    async refresh(refreshToken: unknown) {
        if (typeof refreshToken !== 'string' || !/^[a-f0-9]{64}$/.test(refreshToken)) {
            throw new UnauthorizedException('Invalid or expired refresh token');
        }

        const refreshTokenHash = this.authTokensService.hashRefreshToken(refreshToken);
        const session = await this.authRepository.findSessionByRefreshTokenHash(refreshTokenHash);

        if (!session || session.expiresAt.getTime() <= Date.now()) {
            throw new UnauthorizedException('Invalid or expired refresh token');
        }

        const accessToken = await this.authTokensService.createAccessToken(session.userId);
        return { accessToken, refreshExpiresAt: session.expiresAt };
    }

    async validateCredential({ email, password }: LoginDto) {
        // bcrypt ignores bytes beyond 72, so reject passwords it would truncate.
        if (Buffer.byteLength(password, 'utf8') > 72) {
            throw new UnauthorizedException('Invalid email or password');
        }

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
