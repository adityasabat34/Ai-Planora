import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { SchedulerRegistry } from '@nestjs/schedule';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  it('registers exactly one expired-event cleanup job', () => {
    const jobs = app.get(SchedulerRegistry).getCronJobs();
    expect(jobs.size).toBe(1);
    expect(jobs.has('expired-event-cleanup')).toBe(true);
  });

  afterEach(async () => {
    await app.close();
  });
});
