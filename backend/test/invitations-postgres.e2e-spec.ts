import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { InMemoryMailTransport, MailMessageError, MailTransport } from '@nestjs/mail';
import { Test } from '@nestjs/testing';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { PrismaService } from '../src/database/prisma.service.js';
import { EventsModule } from '../src/events/events.module.js';
import { PrismaClient, type EventInvitation } from '../src/generated/prisma/client.js';
import { InvitationsModule } from '../src/invitations/invitations.module.js';

const testDatabaseUrl = process.env.PLANORA_TEST_DATABASE_URL;

describe.runIf(testDatabaseUrl)('Event invitations with PostgreSQL', () => {
  const ownerId = randomUUID();
  const guestId = randomUUID();
  const guestEmail = `${guestId}@example.test`;
  const inboxUserId = randomUUID();
  const inboxEmail = `${inboxUserId}@example.test`;
  const signupEmail = `${randomUUID()}@example.test`;
  const googleSignupEmail = `${randomUUID()}@example.test`;
  const frontendInvitationUrl = 'https://calendar.example.test/account/register?source=invitation';
  const mailbox = new InMemoryMailTransport();
  let db: PrismaClient;
  let app: INestApplication;
  let ownerCookie: string;
  let guestCookie: string;
  let inboxCookie: string;

  beforeEach(() => mailbox.clear());

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
      .overrideProvider(MailTransport).useValue(mailbox)
      .overrideProvider(ConfigService).useValue(new ConfigService({
        JWT_ACCESS_SECRET: 'postgres-invitation-test-secret', NODE_ENV: 'test', FRONTEND_INVITATION_URL: frontendInvitationUrl,
      }))
      .compile();
    app = module.createNestApplication({ logger: false });
    await app.init();
    await db.user.createMany({ data: [ownerId, guestId, inboxUserId].map(id => ({
      id, fullName: 'Invitation test user', email: `${id}@example.test`, username: id.replaceAll('-', '').slice(0, 30), signInMethod: 'PASSWORD',
    })) });
    const jwt = module.get(JwtService);
    ownerCookie = `access_token=${await jwt.signAsync({ sub: ownerId })}`;
    guestCookie = `access_token=${await jwt.signAsync({ sub: guestId })}`;
    inboxCookie = `access_token=${await jwt.signAsync({ sub: inboxUserId })}`;
  });

  afterAll(async () => {
    try {
      await db?.user.deleteMany({ where: { email: { in: [signupEmail, googleSignupEmail] } } });
      await db?.user.deleteMany({ where: { id: { in: [ownerId, guestId, inboxUserId] } } });
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
    expect(mailbox.filter({ to: guestEmail })).toHaveLength(1);
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
    const inbox = await request(app.getHttpServer()).get('/invitations').set('Cookie', guestCookie).expect(200);
    expect(inbox.body.items).toContainEqual({
      id: stored.id, status: 'PENDING', createdAt: stored.createdAt.toISOString(), expiresAt: start.toISOString(),
    });
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

  it('pages through only this recipient’s visible invites when creation times tie', async () => {
    const [firstEvent, secondEvent, olderEvent, trashedEvent, unclaimedEvent] = await Promise.all(
      Array.from({ length: 5 }, () => createEvent()),
    );
    const [firstId, secondId] = [randomUUID(), randomUUID()].sort().reverse();
    const olderId = randomUUID();
    const foreignId = randomUUID();
    const trashedId = randomUUID();
    const unclaimedId = randomUUID();
    const issuedAt = hoursFromNow(-2);
    const deadline = hoursFromNow(12);
    const earlierIssue = hoursFromNow(-4);
    const elapsed = hoursFromNow(-1);
    const recipient = { inviteeUserId: inboxUserId, inviteeEmail: inboxEmail, createdAt: issuedAt, expiresAt: deadline };
    await db.$transaction(async tx => {
      await tx.$executeRaw`SET LOCAL TIME ZONE 'UTC'`;
      await tx.eventInvitation.createMany({ data: [
        { ...recipient, id: firstId, eventId: firstEvent.id },
        { ...recipient, id: secondId, eventId: secondEvent.id },
        { ...recipient, id: olderId, eventId: olderEvent.id, createdAt: earlierIssue, expiresAt: elapsed },
        { ...recipient, id: foreignId, eventId: firstEvent.id, inviteeUserId: guestId, inviteeEmail: guestEmail },
        { ...recipient, id: trashedId, eventId: trashedEvent.id },
        { ...recipient, id: unclaimedId, eventId: unclaimedEvent.id, inviteeUserId: null },
      ] });
    });
    await request(app.getHttpServer()).delete(`/events/${trashedEvent.id}`).set('Cookie', ownerCookie).expect(204);

    const inbox = () => request(app.getHttpServer()).get('/invitations').set('Cookie', inboxCookie);
    const first = await inbox().query({ limit: 1 }).expect(200);
    const pending = { status: 'PENDING', createdAt: issuedAt.toISOString(), expiresAt: deadline.toISOString() };
    expect(first.body).toEqual({ items: [{ id: firstId, ...pending }], nextCursor: firstId });

    // An invite arriving between page requests should appear on a fresh read, without shifting page two.
    const newestEvent = await createEvent();
    const newest = await invite(newestEvent.id, inboxEmail).expect(201);
    const second = await inbox().query({ limit: 2, cursor: first.body.nextCursor }).expect(200);
    expect(second.body).toEqual({
      items: [
        { id: secondId, ...pending },
        { id: olderId, status: 'EXPIRED', createdAt: earlierIssue.toISOString(), expiresAt: elapsed.toISOString() },
      ],
      nextCursor: null,
    });
    const refreshed = await inbox().query({ limit: 1 }).expect(200);
    expect(refreshed.body.items[0].id).toBe(newest.body.id);
    const afterLast = await inbox().query({ cursor: olderId }).expect(200);
    expect(afterLast.body).toEqual({ items: [], nextCursor: null });

    for (const cursor of [foreignId, trashedId, unclaimedId, randomUUID()]) {
      const invalid = await inbox().query({ cursor }).expect(400);
      expect(invalid.body.message).toBe('Invalid inbox cursor');
    }
    const stored = await storedInvitation(olderEvent.id);
    expect(stored.status).toBe('PENDING');
    expect(await db.eventMember.count({ where: { userId: inboxUserId } })).toBe(0);
  });

  it('lets Riya open only her visible invitation previews after ordinary signup, including an expired invite', async () => {
    const liveEvent = await createEvent();
    const earlyEvent = await createEvent(hoursFromNow(2));
    const calendar = await request(app.getHttpServer()).get(`/events/${earlyEvent.id}`).set('Cookie', ownerCookie).expect(200);
    const live = await invite(liveEvent.id, signupEmail).expect(201);
    await invite(liveEvent.id, signupEmail).expect(200);
    expect(mailbox.filter({ to: signupEmail })).toHaveLength(1);
    expect(mailbox.assertSent({ to: signupEmail }).link().href).toBe(frontendInvitationUrl);
    const early = await invite(earlyEvent.id, signupEmail).expect(201);
    const foreign = await invite(liveEvent.id, guestEmail).expect(201);
    const unclaimed = await invite(liveEvent.id, 'another-recipient@example.test').expect(201);
    expect((await storedInvitation(earlyEvent.id)).inviteeUserId).toBeNull();

    const afterEventStart = hoursFromNow(3);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(afterEventStart);
      const organizerSession = `access_token=${await app.get(JwtService).signAsync({ sub: ownerId })}`;
      const riya = request.agent(app.getHttpServer());
      const registration = await riya.post('/auth/register')
        .send({ fullName: 'Riya', email: ` ${signupEmail.toUpperCase()} `, password: 'test-password-97' }).expect(201);
      await riya.put('/users/me/username').send({ username: signupEmail.slice(0, 8) }).expect(200);
      const inbox = await riya.get('/invitations').expect(200);
      expect(inbox.body.items).toHaveLength(2);
      expect(inbox.body.items).toEqual(expect.arrayContaining([
        { id: live.body.id, status: 'PENDING', createdAt: live.body.createdAt, expiresAt: live.body.expiresAt },
        { id: early.body.id, status: 'EXPIRED', createdAt: early.body.createdAt, expiresAt: early.body.expiresAt },
      ]));

      const expiredPath = `/invitations/${early.body.id}`;
      const preview = await riya.get(expiredPath).expect(200).expect('Cache-Control', 'no-store');
      expect(preview.body).toEqual({
        id: early.body.id,
        status: 'EXPIRED',
        organizer: { fullName: 'Invitation test user', username: ownerId.replaceAll('-', '').slice(0, 30), email: `${ownerId}@example.test` },
        event: {
          title: calendar.body.title, startTime: calendar.body.startTime, endTime: calendar.body.endTime, timeZone: 'UTC',
        },
      });
      await riya.get(`/invitations/${live.body.id}`).expect(200).expect(({ body }) => {
        expect(body.status).toBe('PENDING');
      });
      await riya.get(`/invitations/${foreign.body.id}`).expect(404);
      await riya.get(`/invitations/${unclaimed.body.id}`).expect(404);
      await riya.get(`/invitations/${randomUUID()}`).expect(404);
      await request(app.getHttpServer()).get(expiredPath).set('Cookie', organizerSession).expect(404);
      expect(await storedInvitation(earlyEvent.id)).toMatchObject({ inviteeUserId: registration.body.id, status: 'PENDING' });
      expect((await db.eventInvitation.findUniqueOrThrow({ where: { id: unclaimed.body.id } })).inviteeUserId).toBeNull();
      expect(await db.eventMember.count({ where: { userId: registration.body.id } })).toBe(0);

      await request(app.getHttpServer()).delete(`/events/${earlyEvent.id}`).set('Cookie', organizerSession).expect(204);
      await riya.get(expiredPath).expect(404);
    } finally {
      vi.useRealTimers();
    }
  });

  it('links an invitation sent concurrently with Google registration to the same account', async () => {
    const event = await createEvent();
    const identity = { email: googleSignupEmail, fullName: 'Google Guest', googleSub: randomUUID() };
    const signupCookie = await app.get(JwtService).signAsync(identity, { audience: 'planora:google-signup', expiresIn: 600 });
    const google = request.agent(app.getHttpServer());
    const [registration, issued] = await Promise.all([
      google.post('/auth/google/register').set('Cookie', `google_signup=${signupCookie}`).send({ fullName: identity.fullName }).expect(200),
      invite(event.id, googleSignupEmail).expect(201),
    ]);
    await google.put('/users/me/username').send({ username: googleSignupEmail.slice(0, 8) }).expect(200);
    const inbox = await google.get('/invitations').expect(200);
    expect(inbox.body.items).toEqual([expect.objectContaining({ id: issued.body.id, status: 'PENDING' })]);
    expect((await storedInvitation(event.id)).inviteeUserId).toBe(registration.body.id);
    expect(mailbox.assertSent({ to: googleSignupEmail }).link().href).toBe(frontendInvitationUrl);
  });

  it('retries a failed delivery with the original invitation and sends one registration email', async () => {
    const event = await createEvent();
    mailbox.failNext(new MailMessageError('to', 'Test mail delivery failed'));
    await invite(event.id, guestEmail).expect(503);
    const saved = await storedInvitation(event.id);
    const responses = await Promise.all([invite(event.id, guestEmail).expect(200), invite(event.id, guestEmail).expect(200)]);
    for (const response of responses) expect(response.body.id).toBe(saved.id);
    await invite(event.id, guestEmail).expect(200);
    expect(mailbox.filter({ to: guestEmail })).toHaveLength(1);
    expect(mailbox.assertSent({ to: guestEmail }).link().href).toBe(frontendInvitationUrl);
  });
});
