import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import bcrypt from 'bcrypt';
import { createHash } from 'node:crypto';
import request from 'supertest';
import { AuthController } from '../src/auth/auth.controller.js';
import { AuthRepository, DuplicateAccountError } from '../src/auth/auth.repository.js';
import { AuthService } from '../src/auth/auth.service.js';
import { AuthTokensService } from '../src/auth/auth.tokens.service.js';
import { createJwtOptions } from '../src/auth/config/jwt.config.js';
import { SignInMethod } from '../src/generated/prisma/client.js';
import type { CreateSessionInput } from '../src/auth/auth.types.js';

describe('Auth endpoints', () => {
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
    createPasswordUser: vi.fn<AuthRepository['createPasswordUser']>(),
    findUserByEmail: vi.fn<AuthRepository['findUserByEmail']>(),
    createSession: vi.fn<AuthRepository['createSession']>(),
    findSessionByRefreshTokenHash: vi.fn<AuthRepository['findSessionByRefreshTokenHash']>(),
    deleteSessionByRefreshTokenHash: vi.fn<AuthRepository['deleteSessionByRefreshTokenHash']>(),
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

    expect(response.body).toEqual({ ...publicUser, onboardingRequired: false, token: expect.any(String) });
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
    expect(response.body.token).toBe(accessToken);
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

  it('registers without a username, hashes the password, and creates a login session', async () => {
    repository.createPasswordUser.mockResolvedValue({ ...publicUser, username: null });
    const response = await request(app.getHttpServer()).post('/auth/register')
      .send({ fullName: ' Login Test ', email: ' LOGIN@EXAMPLE.COM ', password })
      .expect(201);

    expect(response.body).toEqual({
      ...publicUser, username: null, onboardingRequired: true, token: expect.any(String),
    });
    const input = repository.createPasswordUser.mock.calls[0]![0];
    expect(input).toEqual({
      fullName: publicUser.fullName, email: publicUser.email, passwordHash: expect.any(String),
    });
    expect(await bcrypt.compare(password, input.passwordHash)).toBe(true);
    expect(repository.createSession).toHaveBeenCalledOnce();
    expect(response.headers['set-cookie']).toHaveLength(2);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('lets a user log back in and resume unfinished username selection', async () => {
    repository.findUserByEmail.mockResolvedValue({
      ...publicUser, username: null, signInMethod: SignInMethod.PASSWORD, passwordHash,
    });
    const response = await request(app.getHttpServer()).post('/auth/login')
      .send({ email: publicUser.email, password }).expect(200);
    expect(response.body.username).toBeNull();
    expect(response.body.onboardingRequired).toBe(true);
    expect(response.headers['set-cookie']).toHaveLength(2);
  });

  it.each([
    { fullName: publicUser.fullName, email: publicUser.email, password, username: 'old_flow' },
    { fullName: publicUser.fullName, email: publicUser.email, password, onboardingRequired: false },
    { fullName: publicUser.fullName, password },
    { fullName: publicUser.fullName, email: 'invalid', password },
    { fullName: publicUser.fullName, email: publicUser.email },
    { fullName: publicUser.fullName, email: publicUser.email, password: 'é'.repeat(37) },
  ])('rejects invalid registration input (%j)', async body => {
    await request(app.getHttpServer()).post('/auth/register').send(body).expect(400);
    expect(repository.createPasswordUser).not.toHaveBeenCalled();
    expect(repository.createSession).not.toHaveBeenCalled();
  });

  it.each([SignInMethod.PASSWORD, SignInMethod.GOOGLE])('handles a duplicate registration email (%s)', async method => {
    repository.createPasswordUser.mockRejectedValue(new DuplicateAccountError('Email is already in use'));
    repository.findUserByEmail.mockResolvedValue({ ...publicUser, passwordHash, signInMethod: method });
    const response = await request(app.getHttpServer()).post('/auth/register')
      .send({ fullName: publicUser.fullName, email: publicUser.email, password }).expect(409);
    expect(response.body.message).toBe(method === SignInMethod.GOOGLE
      ? 'This email uses Google sign-in. Continue with Google'
      : 'Email is already in use');
    expect(repository.createSession).not.toHaveBeenCalled();
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('sends no cookies when registration session creation fails', async () => {
    repository.createPasswordUser.mockResolvedValue({ ...publicUser, username: null });
    repository.createSession.mockRejectedValue(new Error('database unavailable'));
    const response = await request(app.getHttpServer()).post('/auth/register')
      .send({ fullName: publicUser.fullName, email: publicUser.email, password }).expect(500);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it.each([
    { password },
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

  it('refreshes repeatedly using the same session and sets only the access cookie', async () => {
    const refreshToken = 'a'.repeat(64);
    const expiresAt = new Date(Date.now() + 86400000);
    repository.findSessionByRefreshTokenHash.mockResolvedValue({
      userId: publicUser.id,
      expiresAt,
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request(app.getHttpServer())
        .post('/auth/refresh')
        .set('Cookie', `refresh_token=${refreshToken}`)
        .expect(200);

      const claims = await jwt.verifyAsync<{ sub: string; iat: number; exp: number }>(response.body.token);
      expect(claims.sub).toBe(publicUser.id);
      expect(claims.exp - claims.iat).toBe(900);
      expect(response.headers['cache-control']).toBe('no-store');
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toHaveLength(1);
      expect(cookies[0]).toContain(`access_token=${response.body.token};`);
      expect(cookies[0]).toContain('Max-Age=900');
      expect(cookies[0]).toContain('HttpOnly');
      expect(cookies[0]).toContain('Secure');
      expect(cookies[0]).toContain('SameSite=Strict');
      expect(cookies[0]).toContain('Path=/;');
    }

    expect(repository.findSessionByRefreshTokenHash).toHaveBeenCalledTimes(2);
    expect(repository.findSessionByRefreshTokenHash).toHaveBeenCalledWith(
      createHash('sha256').update(refreshToken).digest('hex'),
    );
    expect(repository.createSession).not.toHaveBeenCalled();
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it.each([undefined, '', 'not-a-token', 'A'.repeat(64), 'b'.repeat(63)])(
    'rejects a missing or malformed refresh cookie (%s)', async (token) => {
      const pending = request(app.getHttpServer()).post('/auth/refresh');
      if (token !== undefined) pending.set('Cookie', `refresh_token=${token}`);
      const response = await pending.expect(401);
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(repository.findSessionByRefreshTokenHash).not.toHaveBeenCalled();
    },
  );

  it.each(['unknown', 'expired'])('rejects an %s refresh session', async (scenario) => {
    repository.findSessionByRefreshTokenHash.mockResolvedValue(scenario === 'unknown' ? null : {
      userId: publicUser.id,
      expiresAt: new Date(Date.now() - 1000),
    });
    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${'b'.repeat(64)}`)
      .expect(401);
    expect(response.body.message).toBe('Invalid or expired refresh token');
    expect(response.headers['set-cookie']).toBeUndefined();
    expect(repository.createSession).not.toHaveBeenCalled();
  });

  it('sends no access cookie if the refresh session lookup fails', async () => {
    repository.findSessionByRefreshTokenHash.mockRejectedValue(new Error('database unavailable'));
    const response = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${'b'.repeat(64)}`)
      .expect(500);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('logs out repeatedly, deleting by hash and expiring cookies at their original paths', async () => {
    const refreshToken = 'c'.repeat(64);
    repository.deleteSessionByRefreshTokenHash
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Cookie', `refresh_token=${refreshToken}`)
        .expect(204);

      expect(response.text).toBe('');
      expect(response.headers['cache-control']).toBe('no-store');
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toHaveLength(2);
      expect(cookies.find(cookie => cookie.startsWith('access_token=;'))).toContain('Path=/;');
      expect(cookies.find(cookie => cookie.startsWith('refresh_token=;'))).toContain('Path=/auth;');
      for (const cookie of cookies) {
        expect(cookie).toContain('HttpOnly');
        expect(cookie).toContain('Secure');
        expect(cookie).toContain('SameSite=Strict');
        expect(cookie).not.toContain('Max-Age=900');
        const expiry = /Expires=([^;]+)/.exec(cookie)![1]!;
        expect(new Date(expiry).getTime()).toBeLessThan(Date.now());
      }
    }

    expect(repository.deleteSessionByRefreshTokenHash).toHaveBeenCalledTimes(2);
    expect(repository.deleteSessionByRefreshTokenHash).toHaveBeenCalledWith(
      createHash('sha256').update(refreshToken).digest('hex'),
    );
  });

  it.each([undefined, '', 'invalid-token'])(
    'clears cookies when logging out with a missing or malformed token (%s)', async (token) => {
      const pending = request(app.getHttpServer()).post('/auth/logout');
      if (token !== undefined) pending.set('Cookie', `refresh_token=${token}`);
      const response = await pending.expect(204);
      expect(response.headers['set-cookie']).toHaveLength(2);
      expect(repository.deleteSessionByRefreshTokenHash).not.toHaveBeenCalled();
    },
  );

  it('returns a failure when session deletion fails', async () => {
    repository.deleteSessionByRefreshTokenHash.mockRejectedValue(new Error('database unavailable'));
    const response = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `refresh_token=${'d'.repeat(64)}`)
      .expect(500);
    expect(response.body.message).toBe('Internal server error');
    expect(response.headers['set-cookie']).toBeUndefined();
  });

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
