import { isValidObjectId } from 'mongoose';
import { Anime, AnimeEpisode, SearchHistory } from '../models';
import { providerManager } from './providerManager';
import { libraryService } from './libraryService';
import { AnimasuError, AnimasuProvider, animasuProvider } from '../providers/anime/animasu';
import { ANIME_TYPES, canonicalAnimeType, type AnimasuListItem, type AnimeType } from '../validators/anime.validator';
import { ApiError, notFound } from '../utils/apiResponse';

/**
 * Animeku service — the consumer-facing anime module of MUSIKU+.
 *
 * Architecture (unchanged from the rest of the backend):
 *   Flutter → REST → animeService → Animasu provider / MongoDB Atlas
 *
 * Responsibilities:
 *  - Serve the Animeku catalog (popular / ongoing / completed / schedule /
 *    search / details / episodes) from the Animasu provider.
 *  - Persist normalized metadata in Atlas so the existing library, watchlist,
 *    favourite, rating and watch-history features can reference real ObjectIds
 *    (`providerId` + `source` is unique, so re-syncing never duplicates).
 *  - Gate video playback behind an explicit authorization switch. A provider
 *    returning a URL is **not** proof of distribution rights, so unless the
 *    deployer asserts authorization and allowlists the media hosts, this service
 *    returns metadata plus `playback: 'not_authorized'` instead of a stream.
 *  - Never persist or log a temporary stream URL.
 *
 * Provider calls go through `providerManager` when an `api_providers` record
 * exists (which adds caching, health tracking and request logs); otherwise the
 * adapter is called directly so a freshly initialised database still works.
 */

const SOURCE = 'animasu';

export interface SerializedAnime {
  id: string;
  title: string;
  link: string;
  posterUrl: string;
  synopsis: string;
  type: string;
  rating: number;
  episodeCount: number;
  status: string;
  studio: string;
  genres: string[];
  latestEpisode: { text: string; number: number | null };
  source: string;
  updatedAt?: string;
}

function serializeAnime(doc: Record<string, unknown> & { _id: unknown }): SerializedAnime {
  const latestNumber = doc.latestEpisodeNumber;
  return {
    id: String(doc._id),
    title: String(doc.title ?? ''),
    link: doc.source === SOURCE ? String(doc.providerId ?? '') : '',
    posterUrl: String(doc.posterUrl ?? ''),
    synopsis: String(doc.synopsis ?? ''),
    type: String(doc.format ?? ''),
    rating: Number(doc.rating ?? 0),
    episodeCount: Number(doc.episodeCount ?? 0),
    status: String(doc.status ?? ''),
    studio: String(doc.studio ?? ''),
    genres: Array.isArray(doc.genres) ? (doc.genres as string[]) : [],
    latestEpisode: {
      text: String(doc.latestEpisodeText ?? ''),
      number: typeof latestNumber === 'number' && Number.isFinite(latestNumber) ? latestNumber : null,
    },
    source: String(doc.source ?? SOURCE),
    updatedAt: doc.updatedAt ? new Date(doc.updatedAt as string).toISOString() : undefined,
  };
}

/** Maps an adapter failure onto the API error envelope without leaking internals. */
function toApiError(error: unknown): ApiError {
  if (error instanceof AnimasuError) {
    const status = error.code === 'PROVIDER_DISABLED' ? 503 : error.code === 'BAD_TARGET' ? 400 : error.status;
    return new ApiError(status, error.code, error.message);
  }
  if (error instanceof ApiError) return error;
  return new ApiError(502, 'PROVIDER_UNAVAILABLE', 'The Animeku provider is currently unavailable');
}

export class AnimeService {
  constructor(private readonly provider: AnimasuProvider = animasuProvider) {}

  /** Public capability description — no secrets, no allowlist contents. */
  status(): {
    provider: string;
    displayName: string;
    enabled: boolean;
    metadataAvailable: boolean;
    playback: 'authorized' | 'not_authorized';
    playbackAuthorized: boolean;
    streamHostCount: number;
    cacheTtlSec: number;
    types: readonly AnimeType[];
  } {
    return {
      provider: this.provider.id,
      displayName: 'Animeku',
      enabled: this.provider.enabled,
      metadataAvailable: this.provider.enabled,
      playback: this.provider.streamingAuthorized ? 'authorized' : 'not_authorized',
      playbackAuthorized: this.provider.streamingAuthorized,
      // The count is reported, never the allowlist itself.
      streamHostCount: this.provider.allowedStreamHostCount,
      cacheTtlSec: this.provider.cacheTtlSec,
      types: ANIME_TYPES,
    };
  }

