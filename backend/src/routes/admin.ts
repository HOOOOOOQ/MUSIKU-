import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth, requireAdmin, AuthedRequest } from '../middleware/auth';
import {
  User, MusicTrack, MusicArtist, MusicAlbum, Anime, AnimeEpisode,
  AuditLog, SystemEvent, AppSetting, FeatureFlag, Subscription, Payment,
  Report, ModerationLog, ApiProvider,
} from '../models';
import { databaseHealth } from '../config/database';
import { auditService } from '../services/auditService';
import { ok, notFound } from '../utils/apiResponse';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireAdmin);

/* ── Dashboard overview ──────────────────────────────────────────────── */
adminRouter.get('/dashboard', asyncHandler(async (_req, res) => {
  const [totalUsers, activeUsers, premiumUsers, tracks, artists, albums, anime, episodes, providers, subs, payments] = await Promise.all([
    User.countDocuments({ status: { $ne: 'deleted' } }),
    User.countDocuments({ status: 'active' }),
    User.countDocuments({ premium: true }),
    MusicTrack.countDocuments(),
    MusicArtist.countDocuments(),
    MusicAlbum.countDocuments(),
    Anime.countDocuments(),
    AnimeEpisode.countDocuments(),
    ApiProvider.countDocuments({ enabled: true }),
    Subscription.countDocuments({ status: 'active' }),
    Payment.countDocuments({ status: 'paid' }),
  ]);
  const health = await databaseHealth();
  const providerStatus = await ApiProvider.find({ enabled: true }).select('providerId name type healthStatus avgLatencyMs lastCheckedAt').lean();
  ok(res, {
    users: { total: totalUsers, active: activeUsers, premium: premiumUsers },
    catalog: { tracks, artists, albums, anime, episodes },
    providers: { enabled: providers, status: providerStatus },
    subscriptions: { active: subs, paidPayments: payments },
    database: health,
  });
}));

/* ── User management ─────────────────────────────────────────────────── */
adminRouter.get('/users', asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const q = (req.query.q as string | undefined)?.trim();
  const filter: Record<string, unknown> = {};
  if (q) filter.$or = [{ email: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }, { username: { $regex: q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }];
  const total = await User.countDocuments(filter);
  const users = await User.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
  ok(res, { items: users.map(stripSecrets), total, page, limit });
}));

adminRouter.patch('/users/:id', validate(z.object({
  role: z.enum(['user', 'admin']).optional(),
  status: z.enum(['active', 'suspended']).optional(),
  premium: z.boolean().optional(),
})), asyncHandler(async (req: AuthedRequest, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { $set: req.body }, { new: true });
  if (!user) throw notFound('User not found');
  await auditService.log(req.userId, 'admin.user.update', 'User', String(user._id), req.body, req.ip);
  ok(res, stripSecrets(user.toObject()));
}));

adminRouter.post('/users/:id/suspend', asyncHandler(async (req: AuthedRequest, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { $set: { status: 'suspended' } }, { new: true });
  if (!user) throw notFound('User not found');
  await auditService.log(req.userId, 'admin.user.suspend', 'User', String(user._id), undefined, req.ip);
  ok(res, stripSecrets(user.toObject()));
}));

adminRouter.post('/users/:id/restore', asyncHandler(async (req: AuthedRequest, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { $set: { status: 'active' } }, { new: true });
  if (!user) throw notFound('User not found');
  await auditService.log(req.userId, 'admin.user.restore', 'User', String(user._id), undefined, req.ip);
  ok(res, stripSecrets(user.toObject()));
}));

/* ── Catalog management ──────────────────────────────────────────────── */
adminRouter.get('/catalog/music', asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const total = await MusicTrack.countDocuments();
  const items = await MusicTrack.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
  ok(res, { items, total, page, limit });
}));

