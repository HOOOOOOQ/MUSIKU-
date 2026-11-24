import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { playlistService } from '../services/playlistService';
import { ok, created } from '../utils/apiResponse';

export const playlistsRouter = Router();
playlistsRouter.use(requireAuth);

const createSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  coverUrl: z.string().url().optional().or(z.literal('')),
  visibility: z.enum(['private', 'public']).optional(),
  collaborative: z.boolean().optional(),
});

const updateSchema = createSchema.partial();

const addTracksSchema = z.object({
  trackIds: z.array(z.string().min(1)).min(1).max(200),
});

const reorderSchema = z.object({
  orderedTrackIds: z.array(z.string().min(1)).min(1).max(500),
});

playlistsRouter.get('/', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await playlistService.list(req.userId!));
}));

playlistsRouter.post('/', validate(createSchema), asyncHandler(async (req: AuthedRequest, res) => {
  created(res, await playlistService.create(req.userId!, req.body));
}));

playlistsRouter.get('/shared/:token', asyncHandler(async (req, res) => {
  ok(res, await playlistService.getByShareToken(req.params.token));
}));

playlistsRouter.get('/:id', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await playlistService.getById(req.params.id, req.userId));
}));

playlistsRouter.patch('/:id', validate(updateSchema), asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await playlistService.update(req.params.id, req.userId!, req.body));
}));

playlistsRouter.delete('/:id', asyncHandler(async (req: AuthedRequest, res) => {
  await playlistService.remove(req.params.id, req.userId!);
  ok(res, { deleted: true });
}));

playlistsRouter.post('/:id/tracks', validate(addTracksSchema), asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await playlistService.addTracks(req.params.id, req.userId!, req.body.trackIds));
}));

playlistsRouter.delete('/:id/tracks/:trackId', asyncHandler(async (req: AuthedRequest, res) => {
  await playlistService.removeTrack(req.params.id, req.userId!, req.params.trackId);
  ok(res, { removed: true });
}));

playlistsRouter.post('/:id/reorder', validate(reorderSchema), asyncHandler(async (req: AuthedRequest, res) => {
  await playlistService.reorder(req.params.id, req.userId!, req.body.orderedTrackIds);
  ok(res, { reordered: true });
}));

playlistsRouter.post('/:id/duplicate', asyncHandler(async (req: AuthedRequest, res) => {
  created(res, await playlistService.duplicate(req.params.id, req.userId!));
}));

playlistsRouter.post('/:id/follow', asyncHandler(async (req: AuthedRequest, res) => {
  await playlistService.follow(req.params.id, req.userId!);
  ok(res, { following: true });
}));

playlistsRouter.delete('/:id/follow', asyncHandler(async (req: AuthedRequest, res) => {
  await playlistService.unfollow(req.params.id, req.userId!);
  ok(res, { following: false });
}));
