import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { libraryService } from '../services/libraryService';
import { ok, created } from '../utils/apiResponse';

export const libraryRouter = Router();
libraryRouter.use(requireAuth);

/* ── Liked songs / followed artists / saved albums ───────────────────── */
libraryRouter.get('/liked-songs', asyncHandler(async (req: AuthedRequest, res) => {
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 50);
  ok(res, await libraryService.listLiked(req.userId!, page, limit));
}));

libraryRouter.post('/liked-songs/:trackId', asyncHandler(async (req: AuthedRequest, res) => {
  created(res, await libraryService.likeTrack(req.userId!, req.params.trackId));
}));

libraryRouter.delete('/liked-songs/:trackId', asyncHandler(async (req: AuthedRequest, res) => {
  await libraryService.unlikeTrack(req.userId!, req.params.trackId);
  ok(res, { liked: false });
}));

libraryRouter.get('/followed-artists', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await libraryService.listFollowedArtists(req.userId!));
}));

libraryRouter.post('/followed-artists/:artistId', asyncHandler(async (req: AuthedRequest, res) => {
  created(res, await libraryService.followArtist(req.userId!, req.params.artistId));
}));

libraryRouter.delete('/followed-artists/:artistId', asyncHandler(async (req: AuthedRequest, res) => {
  await libraryService.unfollowArtist(req.userId!, req.params.artistId);
  ok(res, { following: false });
}));

libraryRouter.get('/saved-albums', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await libraryService.listSavedAlbums(req.userId!));
}));

libraryRouter.post('/saved-albums/:albumId', asyncHandler(async (req: AuthedRequest, res) => {
  created(res, await libraryService.saveAlbum(req.userId!, req.params.albumId));
}));

libraryRouter.delete('/saved-albums/:albumId', asyncHandler(async (req: AuthedRequest, res) => {
  await libraryService.unsaveAlbum(req.userId!, req.params.albumId);
  ok(res, { saved: false });
}));

/* ── Watchlist ───────────────────────────────────────────────────────── */
const watchlistAddSchema = z.object({
  animeId: z.string().min(1),
  status: z.enum(['plan_to_watch', 'watching', 'completed', 'on_hold', 'dropped']).default('plan_to_watch'),
  rating: z.number().min(0).max(10).default(0),
  notes: z.string().max(1000).default(''),
});

const watchlistPatchSchema = z.object({
  status: z.enum(['plan_to_watch', 'watching', 'completed', 'on_hold', 'dropped']).optional(),
  rating: z.number().min(0).max(10).optional(),
  notes: z.string().max(1000).optional(),
});

libraryRouter.get('/watchlist', asyncHandler(async (req: AuthedRequest, res) => {
  const status = req.query.status as string | undefined;
  const page = Number(req.query.page ?? 1);
  const limit = Number(req.query.limit ?? 50);
  ok(res, await libraryService.listWatchlist(req.userId!, status, page, limit));
}));

libraryRouter.post('/watchlist', validate(watchlistAddSchema), asyncHandler(async (req: AuthedRequest, res) => {
  created(res, await libraryService.addToWatchlist(req.userId!, req.body.animeId, req.body.status, req.body.rating, req.body.notes));
}));

libraryRouter.patch('/watchlist/:id', validate(watchlistPatchSchema), asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await libraryService.updateWatchlist(req.userId!, req.params.id, req.body));
}));

libraryRouter.delete('/watchlist/:id', asyncHandler(async (req: AuthedRequest, res) => {
  await libraryService.removeFromWatchlist(req.userId!, req.params.id);
  ok(res, { removed: true });
}));

/* ── Anime favorites + ratings ───────────────────────────────────────── */
libraryRouter.get('/anime-favorites', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await libraryService.listAnimeFavorites(req.userId!));
}));

libraryRouter.post('/anime-favorites/:animeId', asyncHandler(async (req: AuthedRequest, res) => {
  created(res, await libraryService.favoriteAnime(req.userId!, req.params.animeId));
}));

libraryRouter.delete('/anime-favorites/:animeId', asyncHandler(async (req: AuthedRequest, res) => {
  await libraryService.unfavoriteAnime(req.userId!, req.params.animeId);
  ok(res, { favorite: false });
}));

libraryRouter.post('/anime-ratings', validate(z.object({ animeId: z.string().min(1), rating: z.number().min(1).max(10) })), asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await libraryService.rateAnime(req.userId!, req.body.animeId, req.body.rating));
}));

/* ── Queue persistence ───────────────────────────────────────────────── */
const queueSchema = z.object({
  trackIds: z.array(z.string()).max(500),
  currentIndex: z.number().int().min(0).optional(),
  positionSec: z.number().min(0).optional(),
  shuffle: z.boolean().optional(),
  repeat: z.enum(['off', 'all', 'one']).optional(),
});

libraryRouter.get('/queue', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await libraryService.getQueue(req.userId!));
}));

libraryRouter.put('/queue', validate(queueSchema), asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await libraryService.saveQueue(req.userId!, req.body));
}));
