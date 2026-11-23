import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { UsersModule } from '../src/users/users.module.js';
import type { PublicUser } from '../src/auth/auth.types.js';

describe('Username setup', () => {
  let app: INestApplication;
  let cookie: string;
  const user: PublicUser = {
    id: '3aab047c-2d7d-4d42-bd4f-f231369c6f98',
    fullName: 'Pending User',
    email: 'pending@example.com',
    username: null,
  };
  const findUnique = vi.fn<() => Promise<PublicUser | null>>();
  const update = vi.fn<() => Promise<PublicUser>>();

  function databaseError(code: string) {
    return new Prisma.PrismaClientKnownRequestError('Database constraint error', {
      code, clientVersion: '7.10.1',
    });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [UsersModule] })
      .overrideProvider(PrismaService).useValue({ user: { findUnique, update } })
      .overrideProvider(ConfigService).useValue(new ConfigService({
        JWT_ACCESS_SECRET: 'username-setup-secret-used-only-in-tests',
        NODE_ENV: 'test',
      }))
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    cookie = `access_token=${await module.get(JwtService).signAsync({ sub: user.id })}`;
  });

  beforeEach(() => {
    vi.resetAllMocks();
    findUnique.mockResolvedValue(user);
    update.mockResolvedValue({ ...user, username: 'pending_user' });
  });

  afterAll(async () => { await app?.close(); });

  it('reports unfinished setup through /users/me', async () => {
    const response = await request(app.getHttpServer()).get('/users/me')
      .set('Cookie', cookie).expect(200);
    expect(response.body).toEqual({ ...user, onboardingRequired: true });
  });

  it('normalizes and assigns the username only to the authenticated account', async () => {
    const response = await request(app.getHttpServer()).put('/users/me/username')
      .set('Cookie', cookie).send({ username: ' Pending_User ' }).expect(200);
    expect(update).toHaveBeenCalledExactlyOnceWith({
      where: { id: user.id, OR: [{ username: null }, { username: 'pending_user' }] },
      data: { username: 'pending_user' },
      select: { id: true, fullName: true, email: true, username: true },
    });
    expect(response.body).toEqual({ ...user, username: 'pending_user', onboardingRequired: false });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('accepts a repeated submission of the same username', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await request(app.getHttpServer()).put('/users/me/username')
        .set('Cookie', cookie).send({ username: 'pending_user' }).expect(200);
    }
    expect(update).toHaveBeenCalledTimes(2);
    // The conditional write accepts either an unclaimed account or this exact username.
    expect(update).toHaveBeenLastCalledWith(expect.objectContaining({
      where: { id: user.id, OR: [{ username: null }, { username: 'pending_user' }] },
    }));
  });

  it.each([undefined, 'access_token=invalid'])(
    'rejects unauthenticated assignment (%s)', async (authCookie) => {
      const pending = request(app.getHttpServer()).put('/users/me/username');
      if (authCookie) pending.set('Cookie', authCookie);
      await pending.send({ username: 'pending_user' }).expect(401);
      expect(update).not.toHaveBeenCalled();
    },
  );

  it.each([
    {}, { username: null }, { username: 123 }, { username: ['valid'] },
    { username: '' }, { username: 'ab' }, { username: 'a'.repeat(31) },
    { username: 'some user' }, { username: 'some-user' }, { username: 'josé' },
    { username: 'valid', userId: 'another-account' },
    { username: 'valid', onboardingRequired: false },
  ])('rejects invalid input before writing (%j)', async (body) => {
    await request(app.getHttpServer()).put('/users/me/username')
      .set('Cookie', cookie).send(body).expect(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 409 if a username was taken after its availability check', async () => {
    findUnique.mockResolvedValueOnce(null);
    const available = await request(app.getHttpServer())
      .get('/users/username-availability?username=pending_user').expect(200);
    expect(available.body.available).toBe(true);

    update.mockRejectedValue(databaseError('P2002'));
    const response = await request(app.getHttpServer()).put('/users/me/username')
      .set('Cookie', cookie).send({ username: 'pending_user' }).expect(409);
    expect(response.body.message).toBe('Username is already in use');
  });

  it('returns 409 when a different username is already set', async () => {
    update.mockRejectedValue(databaseError('P2025'));
    findUnique.mockResolvedValue({ ...user, username: 'original' });
    const response = await request(app.getHttpServer()).put('/users/me/username')
      .set('Cookie', cookie).send({ username: 'replacement' }).expect(409);
    expect(response.body.message).toBe('Username is already set');
  });

  it('returns 401 if the account was deleted before assignment', async () => {
    update.mockRejectedValue(databaseError('P2025'));
    findUnique.mockResolvedValue(null);
    await request(app.getHttpServer()).put('/users/me/username')
      .set('Cookie', cookie).send({ username: 'pending_user' }).expect(401);
  });

  it('keeps unexpected database errors as server errors', async () => {
    update.mockRejectedValue(new Error('database unavailable'));
    const response = await request(app.getHttpServer()).put('/users/me/username')
      .set('Cookie', cookie).send({ username: 'pending_user' }).expect(500);
    expect(response.body.message).toBe('Internal server error');
  });

  it('reports completed setup without issuing another token', async () => {
    await request(app.getHttpServer()).put('/users/me/username')
      .set('Cookie', cookie).send({ username: 'pending_user' }).expect(200);
    findUnique.mockResolvedValue({ ...user, username: 'pending_user' });

    const profile = await request(app.getHttpServer()).get('/users/me').set('Cookie', cookie).expect(200);
    expect(profile.body.onboardingRequired).toBe(false);
  });

});
