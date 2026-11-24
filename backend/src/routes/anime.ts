import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { catalogService } from '../services/catalogService';
import { recommendationService } from '../services/recommendationService';
import { libraryService } from '../services/libraryService';
import { ok, needsCredentials } from '../utils/apiResponse';
import { hasLicensedAnime } from '../config/env';

export const animeRouter = Router();
animeRouter.use(requireAuth);

const searchSchema = z.object({
  q: z.string().min(1).max(200),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

const seasonalSchema = z.object({
  year: z.coerce.number().int().min(1960).max(2100),
  season: z.enum(['winter', 'spring', 'summer', 'fall']),
});

animeRouter.get('/', asyncHandler(async (req, res) => {
  const { page, limit } = listSchema.parse(req.query);
  const [trending, popular, topRated] = await Promise.all([
    catalogService.animeList('trending', page, limit),
    catalogService.animeList('popular', page, limit),
    catalogService.animeList('topRated', page, limit),
  ]);
  ok(res, { trending, popular, topRated });
}));

animeRouter.get('/search', validate(searchSchema, 'query'), asyncHandler(async (req, res) => {
  const { q, page, limit } = req.query as unknown as { q: string; page: number; limit: number };
  ok(res, await catalogService.searchAnime(q, page, limit));
}));

animeRouter.get('/trending', validate(listSchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit } = req.query as unknown as { page: number; limit: number };
  ok(res, await catalogService.animeList('trending', page, limit));
}));

animeRouter.get('/popular', validate(listSchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit } = req.query as unknown as { page: number; limit: number };
  ok(res, await catalogService.animeList('popular', page, limit));
}));

animeRouter.get('/top-rated', validate(listSchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit } = req.query as unknown as { page: number; limit: number };
  ok(res, await catalogService.animeList('topRated', page, limit));
}));

animeRouter.get('/upcoming', validate(listSchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit } = req.query as unknown as { page: number; limit: number };
  ok(res, await catalogService.animeList('upcoming', page, limit));
}));

animeRouter.get('/seasons', validate(seasonalSchema, 'query'), asyncHandler(async (req, res) => {
  const { year, season } = req.query as unknown as { year: number; season: string };
  ok(res, await catalogService.seasonalAnime(year, season));
}));

animeRouter.get('/recommendations', asyncHandler(async (req: AuthedRequest, res) => {
  const refresh = req.query.refresh === 'true';
  ok(res, await recommendationService.animeForUser(req.userId!, refresh));
}));

animeRouter.get('/random', asyncHandler(async (_req, res) => {
  ok(res, await catalogService.randomAnime());
}));

animeRouter.get('/:id', asyncHandler(async (req, res) => {
  ok(res, await catalogService.getAnime(req.params.id));
}));

animeRouter.get('/:id/episodes', asyncHandler(async (req, res) => {
  ok(res, await catalogService.getEpisodes(req.params.id));
}));

animeRouter.get('/:id/related', asyncHandler(async (req, res) => {
  ok(res, await catalogService.relatedAnime(req.params.id));
}));

/**
 * Licensed episode stream resolution. Metadata providers (AniList /
 * Jikan) do not host video. Full episodes require a licensed
 * provider → needs_credentials until configured.
 */
animeRouter.get('/:id/episodes/:episodeId/stream', asyncHandler(async (req, res) => {
  if (!hasLicensedAnime) {
    needsCredentials(res, 'Licensed anime streaming', ['LICENSED_ANIME_API_KEY', 'LICENSED_ANIME_BASE_URL']);
    return;
  }
  const episode = await libraryService.getEpisode(req.params.episodeId);
  ok(res, {
    streamUrl: (episode as { streamUrl?: string } | null)?.streamUrl ?? '',
    subtitles: (episode as { subtitles?: unknown } | null)?.subtitles ?? [],
    licensed: true,
  });
}));
