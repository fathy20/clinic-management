import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppModule } from '../src/app.module.js';
import { AuthService } from '../src/modules/auth/auth.service.js';
import { closePools, ownerPool } from './helpers/db.js';

const PASSWORD = 'e2e-test-password';

describe('auth flow (FR-IAM-01, FR-IAM-02)', () => {
  let app: INestApplication;
  let email: string;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    // Seed a clinic with one owner who can actually authenticate.
    const suffix = randomUUID().slice(0, 8);
    email = `e2e_${suffix}@example.test`;

    const client = await ownerPool.connect();
    try {
      await client.query('begin');
      const plan = await client.query<{ id: string }>(
        `insert into plans (code, name, price_egp) values ($1, 'E2E', '900.00') returning id`,
        [`e2e_${suffix}`],
      );
      const clinic = await client.query<{ id: string }>(
        `insert into clinics (name) values ($1) returning id`,
        [`E2E clinic ${suffix}`],
      );
      await client.query(
        `insert into subscriptions (clinic_id, plan_id, status) values ($1, $2, 'active')`,
        [clinic.rows[0]!.id, plan.rows[0]!.id],
      );
      const user = await client.query<{ id: string }>(
        `insert into users (email, password_hash, full_name) values ($1, $2, 'E2E owner') returning id`,
        [email, await AuthService.hashPassword(PASSWORD)],
      );
      await client.query(
        `insert into memberships (clinic_id, user_id, role) values ($1, $2, 'owner')`,
        [clinic.rows[0]!.id, user.rows[0]!.id],
      );
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  });

  afterAll(async () => {
    await app.close();
    await closePools();
  });

  const login = () =>
    request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: email, password: PASSWORD });

  it('rejects a wrong password with 401', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: email, password: 'not-the-password' })
      .expect(401);
  });

  it('rejects an unknown account with 401, not 404', async () => {
    // A different status for a missing account would enumerate users.
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: 'nobody@example.test', password: PASSWORD })
      .expect(401);
  });

  it('issues a 15-minute access token and a refresh token', async () => {
    const res = await login().expect(200);
    expect(res.body.expiresIn).toBe(900);
    expect(res.body.accessToken).toBeTypeOf('string');
    expect(res.body.refreshToken).toBeTypeOf('string');
    expect(res.body.principal.role).toBe('owner');

    const claims = JSON.parse(
      Buffer.from(res.body.accessToken.split('.')[1], 'base64url').toString(),
    );
    expect(claims.exp - claims.iat).toBe(900);
    // Tenant context is carried by the token, never by a header (FR-PLT-02).
    expect(claims.cid).toBe(res.body.principal.clinicId);
  });

  it('refuses /me without a token and answers with one', async () => {
    await request(app.getHttpServer()).get('/api/auth/me').expect(401);

    const { body } = await login().expect(200);
    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${body.accessToken}`)
      .expect(200);

    expect(me.body.userId).toBe(body.principal.userId);
    expect(me.body.memberships).toHaveLength(1);
  });

  it('rotates the refresh token, and the new one differs from the old', async () => {
    const { body } = await login().expect(200);

    const rotated = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: body.refreshToken })
      .expect(200);

    expect(rotated.body.refreshToken).toBeTypeOf('string');
    expect(rotated.body.refreshToken).not.toBe(body.refreshToken);
  });

  it('detects reuse, and the revocation survives the rejection', async () => {
    const { body } = await login().expect(200);

    const rotated = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: body.refreshToken })
      .expect(200);

    // Presenting the already-redeemed token must fail...
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: body.refreshToken })
      .expect(401);

    // ...and must have revoked the whole family, including the token that was
    // legitimately issued a moment ago. If the revocation ran inside the request
    // transaction, the 401 would have rolled it back and this would still work.
    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401);
  });

  it('logout revokes the family', async () => {
    const { body } = await login().expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .send({ refreshToken: body.refreshToken })
      .expect(204);

    await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: body.refreshToken })
      .expect(401);
  });

  it('rejects a body carrying unexpected fields', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ identifier: email, password: PASSWORD, role: 'owner' })
      .expect(400);
  });
});
