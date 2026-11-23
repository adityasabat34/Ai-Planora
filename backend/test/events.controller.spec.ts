import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { EventsModule } from '../src/events/events.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import type { PublicUser } from '../src/auth/auth.types.js';
import type { CreateEventInput } from '../src/events/events.types.js';

describe('POST /events', () => {
  let app: INestApplication;
  let cookie: string;
  const user: PublicUser = {
    id: '3aab047c-2d7d-4d42-bd4f-f231369c6f98',
    fullName: 'Event Owner', email: 'owner@example.com', username: 'event_owner',
  };
  const body = {
    title: 'Personal plan', startTime: '2026-12-01T09:00:00Z', endTime: '2026-12-01T10:00:00Z',
  };
  const findUnique = vi.fn<() => Promise<PublicUser | null>>();
  const create = vi.fn<(args: { data: CreateEventInput }) => Promise<unknown>>();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [EventsModule] })
      .overrideProvider(PrismaService).useValue({ user: { findUnique }, event: { create } })
      .overrideProvider(ConfigService).useValue(new ConfigService({
        JWT_ACCESS_SECRET: 'events-secret-used-only-in-tests', NODE_ENV: 'test',
      })).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    cookie = `access_token=${await module.get(JwtService).signAsync({ sub: user.id })}`;
  });

  beforeEach(() => {
    vi.resetAllMocks();
    findUnique.mockResolvedValue(user);
    create.mockImplementation(async ({ data }) => ({
      id: '9877aa6d-9c1e-4320-9db6-83cb979833a0', ...data,
      location: data.location ?? null, privateNote: data.privateNote ?? null,
      createdAt: new Date('2026-11-23T00:00:00Z'), updatedAt: new Date('2026-11-23T00:00:00Z'),
    }));
  });

  afterAll(async () => { await app?.close(); });

  it('persists an event for the authenticated owner and returns 201', async () => {
    const response = await request(app.getHttpServer()).post('/events').set('Cookie', cookie)
      .send({ ...body, title: ' Personal plan ', location: ' Office ', privateNote: 'Bring notes' })
      .expect(201);
    expect(create).toHaveBeenCalledExactlyOnceWith({
      data: {
        ownerId: user.id, title: body.title,
        startTime: new Date(body.startTime), endTime: new Date(body.endTime),
        location: 'Office', privateNote: 'Bring notes',
      },
      select: {
        id: true, ownerId: true, title: true, startTime: true, endTime: true,
        location: true, privateNote: true, createdAt: true, updatedAt: true,
      },
    });
    expect(response.body).toMatchObject({
      ...body, startTime: new Date(body.startTime).toISOString(), endTime: new Date(body.endTime).toISOString(),
      ownerId: user.id, location: 'Office', privateNote: 'Bring notes',
    });
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('allows omitted optional fields', async () => {
    const response = await request(app.getHttpServer()).post('/events').set('Cookie', cookie).send(body).expect(201);
    expect(response.body.location).toBeNull();
    expect(response.body.privateNote).toBeNull();
  });

  it('compares instants across different offsets', async () => {
    await request(app.getHttpServer()).post('/events').set('Cookie', cookie)
      .send({ ...body, startTime: '2026-12-01T14:30:00+05:30' }).expect(201);
    expect(create.mock.calls[0]![0].data.startTime.toISOString()).toBe(new Date(body.startTime).toISOString());
  });

  it('allows multi-day events and repeated time ranges', async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      await request(app.getHttpServer()).post('/events').set('Cookie', cookie)
        .send({ ...body, endTime: '2027-01-02T10:00:00Z' }).expect(201);
    }
    expect(create).toHaveBeenCalledTimes(2);
  });

  it.each([
    { title: '' }, { title: '   ' }, { title: 'a'.repeat(201) }, { title: null },
    { startTime: 'invalid' }, { startTime: '2026-02-30T09:00:00Z' },
    { startTime: '2026-12-01' }, { startTime: '2026-12-01T09:00:00' },
    { endTime: 'invalid' }, { endTime: body.startTime },
    { endTime: '2026-12-01T08:59:59Z' },
    { startTime: '2026-12-01T14:30:00+05:30', endTime: '2026-12-01T09:00:00Z' },
    { location: null }, { location: 123 }, { location: 'a'.repeat(501) },
    { privateNote: null }, { privateNote: ['note'] }, { privateNote: 'a'.repeat(10001) },
    { ownerId: 'another-account' }, { unexpected: true },
  ])('rejects invalid or unauthorized fields (%j)', async (overrides) => {
    await request(app.getHttpServer()).post('/events').set('Cookie', cookie)
      .send({ ...body, ...overrides }).expect(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects missing required fields', async () => {
    await request(app.getHttpServer()).post('/events').set('Cookie', cookie).send({}).expect(400);
    expect(create).not.toHaveBeenCalled();
  });

  it.each([undefined, 'access_token=invalid'])('requires a valid login (%s)', async authCookie => {
    const pending = request(app.getHttpServer()).post('/events');
    if (authCookie) pending.set('Cookie', authCookie);
    await pending.send(body).expect(401);
    expect(findUnique).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('requires username completion', async () => {
    findUnique.mockResolvedValue({ ...user, username: null });
    const response = await request(app.getHttpServer()).post('/events').set('Cookie', cookie).send(body).expect(403);
    expect(response.body.onboardingRequired).toBe(true);
    expect(create).not.toHaveBeenCalled();
  });

  it('rejects a deleted account', async () => {
    findUnique.mockResolvedValue(null);
    await request(app.getHttpServer()).post('/events').set('Cookie', cookie).send(body).expect(401);
    expect(create).not.toHaveBeenCalled();
  });

  it('handles an owner deleted between authorization and insertion', async () => {
    create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('Foreign key failed', {
      code: 'P2003', clientVersion: '7.10.1',
    }));
    await request(app.getHttpServer()).post('/events').set('Cookie', cookie).send(body).expect(401);
  });

  it('keeps database failures as server errors', async () => {
    create.mockRejectedValue(new Error('database unavailable'));
    const response = await request(app.getHttpServer()).post('/events').set('Cookie', cookie).send(body).expect(500);
    expect(response.body.message).toBe('Internal server error');
  });
});
