import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { UsersModule } from '../src/users/users.module.js';

describe('GET /users/username-availability', () => {
  let app: INestApplication;
  const findUnique = vi.fn<(args: unknown) => Promise<{ id: string } | null>>();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [UsersModule] })
      .overrideProvider(PrismaService).useValue({ user: { findUnique } })
      .overrideProvider(ConfigService).useValue(new ConfigService({
        JWT_ACCESS_SECRET: 'username-test-secret-used-only-in-tests',
        NODE_ENV: 'test',
      }))
      .compile();

    app = module.createNestApplication({ logger: false });
    await app.init();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    findUnique.mockResolvedValue(null);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('allows anonymous checks, normalizes the query, and selects only the ID', async () => {
    const response = await request(app.getHttpServer())
      .get('/users/username-availability')
      .query({ username: '  New_User  ' })
      .expect(200);

    expect(response.body).toEqual({ username: 'new_user', available: true });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(findUnique).toHaveBeenCalledExactlyOnceWith({
      where: { username: 'new_user' },
      select: { id: true },
    });
  });

  it('reports an existing normalized username as unavailable without exposing its ID', async () => {
    findUnique.mockResolvedValue({ id: 'private-user-id' });
    const response = await request(app.getHttpServer())
      .get('/users/username-availability')
      .query({ username: 'Current_User' })
      .expect(200);

    expect(response.body).toEqual({ username: 'current_user', available: false });
    expect(findUnique).toHaveBeenCalledWith({
      where: { username: 'current_user' },
      select: { id: true },
    });
  });

  it.each(['a_1', 'a'.repeat(30)])('accepts the valid length boundary (%s)', async (username) => {
    const response = await request(app.getHttpServer())
      .get('/users/username-availability')
      .query({ username })
      .expect(200);

    expect(response.body).toEqual({ username, available: true });
  });

  it.each([
    '',
    '?username=',
    '?username=%20%20',
    '?username=ab',
    `?username=${'a'.repeat(31)}`,
    '?username=some%20user',
    '?username=some-user',
    '?username=some.user',
    '?username=jos%C3%A9',
    '?username=valid&username=other',
    '?username[]=valid',
    '?username[name]=valid',
    '?username=valid&unexpected=true',
  ])('rejects an invalid query before looking up a user (%s)', async (query) => {
    await request(app.getHttpServer())
      .get(`/users/username-availability${query}`)
      .expect(400);

    expect(findUnique).not.toHaveBeenCalled();
  });

  it('returns a server error when the database fails', async () => {
    findUnique.mockRejectedValue(new Error('database unavailable'));
    const response = await request(app.getHttpServer())
      .get('/users/username-availability')
      .query({ username: 'valid_user' })
      .expect(500);

    expect(response.body.message).toBe('Internal server error');
    expect(response.body).not.toHaveProperty('available');
  });
});
