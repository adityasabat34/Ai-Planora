import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { LoginTicket, OAuth2Client, type TokenPayload } from 'google-auth-library';
import request from 'supertest';
import { AuthModule } from '../src/auth/auth.module.js';
import { AuthRepository, DuplicateAccountError } from '../src/auth/auth.repository.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { SignInMethod } from '../src/generated/prisma/client.js';

describe('Google sign-in', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let nonce: string;
  let nonceCookie: string;
  const clientId = 'planora-test.apps.googleusercontent.com';
  const profile = { googleSub: 'google-account-123', email: 'google@example.com', fullName: 'Google User' };
  const user = { id: '3aab047c-2d7d-4d42-bd4f-f231369c6f98', fullName: profile.fullName, email: profile.email, username: 'google_user' };
  const config = new ConfigService({
    JWT_ACCESS_SECRET: 'google-test-secret-used-only-in-tests',
    GOOGLE_CLIENT_ID: clientId,
    NODE_ENV: 'production',
  });
  const client = { verifyIdToken: vi.fn<() => Promise<LoginTicket>>() };
  const repository = {
    findUserByGoogleSub: vi.fn<AuthRepository['findUserByGoogleSub']>(),
    findUserByEmail: vi.fn<AuthRepository['findUserByEmail']>(),
    createGoogleUser: vi.fn<AuthRepository['createGoogleUser']>(),
    createPasswordUser: vi.fn<AuthRepository['createPasswordUser']>(),
    createSession: vi.fn<AuthRepository['createSession']>(),
  };

  function ticket(overrides: Partial<TokenPayload> = {}) {
    return new LoginTicket(undefined, {
      iss: 'https://accounts.google.com', aud: clientId,
      sub: profile.googleSub, email: profile.email,
      email_verified: true, name: profile.fullName, nonce,
      iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
      ...overrides,
    });
  }

  async function beginSignup() {
    const response = await request(app.getHttpServer())
      .post('/auth/google/login')
      .set('Cookie', nonceCookie)
      .send({ idToken: 'google-credential' })
      .expect(200);
    const cookies = response.headers['set-cookie'] as unknown as string[];
    return cookies.find(value => value.startsWith('google_signup='))!.split(';')[0]!;
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [AuthModule] })
      .overrideProvider(AuthRepository).useValue(repository)
      .overrideProvider(PrismaService).useValue({})
      .overrideProvider(ConfigService).useValue(config)
      .overrideProvider(OAuth2Client).useValue(client)
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    jwt = module.get(JwtService);
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    repository.findUserByGoogleSub.mockResolvedValue(null);
    repository.findUserByEmail.mockResolvedValue(null);
    repository.createGoogleUser.mockResolvedValue({ ...user, username: null });
    repository.createSession.mockImplementation(async input => ({ id: 'session', expiresAt: input.expiresAt }));
    const challenge = await request(app.getHttpServer()).get('/auth/google/nonce').expect(200);
    nonce = challenge.body.nonce;
    const cookies = challenge.headers['set-cookie'] as unknown as string[];
    nonceCookie = cookies[0]!.split(';')[0]!;
    client.verifyIdToken.mockResolvedValue(ticket());
  });

  afterAll(async () => { await app?.close(); });

  it('issues a browser-bound challenge before Google registration', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/google/login').set('Cookie', nonceCookie)
      .send({ idToken: 'google-credential' }).expect(200);
    expect(client.verifyIdToken).toHaveBeenCalledWith({ idToken: 'google-credential', audience: clientId });
    expect(response.body).toEqual({ requiresSignup: true, profile: { email: profile.email, fullName: profile.fullName } });
    expect(response.headers['cache-control']).toBe('no-store');
    const cookies = response.headers['set-cookie'] as unknown as string[];
    const signupCookie = cookies.find(value => value.startsWith('google_signup='))!;
    expect(signupCookie).toContain('Path=/auth/google');
    expect(signupCookie).toContain('HttpOnly');
    expect(signupCookie).toContain('Secure');
    expect(signupCookie).toContain('SameSite=Strict');
    expect(signupCookie).toContain('Max-Age=600');
    expect(repository.createGoogleUser).not.toHaveBeenCalled();
    expect(repository.createSession).not.toHaveBeenCalled();
  });

  it('creates a Google account without a username and a normal Planora session', async () => {
    const cookie = await beginSignup();
    const response = await request(app.getHttpServer()).post('/auth/google/register')
      .set('Cookie', cookie).send({ fullName: ' Google User ' }).expect(200);
    expect(repository.createGoogleUser).toHaveBeenCalledWith(profile);
    expect(response.body).toEqual({ ...user, username: null, onboardingRequired: true, token: expect.any(String) });
    const claims = await jwt.verifyAsync<{ sub: string }>(response.body.token);
    expect(claims.sub).toBe(user.id);
    expect(repository.createSession).toHaveBeenCalledOnce();
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(cookies.some(value => value.startsWith('access_token='))).toBe(true);
    expect(cookies.some(value => value.startsWith('refresh_token='))).toBe(true);
  });

  it('signs in a returning Google user by sub even when the Google email changed', async () => {
    repository.findUserByGoogleSub.mockResolvedValue(user);
    client.verifyIdToken.mockResolvedValue(ticket({ email: 'changed@example.com' }));
    const response = await request(app.getHttpServer()).post('/auth/google/login')
      .set('Cookie', nonceCookie).send({ idToken: 'google-credential' }).expect(200);
    expect(repository.findUserByGoogleSub).toHaveBeenCalledWith(profile.googleSub);
    expect(repository.findUserByEmail).not.toHaveBeenCalled();
    expect(repository.createGoogleUser).not.toHaveBeenCalled();
    expect(response.body.id).toBe(user.id);
    expect(response.body.onboardingRequired).toBe(false);
  });

  it('lets a returning Google user resume unfinished username selection', async () => {
    repository.findUserByGoogleSub.mockResolvedValue({ ...user, username: null });
    const response = await request(app.getHttpServer()).post('/auth/google/login')
      .set('Cookie', nonceCookie).send({ idToken: 'google-credential' }).expect(200);
    expect(response.body.username).toBeNull();
    expect(response.body.onboardingRequired).toBe(true);
    expect(repository.createGoogleUser).not.toHaveBeenCalled();
    expect(repository.createSession).toHaveBeenCalledOnce();
  });

  it('rejects a password-account email without linking the account', async () => {
    repository.findUserByEmail.mockResolvedValue({ ...user, signInMethod: SignInMethod.PASSWORD, passwordHash: 'hash' });
    const response = await request(app.getHttpServer()).post('/auth/google/login')
      .set('Cookie', nonceCookie).send({ idToken: 'google-credential' }).expect(409);
    expect(response.body.message).toContain('password sign-in');
    expect(repository.createGoogleUser).not.toHaveBeenCalled();
    expect(repository.createSession).not.toHaveBeenCalled();
  });

  it.each(['missing cookie', 'wrong nonce', 'unverified email', 'invalid token'])(
    'rejects %s before account lookup', async scenario => {
      if (scenario === 'wrong nonce') client.verifyIdToken.mockResolvedValue(ticket({ nonce: 'wrong' }));
      if (scenario === 'unverified email') client.verifyIdToken.mockResolvedValue(ticket({ email_verified: false }));
      if (scenario === 'invalid token') client.verifyIdToken.mockRejectedValue(new Error('bad signature, audience, or expiry'));
      const pending = request(app.getHttpServer()).post('/auth/google/login');
      if (scenario !== 'missing cookie') pending.set('Cookie', nonceCookie);
      await pending.send({ idToken: 'google-credential' }).expect(401);
      expect(repository.findUserByGoogleSub).not.toHaveBeenCalled();
      expect(repository.createSession).not.toHaveBeenCalled();
    },
  );

  it.each(['missing', 'expired', 'access token', 'nonce token'])(
    'rejects %s signup proof', async scenario => {
      let cookie: string | undefined;
      if (scenario === 'expired') cookie = 'google_signup=' + await jwt.signAsync(profile, { audience: 'planora:google-signup', expiresIn: -1 });
      if (scenario === 'access token') cookie = 'google_signup=' + await jwt.signAsync({ sub: user.id });
      if (scenario === 'nonce token') cookie = nonceCookie.replace('google_nonce=', 'google_signup=');
      const pending = request(app.getHttpServer()).post('/auth/google/register');
      if (cookie) pending.set('Cookie', cookie);
      await pending.send({ fullName: user.fullName }).expect(401);
      expect(repository.createGoogleUser).not.toHaveBeenCalled();
    },
  );

  it('keeps signup proof available when account creation fails', async () => {
    const cookie = await beginSignup();
    repository.createGoogleUser.mockRejectedValueOnce(new DuplicateAccountError('Email is already in use'));
    const response = await request(app.getHttpServer()).post('/auth/google/register')
      .set('Cookie', cookie).send({ fullName: user.fullName }).expect(409);
    expect(response.headers['set-cookie']).toBeUndefined();
    await request(app.getHttpServer()).post('/auth/google/register')
      .set('Cookie', cookie).send({ fullName: user.fullName }).expect(200);
  });

  it('recovers when another request created the same Google account concurrently', async () => {
    const cookie = await beginSignup();
    repository.findUserByGoogleSub.mockResolvedValueOnce(null).mockResolvedValueOnce(user);
    repository.createGoogleUser.mockRejectedValueOnce(new DuplicateAccountError('duplicate'));
    await request(app.getHttpServer()).post('/auth/google/register')
      .set('Cookie', cookie).send({ fullName: user.fullName }).expect(200);
  });

  it('retries session creation after an account was created successfully', async () => {
    const cookie = await beginSignup();
    repository.createSession.mockRejectedValueOnce(new Error('database unavailable'));
    await request(app.getHttpServer()).post('/auth/google/register')
      .set('Cookie', cookie).send({ fullName: user.fullName }).expect(500);
    repository.findUserByGoogleSub.mockResolvedValue(user);
    await request(app.getHttpServer()).post('/auth/google/register')
      .set('Cookie', cookie).send({ fullName: user.fullName }).expect(200);
    expect(repository.createGoogleUser).toHaveBeenCalledOnce();
  });

  it('rejects client-supplied identity fields in signup', async () => {
    const cookie = await beginSignup();
    await request(app.getHttpServer()).post('/auth/google/register')
      .set('Cookie', cookie).send({ fullName: user.fullName, email: 'attacker@example.com' }).expect(400);
    expect(repository.createGoogleUser).not.toHaveBeenCalled();
  });

  it('requires Google registration and username selection to be separate requests', async () => {
    const cookie = await beginSignup();
    await request(app.getHttpServer()).post('/auth/google/register')
      .set('Cookie', cookie).send({ fullName: user.fullName, username: user.username }).expect(400);
    expect(repository.createGoogleUser).not.toHaveBeenCalled();
  });

  it('reports missing Google configuration without breaking password routes', async () => {
    config.set('GOOGLE_CLIENT_ID', '');
    try {
      await request(app.getHttpServer()).get('/auth/google/nonce').expect(503);
    } finally {
      config.set('GOOGLE_CLIENT_ID', clientId);
    }
  });
});
