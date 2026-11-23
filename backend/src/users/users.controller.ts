import { Controller, Get, Header, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { UsersService } from './users.service.js';
import { UsernameAvailabilityQueryDto } from './dto/username-availability-query.dto.js';

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

    @Get('me')
    @UseGuards(AccessTokenGuard)
    @Header('Cache-Control', 'no-store')
    getMe(@Req() request: AuthenticatedRequest) {
        return this.usersService.getCurrentUser(request.user.id);
    }
}
