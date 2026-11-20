import { Controller, Get, Header, Req, UseGuards } from '@nestjs/common';
import { AccessTokenGuard } from '../auth/access-token.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { UsersService } from './users.service.js';

@Controller('users')
export class UsersController {
    constructor(private readonly usersService: UsersService) { }

    @Get('me')
    @UseGuards(AccessTokenGuard)
    @Header('Cache-Control', 'no-store')
    getMe(@Req() request: AuthenticatedRequest) {
        return this.usersService.getCurrentUser(request.user.id);
    }
}
