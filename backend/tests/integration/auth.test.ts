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

/**
 * Refresh-token rotation families and reuse detection.
 *
 * These run against the in-memory fake models, so the exact grace-window logic
 * in `authService.refresh` is exercised without a live database. The live
 * behaviour against MongoDB Atlas lives in `tests/atlas/atlasIntegration.test.ts`.
 */
describe('refresh token reuse detection (fake database)', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const models = require('../../src/models');
  const email = 'reuse@example.com';
  const password = 'reusePassword123';

  /**
   * Registers a dedicated account and returns the refresh token of the login
   * session plus its rotation `family`, so assertions can be scoped to that
   * chain (registration issues its own session in its own family).
   */
  async function loginFresh(suffix: string): Promise<{ userId: string; refreshToken: string; family: string }> {
    const registered = await request(app)
      .post('/api/auth/register')
      .send({ email, username: `reuse_${suffix}`, password, displayName: 'Reuse Probe' });
    expect([201, 409]).toContain(registered.status);
    const login = await request(app).post('/api/auth/login').send({ email, password });
    expect(login.status).toBe(200);

    const payload = (login.body.data.user ?? registered.body?.data?.user ?? {}) as Record<string, unknown>;
    const userId = String(payload._id ?? payload.id ?? '');
    expect(userId).not.toBe('');
    const tokens = login.body.data.tokens as { accessToken: string; refreshToken: string };

    // The access token carries `sid`, the session document id, so the login
    // session is identified exactly instead of guessing from document order.
    const jwt = await import('jsonwebtoken');
    const decoded = jwt.decode(tokens.accessToken) as { sid?: string } | null;
    expect(decoded?.sid).toBeTruthy();
    const loginSession = (await models.UserSession.findById(String(decoded?.sid))) as Record<string, any> | null;
    expect(loginSession).not.toBeNull();
    expect(String(loginSession!.user)).toBe(userId);
    expect(loginSession!.revokedAt).toBeUndefined();
    expect(loginSession!.refreshTokenHash).toBeTruthy();

    return { userId, refreshToken: tokens.refreshToken, family: String(loginSession!.family) };
  }

  async function sessionsInFamily(userId: string, family: string): Promise<Array<Record<string, any>>> {
    return models.UserSession.find({ user: userId, family }).sort({ createdAt: 1 });
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rotates within one family and rejects a replay inside the grace window without revoking the family', async () => {
    const first = await loginFresh('grace');
    const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(rotated.status).toBe(200);
    const rotatedRefresh = rotated.body.data.refreshToken as string;
    expect(rotatedRefresh).not.toBe(first.refreshToken);

    // A concurrent tab / retried network call re-sends the already-consumed token.
    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(replay.status).toBe(401);

    // The legitimately rotated session must survive a benign replay.
    const stillWorks = await request(app).post('/api/auth/refresh').send({ refreshToken: rotatedRefresh });
    expect(stillWorks.status).toBe(200);

    const family = await sessionsInFamily(first.userId, first.family);
    // login session (consumed) + first rotation (consumed by the second refresh) + live session.
    expect(family.length).toBe(3);
    expect(family.every((session) => session.family === first.family)).toBe(true);
    const consumed = family.filter((session) => session.revokedReason === 'rotated');
    expect(consumed.length).toBe(2);
    expect(consumed.every((session) => session.rotatedAt !== undefined)).toBe(true);
    const live = family.filter((session) => session.revokedAt === undefined);
    expect(live.length).toBe(1);
    // A benign replay must never be recorded as theft.
    expect(family.filter((session) => session.revokedReason === 'reuse_detected')).toEqual([]);
  });

  it('revokes the whole rotation family when a consumed token replays after the grace window', async () => {
    const first = await loginFresh('theft');
    const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(rotated.status).toBe(200);
    const rotatedRefresh = rotated.body.data.refreshToken as string;

    // Simulate the theft being noticed well after REFRESH_REUSE_GRACE_MS.
    const realNow = Date.now();
    jest.spyOn(Date, 'now').mockImplementation(() => realNow + 120_000);

    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(replay.status).toBe(401);
    jest.restoreAllMocks();

    // Containment: the newer token issued to the legitimate device is also dead.
    const rotatedNowFails = await request(app).post('/api/auth/refresh').send({ refreshToken: rotatedRefresh });
    expect(rotatedNowFails.status).toBe(401);

    const family = await sessionsInFamily(first.userId, first.family);
    expect(family.length).toBe(2);
    expect(family.filter((session) => session.revokedReason === 'reuse_detected').length).toBe(1);
    expect(family.every((session) => session.revokedAt !== undefined)).toBe(true);

    // The access token of the revoked session no longer authenticates.
    const me = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${rotated.body.data.accessToken as string}`);
    expect(me.status).toBe(401);
  });

  it('treats a logout-revoked token as reuse instead of a benign replay', async () => {
    const first = await loginFresh('logout');
    const logout = await request(app).post('/api/auth/logout').send({ refreshToken: first.refreshToken });
    expect([200, 204]).toContain(logout.status);

    const replay = await request(app).post('/api/auth/refresh').send({ refreshToken: first.refreshToken });
    expect(replay.status).toBe(401);

    const family = await sessionsInFamily(first.userId, first.family);
    const loggedOut = family.find((session) => session.revokedReason === 'logout');
    expect(loggedOut).toBeDefined();
    expect(family.every((session) => session.revokedAt !== undefined)).toBe(true);
    // A logout replay must not resurrect or issue anything.
    expect(family.length).toBe(1);
  });

  it('rejects a refresh token signed with the access-token secret', async () => {
    const first = await loginFresh('cross');
    const jwt = await import('jsonwebtoken');
    const { env } = await import('../../src/config/env');
    const forged = jwt.sign({ sub: first.userId, sid: 'forged' }, env.JWT_SECRET, { expiresIn: '1h' });
    const response = await request(app).post('/api/auth/refresh').send({ refreshToken: forged });
    expect(response.status).toBe(401);
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
