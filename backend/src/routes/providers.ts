import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth, requireAdmin, AuthedRequest } from '../middleware/auth';
import { ApiProvider, ProviderCredential, ProviderLog, ProviderHealth } from '../models';
import { providerManager } from '../services/providerManager';
import { encryptSecret } from '../utils/crypto';
import { auditService } from '../services/auditService';
import { ok, created, notFound } from '../utils/apiResponse';
import { PROVIDER_TYPES } from '../models/Provider';

export const providersRouter = Router();

/** Public provider status (no secrets, no config details). */
providersRouter.get('/status', requireAuth, asyncHandler(async (_req, res) => {
  const providers = await ApiProvider.find({ enabled: true })
    .sort({ type: 1, priority: 1 })
    .select('providerId name type healthStatus lastCheckedAt avgLatencyMs requiresCredentials')
    .lean();
  ok(res, providers);
}));

providersRouter.get('/', requireAuth, asyncHandler(async (_req, res) => {
  const providers = await ApiProvider.find().sort({ type: 1, priority: 1 }).lean();
  ok(res, providers.map(stripSecrets));
}));

/* ── Admin-only provider management ──────────────────────────────────── */
const providerSchema = z.object({
  providerId: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  type: z.enum(PROVIDER_TYPES as unknown as [string, ...string[]]),
  baseUrl: z.string().url(),
  authMethod: z.enum(['none', 'api_key', 'bearer', 'oauth2']).default('none'),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(1).default(100),
  timeoutMs: z.number().int().min(1000).max(60000).default(8000),
  maxRetries: z.number().int().min(0).max(5).default(2),
  cacheTtlSec: z.number().int().min(0).max(86400).default(3600),
  rateLimitPerMin: z.number().int().min(1).max(10000).default(60),
  requiresCredentials: z.boolean().default(false),
  notes: z.string().max(1000).default(''),
  apiKey: z.string().max(500).optional(),
});

providersRouter.post('/', requireAuth, requireAdmin, validate(providerSchema), asyncHandler(async (req: AuthedRequest, res) => {
  const { apiKey, ...data } = req.body as { apiKey?: string } & Record<string, unknown>;
  const provider = await ApiProvider.create(data);
  if (apiKey) {
    await ProviderCredential.create({ provider: provider._id, apiKeyEncrypted: encryptSecret(apiKey), updatedBy: req.userId });
  }
  await auditService.log(req.userId, 'provider.create', 'ApiProvider', String(provider._id), { providerId: provider.providerId }, req.ip);
  created(res, stripSecrets(provider.toObject()));
}));

providersRouter.patch('/:id', requireAuth, requireAdmin, validate(providerSchema.partial()), asyncHandler(async (req: AuthedRequest, res) => {
  const { apiKey, ...data } = req.body as { apiKey?: string } & Record<string, unknown>;
  const provider = await ApiProvider.findByIdAndUpdate(req.params.id, { $set: data }, { new: true });
  if (!provider) throw notFound('Provider not found');
  if (apiKey) {
    await ProviderCredential.findOneAndUpdate(
      { provider: provider._id },
      { $set: { apiKeyEncrypted: encryptSecret(apiKey), updatedBy: req.userId } },
      { upsert: true, new: true },
    );
  }
  await auditService.log(req.userId, 'provider.update', 'ApiProvider', String(provider._id), { providerId: provider.providerId }, req.ip);
  ok(res, stripSecrets(provider.toObject()));
}));

providersRouter.delete('/:id', requireAuth, requireAdmin, asyncHandler(async (req: AuthedRequest, res) => {
  const provider = await ApiProvider.findByIdAndDelete(req.params.id);
  if (!provider) throw notFound('Provider not found');
  await ProviderCredential.deleteOne({ provider: provider._id });
  await auditService.log(req.userId, 'provider.delete', 'ApiProvider', String(provider._id), { providerId: provider.providerId }, req.ip);
  ok(res, { deleted: true });
}));

providersRouter.post('/health-check', requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  ok(res, await providerManager.healthCheckAll());
}));

providersRouter.get('/logs', requireAuth, requireAdmin, asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const logs = await ProviderLog.find().sort({ createdAt: -1 }).limit(limit).lean();
  ok(res, logs);
}));

providersRouter.get('/health', requireAuth, requireAdmin, asyncHandler(async (_req, res) => {
  ok(res, await ProviderHealth.find().lean());
}));

function stripSecrets(provider: Record<string, unknown>): Record<string, unknown> {
  return { ...provider, hasSecret: undefined };
}
