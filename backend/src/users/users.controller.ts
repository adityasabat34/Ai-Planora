import { Body, Controller, Get, Header, Put, Query, UseGuards, ValidationPipe } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { UsersService } from './users.service.js';
import { UsernameAvailabilityQueryDto } from './dto/username-availability-query.dto.js';
import { SetUsernameDto } from './dto/set-username.dto.js';

@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Get('username-availability')
    @Header('Cache-Control', 'no-store')
    getUsernameAvailability(
        @Query(new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true,
        })) query: UsernameAvailabilityQueryDto,
    ) {
        return this.usersService.getUsernameAvailability(query.username);
    }

    @Put('me/username')
    @UseGuards(AccessTokenGuard)
    @Header('Cache-Control', 'no-store')
    setUsername(
        @CurrentUser('id') userId: string,
        @Body(new ValidationPipe({
            transform: true,
            whitelist: true,
            forbidNonWhitelisted: true,
        })) body: SetUsernameDto,
    ) {
        return this.usersService.setUsername(userId, body.username);
    }

    @Get('me')
    @UseGuards(AccessTokenGuard)
    @Header('Cache-Control', 'no-store')
    getMe(@CurrentUser('id') userId: string) {
        return this.usersService.getCurrentUser(userId);
    }
}
