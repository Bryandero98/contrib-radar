import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

// Boots the full app, including DatabaseModule - needs a real, reachable
// Postgres at DATABASE_URL. Skipped when that's not set, same gate as
// every *.service.spec.ts in this project.
const describeIfDb = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDb('AppController (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterEach(async () => {
    await app.close();
  });

  it('/ (GET) redirects to the dashboard', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(302)
      .expect('Location', '/dashboard');
  });

  it('/health (GET) reports ok with a reachable database', () => {
    return request(app.getHttpServer())
      .get('/health')
      .expect(200)
      .expect((res) => {
        const body = res.body as { status: string };
        expect(body.status).toBe('ok');
      });
  });
});
