import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth } from '../middleware/auth';
import { catalogService } from '../services/catalogService';
import { recommendationService } from '../services/recommendationService';
import { ok, needsCredentials } from '../utils/apiResponse';
import { hasLicensedMusic } from '../config/env';

export const musicRouter = Router();
musicRouter.use(requireAuth);

const searchSchema = z.object({
  q: z.string().min(1).max(200),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const listSchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

musicRouter.get('/', asyncHandler(async (req, res) => {
  const { limit } = listSchema.parse(req.query);
  const [trending, fresh] = await Promise.all([
    catalogService.trendingMusic(limit),
    catalogService.newReleases(limit),
  ]);
  ok(res, { trending, newReleases: fresh });
}));

musicRouter.get('/search', validate(searchSchema, 'query'), asyncHandler(async (req, res) => {
  const { q, limit } = req.query as unknown as { q: string; limit: number };
  const [tracks, artists, albums] = await Promise.all([
    catalogService.searchMusic(q, limit),
    catalogService.searchArtists(q, Math.min(limit, 10)),
    catalogService.searchAlbums(q, Math.min(limit, 10)),
  ]);
  ok(res, { tracks, artists, albums });
}));

musicRouter.get('/trending', validate(listSchema, 'query'), asyncHandler(async (req, res) => {
  const { limit } = req.query as unknown as { limit: number };
  ok(res, await catalogService.trendingMusic(limit));
}));

musicRouter.get('/new-releases', validate(listSchema, 'query'), asyncHandler(async (req, res) => {
  const { limit } = req.query as unknown as { limit: number };
  ok(res, await catalogService.newReleases(limit));
}));

musicRouter.get('/recommendations', asyncHandler(async (req, res) => {
  const userId = (req as { userId?: string }).userId!;
  const refresh = req.query.refresh === 'true';
  ok(res, await recommendationService.musicForUser(userId, refresh));
}));

musicRouter.get('/tracks/:id', asyncHandler(async (req, res) => {
  ok(res, await catalogService.getTrack(req.params.id));
}));

musicRouter.get('/artists/:id', asyncHandler(async (req, res) => {
  ok(res, await catalogService.getArtist(req.params.id));
}));

musicRouter.get('/albums/:id', asyncHandler(async (req, res) => {
  ok(res, await catalogService.getAlbum(req.params.id));
}));

musicRouter.get('/lyrics', validate(z.object({ artist: z.string().min(1), title: z.string().min(1) }), 'query'), asyncHandler(async (req, res) => {
  const { artist, title } = req.query as unknown as { artist: string; title: string };
  const lyrics = await catalogService.getLyrics(artist, title);
  ok(res, lyrics ?? { plain: '', synced: undefined, unavailable: true });
}));

/**
 * Full-track stream resolution. Preview streams (30s, officially
 * exposed by Deezer/iTunes) are served via track.previewUrl.
 * Full tracks require a licensed provider → needs_credentials.
 */
musicRouter.get('/tracks/:id/stream', asyncHandler(async (req, res) => {
  const track = await catalogService.getTrack(req.params.id);
  if (!hasLicensedMusic) {
    needsCredentials(res, 'Licensed full-track music streaming', ['LICENSED_MUSIC_API_KEY', 'LICENSED_MUSIC_BASE_URL']);
    return;
  }
  ok(res, { streamUrl: (track as { streamUrl?: string } | null)?.streamUrl ?? '', licensed: true });
}));
