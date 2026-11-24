import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { notificationService } from '../services/notificationService';
import { ok } from '../utils/apiResponse';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/', asyncHandler(async (req: AuthedRequest, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 30);
  const unreadOnly = req.query.unread === 'true';
  ok(res, await notificationService.list(req.userId!, page, limit, unreadOnly));
}));

notificationsRouter.post('/read-all', asyncHandler(async (req: AuthedRequest, res) => {
  await notificationService.markAllRead(req.userId!);
  ok(res, { read: true });
}));

notificationsRouter.post('/:id/read', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await notificationService.markRead(req.userId!, req.params.id));
}));

notificationsRouter.delete('/:id', asyncHandler(async (req: AuthedRequest, res) => {
  await notificationService.remove(req.userId!, req.params.id);
  ok(res, { deleted: true });
}));

notificationsRouter.get('/preferences', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await notificationService.getPreferences(req.userId!));
}));

const prefsSchema = z.object({
  pushEnabled: z.boolean().optional(),
  newMusic: z.boolean().optional(),
  newEpisodes: z.boolean().optional(),
  artistUpdates: z.boolean().optional(),
  animeUpdates: z.boolean().optional(),
  playlistUpdates: z.boolean().optional(),
  account: z.boolean().optional(),
  premium: z.boolean().optional(),
  security: z.boolean().optional(),
});

notificationsRouter.patch('/preferences', validate(prefsSchema), asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await notificationService.updatePreferences(req.userId!, req.body));
}));
