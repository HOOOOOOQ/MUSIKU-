import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { DownloadRecord } from '../models';
import { ok, created, notFound } from '../utils/apiResponse';
import { hasStorage } from '../config/env';

/**
 * Download records for AUTHORIZED content only. Downloads must
 * respect provider licenses/DRM — this API tracks records and
 * storage keys; it never circumvents download restrictions.
 * Object storage (Cloudflare R2 etc.) needs credentials.
 */
export const downloadsRouter = Router();
downloadsRouter.use(requireAuth);

const createSchema = z.object({
  kind: z.enum(['audio', 'video']),
  contentId: z.string().min(1),
  title: z.string().max(200).default(''),
  quality: z.string().max(20).default('auto'),
  licenseRef: z.string().max(200).default(''),
});

downloadsRouter.get('/', asyncHandler(async (req: AuthedRequest, res) => {
  const items = await DownloadRecord.find({ user: req.userId }).sort({ createdAt: -1 }).limit(100).lean();
  ok(res, { items, storageConfigured: hasStorage });
}));

downloadsRouter.post('/', validate(createSchema), asyncHandler(async (req: AuthedRequest, res) => {
  const record = await DownloadRecord.create({ user: req.userId, ...req.body, status: 'queued' });
  created(res, record);
}));

downloadsRouter.patch('/:id', validate(z.object({
  status: z.enum(['queued', 'downloading', 'paused', 'completed', 'failed', 'deleted']).optional(),
  progress: z.number().min(0).max(100).optional(),
  sizeBytes: z.number().min(0).optional(),
  storageKey: z.string().max(500).optional(),
})), asyncHandler(async (req: AuthedRequest, res) => {
  const record = await DownloadRecord.findOneAndUpdate(
    { _id: req.params.id, user: req.userId },
    { $set: req.body },
    { new: true },
  );
  if (!record) throw notFound('Download record not found');
  ok(res, record);
}));

downloadsRouter.delete('/:id', asyncHandler(async (req: AuthedRequest, res) => {
  const record = await DownloadRecord.findOneAndUpdate(
    { _id: req.params.id, user: req.userId },
    { $set: { status: 'deleted' } },
    { new: true },
  );
  if (!record) throw notFound('Download record not found');
  ok(res, record);
}));
