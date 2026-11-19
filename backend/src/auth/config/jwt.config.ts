import type { ConfigService } from '@nestjs/config';
import type { JwtModuleOptions } from '@nestjs/jwt';

export function createJwtOptions(
    config: ConfigService,
): JwtModuleOptions {
    return {
        secret: config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        signOptions: {
            algorithm: 'HS256',
            expiresIn: '15m',
        },
        verifyOptions: {
            algorithms: ['HS256'],
        },
    };
}