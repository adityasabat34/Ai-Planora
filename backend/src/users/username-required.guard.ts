import { ForbiddenException, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { UsersService } from './users.service.js';

@Injectable()
export class UsernameRequiredGuard implements CanActivate {
    constructor(private readonly usersService: UsersService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
        const user = await this.usersService.getCurrentUser(request.user.id);
        if (user.onboardingRequired) {
            throw new ForbiddenException({
                statusCode: 403,
                error: 'Forbidden',
                message: 'Choose a username to finish account setup',
                onboardingRequired: true,
            });
        }
        return true;
    }
}
