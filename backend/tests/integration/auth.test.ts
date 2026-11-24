import request from 'supertest';

/**
 * Auth flow integration tests with in-memory fake models.
 * The models module is replaced by generic fakes so the full
 * HTTP → route → service → model path runs without MongoDB.
 */
jest.mock('../../src/models', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createFakeModel } = require('../helpers/fakeModel');
  const cache = new Map<string, unknown>();
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === '__esModule') return true;
        if (!cache.has(prop)) cache.set(prop, createFakeModel());
        return cache.get(prop);
      },
    },
  );
});

import { createApp } from '../../src/app';

const app = createApp();

describe('Auth flow (fake models)', () => {
  it('registers a new user and returns tokens without password hash', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', username: 'testuser', password: 'password123', displayName: 'Test User' });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
    expect(res.body.data.tokens.refreshToken).toBeTruthy();
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user.email).toBe('test@example.com');
  });

  it('rejects duplicate registration (409)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ email: 'test@example.com', username: 'testuser', password: 'password123' });
    expect(res.status).toBe(409);
  });

  it('logs in with correct credentials', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.body.data.tokens.accessToken).toBeTruthy();
  });

  it('rejects wrong password (401)', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('refresh rotates tokens and revokes the old session', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });
    const oldRefresh = login.body.data.tokens.refreshToken as string;

    const refreshed = await request(app).post('/api/auth/refresh').send({ refreshToken: oldRefresh });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.data.refreshToken).toBeTruthy();
    expect(refreshed.body.data.refreshToken).not.toBe(oldRefresh);

    // Old refresh token must no longer work.
    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken: oldRefresh });
    expect(replay.status).toBe(401);
  });

  it('GET /api/auth/me returns profile + preferences', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });
    const token = login.body.data.tokens.accessToken as string;

    const me = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe('test@example.com');
    expect(me.body.data.profile).toBeTruthy();
    expect(me.body.data.preferences).toBeTruthy();
  });

  it('logout revokes the session', async () => {
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });
    const refresh = login.body.data.tokens.refreshToken as string;

    const out = await request(app).post('/api/auth/logout').send({ refreshToken: refresh });
    expect(out.status).toBe(200);

    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken: refresh });
    expect(replay.status).toBe(401);
  });

  it('forgot + reset password flow works in development', async () => {
    const forgot = await request(app).post('/api/auth/forgot-password').send({ email: 'test@example.com' });
    expect(forgot.status).toBe(200);
    const token = forgot.body.data.token as string;
    expect(token).toBeTruthy();

    const reset = await request(app).post('/api/auth/reset-password').send({ token, newPassword: 'newpassword456' });
    expect(reset.status).toBe(200);

    const login = await request(app).post('/api/auth/login').send({ email: 'test@example.com', password: 'newpassword456' });
    expect(login.status).toBe(200);
  });

  it('change password requires the current password', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'test@example.com', password: 'newpassword456' });
    const token = login.body.data.tokens.accessToken as string;

    const bad = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'wrong', newPassword: 'anotherpass789' });
    expect(bad.status).toBe(400);

    const good = await request(app)
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword: 'newpassword456', newPassword: 'anotherpass789' });
    expect(good.status).toBe(200);
  });
});

describe('session security regressions (fake database)', () => {
  it('exactly one concurrent refresh succeeds', async () => {
    const login = await request(app).post('/api/auth/login').send({ email: 'test@example.com', password: 'anotherpass789' });
    const refreshToken = login.body.data.tokens.refreshToken;
    const responses = await Promise.all([1,2].map(() => request(app).post('/api/auth/refresh').send({ refreshToken })));
    expect(responses.map(r=>r.status).sort()).toEqual([200,401]);
  });
  it('logout immediately invalidates access JWT through session binding', async () => {
    const login = await request(app).post('/api/auth/login').send({ email:'test@example.com',password:'anotherpass789' });
    const tokens = login.body.data.tokens;
    await request(app).post('/api/auth/logout').send({refreshToken:tokens.refreshToken});
    expect((await request(app).get('/api/auth/me').set('Authorization',`Bearer ${tokens.accessToken}`)).status).toBe(401);
  });
  it('forgot response does not disclose nonexistent account', async () => {
    const response=await request(app).post('/api/auth/forgot-password').send({email:'missing@example.com'});
    expect(response.status).toBe(200);expect(response.body.data.sent).toBe(true);expect(response.body.data.token).toBeUndefined();
  });
});

describe('public authentication capabilities', () => {
  it('reports Google as unavailable without backend credentials and leaks no secret', async () => {
    const response = await request(app).get('/api/auth/providers');
    expect(response.status).toBe(200);
    const google = (response.body.data as { id: string; enabled: boolean; exchangeEndpoint: string }[])
      .find((provider) => provider.id === 'google');
    expect(google).toBeDefined();
    expect(google!.enabled).toBe(false);
    expect(google!.exchangeEndpoint).toBe('/auth/google');
    expect(JSON.stringify(response.body)).not.toMatch(/client_secret|clientSecret|GOOGLE_CLIENT/i);
  });
});
