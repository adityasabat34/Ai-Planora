import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { EventsModule } from '../src/events/events.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { EVENT_TRASH_RETENTION_MS } from '../src/events/events.constants.js';
import type { PublicUser } from '../src/auth/auth.types.js';

describe('Event recycle bin', () => {
  let app: INestApplication;
  let cookie: string;
  const now = new Date('2026-11-23T12:00:00Z');
  const cutoff = new Date(now.getTime() - EVENT_TRASH_RETENTION_MS);
  const user: PublicUser = {
    id: '3aab047c-2d7d-4d42-bd4f-f231369c6f98', fullName: 'Owner',
    email: 'owner@example.com', username: 'owner',
  };
  const event = {
    id: '9877aa6d-9c1e-4320-9db6-83cb979833a0', ownerId: user.id, title: 'Plan',
    startTime: new Date('2026-12-01T09:00:00Z'), endTime: new Date('2026-12-01T10:00:00Z'),
    location: null, privateNote: 'Private', createdAt: now, updatedAt: now,
  };
  const findUser = vi.fn<() => Promise<PublicUser | null>>();
  const findEvent = vi.fn<() => Promise<unknown>>();
  const findMany = vi.fn<() => Promise<unknown[]>>();
  const update = vi.fn<() => Promise<unknown>>();
  const updateMany = vi.fn<() => Promise<{ count: number }>>();

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const module = await Test.createTestingModule({ imports: [EventsModule] })
      .overrideProvider(PrismaService).useValue({
        user: { findUnique: findUser }, event: { findUnique: findEvent, findMany, update, updateMany },
      })
      .overrideProvider(ConfigService).useValue(new ConfigService({
        JWT_ACCESS_SECRET: 'event-trash-secret-used-only-in-tests', NODE_ENV: 'test',
      })).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    cookie = `access_token=${await module.get(JwtService).signAsync({ sub: user.id })}`;
  });

  beforeEach(() => {
    vi.resetAllMocks();
    findUser.mockResolvedValue(user);
    findEvent.mockResolvedValue(null);
    findMany.mockResolvedValue([]);
    updateMany.mockResolvedValue({ count: 1 });
    update.mockResolvedValue(event);
  });

  afterAll(async () => { await app?.close(); vi.useRealTimers(); });

  it('soft-deletes an owned active event and returns 204 with no body', async () => {
    const response = await request(app.getHttpServer()).delete(`/events/${event.id}`)
      .set('Cookie', cookie).expect(204);
    expect(response.text).toBe('');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(updateMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: event.id, ownerId: user.id, deletedAt: null }, data: { deletedAt: now },
    });
  });

  it('accepts repeated deletion without extending the retention window', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    findEvent.mockResolvedValue({ id: event.id });
    await request(app.getHttpServer()).delete(`/events/${event.id}`).set('Cookie', cookie).expect(204);
    expect(updateMany).toHaveBeenCalledOnce();
    expect(findEvent).toHaveBeenCalledExactlyOnceWith({
      where: { id: event.id, ownerId: user.id, deletedAt: { gt: cutoff, lte: now } },
      select: { id: true },
    });
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 404 when deleting a missing, unowned, or expired event', async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await request(app.getHttpServer()).delete(`/events/${event.id}`).set('Cookie', cookie).expect(404);
  });

  it('routes /events/trash correctly and excludes expired rows at the exact cutoff', async () => {
    const deleted = { ...event, deletedAt: now };
    findMany.mockResolvedValue([deleted]);
    const response = await request(app.getHttpServer()).get('/events/trash').set('Cookie', cookie).expect(200);
    expect(response.body).toEqual([JSON.parse(JSON.stringify(deleted))]);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: { ownerId: user.id, deletedAt: { gt: cutoff, lte: now } },
      orderBy: [{ deletedAt: 'desc' }, { id: 'asc' }],
      select: {
        id: true, ownerId: true, title: true, startTime: true, endTime: true,
        location: true, privateNote: true, createdAt: true, updatedAt: true, deletedAt: true,
      },
    });
    expect(findEvent).not.toHaveBeenCalled();
  });

  it('returns an empty recycle bin when no recoverable rows exist', async () => {
    const response = await request(app.getHttpServer()).get('/events/trash').set('Cookie', cookie).expect(200);
    expect(response.body).toEqual([]);
  });

  it('opts into a bounded page and reports an empty result with pagination metadata', async () => {
    const response = await request(app.getHttpServer()).get('/events/trash').set('Cookie', cookie)
      .query({ limit: 100 }).expect(200);
    expect(response.body).toEqual({ items: [], nextCursor: null });
    expect(findMany).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      where: { ownerId: user.id, deletedAt: { gt: cutoff, lte: now } }, take: 101,
    }));
  });

  it.each([{ limit: 101 }, { cursor: 'invalid' }])('rejects invalid trash pagination (%j)', async query => {
    await request(app.getHttpServer()).get('/events/trash').set('Cookie', cookie).query(query).expect(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('restores only an owned row deleted less than 21 days ago in one conditional write', async () => {
    const response = await request(app.getHttpServer()).post(`/events/${event.id}/restore`)
      .set('Cookie', cookie).expect(200);
    expect(response.body.id).toBe(event.id);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(update).toHaveBeenCalledExactlyOnceWith({
      where: { id: event.id, ownerId: user.id, deletedAt: { gt: cutoff, lte: now } },
      data: { deletedAt: null },
      select: {
        id: true, ownerId: true, title: true, startTime: true, endTime: true,
        location: true, privateNote: true, createdAt: true, updatedAt: true,
      },
    });
  });

  it('returns 404 when no owned recoverable row matches the restore condition', async () => {
    update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('No match', { code: 'P2025', clientVersion: '7.10.1' }));
    await request(app.getHttpServer()).post(`/events/${event.id}/restore`).set('Cookie', cookie).expect(404);
  });

  it('keeps a deleted event unavailable for normal lookup and editing', async () => {
    await request(app.getHttpServer()).get(`/events/${event.id}`).set('Cookie', cookie).expect(404);
    await request(app.getHttpServer()).patch(`/events/${event.id}`).set('Cookie', cookie)
      .send({ title: 'Changed' }).expect(404);
    expect(findEvent).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: event.id, ownerId: user.id, deletedAt: null },
    }));
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['delete', 'restore'] as const)('rejects malformed IDs for %s', async action => {
    const pending = action === 'delete'
      ? request(app.getHttpServer()).delete('/events/invalid')
      : request(app.getHttpServer()).post('/events/invalid/restore');
    await pending.set('Cookie', cookie).expect(400);
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['delete', 'trash', 'restore'] as const)('requires login for %s', async action => {
    const pending = action === 'delete' ? request(app.getHttpServer()).delete(`/events/${event.id}`)
      : action === 'trash' ? request(app.getHttpServer()).get('/events/trash')
      : request(app.getHttpServer()).post(`/events/${event.id}/restore`);
    await pending.expect(401);
    expect(updateMany).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['delete', 'trash', 'restore'] as const)('requires completed onboarding for %s', async action => {
    findUser.mockResolvedValue({ ...user, username: null });
    const pending = action === 'delete' ? request(app.getHttpServer()).delete(`/events/${event.id}`)
      : action === 'trash' ? request(app.getHttpServer()).get('/events/trash')
      : request(app.getHttpServer()).post(`/events/${event.id}/restore`);
    await pending.set('Cookie', cookie).expect(403);
    expect(updateMany).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['delete', 'trash', 'restore'] as const)('preserves database failures for %s', async action => {
    const error = new Error('database unavailable');
    updateMany.mockRejectedValue(error);
    findMany.mockRejectedValue(error);
    update.mockRejectedValue(error);
    const pending = action === 'delete' ? request(app.getHttpServer()).delete(`/events/${event.id}`)
      : action === 'trash' ? request(app.getHttpServer()).get('/events/trash')
      : request(app.getHttpServer()).post(`/events/${event.id}/restore`);
    const response = await pending.set('Cookie', cookie).expect(500);
    expect(response.body.message).toBe('Internal server error');
  });
});
