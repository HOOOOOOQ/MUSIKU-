/**
 * Animeku REST surface (integration, hermetic).
 *
 * The Mongoose models are replaced by in-memory fakes and the provider manager
 * reports "no registered provider", so `animeService` calls the Animasu adapter
 * directly. The adapter itself is stubbed per test — no network, no database.
 *
 * What is pinned here:
 *  - the documented Animeku endpoints exist, are authenticated and use the
 *    standard response envelope;
 *  - normalized metadata is persisted with stable keys and never carries a
 *    temporary stream URL;
 *  - playback stays disabled (403 STREAM_NOT_AUTHORIZED) on a deployment that
 *    has not asserted authorization, while metadata keeps working;
 *  - SSRF-hostile `link` / `episodeUrl` values are rejected before any request;
 *  - the pre-existing licensed-anime behaviour is unchanged.
 */
import request from 'supertest';
import { createApp } from '../../src/app';
import { signAccessToken } from '../../src/utils/crypto';
import { Anime, AnimeEpisode, AnimeWatchHistory, SearchHistory } from '../../src/models';
import { animasuProvider, AnimasuProvider } from '../../src/providers/anime/animasu';
import { AnimeService } from '../../src/services/animeService';
import { canonicalAnimeType } from '../../src/validators/anime.validator';
import type { AnimasuDetails, AnimasuEpisodeList, AnimasuListItem, AnimasuListPage, AnimasuSchedule } from '../../src/validators/anime.validator';

jest.mock('../../src/services/catalogService', () => ({
  catalogService: {
    animeList: jest.fn(async () => []),
    searchAnime: jest.fn(async () => []),
    seasonalAnime: jest.fn(async () => []),
    randomAnime: jest.fn(async () => null),
    getAnime: jest.fn(async () => null),
    getEpisodes: jest.fn(async () => []),
    relatedAnime: jest.fn(async () => []),
    getTrack: jest.fn(async () => null),
  },
}));

// No api_providers record in these tests → the service calls the adapter directly.
jest.mock('../../src/services/providerManager', () => ({
  providerManager: {
    listProviders: jest.fn(async () => []),
    execute: jest.fn(),
  },
}));

jest.mock('../../src/models', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createFakeModel } = require('../helpers/fakeModel');
  const cache = new Map<string, unknown>();
  return new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === '__esModule') return true;
        if (!cache.has(prop)) cache.set(prop, createFakeModel());
        return cache.get(prop);
      },
    },
  );
});

const app = createApp();
const userToken = signAccessToken('user-1', 'user');
const auth = { Authorization: `Bearer ${userToken}` };

type FakeModel = {
  _docs: Record<string, unknown>[];
  _reset: () => void;
  create: (doc: Record<string, unknown>) => Promise<Record<string, unknown>>;
};
const animeModel = Anime as unknown as FakeModel;
const episodeModel = AnimeEpisode as unknown as FakeModel;
const historyModel = AnimeWatchHistory as unknown as FakeModel;
const searchHistoryModel = SearchHistory as unknown as FakeModel;

const listPage = (items: { title: string; link: string; type?: string; rating?: number | null; latestEpisode?: string }[]): AnimasuListPage => ({
  kind: 'ongoing',
  page: 1,
  total: items.length,
  query: '',
  items: items.map((item): AnimasuListItem => ({
    title: item.title,
    link: item.link,
    image: `https://img.example/${item.link.slice(1)}.jpg`,
    type: canonicalAnimeType(item.type ?? ''),
    rawType: item.type ?? '',
    rating: item.rating ?? 0,
    latestEpisode: { text: item.latestEpisode ?? '', number: null },
  })),
});

const detailsPayload = (episodes: AnimasuEpisodeList): AnimasuDetails => ({
  title: 'Jujutsu Kaisen',
  image: 'https://img.example/jjk.jpg',
  info: { Type: 'TV', Studio: 'MAPPA', Status: 'Ongoing' },
  genres: ['Action', 'Supernatural'],
  synopsis: 'Sorcery school.',
  rating: 8.6,
  totalEpisodes: episodes.items.length,
  episodes,
});