  /** Runs an operation through the provider manager when it is configured. */
  private async execute<T>(operation: string, cacheKey: string, fn: () => Promise<T>, isEmpty: (value: T) => boolean): Promise<T> {
    try {
      const registered = await providerManager.listProviders('animeku');
      if (registered.length > 0) {
        const { data } = await providerManager.execute<T>('animeku', { operation, cacheKey }, async () => fn(), isEmpty);
        return data;
      }
    } catch (error) {
      // A missing/failed provider record must not take the whole request down:
      // fall through to a direct adapter call and surface real errors from there.
      if (error instanceof AnimasuError) throw error;
    }
    return fn();
  }

  /** Persists normalized list items and returns them with their ObjectIds. */
  private async persistItems(items: AnimasuListItem[]): Promise<SerializedAnime[]> {
    if (items.length === 0) return [];
    await Promise.all(
      items.map((item) =>
        Anime.findOneAndUpdate(
          { providerId: item.link, source: SOURCE },
          {
            $set: {
              providerId: item.link,
              source: SOURCE,
              title: item.title,
              posterUrl: item.image,
              format: item.type || item.rawType,
              rating: item.rating,
              latestEpisodeText: item.latestEpisode.text,
              latestEpisodeNumber: item.latestEpisode.number ?? undefined,
            },
          },
          { upsert: true, new: true },
        ),
      ),
    );
    const links = items.map((item) => item.link);
    const docs = (await Anime.find({ providerId: { $in: links }, source: SOURCE }).lean()) as unknown as (Record<string, unknown> & { _id: unknown })[];
    const byLink = new Map(docs.map((doc) => [String(doc.providerId), doc]));
    // Preserve provider ordering.
    return links.map((link) => byLink.get(link)).filter((doc): doc is Record<string, unknown> & { _id: unknown } => Boolean(doc)).map(serializeAnime);
  }

  private filterByType(items: SerializedAnime[], type: string): SerializedAnime[] {
    if (!type) return items;
    return items.filter((item) => item.type.toUpperCase() === type.toUpperCase());
  }

  async catalog(
    kind: 'popular' | 'ongoing' | 'completed',
    options: { page?: number; limit?: number; type?: string } = {},
  ): Promise<{ kind: string; page: number; total: number; items: SerializedAnime[] }> {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const type = options.type ?? '';
    const result = await this.execute(
      `animeku.${kind}`,
      `animeku:${kind}:${page}`,
      () => this.provider[kind](page),
      (value) => value.items.length === 0,
    ).catch((error: unknown) => {
      throw toApiError(error);
    });
    const sliced = result.items.slice(0, limit);
    const items = this.filterByType(await this.persistItems(sliced), type);
    return { kind, page: result.page, total: result.total, items };
  }

  async schedule(): Promise<{ days: { key: string; label: string; items: SerializedAnime[] }[]; totalDays: number; shape: string }> {
    const result = await this.execute('animeku.schedule', 'animeku:schedule', () => this.provider.schedule(), (value) => value.days.length === 0).catch(
      (error: unknown) => {
        throw toApiError(error);
      },
    );
    const days: { key: string; label: string; items: SerializedAnime[] }[] = [];
    for (const day of result.days) {
      // Persist at most the first page of each bucket to keep writes bounded.
      const items = await this.persistItems(day.items.slice(0, 20));
      days.push({ key: day.key, label: day.label, items });
    }
    return { days, totalDays: result.totalDays, shape: result.shape };
  }

  async search(
    query: string,
    options: { page?: number; limit?: number; type?: string; userId?: string } = {},
  ): Promise<{ query: string; page: number; total: number; items: SerializedAnime[] }> {
    const page = options.page ?? 1;
    const limit = options.limit ?? 20;
    const normalizedQuery = query.trim();
    if (!normalizedQuery) throw new ApiError(400, 'BAD_REQUEST', 'q is required');

    const result = await this.execute(
      'animeku.search',
      `animeku:search:${normalizedQuery.toLowerCase()}:${page}`,
      () => this.provider.search(normalizedQuery, page),
      (value) => value.items.length === 0,
    ).catch((error: unknown) => {
      throw toApiError(error);
    });

    if (options.userId) {
      // One entry per query, refreshed on repeat — mirrors the music search history.
      await SearchHistory.findOneAndUpdate(
        { user: options.userId, query: normalizedQuery },
        { $set: { category: 'anime', searchedAt: new Date() } },
        { upsert: true, new: true },
      ).catch(() => undefined);
    }

    const items = this.filterByType(await this.persistItems(result.items.slice(0, limit)), options.type ?? '');
    return { query: normalizedQuery, page: result.page, total: result.total, items };
  }

