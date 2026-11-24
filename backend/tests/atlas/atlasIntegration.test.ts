import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';

/**
 * MongoDB Atlas integration suite — REAL database, no model fakes.
 *
 * Only the Google token verifier is mocked: Google's JWKS endpoint is not
 * reachable from CI and no owner OAuth credentials are configured, so a real
 * Google round-trip cannot be performed. Everything else (HTTP layer, services,
 * Mongoose, indexes, Atlas persistence and transactions) is exercised for real.
 *
 * The suite is reported as **skipped with a reason** when the pre-flight probe
 * (`npm run atlas:preflight`, executed automatically by
 * `npm run test:atlas:integration`) could not reach a usable Atlas test
 * database. A skipped suite is never presented as a passing integration test.
 *
 * Data safety: every document is written to the isolated test database
 * (`MONGODB_TEST_DB_NAME`, default `<MONGODB_DB_NAME>_ci_test`), tagged with a
 * per-run identifier, and deleted in `afterAll`. Collections are never dropped
 * and no other database is touched.
 */
jest.mock('../../src/services/googleIdentity', () => ({
  googleIdentity: { verify: jest.fn() },
  googleVerifierStatus: () => ({ configured: true, verifier: 'google-auth-library (verifier mocked in the Atlas suite)' }),
  fingerprintClientId: (value: string) => value,
}));

import { createApp } from '../../src/app';
import { connectDatabase, disconnectDatabase, initIndexes, databaseHealth } from '../../src/config/database';
import { env, testDatabaseName } from '../../src/config/env';
import { sha256 } from '../../src/utils/crypto';
import {
  User, UserProfile, UserPreference, NotificationPreference, UserSession, UserDevice, LoginHistory,
  PasswordReset, EmailVerification, OAuthReplay, MusicTrack, MusicPlaylist, PlaylistTrack, LikedSong,
  MusicHistory, Anime, AnimeEpisode, AnimeWatchHistory, AuditLog, SystemEvent,
} from '../../src/models';
import { googleIdentity } from '../../src/services/googleIdentity';

interface Preflight {
  available: boolean;
  reason: string;
  testDatabase: string;
  primaryDatabaseReachable: boolean;
  transactions: boolean;
  latencyMs: number;
  uriScheme: string;
}

const preflightPath = join(__dirname, 'preflight.json');
const preflight: Preflight = existsSync(preflightPath)
  ? (JSON.parse(readFileSync(preflightPath, 'utf8')) as Preflight)
  : {
      available: false,
      reason: 'pre-flight probe result not found — run `npm run test:atlas:integration` (it runs scripts/atlas-preflight.ts first)',
      testDatabase: '',
      primaryDatabaseReachable: false,
      transactions: false,
      latencyMs: 0,
      uriScheme: 'unknown',
    };

const describeAtlas = preflight.available ? describe : describe.skip;
const suiteTitle = preflight.available
  ? 'MongoDB Atlas integration (live database)'
  : `MongoDB Atlas integration — SKIPPED: ${preflight.reason}`;

const verifyGoogle = googleIdentity.verify as jest.Mock;

const runId = randomUUID().split('-')[0];
const email = (name: string): string => `ci-${runId}-${name}@example.invalid`;
const username = (name: string): string => `ci_${runId}_${name}`.slice(0, 30);
const PASSWORD = 'atlas-suite-password-123';

