import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';
import { createJwtOptions } from './config/jwt.config.js';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthTokensService } from './auth.tokens.service.js';
import { AccessTokenGuard } from './access-token.guard.js';
import { GoogleAuthController } from './google.auth.controller.js';
import { GoogleAuthService } from './google.auth.service.js';
import { GoogleIdentityService } from './google.identity.service.js';
import { OAuth2Client } from 'google-auth-library';

@Module({
    imports: [
        ConfigModule.forRoot(),
        DatabaseModule,
        JwtModule.registerAsync({
            imports: [ConfigModule],
            inject: [ConfigService],
            useFactory: createJwtOptions,
        }),
    ],
    controllers: [AuthController, GoogleAuthController],
    providers: [
        AuthService, AuthRepository, AuthTokensService, AccessTokenGuard,
        GoogleAuthService, GoogleIdentityService,
        { provide: OAuth2Client, useFactory: () => new OAuth2Client() },
    ],
    exports: [AccessTokenGuard, AuthTokensService],
})
export class AuthModule { }
