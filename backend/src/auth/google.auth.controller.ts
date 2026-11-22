import { Body, Controller, Cookies, Get, Header, HttpCode, HttpStatus, Post, Res, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { AUTH_COOKIE_NAMES, createAuthCookieOptions, createGoogleCookieClearOptions, createGoogleCookieOptions } from './auth.cookies.js';
import type { AuthSession } from './auth.types.js';
import { GoogleLoginDto } from './dto/google-login.dto.js';
import { GoogleRegisterDto } from './dto/google-register.dto.js';
import { GoogleAuthService } from './google.auth.service.js';

@Controller('auth/google')
export class GoogleAuthController {
    constructor(
        private readonly googleAuthService: GoogleAuthService,
        private readonly config: ConfigService,
    ) { }

    @Get('nonce')
    @Header('Cache-Control', 'no-store')
    async createChallenge(@Res({ passthrough: true }) response: Response) {
        const { clientId, nonce, cookie } = await this.googleAuthService.createChallenge();
        response.cookie(AUTH_COOKIE_NAMES.googleNonce, cookie, createGoogleCookieOptions(this.isProduction));
        return { clientId, nonce };
    }

    @Post('login')
    @Header('Cache-Control', 'no-store')
    @HttpCode(HttpStatus.OK)
    async login(
        @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) body: GoogleLoginDto,
        @Cookies(AUTH_COOKIE_NAMES.googleNonce) nonceCookie: unknown,
        @Res({ passthrough: true }) response: Response,
    ) {
        const result = await this.googleAuthService.login(body.idToken, nonceCookie);
        this.clearGoogleCookie(response, AUTH_COOKIE_NAMES.googleNonce);
        if (result.requiresSignup) {
            response.cookie(AUTH_COOKIE_NAMES.googleSignup, result.signupToken, createGoogleCookieOptions(this.isProduction));
            return { requiresSignup: true, profile: result.profile };
        }

        this.clearGoogleCookie(response, AUTH_COOKIE_NAMES.googleSignup);
        return this.sendSession(response, result.session);
    }

    @Post('register')
    @Header('Cache-Control', 'no-store')
    @HttpCode(HttpStatus.OK)
    async register(
        @Body(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true })) body: GoogleRegisterDto,
        @Cookies(AUTH_COOKIE_NAMES.googleSignup) signupCookie: unknown,
        @Res({ passthrough: true }) response: Response,
    ) {
        const session = await this.googleAuthService.register(body, signupCookie);
        this.clearGoogleCookie(response, AUTH_COOKIE_NAMES.googleSignup);
        return this.sendSession(response, session);
    }

    private get isProduction(): boolean {
        return this.config.get<string>('NODE_ENV') === 'production';
    }

    private clearGoogleCookie(response: Response, name: string) {
        response.clearCookie(name, createGoogleCookieClearOptions(this.isProduction));
    }

    private sendSession(
        response: Response,
        { user, accessToken, refreshToken, refreshExpiresAt }: AuthSession,
    ) {
        const options = createAuthCookieOptions(this.isProduction, refreshExpiresAt);
        response.cookie(AUTH_COOKIE_NAMES.accessToken, accessToken, options.accessToken);
        response.cookie(AUTH_COOKIE_NAMES.refreshToken, refreshToken, options.refreshToken);
        return { ...user, token: accessToken };
    }
}