  /**
   * Details + episode list. Episodes are re-synced only when the stored count
   * differs from the provider's, so a 500-episode title is not rewritten on
   * every request. Episode documents never carry a stream URL.
   */
  async details(link: string): Promise<{
    anime: SerializedAnime;
    episodes: { number: number; label: string; title: string; date: string; id: string }[];
    episodeOrder: { reversed: boolean; numberSource: string };
    playback: 'authorized' | 'not_authorized';
  }> {
    const normalized = await this.provider.details(link).catch((error: unknown) => {
      throw toApiError(error);
    });
    if (!normalized.title) throw notFound('Anime not found at the provider');

    const doc = (await Anime.findOneAndUpdate(
      { providerId: link, source: SOURCE },
      {
        $set: {
          providerId: link,
          source: SOURCE,
          title: normalized.title,
          posterUrl: normalized.image,
          synopsis: normalized.synopsis,
          genres: normalized.genres,
          rating: normalized.rating,
          episodeCount: normalized.totalEpisodes,
          studio: normalized.info['Studio'] ?? normalized.info['studio'] ?? '',
          status: normalized.info['Status'] ?? normalized.info['status'] ?? '',
          season: normalized.info['Season'] ?? normalized.info['season'] ?? '',
          format: canonicalAnimeType(normalized.info['Type'] ?? normalized.info['type'] ?? normalized.info['Tipe'] ?? ''),
          latestEpisodeText: normalized.episodes.items.length > 0 ? normalized.episodes.items[normalized.episodes.items.length - 1].label : '',
          latestEpisodeNumber: normalized.episodes.items.length > 0 ? normalized.episodes.items[normalized.episodes.items.length - 1].number : undefined,
        },
      },
      { upsert: true, new: true },
    )) as unknown as Record<string, unknown> & { _id: unknown };

    const animeId = String(doc._id);
    const storedCount = await AnimeEpisode.countDocuments({ anime: animeId });
    if (storedCount !== normalized.episodes.items.length) {
      await Promise.all(
        normalized.episodes.items.map((episode) =>
          AnimeEpisode.findOneAndUpdate(
            { anime: animeId, number: episode.number },
            {
              $set: {
                anime: animeId,
                number: episode.number,
                title: episode.title || episode.label,
                providerEpisodeId: episode.episodeUrl,
                releaseDate: episode.date ? new Date(episode.date) : undefined,
                // Temporary media URLs are never persisted.
                streamUrl: '',
              },
            },
            { upsert: true, new: true },
          ),
        ),
      );
    }

    const episodeDocs = (await AnimeEpisode.find({ anime: animeId }).sort({ number: 1 }).lean()) as unknown as (Record<string, unknown> & { _id: unknown })[];
    const byNumber = new Map(episodeDocs.map((episode) => [Number(episode.number), episode]));

    return {
      anime: serializeAnime(doc),
      episodes: normalized.episodes.items.map((episode) => {
        const stored = byNumber.get(episode.number);
        return {
          number: episode.number,
          label: episode.label,
          title: episode.title,
          date: episode.date,
          id: stored ? String(stored._id) : '',
        };
      }),
      episodeOrder: { reversed: normalized.episodes.reversed, numberSource: normalized.episodes.numberSource },
      playback: this.status().playback,
    };
  }

  async episodes(link: string): Promise<{
    anime: SerializedAnime;
    episodes: { number: number; label: string; title: string; date: string; id: string }[];
    episodeOrder: { reversed: boolean; numberSource: string };
    playback: 'authorized' | 'not_authorized';
  }> {
    const result = await this.details(link);
    return { anime: result.anime, episodes: result.episodes, episodeOrder: result.episodeOrder, playback: result.playback };
  }

  /**
   * Resolves a playable media URL for an episode.
   *
   * Returns a **temporary** URL. It is not cached, not persisted and not logged.
   * When playback is not authorized the call fails with `STREAM_NOT_AUTHORIZED`
   * (403) so clients can show an honest "playback unavailable" state instead of
   * a broken player.
   */
  async stream(episodeUrl: string): Promise<{ streamUrl: string; alternativeLinks: string[]; episodeTitle: string; heading: string; temporary: true }> {
    const result = await this.provider.stream(episodeUrl).catch((error: unknown) => {
      throw toApiError(error);
    });
    return { ...result, temporary: true };
  }

