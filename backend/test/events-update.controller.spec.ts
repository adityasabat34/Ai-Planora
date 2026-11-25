import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { EventsModule } from '../src/events/events.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { Prisma } from '../src/generated/prisma/client.js';
import type { PublicUser } from '../src/auth/auth.types.js';

describe('PATCH /events/:id', () => {
  let app: INestApplication;
  let cookie: string;
  const user: PublicUser = {
    id: '3aab047c-2d7d-4d42-bd4f-f231369c6f98', fullName: 'Owner',
    email: 'owner@example.com', username: 'owner',
  };
  const event = {
    id: '9877aa6d-9c1e-4320-9db6-83cb979833a0', ownerId: user.id, title: 'Original',
    startTime: new Date('2026-12-01T09:00:00Z'), endTime: new Date('2026-12-01T10:00:00Z'),
    location: 'Home' as string | null, privateNote: 'Private' as string | null,
    createdAt: new Date('2026-11-23T00:00:00Z'), updatedAt: new Date('2026-11-23T00:00:00Z'),
  };
  const findUser = vi.fn<() => Promise<PublicUser | null>>();
  const findEvent = vi.fn<() => Promise<typeof event | null>>();
  const update = vi.fn<(args: Prisma.EventUpdateArgs) => Promise<unknown>>();
  const updateDeadlines = vi.fn<() => Promise<number>>();

  function recordNotFound() {
    return new Prisma.PrismaClientKnownRequestError('No matching event', { code: 'P2025', clientVersion: '7.10.1' });
  }

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [EventsModule] })
      .overrideProvider(PrismaService).useValue({
        user: { findUnique: findUser }, event: { findUnique: findEvent, update },
        $executeRaw: updateDeadlines, $transaction: (operations: Promise<unknown>[]) => Promise.all(operations),
      })
      .overrideProvider(ConfigService).useValue(new ConfigService({
        JWT_ACCESS_SECRET: 'event-update-secret-used-only-in-tests', NODE_ENV: 'test',
      })).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    cookie = `access_token=${await module.get(JwtService).signAsync({ sub: user.id })}`;
  });

  beforeEach(() => {
    vi.resetAllMocks();
    findUser.mockResolvedValue(user);
    findEvent.mockResolvedValue(event);
    update.mockImplementation(async ({ data }) => ({ ...event, ...data }));
    updateDeadlines.mockResolvedValue(0);
  });

  afterAll(async () => { await app?.close(); });

  it('updates only supplied fields and scopes the write to the owner', async () => {
    const response = await request(app.getHttpServer()).patch(`/events/${event.id}`)
      .set('Cookie', cookie).send({ title: ' Renamed ' }).expect(200);
    expect(response.body).toMatchObject({ title: 'Renamed', location: 'Home', privateNote: 'Private' });
    expect(response.body.startTime).toBe(event.startTime.toISOString());
    expect(response.headers['cache-control']).toBe('no-store');
    expect(updateDeadlines).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledExactlyOnceWith({
      where: { id: event.id, ownerId: user.id, deletedAt: null }, data: { title: 'Renamed' },
      select: {
        id: true, ownerId: true, title: true, startTime: true, endTime: true,
        location: true, privateNote: true, createdAt: true, updatedAt: true,
      },
    });
  });

  it('clears nullable fields explicitly', async () => {
    const response = await request(app.getHttpServer()).patch(`/events/${event.id}`)
      .set('Cookie', cookie).send({ location: null, privateNote: null }).expect(200);
    expect(response.body.location).toBeNull();
    expect(response.body.privateNote).toBeNull();
    expect(update.mock.calls[0]![0].data).toEqual({ location: null, privateNote: null });
  });

  it('accepts optional text and trims the location', async () => {
    const response = await request(app.getHttpServer()).patch(`/events/${event.id}`)
      .set('Cookie', cookie).send({ location: ' Office ', privateNote: 'Updated note' }).expect(200);
    expect(response.body.location).toBe('Office');
    expect(response.body.privateNote).toBe('Updated note');
  });

  it('merges a partial schedule with stored times and checks the original schedule on write', async () => {
    await request(app.getHttpServer()).patch(`/events/${event.id}`).set('Cookie', cookie)
      .send({ startTime: '2026-12-01T15:00:00+05:30' }).expect(200);
    expect(update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: event.id, ownerId: user.id, deletedAt: null, startTime: event.startTime, endTime: event.endTime },
      data: { startTime: new Date('2026-12-01T09:30:00Z') },
    }));
    expect(updateDeadlines).toHaveBeenCalledOnce();
  });

  it('allows moving both timestamps and spanning multiple days', async () => {
    await request(app.getHttpServer()).patch(`/events/${event.id}`).set('Cookie', cookie)
      .send({ startTime: '2027-01-01T09:00:00Z', endTime: '2027-01-03T10:00:00Z' }).expect(200);
    expect(update.mock.calls[0]![0].data).toEqual({
      startTime: new Date('2027-01-01T09:00:00Z'), endTime: new Date('2027-01-03T10:00:00Z'),
    });
  });

  it.each([
    {}, { title: null }, { title: '' }, { title: '  ' }, { title: 'a'.repeat(201) },
    { startTime: null }, { endTime: null }, { startTime: 'invalid' },
    { startTime: '2026-02-30T09:00:00Z' }, { endTime: '2026-12-01T10:00:00' },
    { startTime: event.endTime.toISOString() }, { endTime: event.startTime.toISOString() },
    { startTime: '2026-12-01T11:00:00Z' }, { endTime: '2026-12-01T08:00:00Z' },
    { location: 123 }, { location: 'a'.repeat(501) },
    { privateNote: [] }, { privateNote: 'a'.repeat(10001) },
    { ownerId: 'another-user' }, { id: event.id }, { unexpected: true },
  ])('rejects an invalid update without writing (%j)', async body => {
    await request(app.getHttpServer()).patch(`/events/${event.id}`).set('Cookie', cookie).send(body).expect(400);
    expect(update).not.toHaveBeenCalled();
  });

  it.each(['missing', 'another owner'])('returns 404 for an event with %s', async () => {
    findEvent.mockResolvedValue(null);
    const response = await request(app.getHttpServer()).patch(`/events/${event.id}`)
      .set('Cookie', cookie).send({ title: 'New' }).expect(404);
    expect(response.body.message).toBe('Event not found');
    expect(findEvent).toHaveBeenCalledWith(expect.objectContaining({ where: { id: event.id, ownerId: user.id, deletedAt: null } }));
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 409 if a concurrent edit changes the schedule', async () => {
    update.mockRejectedValue(recordNotFound());
    const response = await request(app.getHttpServer()).patch(`/events/${event.id}`)
      .set('Cookie', cookie).send({ endTime: '2026-12-01T11:00:00Z' }).expect(409);
    expect(response.body.message).toBe('Event schedule changed. Reload and retry');
  });

  it('returns 404 if the event disappears before the update', async () => {
    findEvent.mockResolvedValueOnce(event).mockResolvedValueOnce(null);
    update.mockRejectedValue(recordNotFound());
    await request(app.getHttpServer()).patch(`/events/${event.id}`)
      .set('Cookie', cookie).send({ title: 'New' }).expect(404);
  });

  it('rejects malformed IDs', async () => {
    await request(app.getHttpServer()).patch('/events/invalid').set('Cookie', cookie).send({ title: 'New' }).expect(400);
    expect(findEvent).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it.each([undefined, 'access_token=invalid'])('requires login (%s)', async authCookie => {
    const pending = request(app.getHttpServer()).patch(`/events/${event.id}`);
    if (authCookie) pending.set('Cookie', authCookie);
    await pending.send({ title: 'New' }).expect(401);
    expect(update).not.toHaveBeenCalled();
  });

  it('requires completed username setup', async () => {
    findUser.mockResolvedValue({ ...user, username: null });
    await request(app.getHttpServer()).patch(`/events/${event.id}`)
      .set('Cookie', cookie).send({ title: 'New' }).expect(403);
    expect(update).not.toHaveBeenCalled();
  });

  it('preserves unexpected database errors', async () => {
    update.mockRejectedValue(new Error('database unavailable'));
    const response = await request(app.getHttpServer()).patch(`/events/${event.id}`)
      .set('Cookie', cookie).send({ title: 'New' }).expect(500);
    expect(response.body.message).toBe('Internal server error');
  });
});
