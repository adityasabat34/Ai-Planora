import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { UsersModule } from '../src/users/users.module.js';
import { UsersRepository } from '../src/users/users.repository.js';

describe('GET /users/me', () => {
  let app: INestApplication;
  let jwt: JwtService;
  const user = {
    id: '3aab047c-2d7d-4d42-bd4f-f231369c6f98',
    fullName: 'Current User',
    email: 'current@example.com',
    username: 'current_user',
  };
  const repository = {
    findPublicUserById: vi.fn<UsersRepository['findPublicUserById']>(),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [UsersModule] })
      .overrideProvider(UsersRepository).useValue(repository)
      .overrideProvider(PrismaService).useValue({})
      .overrideProvider(ConfigService).useValue(new ConfigService({
        JWT_ACCESS_SECRET: 'users-test-secret-used-only-in-tests',
        NODE_ENV: 'test',
      }))
      .compile();

    app = module.createNestApplication({ logger: false });
    await app.init();
    jwt = module.get(JwtService);
  });

  beforeEach(() => {
    vi.resetAllMocks();
    repository.findPublicUserById.mockResolvedValue(user);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('uses the verified subject to fetch the public profile', async () => {
    const token = await jwt.signAsync({ sub: user.id });
    const response = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', `other_cookie=ignored; access_token=${token}`)
      .expect(200);

    expect(repository.findPublicUserById).toHaveBeenCalledWith(user.id);
    expect(response.body).toEqual({ ...user, onboardingRequired: false });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it.each([undefined, 'access_token=', 'access_token=garbage', 'access_token=%ZZ', 'refresh_token=only-refresh'])(
    'rejects a missing or malformed access cookie (%s)', async (cookie) => {
      const pending = request(app.getHttpServer()).get('/users/me');
      if (cookie !== undefined) pending.set('Cookie', cookie);
      await pending.expect(401);
      expect(repository.findPublicUserById).not.toHaveBeenCalled();
    },
  );

  it.each(['expired', 'wrong signature', 'wrong algorithm', 'missing subject', 'invalid subject', 'numeric subject', 'missing expiry'])(
    'rejects a token with %s before the database lookup', async (scenario) => {
      let token: string;
      switch (scenario) {
        case 'expired':
          token = await jwt.signAsync({ sub: user.id }, { expiresIn: -1 });
          break;
        case 'wrong signature':
          token = await jwt.signAsync({ sub: user.id }, { secret: 'different-secret' });
          break;
        case 'wrong algorithm':
          token = await jwt.signAsync({ sub: user.id }, { algorithm: 'HS384' });
          break;
        case 'missing subject':
          token = await jwt.signAsync({});
          break;
        case 'invalid subject':
          token = await jwt.signAsync({ sub: 'invalid-uuid' });
          break;
        case 'numeric subject':
          token = await jwt.signAsync({ sub: 123 });
          break;
        default:
          token = await new JwtService({
            secret: 'users-test-secret-used-only-in-tests',
          }).signAsync({ sub: user.id });
      }

      await request(app.getHttpServer())
        .get('/users/me')
        .set('Cookie', `access_token=${token}`)
        .expect(401);
      expect(repository.findPublicUserById).not.toHaveBeenCalled();
    },
  );

  it('rejects a token when the account has been deleted', async () => {
    repository.findPublicUserById.mockResolvedValue(null);
    const token = await jwt.signAsync({ sub: user.id });
    await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', `access_token=${token}`)
      .expect(401);
  });

  it('keeps database failures as server errors', async () => {
    repository.findPublicUserById.mockRejectedValue(new Error('database unavailable'));
    const token = await jwt.signAsync({ sub: user.id });
    const response = await request(app.getHttpServer())
      .get('/users/me')
      .set('Cookie', `access_token=${token}`)
      .expect(500);
    expect(response.body.message).toBe('Internal server error');
  });
});