describeAtlas(suiteTitle, () => {
  let app: ReturnType<typeof createApp>;
  let indexReport: { created: number; failures: string[] } = { created: 0, failures: [] };
  const userIds: string[] = [];
  const trackIds: string[] = [];
  const animeIds: string[] = [];
  const episodeIds: string[] = [];
  const playlistIds: string[] = [];
  const replayHashes: string[] = [];

  const register = async (name: string) => {
    const response = await request(app)
      .post('/api/auth/register')
      .send({ email: email(name), username: username(name), password: PASSWORD, displayName: `CI ${name}` });
    expect(response.status).toBe(201);
    const user = response.body.data.user as { _id: string };
    userIds.push(user._id);
    return {
      id: user._id,
      accessToken: response.body.data.tokens.accessToken as string,
      refreshToken: response.body.data.tokens.refreshToken as string,
    };
  };

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    await connectDatabase({ dbName: testDatabaseName, attempts: 1, serverSelectionTimeoutMS: 15_000 });
    indexReport = await initIndexes();
    app = createApp();
  }, 120_000);

  afterAll(async () => {
    // Remove only what this run created. Never drop collections or databases.
    try {
      if (userIds.length > 0) {
        const users = { $in: userIds.map((id) => new mongoose.Types.ObjectId(id)) };
        await Promise.all([
          User.deleteMany({ _id: users }),
          UserProfile.deleteMany({ user: users }),
          UserPreference.deleteMany({ user: users }),
          NotificationPreference.deleteMany({ user: users }),
          UserSession.deleteMany({ user: users }),
          UserDevice.deleteMany({ user: users }),
          LoginHistory.deleteMany({ user: users }),
          PasswordReset.deleteMany({ user: users }),
          EmailVerification.deleteMany({ user: users }),
          LikedSong.deleteMany({ user: users }),
          MusicHistory.deleteMany({ user: users }),
          AnimeWatchHistory.deleteMany({ user: users }),
          MusicPlaylist.deleteMany({ owner: users }),
          PlaylistTrack.deleteMany({ addedBy: users }),
          AuditLog.deleteMany({ actor: { $in: userIds } }),
        ]);
      }
      if (trackIds.length > 0) await MusicTrack.deleteMany({ _id: { $in: trackIds } });
      if (animeIds.length > 0) await Anime.deleteMany({ _id: { $in: animeIds } });
      if (episodeIds.length > 0) await AnimeEpisode.deleteMany({ _id: { $in: episodeIds } });
      if (playlistIds.length > 0) {
        await PlaylistTrack.deleteMany({ playlist: { $in: playlistIds } });
        await MusicPlaylist.deleteMany({ _id: { $in: playlistIds } });
      }
      if (replayHashes.length > 0) await OAuthReplay.deleteMany({ tokenHash: { $in: replayHashes } });
      await SystemEvent.deleteMany({ source: 'auth', message: /Refresh token reuse detected/ });
    } finally {
      await disconnectDatabase();
    }
  }, 120_000);

  it('connects to Atlas, reports health and creates the declared indexes', async () => {
    const health = await databaseHealth();
    expect(health.status).toBe('ok');
    expect(mongoose.connection.name).toBe(testDatabaseName);
    // Surfaces Atlas privilege problems (e.g. a user without createIndex) clearly
    // instead of letting later index assertions fail without context.
    expect(indexReport.failures).toEqual([]);
    expect(indexReport.created).toBeGreaterThan(0);

    const userIndexes = await User.collection.indexes();
    const uniqueEmail = userIndexes.find((index) => index.unique && index.key?.email);
    expect(uniqueEmail).toBeDefined();
    const uniqueUsername = userIndexes.find((index) => index.unique && index.key?.username);
    expect(uniqueUsername).toBeDefined();

    const sessionIndexes = await UserSession.collection.indexes();
    expect(sessionIndexes.find((index) => index.unique && index.key?.refreshTokenHash)).toBeDefined();
    expect(sessionIndexes.find((index) => index.expireAfterSeconds === 0 && index.key?.expiresAt)).toBeDefined();
  });

  it('enforces the unique email index at the database level', async () => {
    await User.create({ email: email('unique'), username: username('unique'), status: 'active', role: 'user' });
    const duplicate = await User.create({ email: email('unique'), username: username('unique2') }).catch((error) => error);
    expect((duplicate as { code?: number }).code).toBe(11000);
    const clash = await User.findOne({ email: email('unique') });
    if (clash) userIds.push(String(clash._id));
  });

  it('registers, logs in and persists the profile with hashed credentials only', async () => {
    const account = await register('primary');

    const login = await request(app).post('/api/auth/login').send({ email: email('primary'), password: PASSWORD, deviceId: `ci-device-${runId}` });
    expect(login.status).toBe(200);
    expect(login.body.data.user.passwordHash).toBeUndefined();

    const me = await request(app).get('/api/auth/me').set(auth(login.body.data.tokens.accessToken));
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(email('primary'));
    expect(me.body.data.profile).toBeTruthy();

    // Passwords and refresh tokens are stored only as hashes.
    const stored = await User.findById(account.id).lean();
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toBe(PASSWORD);
    const session = await UserSession.findOne({ user: account.id }).sort({ createdAt: -1 }).lean();
    expect(session?.refreshTokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(session)).not.toContain(login.body.data.tokens.refreshToken);

    // Device + login history are persisted for the real user.
    expect(await UserDevice.countDocuments({ user: account.id, deviceId: `ci-device-${runId}` })).toBe(1);
    expect(await LoginHistory.countDocuments({ user: account.id, method: 'email', success: true })).toBeGreaterThanOrEqual(1);
    void account.refreshToken;
  });

  it('rotates refresh tokens in Atlas, rejects a replay and revokes the family on reuse', async () => {
    const account = await register('rotation');

    const rotated = await request(app).post('/api/auth/refresh').send({ refreshToken: account.refreshToken });
    expect(rotated.status).toBe(200);
    const nextRefresh = rotated.body.data.refreshToken as string;
    expect(nextRefresh).not.toBe(account.refreshToken);

    // Immediate duplicate (two tabs / retried request): rejected, family intact.
    const duplicate = await request(app).post('/api/auth/refresh').send({ refreshToken: account.refreshToken });
    expect(duplicate.status).toBe(401);
    const stillValid = await request(app).post('/api/auth/refresh').send({ refreshToken: nextRefresh });
    expect(stillValid.status).toBe(200);
    const currentRefresh = stillValid.body.data.refreshToken as string;
    const currentAccess = stillValid.body.data.accessToken as string;

    // Simulate a stolen ancestor token replayed after the grace window.
    const consumed = await UserSession.findOne({ user: account.id, refreshTokenHash: sha256(account.refreshToken) });
    expect(consumed).toBeTruthy();
    const family = consumed!.family;
    expect(family).toBeTruthy();
    await UserSession.updateOne({ _id: consumed!._id }, { $set: { rotatedAt: new Date(Date.now() - 600_000) } });

    const stolen = await request(app).post('/api/auth/refresh').send({ refreshToken: account.refreshToken });
    expect(stolen.status).toBe(401);

    // Every live session in that family is revoked, and their access tokens die.
    const live = await UserSession.countDocuments({ family, revokedAt: { $exists: false } });
    expect(live).toBe(0);
    const revokedForReuse = await UserSession.countDocuments({ family, revokedReason: 'reuse_detected' });
    expect(revokedForReuse).toBeGreaterThanOrEqual(1);
    expect((await request(app).get('/api/auth/me').set(auth(currentAccess))).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: currentRefresh })).status).toBe(401);
    expect(await AuditLog.countDocuments({ actor: account.id, action: 'auth.refresh.reuse_detected' })).toBeGreaterThanOrEqual(1);
  });

  it('revokes the session on logout and rejects the old access token immediately', async () => {
    const account = await register('logout');
    expect((await request(app).post('/api/auth/logout').send({ refreshToken: account.refreshToken })).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(auth(account.accessToken))).status).toBe(401);
    const session = await UserSession.findOne({ user: account.id }).lean();
    expect(session?.revokedAt).toBeTruthy();
    expect(session?.revokedReason).toBe('logout');
  });

  it('rejects an expired access token and a token signed with the wrong secret', async () => {
    const account = await register('expiry');

    const expired = jwt.sign(
      { sub: account.id, role: 'user', type: 'access', sid: 'irrelevant' },
      env.JWT_SECRET,
      { expiresIn: '-10s' },
    );
    expect((await request(app).get('/api/auth/me').set(auth(expired))).status).toBe(401);

    const wrongSecret = jwt.sign({ sub: account.id, role: 'user', type: 'access' }, 'a-completely-different-secret-key');
    expect((await request(app).get('/api/auth/me').set(auth(wrongSecret))).status).toBe(401);

    const refreshAsAccess = jwt.sign({ sub: account.id, type: 'refresh' }, env.JWT_REFRESH_SECRET);
    expect((await request(app).get('/api/auth/me').set(auth(refreshAsAccess))).status).toBe(401);
  });

  it('links a Google identity to a verified existing email without duplicating the account', async () => {
    const account = await register('google');
    // Email verification is a database flag here: SMTP delivery is not configured
    // in CI, and this suite tests linking persistence, not email transport.
    await User.updateOne({ _id: account.id }, { $set: { emailVerified: true } });

    const googleSub = `ci-google-${runId}`;
    verifyGoogle.mockResolvedValue({
      sub: googleSub,
      email: email('google'),
      email_verified: true,
      aud: 'web-client',
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 600,
    });

    const firstToken = `ci-google-token-${runId}-1`;
    replayHashes.push(sha256(firstToken));
    const linked = await request(app).post('/api/auth/google').send({ idToken: firstToken, deviceId: `ci-device-${runId}` });
    expect(linked.status).toBe(200);
    expect(linked.body.data.user.email).toBe(email('google'));
    expect(linked.body.data.tokens.accessToken).toBeTruthy();

    // Exactly one account exists for that email, now carrying the Google subject.
    expect(await User.countDocuments({ email: email('google') })).toBe(1);
    const storedUser = await User.findById(account.id).lean();
    expect(storedUser?.googleId).toBe(googleSub);

    // A second sign-in with a fresh token reuses the same account.
    const secondToken = `ci-google-token-${runId}-2`;
    replayHashes.push(sha256(secondToken));
    const again = await request(app).post('/api/auth/google').send({ idToken: secondToken });
    expect(again.status).toBe(200);
    expect(await User.countDocuments({ email: email('google') })).toBe(1);
    expect(await User.countDocuments({ googleId: googleSub })).toBe(1);
    expect(await LoginHistory.countDocuments({ user: account.id, method: 'google', success: true })).toBe(2);

    // Replaying the very same ID token is rejected by the unique replay index.
    const replay = await request(app).post('/api/auth/google').send({ idToken: firstToken });
    expect(replay.status).toBe(401);
    expect(await OAuthReplay.countDocuments({ tokenHash: sha256(firstToken) })).toBe(1);
  });

  it('refuses to link a Google identity to an unverified email', async () => {
    const account = await register('unverified');
    verifyGoogle.mockResolvedValue({
      sub: `ci-google-unverified-${runId}`,
      email: email('unverified'),
      email_verified: true,
      aud: 'web-client',
      iss: 'https://accounts.google.com',
      exp: Math.floor(Date.now() / 1000) + 600,
    });
    const token = `ci-google-token-${runId}-unverified`;
    replayHashes.push(sha256(token));
    const response = await request(app).post('/api/auth/google').send({ idToken: token });
    expect(response.status).toBe(409);
    const stored = await User.findById(account.id).lean();
    expect(stored?.googleId).toBeUndefined();
  });

  it('stores music library entries and anime watch history for the authenticated user', async () => {
    const account = await register('library');

    const track = await MusicTrack.create({
      providerId: `ci-track-${runId}`,
      source: 'ci',
      title: 'CI integration track',
      artistName: 'CI artist',
      durationSec: 180,
      previewUrl: 'https://example.invalid/preview.mp3',
    });
    trackIds.push(String(track._id));

    expect((await request(app).post(`/api/library/liked-songs/${track._id}`).set(auth(account.accessToken))).status).toBe(201);
    const liked = await request(app).get('/api/library/liked-songs').set(auth(account.accessToken));
    expect(liked.status).toBe(200);
    expect(liked.body.data.total).toBe(1);
    expect(await LikedSong.countDocuments({ user: account.id, track: track._id })).toBe(1);

    expect((await request(app).post('/api/history/music').set(auth(account.accessToken)).send({ trackId: String(track._id), positionSec: 42, completed: false })).status).toBe(201);
    const musicHistory = await request(app).get('/api/history/music').set(auth(account.accessToken));
    expect(musicHistory.status).toBe(200);
    expect(musicHistory.body.data.length).toBeGreaterThanOrEqual(1);

    const anime = await Anime.create({
      providerId: `ci-anime-${runId}`,
      source: 'ci',
      title: 'CI integration anime',
      synopsis: 'Created by the Atlas integration suite',
      episodeCount: 1,
    });
    animeIds.push(String(anime._id));
    const episode = await AnimeEpisode.create({ anime: anime._id, providerEpisodeId: `ci-ep-${runId}`, number: 1, title: 'Episode 1', durationSec: 1200 });
    episodeIds.push(String(episode._id));

    const watched = await request(app)
      .post('/api/history/anime')
      .set(auth(account.accessToken))
      .send({ animeId: String(anime._id), episodeId: String(episode._id), episodeNumber: 1, positionSec: 300, durationSec: 1200, completed: false });
    expect(watched.status).toBe(201);

    const history = await request(app).get(`/api/history/anime?animeId=${anime._id}`).set(auth(account.accessToken));
    expect(history.status).toBe(200);
    expect(history.body.data.length).toBe(1);
    expect(history.body.data[0].positionSec).toBe(300);

    const continueWatching = await request(app).get('/api/history/anime/continue-watching').set(auth(account.accessToken));
    expect(continueWatching.status).toBe(200);
    expect(JSON.stringify(continueWatching.body.data)).toContain(String(anime._id));
  });

  it('creates a playlist, adds tracks and persists the reordered sequence', async () => {
    const account = await register('playlist');
    const first = await MusicTrack.create({ providerId: `ci-pl-a-${runId}`, source: 'ci', title: 'CI playlist track A' });
    const second = await MusicTrack.create({ providerId: `ci-pl-b-${runId}`, source: 'ci', title: 'CI playlist track B' });
    trackIds.push(String(first._id), String(second._id));

    const created = await request(app).post('/api/playlists').set(auth(account.accessToken)).send({ name: `CI playlist ${runId}`, description: 'Atlas integration' });
    expect(created.status).toBe(201);
    const playlistId = created.body.data._id as string;
    playlistIds.push(playlistId);

    const added = await request(app)
      .post(`/api/playlists/${playlistId}/tracks`)
      .set(auth(account.accessToken))
      .send({ trackIds: [String(first._id), String(second._id)] });
    expect(added.status).toBe(200);

    const before = await request(app).get(`/api/playlists/${playlistId}`).set(auth(account.accessToken));
    expect(before.body.data.tracks.map((entry: { track: { _id: string } }) => String(entry.track._id))).toEqual([String(first._id), String(second._id)]);
    expect(before.body.data.trackCount).toBe(2);

    const reordered = await request(app)
      .post(`/api/playlists/${playlistId}/reorder`)
      .set(auth(account.accessToken))
      .send({ orderedTrackIds: [String(second._id), String(first._id)] });
    expect(reordered.status).toBe(200);

    const after = await request(app).get(`/api/playlists/${playlistId}`).set(auth(account.accessToken));
    expect(after.body.data.tracks.map((entry: { track: { _id: string } }) => String(entry.track._id))).toEqual([String(second._id), String(first._id)]);

    const removed = await request(app).delete(`/api/playlists/${playlistId}/tracks/${first._id}`).set(auth(account.accessToken));
    expect(removed.status).toBe(200);
    expect(await PlaylistTrack.countDocuments({ playlist: playlistId })).toBe(1);
  });

  it('updates the user profile and preferences through the API', async () => {
    const account = await register('profile');
    const patched = await request(app)
      .patch('/api/users/profile')
      .set(auth(account.accessToken))
      .send({ displayName: `CI renamed ${runId}`, bio: 'Atlas integration profile', language: 'id' });
    expect(patched.status).toBe(200);

    const profile = await UserProfile.findOne({ user: account.id }).lean();
    expect(profile?.displayName).toBe(`CI renamed ${runId}`);
    expect(profile?.bio).toBe('Atlas integration profile');

    const preferences = await request(app).patch('/api/users/preferences').set(auth(account.accessToken)).send({ theme: 'dark' });
    expect(preferences.status).toBe(200);
    expect(await UserPreference.countDocuments({ user: account.id })).toBe(1);
  });

  it('isolates user data: another account cannot read or modify these records', async () => {
    const owner = await register('owner');
    const intruder = await register('intruder');

    const track = await MusicTrack.create({ providerId: `ci-iso-${runId}`, source: 'ci', title: 'CI isolation track' });
    trackIds.push(String(track._id));
    await request(app).post(`/api/library/liked-songs/${track._id}`).set(auth(owner.accessToken));
    const created = await request(app).post('/api/playlists').set(auth(owner.accessToken)).send({ name: `CI private ${runId}` });
    const playlistId = created.body.data._id as string;
    playlistIds.push(playlistId);
    await request(app).post(`/api/playlists/${playlistId}/tracks`).set(auth(owner.accessToken)).send({ trackIds: [String(track._id)] });

    // The intruder sees none of the owner's data.
    const intruderLiked = await request(app).get('/api/library/liked-songs').set(auth(intruder.accessToken));
    expect(intruderLiked.body.data.total).toBe(0);
    const intruderPlaylists = await request(app).get('/api/playlists').set(auth(intruder.accessToken));
    expect(JSON.stringify(intruderPlaylists.body.data)).not.toContain(`CI private ${runId}`);
    expect(await MusicPlaylist.countDocuments({ owner: intruder.id })).toBe(0);

    // Direct access and mutation are refused.
    expect((await request(app).get(`/api/playlists/${playlistId}`).set(auth(intruder.accessToken))).status).toBe(403);
    expect((await request(app).delete(`/api/playlists/${playlistId}/tracks/${track._id}`).set(auth(intruder.accessToken))).status).toBe(403);
    expect((await request(app).patch(`/api/playlists/${playlistId}`).set(auth(intruder.accessToken)).send({ name: 'hijacked' })).status).toBe(403);
    expect((await request(app).delete(`/api/playlists/${playlistId}`).set(auth(intruder.accessToken))).status).toBe(403);

    // Sessions and devices are scoped to the caller.
    const intruderSessions = await request(app).get('/api/auth/sessions').set(auth(intruder.accessToken));
    expect(intruderSessions.status).toBe(200);
    expect(JSON.stringify(intruderSessions.body.data)).not.toContain(owner.id);
    expect((await request(app).post('/api/auth/revoke-all').set(auth(intruder.accessToken)).send({})).status).toBe(200);
    expect(await UserSession.countDocuments({ user: owner.id, revokedAt: { $exists: false } })).toBeGreaterThanOrEqual(1);

    // Unauthenticated and non-admin access is refused.
    expect((await request(app).get('/api/library/liked-songs')).status).toBe(401);
    expect((await request(app).get('/api/admin/users').set(auth(owner.accessToken))).status).toBe(403);

    // The owner's data is still intact.
    expect(await LikedSong.countDocuments({ user: owner.id })).toBe(1);
    expect(await PlaylistTrack.countDocuments({ playlist: playlistId })).toBe(1);
  });

  const itWithTransactions = preflight.transactions ? it : it.skip;
  itWithTransactions('commits a multi-document transaction (replica set only)', async () => {
    const account = await register('transaction');
    const session = await mongoose.startSession();
    try {
      await session.withTransaction(async () => {
        await User.updateOne({ _id: account.id }, { $set: { premium: true } }, { session });
        await UserPreference.updateOne({ user: account.id }, { $set: { theme: 'dark' } }, { session });
      });
    } finally {
      await session.endSession();
    }
    const stored = await User.findById(account.id).lean();
    expect(stored?.premium).toBe(true);
  });
});
