import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { InvitationStatus } from '../src/generated/prisma/client.js';
import { InvitationsModule } from '../src/invitations/invitations.module.js';

describe('Organizer invitations', () => {
  const now = new Date('2026-11-25T12:00:00Z');
  const organizer = { id: '0a61ccf4-12d8-4797-9c74-7d2f622ca51d', email: 'owner@example.com', fullName: 'Owner', username: 'owner' };
  const eventId = 'e4c6b8c5-b6cd-4719-a93e-b17013ce1056';
  const inviteeId = 'ccb5d43d-06a2-42ae-a475-b665cdf8d11d';
  const invitation = {
    id: 'd43bc536-725b-4ad5-9c58-b369c6ce1c48', eventId, inviteeEmail: 'guest@example.com',
    status: InvitationStatus.PENDING, createdAt: now, expiresAt: new Date('2026-11-26T12:00:00Z'), respondedAt: null,
  };
  const collection = `/events/${eventId}/invitations`;
  const resource = `${collection}/${invitation.id}`;
  const selected = { id: true, eventId: true, inviteeEmail: true, status: true, createdAt: true, expiresAt: true, respondedAt: true };
  const event = { ownerEmail: organizer.email, startTime: new Date('2026-11-29T12:00:00Z') };
  const findUser = vi.fn();
  const query = vi.fn();
  const findExisting = vi.fn();
  const insert = vi.fn();
  const findOne = vi.fn();
  const tx = { $queryRaw: query, $executeRaw: vi.fn(), eventInvitation: { findUnique: findExisting, findFirst: findOne, create: insert } };
  const transaction = vi.fn<(work: (client: typeof tx) => Promise<unknown>) => Promise<unknown>>();
  let app: INestApplication;
  let cookie: string;

  beforeAll(async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(now);
    const module = await Test.createTestingModule({ imports: [InvitationsModule] })
      .overrideProvider(PrismaService).useValue({
        $transaction: transaction, user: { findUnique: findUser },
      })
      .overrideProvider(ConfigService).useValue(new ConfigService({ JWT_ACCESS_SECRET: 'organizer-invitation-test-secret' }))
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    cookie = `access_token=${await module.get(JwtService).signAsync({ sub: organizer.id })}`;
  });

  beforeEach(() => {
    vi.resetAllMocks();
    findUser.mockResolvedValue(organizer);
    transaction.mockImplementation(work => work(tx));
    findExisting.mockResolvedValue(null);
    insert.mockResolvedValue(invitation);
    findOne.mockResolvedValue(invitation);
  });

  afterAll(async () => {
    await app?.close();
    vi.useRealTimers();
  });

  function post(email: string) {
    return request(app.getHttpServer()).post(collection).set('Cookie', cookie).send({ email });
  }

  it('normalizes the address, binds an existing account, and provides the organizer resource URL', async () => {
    query.mockResolvedValueOnce([event]).mockResolvedValueOnce([{ id: inviteeId }]);
    const response = await post('  Guest@Example.com  ').expect(201);
    expect(insert).toHaveBeenCalledExactlyOnceWith({
      data: { eventId, inviteeEmail: invitation.inviteeEmail, inviteeUserId: inviteeId, createdAt: now, expiresAt: invitation.expiresAt },
      select: selected,
    });
    expect(findExisting).toHaveBeenCalledExactlyOnceWith({
      where: { eventId_inviteeEmail: { eventId, inviteeEmail: invitation.inviteeEmail } }, select: selected,
    });
    expect(response.headers.location).toBe(resource);
    expect(response.headers['cache-control']).toBe('no-store');
    const reading = await request(app.getHttpServer()).get(resource).set('Cookie', cookie).expect(200);
    expect(reading.body).toEqual(response.body);
    expect(findOne).toHaveBeenCalledExactlyOnceWith({ where: { id: invitation.id, eventId, event: { ownerId: organizer.id, deletedAt: null } }, select: selected });
  });

  it('records an invitation before signup and uses an earlier event start as its deadline', async () => {
    const startTime = new Date('2026-11-25T13:00:00Z');
    query.mockResolvedValueOnce([{ ...event, startTime }]).mockResolvedValueOnce([]);
    await post(invitation.inviteeEmail).expect(201);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      data: { eventId, inviteeEmail: invitation.inviteeEmail, inviteeUserId: null, createdAt: now, expiresAt: startTime },
    }));
  });

  it.each(Object.values(InvitationStatus))('preserves the original %s invite on a retry', async status => {
    query.mockResolvedValueOnce([event]);
    findExisting.mockResolvedValue({ ...invitation, status });
    const response = await post(invitation.inviteeEmail).expect(200);
    expect(response.body).toMatchObject({ id: invitation.id, status, expiresAt: invitation.expiresAt.toISOString() });
    expect(insert).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('reports an elapsed pending invite as expired on retry and lookup, including the exact cutoff', async () => {
    const elapsed = { ...invitation, expiresAt: now };
    query.mockResolvedValueOnce([{ ...event, startTime: now }]);
    findExisting.mockResolvedValue(elapsed);
    findOne.mockResolvedValue(elapsed);
    const replay = await post(invitation.inviteeEmail).expect(200);
    const read = await request(app.getHttpServer()).get(resource).set('Cookie', cookie).expect(200);
    expect(replay.body.status).toBe('EXPIRED');
    expect(read.body).toEqual(replay.body);
    expect(insert).not.toHaveBeenCalled();
  });

  it('requires an active event owned by the caller and hides inaccessible invitations', async () => {
    query.mockResolvedValueOnce([]);
    findOne.mockResolvedValue(null);
    await post(invitation.inviteeEmail).expect(404);
    expect(query.mock.calls[0]!.slice(1)).toEqual([eventId, organizer.id]);
    await request(app.getHttpServer()).get(resource).set('Cookie', cookie).expect(404);
    expect(findExisting).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects a self-invitation', async () => {
    query.mockResolvedValueOnce([event]);
    await post('OWNER@example.com').expect(400);
    expect(insert).not.toHaveBeenCalled();
  });

  it('rejects a new invitation at event start', async () => {
    query.mockResolvedValueOnce([{ ...event, startTime: now }]).mockResolvedValueOnce([]);
    await post(invitation.inviteeEmail).expect(409);
    expect(insert).not.toHaveBeenCalled();
  });

  it.each([{}, { email: 'invalid' }, { email: null }, { email: ['guest@example.com'] },
    { email: 'a'.repeat(245) + '@example.com' }, { email: invitation.inviteeEmail, status: 'ACCEPTED' },
    { email: invitation.inviteeEmail, inviteeUserId: inviteeId }])('rejects invalid inputs (%j)', async body => {
    await request(app.getHttpServer()).post(collection).set('Cookie', cookie).send(body).expect(400);
    expect(transaction).not.toHaveBeenCalled();
  });

  it('requires login and completed username setup for both operations', async () => {
    await request(app.getHttpServer()).post(collection).send({ email: invitation.inviteeEmail }).expect(401);
    await request(app.getHttpServer()).get(resource).expect(401);
    findUser.mockResolvedValue({ ...organizer, username: null });
    await post(invitation.inviteeEmail).expect(403);
    await request(app.getHttpServer()).get(resource).set('Cookie', cookie).expect(403);
    expect(transaction).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });

  it('validates the event and invitation UUIDs', async () => {
    await request(app.getHttpServer()).post('/events/invalid/invitations').set('Cookie', cookie).send({ email: invitation.inviteeEmail }).expect(400);
    await request(app.getHttpServer()).get(`${collection}/invalid`).set('Cookie', cookie).expect(400);
    expect(transaction).not.toHaveBeenCalled();
    expect(findOne).not.toHaveBeenCalled();
  });
});
