import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthRepository } from './auth.repository.js';

@Module({
    imports: [DatabaseModule],
    controllers: [AuthController],
    providers: [AuthService, AuthRepository],
})
export class AuthModule { }