adminRouter.get('/catalog/anime', asyncHandler(async (req, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Math.min(Number(req.query.limit ?? 20), 100);
  const total = await Anime.countDocuments();
  const items = await Anime.find().sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
  ok(res, { items, total, page, limit });
}));

adminRouter.get('/catalog/anime/:id/episodes', asyncHandler(async (req, res) => {
  const items = await AnimeEpisode.find({ anime: req.params.id }).sort({ number: 1 }).lean();
  ok(res, items);
}));

/* ── Providers (delegates to /api/providers admin routes) ────────────── */
adminRouter.get('/providers', asyncHandler(async (_req, res) => {
  ok(res, await ApiProvider.find().sort({ type: 1, priority: 1 }).lean());
}));

/* ── Logs ────────────────────────────────────────────────────────────── */
adminRouter.get('/logs', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const [audit, system] = await Promise.all([
    AuditLog.find().sort({ createdAt: -1 }).limit(limit).lean(),
    SystemEvent.find().sort({ createdAt: -1 }).limit(limit).lean(),
  ]);
  ok(res, { audit, system });
}));

adminRouter.get('/audit-logs', asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  ok(res, await AuditLog.find().sort({ createdAt: -1 }).limit(limit).lean());
}));

/* ── Reports & moderation ────────────────────────────────────────────── */
adminRouter.get('/reports', asyncHandler(async (_req, res) => {
  ok(res, await Report.find().sort({ createdAt: -1 }).limit(100).lean());
}));

adminRouter.patch('/reports/:id', validate(z.object({ status: z.enum(['open', 'reviewing', 'resolved', 'dismissed']) })), asyncHandler(async (req: AuthedRequest, res) => {
  const report = await Report.findByIdAndUpdate(req.params.id, { $set: { status: req.body.status, handledBy: req.userId } }, { new: true });
  if (!report) throw notFound('Report not found');
  await ModerationLog.create({ moderator: req.userId, action: `report.${req.body.status}`, targetType: 'Report', targetId: String(report._id) });
  ok(res, report);
}));

/* ── Application settings & feature flags ────────────────────────────── */
adminRouter.get('/settings', asyncHandler(async (_req, res) => {
  ok(res, await AppSetting.find().lean());
}));

adminRouter.put('/settings', validate(z.object({
  settings: z.array(z.object({ key: z.string().min(1), value: z.unknown(), description: z.string().optional() })).min(1),
})), asyncHandler(async (req: AuthedRequest, res) => {
  const results = [];
  for (const s of req.body.settings) {
    results.push(await AppSetting.findOneAndUpdate(
      { key: s.key },
      { $set: { key: s.key, value: s.value, description: s.description ?? '', updatedBy: req.userId } },
      { upsert: true, new: true },
    ));
  }
  await auditService.log(req.userId, 'admin.settings.update', 'AppSetting', '', { keys: req.body.settings.map((s: { key: string }) => s.key) }, req.ip);
  ok(res, results);
}));

adminRouter.get('/feature-flags', asyncHandler(async (_req, res) => {
  ok(res, await FeatureFlag.find().lean());
}));

adminRouter.put('/feature-flags', validate(z.object({
  flags: z.array(z.object({ key: z.string().min(1), enabled: z.boolean(), description: z.string().optional() })).min(1),
})), asyncHandler(async (req: AuthedRequest, res) => {
  const results = [];
  for (const f of req.body.flags) {
    results.push(await FeatureFlag.findOneAndUpdate(
      { key: f.key },
      { $set: { key: f.key, enabled: f.enabled, description: f.description ?? '' } },
      { upsert: true, new: true },
    ));
  }
  await auditService.log(req.userId, 'admin.flags.update', 'FeatureFlag', '', { keys: req.body.flags.map((f: { key: string }) => f.key) }, req.ip);
  ok(res, results);
}));

function stripSecrets(user: unknown): Record<string, unknown> {
  const { passwordHash, ...rest } = user as Record<string, unknown>;
  void passwordHash;
  return rest;
}
