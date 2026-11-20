import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthRepository } from '../src/auth/auth.repository.js';
import { AuthService } from '../src/auth/auth.service.js';
import { AuthTokensService } from '../src/auth/auth.tokens.service.js';
import { createJwtOptions } from '../src/auth/config/jwt.config.js';
import { SignInMethod } from '../src/generated/prisma/client.js';
import type { CreateSessionInput } from '../src/auth/auth.types.js';

describe('POST /auth/login', () => {
  let app: INestApplication;
  let passwordHash: string;
  let jwt: JwtService;
  const password = 'PlanoraTest2026!';
  const publicUser = {
    id: '3aab047c-2d7d-4d42-bd4f-f231369c6f98',
    fullName: 'Login Test',
    email: 'login@example.com',
    username: 'login_test',
  };
  const repository = {
    findUserByEmail: vi.fn<AuthRepository['findUserByEmail']>(),
    createSession: vi.fn<AuthRepository['createSession']>(),
  };
  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'login-test-secret-used-only-in-tests',
    NODE_ENV: 'production',
  });

  beforeAll(async () => {
    passwordHash = await bcrypt.hash(password, 4);
    const module = await Test.createTestingModule({
      imports: [JwtModule.register(createJwtOptions(config))],
      controllers: [AuthController],
      providers: [
        AuthService,
        AuthTokensService,
        { provide: AuthRepository, useValue: repository },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    jwt = module.get(JwtService);
  });

  beforeEach(() => {
    vi.resetAllMocks();
    repository.findUserByEmail.mockResolvedValue({
      ...publicUser,
      signInMethod: SignInMethod.PASSWORD,
      passwordHash,
    });
    repository.createSession.mockImplementation(async (input: CreateSessionInput) => ({
      id: 'test-session',
      expiresAt: input.expiresAt,
    }));
  });

  afterAll(async () => {
    await app?.close();
  });

  it('normalizes email, stores only the refresh hash, and sets secure token cookies', async () => {
    const startedAt = Date.now();
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: ' LOGIN@EXAMPLE.COM ', password })
      .expect(200);

    expect(response.body).toEqual(publicUser);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(repository.findUserByEmail).toHaveBeenCalledWith(publicUser.email);

    const cookies = response.headers['set-cookie'] as unknown as string[];
    const accessCookie = cookies.find((cookie) => cookie.startsWith('access_token='))!;
    const refreshCookie = cookies.find((cookie) => cookie.startsWith('refresh_token='))!;
    for (const cookie of cookies) {
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Strict');
    }
    expect(accessCookie).toContain('Max-Age=900');
    expect(accessCookie).toContain('Path=/;');
    expect(refreshCookie).toContain('Path=/auth;');

    const accessToken = accessCookie.split(';')[0]!.slice('access_token='.length);
    const refreshToken = refreshCookie.split(';')[0]!.slice('refresh_token='.length);
    const claims = await jwt.verifyAsync<{ sub: string; iat: number; exp: number }>(accessToken);
    expect(claims.sub).toBe(publicUser.id);
    expect(claims.exp - claims.iat).toBe(900);
    expect(refreshToken).toMatch(/^[a-f0-9]{64}$/);

    const session = repository.createSession.mock.calls[0]![0];
    expect(session.userId).toBe(publicUser.id);
    expect(session.refreshTokenHash).toBe(createHash('sha256').update(refreshToken).digest('hex'));
    const ttl = 7 * 24 * 60 * 60 * 1000;
    expect(session.expiresAt.getTime()).toBeGreaterThanOrEqual(startedAt + ttl);
    expect(session.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + ttl);
  });

  it.each([
    { email: 'invalid', password },
    { email: publicUser.email, password: '' },
    { email: publicUser.email, password: 12345 },
    { email: publicUser.email },
    { email: publicUser.email, password, unexpected: true },
  ])('rejects invalid input before accessing the database (%j)', async (body) => {
    await request(app.getHttpServer()).post('/auth/login').send(body).expect(400);
    expect(repository.findUserByEmail).not.toHaveBeenCalled();
    expect(repository.createSession).not.toHaveBeenCalled();
  });

  it.each(['unknown email', 'wrong password', 'missing hash', 'Google account', 'overlong UTF-8 password'])(
    'rejects %s without creating a session or setting cookies',
    async (scenario) => {
      let submittedPassword = password;
      if (scenario === 'unknown email') repository.findUserByEmail.mockResolvedValue(null);
      if (scenario === 'wrong password') submittedPassword = 'wrong-password';
      if (scenario === 'missing hash') {
        repository.findUserByEmail.mockResolvedValue({
          ...publicUser, signInMethod: SignInMethod.PASSWORD, passwordHash: null,
        });
      }
      if (scenario === 'Google account') {
        repository.findUserByEmail.mockResolvedValue({
          ...publicUser, signInMethod: SignInMethod.GOOGLE, passwordHash: null,
        });
      }
      if (scenario === 'overlong UTF-8 password') submittedPassword = 'é'.repeat(37);

      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: publicUser.email, password: submittedPassword })
        .expect(401);
      expect(response.body.message).toBe(scenario === 'Google account'
        ? 'Continue with Google to sign in'
        : 'Invalid email or password');
      expect(repository.createSession).not.toHaveBeenCalled();
      expect(response.headers['set-cookie']).toBeUndefined();
    },
  );

  it('sends no cookies when saving the session fails', async () => {
    repository.createSession.mockRejectedValue(new Error('database unavailable'));
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: publicUser.email, password })
      .expect(500);
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(response.body.message).toBe('Internal server error');
  });
});
