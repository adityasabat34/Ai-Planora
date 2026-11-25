import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { EventsModule } from '../src/events/events.module.js';
import { PrismaClient, type EventInvitation } from '../src/generated/prisma/client.js';
import { InvitationsModule } from '../src/invitations/invitations.module.js';

const testDatabaseUrl = process.env.PLANORA_TEST_DATABASE_URL;

describe.runIf(testDatabaseUrl)('Organizer invitations with PostgreSQL', () => {
  const ownerId = randomUUID();
  const guestId = randomUUID();
  const guestEmail = `${guestId}@example.test`;
  let db: PrismaClient;
  let app: INestApplication;
  let ownerCookie: string;
  let guestCookie: string;

  function hoursFromNow(hours: number) {
    return new Date(Date.now() + hours * 60 * 60 * 1000);
  }

  function createEvent(startTime = hoursFromNow(48)) {
    return db.event.create({ data: {
      ownerId, title: 'Test event', startTime, endTime: hoursFromNow(72), privateNote: 'Owner only',
    } });
  }

  async function storedInvitation(eventId: string) {
    type Stored = Pick<EventInvitation, 'id' | 'inviteeEmail' | 'inviteeUserId' | 'status' | 'createdAt' | 'expiresAt'>;
    const rows = await db.$queryRaw<Stored[]>`
      SELECT "id", "inviteeEmail", "inviteeUserId", "status"::text AS "status",
             "createdAt" AT TIME ZONE 'UTC' AS "createdAt", "expiresAt" AT TIME ZONE 'UTC' AS "expiresAt"
      FROM "EventInvitation" WHERE "eventId" = ${eventId}::uuid`;
    expect(rows).toHaveLength(1);
    return rows[0]!;
  }

  function invite(eventId: string, email: string, cookie = ownerCookie) {
    return request(app.getHttpServer()).post(`/events/${eventId}/invitations`).set('Cookie', cookie).send({ email });
  }

  function moveStart(eventId: string, startTime: Date) {
    return request(app.getHttpServer()).patch(`/events/${eventId}`).set('Cookie', ownerCookie)
      .send({ startTime: startTime.toISOString() }).expect(200);
  }

  beforeAll(async () => {
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl, options: '-c timezone=Asia/Kolkata' }) });
    const module = await Test.createTestingModule({ imports: [EventsModule, InvitationsModule] })
      .overrideProvider(PrismaService).useValue(db)
      .overrideProvider(ConfigService).useValue(new ConfigService({ JWT_ACCESS_SECRET: 'postgres-invitation-test-secret' }))
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    await db.user.createMany({ data: [ownerId, guestId].map(id => ({
      id, fullName: 'Invitation test user', email: `${id}@example.test`, username: id.replaceAll('-', '').slice(0, 30), signInMethod: 'PASSWORD',
    })) });
    const jwt = module.get(JwtService);
    ownerCookie = `access_token=${await jwt.signAsync({ sub: ownerId })}`;
    guestCookie = `access_token=${await jwt.signAsync({ sub: guestId })}`;
  });

  afterAll(async () => {
    try {
      await db?.user.deleteMany({ where: { id: { in: [ownerId, guestId] } } });
    } finally {
      await app?.close();
      await db?.$disconnect();
    }
  });

  it('commits one invitation for concurrent sends and keeps organizer data private', async () => {
    const event = await createEvent();
    const responses = await Promise.all([invite(event.id, guestEmail), invite(event.id, ` ${guestEmail.toUpperCase()} `)]);
    expect(responses.map(response => response.status).sort((a, b) => a - b)).toEqual([200, 201]);
    expect(responses[0]!.body).toEqual(responses[1]!.body);
    const stored = await storedInvitation(event.id);
    expect(stored).toMatchObject({ id: responses[0]!.body.id, inviteeEmail: guestEmail, inviteeUserId: guestId, status: 'PENDING' });
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(stored.createdAt.toISOString()).toBe(responses[0]!.body.createdAt);
    expect(await db.eventMember.count({ where: { eventId: event.id } })).toBe(0);
    const resource = `/events/${event.id}/invitations/${stored.id}`;
    const read = await request(app.getHttpServer()).get(resource).set('Cookie', ownerCookie).expect(200);
    expect(Object.keys(read.body).sort()).toEqual(['id', 'eventId', 'inviteeEmail', 'status', 'createdAt', 'expiresAt', 'respondedAt'].sort());
    await request(app.getHttpServer()).get(resource).set('Cookie', guestCookie).expect(404);
    await invite(event.id, 'other@example.test', guestCookie).expect(404);
    await request(app.getHttpServer()).delete(`/events/${event.id}`).set('Cookie', ownerCookie).expect(204);
    await invite(event.id, guestEmail).expect(404);
    await request(app.getHttpServer()).get(resource).set('Cookie', ownerCookie).expect(404);
  });

  it('stores the calendar start as the exact deadline when the database session uses Asia/Kolkata', async () => {
    const start = hoursFromNow(2);
    const event = await createEvent(start);
    const created = await invite(event.id, guestEmail).expect(201);
    expect(created.body.expiresAt).toBe(start.toISOString());
    const stored = await storedInvitation(event.id);
    expect(stored.expiresAt).toEqual(start);
    const read = await request(app.getHttpServer()).get(created.headers.location as string).set('Cookie', ownerCookie).expect(200);
    expect(read.body).toEqual(created.body);
  });

  it('serializes an invitation with a concurrent reschedule and never reopens an expired invite', async () => {
    const event = await createEvent();
    const email = `${randomUUID()}@example.test`;
    const earlierStart = hoursFromNow(3);
    await Promise.all([invite(event.id, email).expect(201), moveStart(event.id, earlierStart)]);
    const stored = await storedInvitation(event.id);
    expect(stored).toMatchObject({ status: 'PENDING', inviteeUserId: null, expiresAt: earlierStart });

    await moveStart(event.id, hoursFromNow(36));
    const extended = await storedInvitation(event.id);
    expect(extended.expiresAt.getTime() - stored.createdAt.getTime()).toBe(24 * 60 * 60 * 1000);
    const elapsedStart = hoursFromNow(-1);
    await moveStart(event.id, elapsedStart);
    await moveStart(event.id, hoursFromNow(12));
    const replay = await invite(event.id, email).expect(200);
    expect(replay.body).toMatchObject({ id: stored.id, status: 'EXPIRED', expiresAt: elapsedStart.toISOString() });
  });
});