  /** Ensures an Anime document exists for a provider link and returns its id. */
  async resolveAnimeId(linkOrId: string): Promise<string> {
    if (isValidObjectId(linkOrId)) {
      const existing = await Anime.findById(linkOrId).lean();
      if (existing) return String((existing as { _id: unknown })._id);
    }
    const doc = await Anime.findOneAndUpdate(
      { providerId: linkOrId, source: SOURCE },
      { $setOnInsert: { providerId: linkOrId, source: SOURCE, title: linkOrId } },
      { upsert: true, new: true },
    );
    if (!doc) throw notFound('Anime not found');
    return String((doc as { _id: unknown })._id);
  }

  /**
   * Saves watch progress. Accepts either a Mongo id or a provider link so the
   * player can persist progress even when it was opened straight from a list.
   */
  async saveProgress(
    userId: string,
    input: { animeId?: string; link?: string; episodeUrl?: string; episodeNumber?: number; positionSec?: number; durationSec?: number; completed?: boolean },
  ): Promise<{ animeId: string; episodeId: string; saved: true }> {
    const reference = input.animeId || input.link;
    if (!reference) throw new ApiError(400, 'BAD_REQUEST', 'animeId or link is required');
    const animeId = await this.resolveAnimeId(reference);

    let episodeId = '';
    if (input.episodeUrl) {
      const episode = (await AnimeEpisode.findOneAndUpdate(
        { anime: animeId, providerEpisodeId: input.episodeUrl },
        {
          $setOnInsert: {
            anime: animeId,
            providerEpisodeId: input.episodeUrl,
            number: input.episodeNumber ?? 0,
            title: '',
            streamUrl: '',
          },
        },
        { upsert: true, new: true },
      )) as unknown as { _id: unknown } | null;
      episodeId = episode ? String(episode._id) : '';
    } else if (typeof input.episodeNumber === 'number' && input.episodeNumber > 0) {
      const episode = (await AnimeEpisode.findOne({ anime: animeId, number: input.episodeNumber }).lean()) as unknown as { _id: unknown } | null;
      episodeId = episode ? String(episode._id) : '';
    }

    await libraryService.recordAnimeWatch(userId, {
      animeId,
      episodeId: episodeId || undefined,
      episodeNumber: input.episodeNumber ?? 0,
      positionSec: input.positionSec ?? 0,
      durationSec: input.durationSec ?? 0,
      completed: input.completed ?? false,
    });
    return { animeId, episodeId, saved: true };
  }

  /** Animeku home aggregate. Partial failures degrade instead of blanking. */
  async home(userId?: string, options: { limit?: number } = {}): Promise<Record<string, unknown>> {
    const limit = Math.min(options.limit ?? 10, 20);
    const tasks: [string, Promise<unknown>][] = [
      ['popular', this.catalog('popular', { limit }).then((result) => result.items).catch(() => [])],
      ['ongoing', this.catalog('ongoing', { limit }).then((result) => result.items).catch(() => [])],
      ['completed', this.catalog('completed', { limit }).then((result) => result.items).catch(() => [])],
      ['schedule', this.schedule().catch(() => ({ days: [], totalDays: 0, shape: 'unavailable' }))],
    ];
    if (userId) {
      tasks.push(['continueWatching', libraryService.continueWatching(userId, limit).catch(() => [])]);
      tasks.push(['watchlist', libraryService.listWatchlist(userId, undefined, 1, limit).then((result) => result.items).catch(() => [])]);
      tasks.push(['favorites', libraryService.listAnimeFavorites(userId).catch(() => [])]);
      tasks.push(['history', libraryService.listAnimeHistory(userId, limit).catch(() => [])]);
    }

    const results = await Promise.all(tasks.map(([, task]) => task));
    const payload: Record<string, unknown> = { status: this.status() };
    tasks.forEach(([key], index) => {
      payload[key] = results[index];
    });

    // "Featured" is the highest-rated popular entry set; "latest episodes" is
    // derived from the ongoing list because the provider has no dedicated feed.
    const popular = (payload.popular as SerializedAnime[]) ?? [];
    payload.featured = [...popular].sort((a, b) => b.rating - a.rating).slice(0, 5);
    const ongoing = (payload.ongoing as SerializedAnime[]) ?? [];
    payload.latestEpisodes = ongoing
      .filter((item) => item.latestEpisode.text || item.latestEpisode.number !== null)
      .map((item) => ({ anime: item, label: item.latestEpisode.text || `Episode ${item.latestEpisode.number ?? ''}` }));
    return payload;
  }
}

export const animeService = new AnimeService();
