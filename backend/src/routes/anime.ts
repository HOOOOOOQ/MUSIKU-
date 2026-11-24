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
import { animeService } from '../services/animeService';
import {
  animeDetailsQuerySchema,
  animeEpisodesQuerySchema,
  animeListQuerySchema,
  animeSearchQuerySchema,
  animeStreamQuerySchema,
} from '../validators/anime.validator';

/**
 * Prefers the Animeku provider and falls back to the existing AniList/Jikan
 * metadata path, so an Animeku outage degrades instead of breaking the screen.
 */
async function withAnimekuFallback<T>(primary: () => Promise<T>, fallback: () => Promise<unknown>): Promise<T | { fallback: true; source: string; data: unknown }> {
  try {
    return await primary();
  } catch {
    return { fallback: true, source: 'anime_metadata', data: await fallback() };
  }
}

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

animeRouter.get('/search', validate(animeSearchQuerySchema, 'query'), asyncHandler(async (req: AuthedRequest, res) => {
  const { q, page, limit, type } = req.query as unknown as { q: string; page: number; limit: number; type: string };
  ok(
    res,
    await withAnimekuFallback(
      () => animeService.search(q, { page, limit, type, userId: req.userId }),
      async () => catalogService.searchAnime(q, page, limit),
    ),
  );
}));

animeRouter.get('/trending', validate(listSchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit } = req.query as unknown as { page: number; limit: number };
  ok(res, await catalogService.animeList('trending', page, limit));
}));

animeRouter.get('/popular', validate(animeListQuerySchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit, type } = req.query as unknown as { page: number; limit: number; type: string };
  ok(res, await withAnimekuFallback(() => animeService.catalog('popular', { page, limit, type }), () => catalogService.animeList('popular', page, limit)));
}));

/* ── Animeku (internal provider: Animasu) ─────────────────────────────────
 * Consumer-facing anime module. Metadata is always available when the provider
 * is enabled; video playback additionally requires an explicit authorization
 * switch on the backend (see ANIMASU_STREAMING_AUTHORIZED). These routes are
 * registered before `/:id` so they are never captured by the id parameter. */

animeRouter.get('/status', asyncHandler(async (_req, res) => {
  ok(res, animeService.status());
}));

animeRouter.get('/home', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await animeService.home(req.userId));
}));

animeRouter.get('/ongoing', validate(animeListQuerySchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit, type } = req.query as unknown as { page: number; limit: number; type: string };
  ok(res, await animeService.catalog('ongoing', { page, limit, type }));
}));

animeRouter.get('/completed', validate(animeListQuerySchema, 'query'), asyncHandler(async (req, res) => {
  const { page, limit, type } = req.query as unknown as { page: number; limit: number; type: string };
  ok(res, await animeService.catalog('completed', { page, limit, type }));
}));

animeRouter.get('/schedule', asyncHandler(async (_req, res) => {
  ok(res, await animeService.schedule());
}));

animeRouter.get('/details', validate(animeDetailsQuerySchema, 'query'), asyncHandler(async (req, res) => {
  const { link } = req.query as unknown as { link: string };
  ok(res, await animeService.details(link));
}));

animeRouter.get('/episodes', validate(animeEpisodesQuerySchema, 'query'), asyncHandler(async (req, res) => {
  const { link } = req.query as unknown as { link: string };
  ok(res, await animeService.episodes(link));
}));

/**
 * Episode media resolution. Returns a temporary URL only when playback is
 * authorized; otherwise 403 STREAM_NOT_AUTHORIZED so the client can render an
 * honest unavailable state. The URL is never stored, cached or logged.
 */
animeRouter.get('/stream', validate(animeStreamQuerySchema, 'query'), asyncHandler(async (req, res) => {
  const { episodeUrl } = req.query as unknown as { episodeUrl: string };
  ok(res, await animeService.stream(episodeUrl));
}));

/** Watch-progress persistence that accepts a provider link or a Mongo id. */
animeRouter.post(
  '/progress',
  validate(
    z.object({
      animeId: z.string().optional(),
      link: z.string().optional(),
      episodeUrl: z.string().optional(),
      episodeNumber: z.coerce.number().int().min(0).max(100000).optional(),
      positionSec: z.coerce.number().min(0).optional(),
      durationSec: z.coerce.number().min(0).optional(),
      completed: z.boolean().optional(),
    }).refine((value) => Boolean(value.animeId || value.link), { message: 'animeId or link is required' }),
  ),
  asyncHandler(async (req: AuthedRequest, res) => {
    ok(res, await animeService.saveProgress(req.userId!, req.body as Parameters<typeof animeService.saveProgress>[1]));
  }),
);

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
 * Episode media resolution by Mongo ids (used by the mobile player).
 *
 * Two sources are supported, in this order:
 *  1. **Animeku** — episodes synced from the Animasu provider store a provider
 *     link in `providerEpisodeId` and never a media URL (temporary URLs are not
 *     persisted). The link is resolved on demand and is subject to the playback
 *     authorization switch: unauthorized deployments get 403
 *     `STREAM_NOT_AUTHORIZED` instead of a URL.
 *  2. **Licensed anime provider** — configured via LICENSED_ANIME_*; without it
 *     the response is `needs_credentials`, exactly as before.
 */
animeRouter.get('/:id/episodes/:episodeId/stream', asyncHandler(async (req, res) => {
  const episode = (await libraryService.getEpisode(req.params.episodeId)) as
    | { streamUrl?: string; subtitles?: unknown; providerEpisodeId?: string }
    | null;
  const providerEpisodeId = episode?.providerEpisodeId ?? '';

  if (providerEpisodeId) {
    ok(res, await animeService.stream(providerEpisodeId));
    return;
  }
  if (!hasLicensedAnime) {
    needsCredentials(res, 'Licensed anime streaming', ['LICENSED_ANIME_API_KEY', 'LICENSED_ANIME_BASE_URL']);
    return;
  }
  ok(res, {
    streamUrl: episode?.streamUrl ?? '',
    subtitles: episode?.subtitles ?? [],
    licensed: true,
  });
}));