beforeEach(() => {
  jest.restoreAllMocks();
  [animeModel, episodeModel, historyModel, searchHistoryModel].forEach((model) => model._reset());
});

describe('Animeku status and authentication', () => {
  it('requires authentication', async () => {
    const res = await request(app).get('/api/anime/ongoing');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('reports the Animeku capability set without leaking the allowlist', async () => {
    const res = await request(app).get('/api/anime/status').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toMatchObject({ provider: 'animasu', displayName: 'Animeku', enabled: true, playback: 'not_authorized', playbackAuthorized: false });
    expect(res.body.data.types).toEqual(['TV', 'Movie', 'Special', 'OVA', 'ONA', 'Other']);
    expect(JSON.stringify(res.body)).not.toContain('allowedStreamHosts');
  });
});

describe('Animeku catalog endpoints', () => {
  it('GET /api/anime/ongoing normalizes and persists the provider list', async () => {
    jest.spyOn(animasuProvider, 'ongoing').mockResolvedValue(
      listPage([
        { title: 'Frieren', link: '/anime/frieren', type: 'TV', rating: 9.1, latestEpisode: 'Episode 12' },
        { title: 'Odd Type', link: '/anime/odd', type: 'Web Anime', rating: null, latestEpisode: '??' },
      ]),
    );
    const res = await request(app).get('/api/anime/ongoing?page=1&limit=20').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.kind).toBe('ongoing');
    expect(res.body.data.items).toHaveLength(2);
    expect(res.body.data.items[0]).toMatchObject({
      title: 'Frieren',
      link: '/anime/frieren',
      type: 'TV',
      rating: 9.1,
      source: 'animasu',
      latestEpisode: { text: 'Episode 12', number: null },
    });
    expect(res.body.data.items[1].type).toBe('Other');
    expect(typeof res.body.data.items[0].id).toBe('string');

    // Persisted exactly once per provider link, with no media URL anywhere.
    expect(animeModel._docs).toHaveLength(2);
    expect(animeModel._docs[0]).toMatchObject({ providerId: '/anime/frieren', source: 'animasu', latestEpisodeText: 'Episode 12' });
    expect(JSON.stringify(animeModel._docs)).not.toContain('https://cdn');
  });

  it('GET /api/anime/completed and /api/anime/popular use the same envelope', async () => {
    jest.spyOn(animasuProvider, 'completed').mockResolvedValue(listPage([{ title: 'Done', link: '/anime/done', type: 'TV' }]));
    jest.spyOn(animasuProvider, 'popular').mockResolvedValue(listPage([{ title: 'Hot', link: '/anime/hot', type: 'Movie' }]));

    const completed = await request(app).get('/api/anime/completed').set(auth);
    expect(completed.body.data.kind).toBe('completed');
    expect(completed.body.data.items[0].title).toBe('Done');

    const popular = await request(app).get('/api/anime/popular').set(auth);
    expect(popular.body.data.kind).toBe('popular');
    expect(popular.body.data.items[0].title).toBe('Hot');
  });

  it('filters by anime type when the client asks for one', async () => {
    jest.spyOn(animasuProvider, 'ongoing').mockResolvedValue(
      listPage([
        { title: 'TV show', link: '/anime/tv', type: 'TV' },
        { title: 'A film', link: '/anime/movie', type: 'Movie' },
      ]),
    );
    const res = await request(app).get('/api/anime/ongoing?type=Movie').set(auth);
    expect(res.body.data.items.map((item: { title: string }) => item.title)).toEqual(['A film']);
  });

  it('degrades to the metadata providers when Animeku fails', async () => {
    jest.spyOn(animasuProvider, 'popular').mockRejectedValue(new Error('provider exploded'));
    const res = await request(app).get('/api/anime/popular').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ fallback: true, source: 'anime_metadata' });
  });

  it('rejects invalid pagination instead of calling the provider', async () => {
    const res = await request(app).get('/api/anime/ongoing?page=0').set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Animeku schedule endpoint', () => {
  it('exposes day buckets from the nested provider object', async () => {
    const schedule: AnimasuSchedule = {
      shape: 'object',
      totalDays: 7,
      days: [
        { key: 'all', label: 'Semua', items: listPage([{ title: 'Frieren', link: '/anime/frieren', type: 'TV' }]).items },
        { key: 'senin', label: 'Senin', items: listPage([{ title: 'One Piece', link: '/anime/one-piece', type: 'TV' }]).items },
      ],
    };
    jest.spyOn(animasuProvider, 'schedule').mockResolvedValue(schedule);
    const res = await request(app).get('/api/anime/schedule').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.shape).toBe('object');
    expect(res.body.data.totalDays).toBe(7);
    expect(res.body.data.days.map((day: { key: string; label: string }) => [day.key, day.label])).toEqual([
      ['all', 'Semua'],
      ['senin', 'Senin'],
    ]);
    expect(res.body.data.days[0].items[0].link).toBe('/anime/frieren');
  });

  it('returns an empty schedule rather than an error when the provider has none', async () => {
    jest.spyOn(animasuProvider, 'schedule').mockResolvedValue({ shape: 'empty', totalDays: 0, days: [] });
    const res = await request(app).get('/api/anime/schedule').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.days).toEqual([]);
  });
});

