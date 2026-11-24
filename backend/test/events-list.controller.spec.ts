import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { EventsModule } from '../src/events/events.module.js';
import { PrismaService } from '../src/database/prisma.service.js';
import type { PublicUser } from '../src/auth/auth.types.js';
import type { Prisma } from '../src/generated/prisma/client.js';

describe('GET /events', () => {
  let app: INestApplication;
  let jwt: JwtService;
  let cookie: string;
  const user: PublicUser = {
    id: '3aab047c-2d7d-4d42-bd4f-f231369c6f98',
    fullName: 'Calendar Owner', email: 'calendar@example.com', username: 'calendar_owner',
  };
  const range = { from: '2026-12-01T00:00:00Z', to: '2027-01-01T00:00:00Z' };
  const findUser = vi.fn<() => Promise<PublicUser | null>>();
  const findMany = vi.fn<(args: Prisma.EventFindManyArgs) => Promise<unknown[]>>();

  beforeAll(async () => {
    const module = await Test.createTestingModule({ imports: [EventsModule] })
      .overrideProvider(PrismaService).useValue({ user: { findUnique: findUser }, event: { findMany } })
      .overrideProvider(ConfigService).useValue(new ConfigService({
        JWT_ACCESS_SECRET: 'event-list-secret-used-only-in-tests', NODE_ENV: 'test',
      })).compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    jwt = module.get(JwtService);
    cookie = `access_token=${await jwt.signAsync({ sub: user.id })}`;
  });

  beforeEach(() => {
    vi.resetAllMocks();
    findUser.mockResolvedValue(user);
    findMany.mockResolvedValue([]);
  });

  afterAll(async () => { await app?.close(); });

  it('queries all overlapping owned events with stable ordering and strict boundaries', async () => {
    const events = [{
      id: '9877aa6d-9c1e-4320-9db6-83cb979833a0', ownerId: user.id,
      title: 'Spans the entire month', startTime: '2026-11-30T10:00:00Z',
      endTime: '2027-01-02T10:00:00Z', privateNote: 'Owner only',
    }];
    findMany.mockResolvedValue(events);
    const response = await request(app.getHttpServer()).get('/events')
      .set('Cookie', cookie).query(range).expect(200);
    expect(response.body).toEqual(events);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(findMany).toHaveBeenCalledExactlyOnceWith({
      where: {
        ownerId: user.id, deletedAt: null, startTime: { lt: new Date(range.to) }, endTime: { gt: new Date(range.from) },
      },
      orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      select: {
        id: true, ownerId: true, title: true, startTime: true, endTime: true,
        location: true, privateNote: true, createdAt: true, updatedAt: true,
      },
    });
  });

  it('returns an empty array when no events overlap', async () => {
    const response = await request(app.getHttpServer()).get('/events')
      .set('Cookie', cookie).query(range).expect(200);
    expect(response.body).toEqual([]);
  });

  it('normalizes UTC offsets to instants', async () => {
    await request(app.getHttpServer()).get('/events').set('Cookie', cookie)
      .query({ from: '2026-12-01T05:30:00+05:30', to: range.to }).expect(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: user.id, deletedAt: null, startTime: { lt: new Date(range.to) }, endTime: { gt: new Date(range.from) } },
    }));
  });

  it('uses the verified account ID for each calendar query', async () => {
    const otherUser = { ...user, id: '97356276-fcad-4ca2-bd41-091ce2344ebe' };
    findUser.mockResolvedValue(otherUser);
    const otherCookie = `access_token=${await jwt.signAsync({ sub: otherUser.id })}`;
    await request(app.getHttpServer()).get('/events').set('Cookie', otherCookie).query(range).expect(200);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ownerId: otherUser.id, deletedAt: null, startTime: { lt: new Date(range.to) }, endTime: { gt: new Date(range.from) } },
    }));
  });

  it.each([
    {}, { from: range.from }, { to: range.to },
    { ...range, from: '' }, { ...range, from: 'invalid' },
    { ...range, from: '2026-02-30T00:00:00Z' },
    { ...range, from: '2026-12-01' }, { ...range, to: '2027-01-01T00:00:00' },
    { ...range, to: range.from }, { from: range.to, to: range.from },
    { from: '2026-12-01T05:30:00+05:30', to: range.from },
    { ...range, from: [range.from, range.from] },
    { ...range, ownerId: user.id }, { ...range, unexpected: 'value' },
  ])('rejects invalid queries before event lookup (%j)', async query => {
    await request(app.getHttpServer()).get('/events').set('Cookie', cookie).query(query).expect(400);
    expect(findMany).not.toHaveBeenCalled();
  });

  it.each([undefined, 'access_token=invalid'])('requires login (%s)', async authCookie => {
    const pending = request(app.getHttpServer()).get('/events').query(range);
    if (authCookie) pending.set('Cookie', authCookie);
    await pending.expect(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('requires completed username setup', async () => {
    findUser.mockResolvedValue({ ...user, username: null });
    await request(app.getHttpServer()).get('/events').set('Cookie', cookie).query(range).expect(403);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('rejects deleted accounts', async () => {
    findUser.mockResolvedValue(null);
    await request(app.getHttpServer()).get('/events').set('Cookie', cookie).query(range).expect(401);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('preserves database failures as server errors', async () => {
    findMany.mockRejectedValue(new Error('database unavailable'));
    const response = await request(app.getHttpServer()).get('/events')
      .set('Cookie', cookie).query(range).expect(500);
    expect(response.body.message).toBe('Internal server error');
  });
});
