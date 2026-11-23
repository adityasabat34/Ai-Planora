import { Body, Controller, Cookies, Header, HttpCode, HttpStatus, Post, Res, ValidationPipe } from "@nestjs/common"
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { AUTH_COOKIE_NAMES, createAuthCookieClearOptions, createAuthCookieOptions } from './auth.cookies.js';
import type { AuthSession } from './auth.types.js';
import { toUserProfile } from '../users/user-profile.js';

@Controller("auth")
export class AuthController {
    constructor(
        private readonly authService: AuthService,
        private readonly config: ConfigService,
    ) { }

    @Post("register")
    @Header('Cache-Control', 'no-store')
    async register(
        @Body(new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true,
        }))
        body: RegisterDto,
        @Res({ passthrough: true }) response: Response,
    ) {
        const session = await this.authService.register(body);
        return this.sendSession(response, session);
    }

    @Post('logout')
    @HttpCode(HttpStatus.NO_CONTENT)
    @Header('Cache-Control', 'no-store')
    async logout(
        @Cookies(AUTH_COOKIE_NAMES.refreshToken) refreshToken: unknown,
        @Res({ passthrough: true }) response: Response,
    ) {
        await this.authService.logout(refreshToken);

        const cookieOptions = createAuthCookieClearOptions(
            this.config.get<string>('NODE_ENV') === 'production',
        );
        response.clearCookie(AUTH_COOKIE_NAMES.accessToken, cookieOptions.accessToken);
        response.clearCookie(AUTH_COOKIE_NAMES.refreshToken, cookieOptions.refreshToken);
    }

    @Post('refresh')
    @HttpCode(HttpStatus.OK)
    @Header('Cache-Control', 'no-store')
    async refresh(
        @Cookies(AUTH_COOKIE_NAMES.refreshToken) refreshToken: unknown,
        @Res({ passthrough: true }) response: Response,
    ) {
        const { accessToken, refreshExpiresAt } = await this.authService.refresh(refreshToken);
        const cookieOptions = createAuthCookieOptions(
            this.config.get<string>('NODE_ENV') === 'production',
            refreshExpiresAt,
        );

        response.cookie(AUTH_COOKIE_NAMES.accessToken, accessToken, cookieOptions.accessToken);
        return { token: accessToken };
    }

    @Post('login')
    @HttpCode(HttpStatus.OK)
    @Header('Cache-Control', 'no-store')
    async login(
        @Body(new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true,
        }))
        body: LoginDto,
        @Res({ passthrough: true }) response: Response,
    ) {
        const session = await this.authService.login(body);
        return this.sendSession(response, session);
    }

    private sendSession(
        response: Response,
        { user, accessToken, refreshToken, refreshExpiresAt }: AuthSession,
    ) {
        const cookieOptions = createAuthCookieOptions(
            this.config.get<string>('NODE_ENV') === 'production',
            refreshExpiresAt,
        );

        response.cookie(AUTH_COOKIE_NAMES.accessToken, accessToken, cookieOptions.accessToken);
        response.cookie(AUTH_COOKIE_NAMES.refreshToken, refreshToken, cookieOptions.refreshToken);

        return {
            ...toUserProfile(user),
            token: accessToken,
        };
    }
}