describe('Animeku search endpoint', () => {
  it('returns normalized results and records the query in search history', async () => {
    const page = listPage([{ title: 'Frieren', link: '/anime/frieren', type: 'TV' }]);
    jest.spyOn(animasuProvider, 'search').mockResolvedValue({ ...page, kind: 'search', query: 'frieren' });
    const res = await request(app).get('/api/anime/search?q=frieren').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.query).toBe('frieren');
    expect(res.body.data.items[0].title).toBe('Frieren');
    expect(searchHistoryModel._docs).toHaveLength(1);
    expect(searchHistoryModel._docs[0]).toMatchObject({ query: 'frieren', category: 'anime', user: 'user-1' });
  });

  it('requires a query string', async () => {
    const res = await request(app).get('/api/anime/search').set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('Animeku details and episodes', () => {
  const episodes: AnimasuEpisodeList = {
    reversed: true,
    numberSource: 'episode',
    items: [
      { number: 1, label: 'Episode 1', title: 'Ryoumen Sukuna', episodeUrl: '/episode/jjk-1', date: '2026-01-05' },
      { number: 2, label: 'Episode 2', title: 'Fushiguro', episodeUrl: '/episode/jjk-2', date: '2026-01-12' },
    ],
  };

  it('returns details with episodes and the playback state', async () => {
    jest.spyOn(animasuProvider, 'details').mockResolvedValue(detailsPayload(episodes));
    const res = await request(app).get('/api/anime/details?link=/anime/jujutsu-kaisen').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.anime).toMatchObject({ title: 'Jujutsu Kaisen', type: 'TV', rating: 8.6, status: 'Ongoing', studio: 'MAPPA' });
    expect(res.body.data.anime.genres).toEqual(['Action', 'Supernatural']);
    expect(res.body.data.episodes.map((episode: { number: number }) => episode.number)).toEqual([1, 2]);
    expect(res.body.data.episodeOrder).toEqual({ reversed: true, numberSource: 'episode' });
    expect(res.body.data.playback).toBe('not_authorized');

    // Episode documents are synced without any media URL.
    expect(episodeModel._docs).toHaveLength(2);
    expect(episodeModel._docs[0]).toMatchObject({ number: 1, providerEpisodeId: '/episode/jjk-1', streamUrl: '' });
    expect(JSON.stringify(episodeModel._docs)).not.toContain('https://');
  });

  it('does not duplicate episodes on a second sync', async () => {
    jest.spyOn(animasuProvider, 'details').mockResolvedValue(detailsPayload(episodes));
    await request(app).get('/api/anime/details?link=/anime/jujutsu-kaisen').set(auth);
    await request(app).get('/api/anime/details?link=/anime/jujutsu-kaisen').set(auth);
    expect(animeModel._docs).toHaveLength(1);
    expect(episodeModel._docs).toHaveLength(2);
  });

  it('GET /api/anime/episodes returns the same episode list', async () => {
    jest.spyOn(animasuProvider, 'details').mockResolvedValue(detailsPayload(episodes));
    const res = await request(app).get('/api/anime/episodes?link=/anime/jujutsu-kaisen').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.episodes).toHaveLength(2);
    expect(res.body.data.playback).toBe('not_authorized');
  });

  it('returns 404 when the provider has no such title', async () => {
    jest.spyOn(animasuProvider, 'details').mockResolvedValue({ ...detailsPayload({ items: [], reversed: false, numberSource: 'index' }), title: '' });
    const res = await request(app).get('/api/anime/details?link=/anime/nope').set(auth);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

describe('Animeku SSRF guards at the API boundary', () => {
  it('rejects a protocol-relative target during validation', async () => {
    const res = await request(app).get('/api/anime/details').query({ link: '//evil.example/anime/x' }).set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects a foreign origin target with BAD_TARGET instead of fetching it', async () => {
    const spy = jest.spyOn(animasuProvider, 'details');
    const res = await request(app).get('/api/anime/details').query({ link: 'https://evil.example/anime/x' }).set(auth);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('BAD_TARGET');
    expect(spy).toHaveBeenCalled();
    expect(spy.mock.calls[0][0]).toBe('https://evil.example/anime/x');
  });

  it('rejects whitespace injection in an episode target', async () => {
    const res = await request(app).get('/api/anime/stream').query({ episodeUrl: '/ep/1 https://evil.example' }).set(auth);
    expect(res.status).toBe(400);
  });
});

describe('Animeku playback authorization', () => {
  it('refuses to hand out a media URL when playback is not authorized', async () => {
    const spy = jest.spyOn(animasuProvider, 'stream');
    const res = await request(app).get('/api/anime/stream').query({ episodeUrl: '/episode/jjk-1' }).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STREAM_NOT_AUTHORIZED');
    expect(res.body.success).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain('streamUrl');
    // The adapter itself refused: it never returned a URL to the route.
    await expect(spy.mock.results[0].value).rejects.toMatchObject({ code: 'STREAM_NOT_AUTHORIZED' });
  });

  it('returns a temporary URL for an authorized deployment and persists nothing', async () => {
    const calls: string[] = [];
    const authorized = new AnimeService(
      new AnimasuProvider(
        {
          enabled: true,
          baseUrl: 'https://api.nexadev.my.id/animasu',
          streamingAuthorized: true,
          allowedStreamHosts: ['cdn.example.com'],
          timeoutMs: 5000,
          cacheTtlSec: 0,
          rateLimitPerMin: 60,
        },
        async <T,>(url: string): Promise<T> => {
          calls.push(url);
          return {
            success: true,
            data: {
              streamUrl: 'https://cdn.example.com/jjk-1.m3u8?token=temporary',
              alternativeLinks: ['https://evil.example/jjk-1.m3u8'],
              episodeInfo: { title: 'Episode 1', heading: 'Jujutsu Kaisen' },
            },
          } as T;
        },
      ),
    );

    const stream = await authorized.stream('/episode/jjk-1');
    expect(calls).toEqual(['https://api.nexadev.my.id/animasu?stream=%2Fepisode%2Fjjk-1']);
    expect(stream).toMatchObject({ streamUrl: 'https://cdn.example.com/jjk-1.m3u8?token=temporary', temporary: true, episodeTitle: 'Episode 1' });
    expect(stream.alternativeLinks).toEqual([]);
    expect(authorized.status().playback).toBe('authorized');

    // Nothing about the media URL reached the database.
    expect(JSON.stringify(animeModel._docs)).not.toContain('cdn.example.com');
    expect(JSON.stringify(episodeModel._docs)).not.toContain('cdn.example.com');
  });
});

describe('Animeku home aggregate and watch progress', () => {
  it('assembles the rails and degrades when one of them fails', async () => {
    jest.spyOn(animasuProvider, 'popular').mockResolvedValue(listPage([{ title: 'Hot', link: '/anime/hot', type: 'TV', rating: 9 }]));
    jest.spyOn(animasuProvider, 'ongoing').mockResolvedValue(listPage([{ title: 'Now', link: '/anime/now', type: 'TV', latestEpisode: 'Episode 4' }]));
    jest.spyOn(animasuProvider, 'completed').mockRejectedValue(new Error('down'));
    jest.spyOn(animasuProvider, 'schedule').mockResolvedValue({ shape: 'empty', totalDays: 0, days: [] });

    const res = await request(app).get('/api/anime/home').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.data.status.displayName).toBe('Animeku');
    expect(res.body.data.popular[0].title).toBe('Hot');
    expect(res.body.data.ongoing[0].title).toBe('Now');
    expect(res.body.data.completed).toEqual([]);
    expect(res.body.data.featured[0].title).toBe('Hot');
    expect(res.body.data.latestEpisodes[0]).toMatchObject({ label: 'Episode 4' });
    expect(Array.isArray(res.body.data.continueWatching)).toBe(true);
    expect(Array.isArray(res.body.data.watchlist)).toBe(true);
  });

  it('saves watch progress from a provider link', async () => {
    jest.spyOn(animasuProvider, 'details').mockResolvedValue(
      detailsPayload({
        reversed: false,
        numberSource: 'episode',
        items: [{ number: 1, label: 'Episode 1', title: 'Pilot', episodeUrl: '/episode/jjk-1', date: '2026-01-05' }],
      }),
    );
    await request(app).get('/api/anime/details?link=/anime/jujutsu-kaisen').set(auth);
    const animeId = String(animeModel._docs[0]._id);
    const episodeId = String(episodeModel._docs[0]._id);

    const res = await request(app)
      .post('/api/anime/progress')
      .set(auth)
      .send({ link: '/anime/jujutsu-kaisen', episodeUrl: '/episode/jjk-1', episodeNumber: 1, positionSec: 42, durationSec: 1440 });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ animeId, episodeId, saved: true });
    // Resolving the reference reused the synced document instead of creating one.
    expect(animeModel._docs).toHaveLength(1);
    expect(historyModel._docs).toHaveLength(1);
    expect(historyModel._docs[0]).toMatchObject({ user: 'user-1', anime: animeId, episodeNumber: 1, positionSec: 42, durationSec: 1440 });
  });

  it('accepts a Mongo id reference for progress updates', async () => {
    const objectId = '507f1f77bcf86cd799439011';
    await animeModel.create({ _id: objectId, providerId: '/anime/by-id', source: 'animasu', title: 'By id' });
    const res = await request(app).post('/api/anime/progress').set(auth).send({ animeId: objectId, episodeNumber: 3, positionSec: 5 });
    expect(res.status).toBe(200);
    expect(res.body.data.animeId).toBe(objectId);
    expect(historyModel._docs[0]).toMatchObject({ anime: objectId, episodeNumber: 3 });
    expect(animeModel._docs).toHaveLength(1);
  });

  it('requires an anime reference to save progress', async () => {
    const res = await request(app).post('/api/anime/progress').set(auth).send({ positionSec: 10 });
    expect(res.status).toBe(400);
  });
});

describe('existing licensed-anime behaviour is preserved', () => {
  it('still answers needs_credentials for a metadata-provider episode', async () => {
    await episodeModel.create({ anime: 'anime-1', number: 1, title: 'Pilot', providerEpisodeId: '', streamUrl: '' });
    const episodeId = String(episodeModel._docs[0]._id);
    const res = await request(app).get(`/api/anime/anime-1/episodes/${episodeId}/stream`).set(auth);
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe('NEEDS_CREDENTIALS');
    expect(res.body.error.details.missing).toEqual(['LICENSED_ANIME_API_KEY', 'LICENSED_ANIME_BASE_URL']);
  });

  it('routes an Animasu-synced episode through the Animeku resolver', async () => {
    await episodeModel.create({ anime: 'anime-1', number: 1, title: 'Pilot', providerEpisodeId: '/episode/jjk-1', streamUrl: '' });
    const episodeId = String(episodeModel._docs[0]._id);
    const res = await request(app).get(`/api/anime/anime-1/episodes/${episodeId}/stream`).set(auth);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('STREAM_NOT_AUTHORIZED');
  });
});
