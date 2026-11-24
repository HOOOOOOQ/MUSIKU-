import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { catalogService } from '../services/catalogService';
import { animeService } from '../services/animeService';
import { SearchHistory } from '../models';
import { ok } from '../utils/apiResponse';

export const searchRouter = Router();
searchRouter.use(requireAuth);

const universalSchema = z.object({
  q: z.string().min(1).max(200),
  category: z.enum(['all', 'songs', 'artists', 'albums', 'playlists', 'anime', 'episodes', 'genres']).default('all'),
  limit: z.coerce.number().int().min(1).max(30).default(10),
});

/**
 * Universal search: fans out to music + anime providers in parallel,
 * records the query in search history, and tags each result with its
 * provider source.
 */
searchRouter.get('/', validate(universalSchema, 'query'), asyncHandler(async (req: AuthedRequest, res) => {
  const { q, category, limit } = req.query as unknown as { q: string; category: string; limit: number };

  const tasks: Promise<unknown>[] = [];
  const results: Record<string, unknown> = { query: q, category };

  if (category === 'all' || category === 'songs') {
    tasks.push(catalogService.searchMusic(q, limit).then((r) => { results.songs = r; }).catch(() => { results.songs = []; }));
  }
  if (category === 'all' || category === 'artists') {
    tasks.push(catalogService.searchArtists(q, Math.min(limit, 8)).then((r) => { results.artists = r; }).catch(() => { results.artists = []; }));
  }
  if (category === 'all' || category === 'albums') {
    tasks.push(catalogService.searchAlbums(q, Math.min(limit, 8)).then((r) => { results.albums = r; }).catch(() => { results.albums = []; }));
  }
  if (category === 'all' || category === 'anime') {
    /* Animeku first (it records the query and returns provider links), with the
     * AniList/Jikan path as a fallback so search never blanks out. */
    tasks.push(
      animeService
        .search(q, { limit, userId: req.userId })
        .then((r) => { results.anime = r.items; })
        .catch(() => catalogService.searchAnime(q, 1, limit).then((r) => { results.anime = r.items; }))
        .catch(() => { results.anime = []; }),
    );
  }

  await Promise.all(tasks);

  // Record search history (upsert to keep one entry per query).
  await SearchHistory.findOneAndUpdate(
    { user: req.userId, query: q },
    { $set: { category, searchedAt: new Date() } },
    { upsert: true, new: true },
  );

  ok(res, results);
}));

searchRouter.get('/history', asyncHandler(async (req: AuthedRequest, res) => {
  const items = await SearchHistory.find({ user: req.userId }).sort({ searchedAt: -1 }).limit(30).lean();
  ok(res, items);
}));

searchRouter.delete('/history', asyncHandler(async (req: AuthedRequest, res) => {
  await SearchHistory.deleteMany({ user: req.userId });
  ok(res, { cleared: true });
}));

searchRouter.delete('/history/:id', asyncHandler(async (req: AuthedRequest, res) => {
  await SearchHistory.deleteOne({ _id: req.params.id, user: req.userId });
  ok(res, { removed: true });
}));
