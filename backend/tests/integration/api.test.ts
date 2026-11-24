import request from 'supertest';
import { createApp } from '../../src/app';
import { signAccessToken } from '../../src/utils/crypto';

jest.mock('../../src/services/catalogService', () => ({
  catalogService: {
    getTrack: jest.fn(async () => ({ providerId: '1', source: 'deezer', streamUrl: 'https://cdn.example/preview.mp3' })),
  },
}));

// Replace all Mongoose models with in-memory fakes so no real DB is needed.
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

const app = createApp();
const userToken = signAccessToken('user-1', 'user');
const adminToken = signAccessToken('admin-1', 'admin');

describe('API integration (no DB required)', () => {
  it('GET /health returns ok', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
  });

  it('unknown routes return 404 envelope', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('protected routes require authentication (401)', async () => {
    const res = await request(app).get('/api/music');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('invalid tokens are rejected (401)', async () => {
    const res = await request(app).get('/api/music').set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
  });

  it('non-admin users cannot access admin routes (403)', async () => {
    const res = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('admin token passes authorization (fails later on DB, not 403)', async () => {
    const res = await request(app).get('/api/admin/dashboard').set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).not.toBe(403);
    expect(res.status).not.toBe(401);
  });

  it('register validation rejects bad input (400)', async () => {
    const res = await request(app).post('/api/auth/register').send({ email: 'not-an-email', username: 'ab', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('NoSQL injection payloads are sanitized before validation', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: { $gt: '' }, password: 'x' });
    expect(res.status).toBe(400);
  });

  it('Google sign-in without credentials returns 501 NEEDS_CREDENTIALS', async () => {
    const res = await request(app).post('/api/auth/google').send({ idToken: 'fake' });
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NEEDS_CREDENTIALS');
  });

  it('premium checkout without payment provider returns 501', async () => {
    const res = await request(app)
      .post('/api/premium/checkout')
      .set('Authorization', `Bearer ${userToken}`)
      .send({ planId: 'premium_monthly' });
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NEEDS_CREDENTIALS');
  });

  it('full-track stream without licensed provider returns 501', async () => {
    const res = await request(app)
      .get('/api/music/tracks/1/stream')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NEEDS_CREDENTIALS');
  });

  it('licensed anime stream without provider returns 501', async () => {
    const res = await request(app)
      .get('/api/anime/1/episodes/ep1/stream')
      .set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NEEDS_CREDENTIALS');
  });

  it('premium plans endpoint is public to authenticated users', async () => {
    const res = await request(app).get('/api/premium/plans').set('Authorization', `Bearer ${userToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
  });
});

describe('security regression checks', () => {
  it('admin provider alias requires admin role', async () => {
    const response = await request(app).get('/api/admin/providers').set('Authorization', `Bearer ${userToken}`);
    expect(response.status).toBe(403);
  });
  it.each(['-1', 'NaN', '0', '1000000000'])('rejects invalid pagination %s', async (page) => {
    const response = await request(app).get(`/api/admin/users?page=${page}`).set('Authorization', `Bearer ${adminToken}`);
    expect(response.status).toBe(400);
  });
  it('never accepts an unsigned payment confirmation', async () => {
    const response = await request(app).post('/api/premium/webhook').set('Authorization', `Bearer ${userToken}`).send({providerPaymentId: 'untrusted', paid: true});
    expect(response.status).toBe(501);
    expect(response.body.success).toBe(false);
  });
  it('watchlist alias requires authentication', async () => {
    expect((await request(app).get('/api/watchlist')).status).toBe(401);
  });
});
