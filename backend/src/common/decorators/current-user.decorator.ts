import { createParamDecorator, UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedRequest } from '../../auth/auth.types.js';

export const CurrentUser = createParamDecorator(
  (field: keyof AuthenticatedRequest['user'] | undefined, context: ExecutionContext) => {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) throw new UnauthorizedException();

    return field === undefined ? user : user[field];
  },
);
