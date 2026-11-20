import type { ConfigService } from '@nestjs/config';
import type { JwtModuleOptions } from '@nestjs/jwt';
import { ACCESS_TOKEN_TTL_SECONDS } from '../auth.constants.js';

export function createJwtOptions(
    config: ConfigService,
): JwtModuleOptions {
    return {
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
            algorithm: 'HS256',
            expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        },
        verifyOptions: {
            algorithms: ['HS256'],
        },
    };
}
