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
    controllers: [AuthController],
    providers: [AuthService, AuthRepository, AuthTokensService, AccessTokenGuard],
    exports: [AccessTokenGuard, AuthTokensService],
})
export class AuthModule { }
