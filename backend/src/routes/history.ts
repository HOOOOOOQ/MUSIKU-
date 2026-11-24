import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { libraryService } from '../services/libraryService';
import { ok, created } from '../utils/apiResponse';

export const historyRouter = Router();
historyRouter.use(requireAuth);

const musicPlaySchema = z.object({
  trackId: z.string().min(1),
  positionSec: z.number().min(0).default(0),
  completed: z.boolean().default(false),
});

const animeWatchSchema = z.object({
  animeId: z.string().min(1),
  episodeId: z.string().optional(),
  episodeNumber: z.number().int().min(0).default(0),
  positionSec: z.number().min(0).default(0),
  durationSec: z.number().min(0).default(0),
  completed: z.boolean().default(false),
});

historyRouter.get('/music', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await libraryService.listMusicHistory(req.userId!, Number(req.query.limit ?? 50)));
}));

historyRouter.post('/music', validate(musicPlaySchema), asyncHandler(async (req: AuthedRequest, res) => {
  created(res, await libraryService.recordMusicPlay(req.userId!, req.body.trackId, req.body.positionSec, req.body.completed));
}));

historyRouter.delete('/music', asyncHandler(async (req: AuthedRequest, res) => {
  await libraryService.clearMusicHistory(req.userId!);
  ok(res, { cleared: true });
}));

historyRouter.get('/anime', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await libraryService.listAnimeHistory(req.userId!, Number(req.query.limit ?? 50), req.query.animeId as string | undefined));
}));

historyRouter.post('/anime', validate(animeWatchSchema), asyncHandler(async (req: AuthedRequest, res) => {
  created(res, await libraryService.recordAnimeWatch(req.userId!, req.body));
}));

historyRouter.get('/anime/continue-watching', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await libraryService.continueWatching(req.userId!, Number(req.query.limit ?? 20)));
}));

historyRouter.delete('/anime/:id', asyncHandler(async (req: AuthedRequest, res) => {
  await libraryService.removeAnimeHistory(req.userId!, req.params.id);
  ok(res, { removed: true });
}));

historyRouter.delete('/anime', asyncHandler(async (req: AuthedRequest, res) => {
  await libraryService.clearAnimeHistory(req.userId!);
  ok(res, { cleared: true });
}));
