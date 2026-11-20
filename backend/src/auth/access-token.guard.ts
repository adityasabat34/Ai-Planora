import { Injectable, UnauthorizedException, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { readAccessTokenCookie } from './auth.cookies.js';
import { AuthTokensService } from './auth.tokens.service.js';
import type { AuthenticatedRequest } from './auth.types.js';

@Injectable()
export class AccessTokenGuard implements CanActivate {
    constructor(private readonly authTokensService: AuthTokensService) { }

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

        try {
            const accessToken = readAccessTokenCookie(request.headers.cookie);
            if (!accessToken) {
                throw new UnauthorizedException('Invalid or expired access token');
            }

            const userId = await this.authTokensService.verifyAccessToken(accessToken);
            request.user = { id: userId };
            return true;
        } catch {
            throw new UnauthorizedException('Invalid or expired access token');
        }
    }
}
