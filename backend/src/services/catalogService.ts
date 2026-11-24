import { isValidObjectId } from 'mongoose';
import { MusicTrack, MusicArtist, MusicAlbum, Anime, AnimeEpisode } from '../models';
import { DeezerProvider } from '../providers/music/deezer';
import { ItunesProvider } from '../providers/music/itunes';
import { MusicBrainzProvider } from '../providers/music/musicbrainz';
import { LrclibProvider } from '../providers/music/lrclib';
import { AniListProvider } from '../providers/anime/anilist';
import { JikanProvider } from '../providers/anime/jikan';
import { NormalizedTrack, NormalizedArtist, NormalizedAlbum } from '../providers/music/types';
import { NormalizedAnime, NormalizedEpisode } from '../providers/anime/types';
import { providerManager } from './providerManager';

/**
 * Catalog service: fans out to official/public providers with
 * fallback, caches results in MongoDB catalog collections, and
 * serves reads from cache first. Only provider-supplied data is
 * stored — no scraping, no DRM bypass.
 */

const deezer = new DeezerProvider();
const itunes = new ItunesProvider();
const musicbrainz = new MusicBrainzProvider();
const lrclib = new LrclibProvider();
const anilist = new AniListProvider();
const jikan = new JikanProvider();

const isNonEmptyArray = <T,>(arr: T[] | null | undefined): boolean => Array.isArray(arr) && arr.length > 0;

async function upsertTrack(t: NormalizedTrack){
  return MusicTrack.findOneAndUpdate(
    { providerId: t.providerId, source: t.source },
    { $set: { ...t, releaseDate: t.releaseDate ? new Date(t.releaseDate) : undefined } },
    { upsert: true, new: true },
  );
}

async function upsertArtist(a: NormalizedArtist){
  return MusicArtist.findOneAndUpdate(
    { providerId: a.providerId, source: a.source },
    { $set: a },
    { upsert: true, new: true },
  );
}

async function upsertAlbum(a: NormalizedAlbum){
  return MusicAlbum.findOneAndUpdate(
    { providerId: a.providerId, source: a.source },
    { $set: { ...a, releaseDate: a.releaseDate ? new Date(a.releaseDate) : undefined } },
    { upsert: true, new: true },
  );
}

async function upsertAnime(a: NormalizedAnime){
  return Anime.findOneAndUpdate(
    { providerId: a.providerId, source: a.source },
    { $set: { ...a, releaseDate: a.releaseDate ? new Date(a.releaseDate) : undefined, nextAiringAt: a.nextAiringAt ? new Date(a.nextAiringAt) : undefined } },
    { upsert: true, new: true },
  );
}

export const catalogService = {
  /* ── Music ─────────────────────────────────────────────────────────── */
  async searchMusic(query: string, limit = 20) {
    const { data } = await providerManager.execute<NormalizedTrack[]>(
      'music_metadata',
      { operation: 'music.search', cacheKey: `music:search:${query.toLowerCase()}:${limit}` },
      async (provider) => {
        if (provider.providerId === 'itunes') return itunes.searchTracks(query, limit);
        if (provider.providerId === 'musicbrainz') return musicbrainz.searchTracks(query, limit);
        return deezer.searchTracks(query, limit);
      },
      (r) => !isNonEmptyArray(r),
    );
    return Promise.all(data.map(upsertTrack));
  },

  async searchArtists(query: string, limit = 20) {
    const { data } = await providerManager.execute<NormalizedArtist[]>(
      'music_metadata',
      { operation: 'music.searchArtists', cacheKey: `music:artists:${query.toLowerCase()}:${limit}` },
      async (provider) => {
        if (provider.providerId === 'itunes') return itunes.searchArtists(query, limit);
        if (provider.providerId === 'musicbrainz') return musicbrainz.searchArtists(query, limit);
        return deezer.searchArtists(query, limit);
      },
      (r) => !isNonEmptyArray(r),
    );
    await Promise.all(data.map(upsertArtist));
    return data;
  },

  async searchAlbums(query: string, limit = 20) {
    const { data } = await providerManager.execute<NormalizedAlbum[]>(
      'music_metadata',
      { operation: 'music.searchAlbums', cacheKey: `music:albums:${query.toLowerCase()}:${limit}` },
      async (provider) => {
        if (provider.providerId === 'itunes') return itunes.searchAlbums(query, limit);
        if (provider.providerId === 'musicbrainz') return musicbrainz.searchAlbums(query, limit);
        return deezer.searchAlbums(query, limit);
      },
      (r) => !isNonEmptyArray(r),
    );
    await Promise.all(data.map(upsertAlbum));
    return data;
  },

  async getTrack(id: string) {
    const cached = await MusicTrack.findOne(isValidObjectId(id) ? { _id: id } : { providerId: id.includes(':') ? id.split(':').slice(1).join(':') : id, ...(id.includes(':') ? { source: id.split(':')[0] } : {}) }).lean();
    if (cached) return cached;
    const { data } = await providerManager.execute<NormalizedTrack | null>(
      'music_metadata',
      { operation: 'music.getTrack', cacheKey: `music:track:${id}` },
      async (provider) => {
        if (provider.providerId === 'itunes') return itunes.getTrack(id);
        if (provider.providerId === 'musicbrainz') return musicbrainz.getTrack(id);
        return deezer.getTrack(id);
      },
    );
    return data ? upsertTrack(data) : null;
  },

  async getArtist(id: string) {
    const cached = await MusicArtist.findOne(isValidObjectId(id) ? { _id: id } : { providerId: id.includes(':') ? id.split(':').slice(1).join(':') : id, ...(id.includes(':') ? { source: id.split(':')[0] } : {}) }).lean();
    if (cached) return cached;
    const { data } = await providerManager.execute<NormalizedArtist | null>(
      'music_metadata',
      { operation: 'music.getArtist', cacheKey: `music:artist:${id}` },
      async (provider) => {
        if (provider.providerId === 'itunes') return itunes.getArtist(id);
        if (provider.providerId === 'musicbrainz') return musicbrainz.getArtist(id);
        return deezer.getArtist(id);
      },
    );
    if (data) await upsertArtist(data);
    return data;
  },

  async getAlbum(id: string) {
    const cached = await MusicAlbum.findOne(isValidObjectId(id) ? { _id: id } : { providerId: id.includes(':') ? id.split(':').slice(1).join(':') : id, ...(id.includes(':') ? { source: id.split(':')[0] } : {}) }).lean();
    if (cached) return cached;
    const { data } = await providerManager.execute<NormalizedAlbum | null>(
      'music_metadata',
      { operation: 'music.getAlbum', cacheKey: `music:album:${id}` },
      async (provider) => {
        if (provider.providerId === 'itunes') return itunes.getAlbum(id);
        if (provider.providerId === 'musicbrainz') return musicbrainz.getAlbum(id);
        return deezer.getAlbum(id);
      },
    );
    if (data) await upsertAlbum(data);
    return data;
  },

  async trendingMusic(limit = 20) {
    const { data } = await providerManager.execute<NormalizedTrack[]>(
      'music_metadata',
      { operation: 'music.trending', cacheKey: `music:trending:${limit}` },
      async (provider) => {
        if (provider.providerId === 'itunes') return itunes.trending(limit);
        return deezer.trending(limit);
      },
      (r) => !isNonEmptyArray(r),
    );
    return Promise.all(data.map(upsertTrack));
  },

  async newReleases(limit = 20) {
    const { data } = await providerManager.execute<NormalizedTrack[]>(
      'music_metadata',
      { operation: 'music.newReleases', cacheKey: `music:new:${limit}` },
      async (provider) => {
        if (provider.providerId === 'itunes') return itunes.newReleases(limit);
        return deezer.newReleases(limit);
      },
      (r) => !isNonEmptyArray(r),
    );
    return Promise.all(data.map(upsertTrack));
  },

  async getLyrics(artist: string, title: string) {
    return lrclib.getLyrics(artist, title);
  },

  /* ── Anime ─────────────────────────────────────────────────────────── */
  async searchAnime(query: string, page = 1, perPage = 20) {
    const { data } = await providerManager.execute<{ items: NormalizedAnime[]; total: number }>(
      'anime_metadata',
      { operation: 'anime.search', cacheKey: `anime:search:${query.toLowerCase()}:${page}:${perPage}` },
      async (provider) => {
        if (provider.providerId === 'jikan') return jikan.search(query, page, perPage);
        return anilist.search(query, page, perPage);
      },
      (r) => !r || !isNonEmptyArray(r.items),
    );
    return { ...data, items: await Promise.all(data.items.map(upsertAnime)) };
  },

  async animeList(kind: 'trending' | 'popular' | 'topRated' | 'upcoming', page = 1, perPage = 20) {
    const { data } = await providerManager.execute<NormalizedAnime[]>(
      'anime_metadata',
      { operation: `anime.${kind}`, cacheKey: `anime:${kind}:${page}:${perPage}` },
      async (provider) => {
        const impl = provider.providerId === 'jikan' ? jikan : anilist;
        if (kind === 'trending') return impl.trending(page, perPage);
        if (kind === 'popular') return impl.popular(page, perPage);
        if (kind === 'topRated') return impl.topRated(page, perPage);
        return impl.upcoming(page, perPage);
      },
      (r) => !isNonEmptyArray(r),
    );
    return Promise.all(data.map(upsertAnime));
  },

  async seasonalAnime(year: number, season: string) {
    const { data } = await providerManager.execute<NormalizedAnime[]>(
      'anime_metadata',
      { operation: 'anime.seasonal', cacheKey: `anime:season:${year}:${season}` },
      async (provider) => (provider.providerId === 'jikan' ? jikan.seasonal(year, season) : anilist.seasonal(year, season)),
      (r) => !isNonEmptyArray(r),
    );
    return Promise.all(data.map(upsertAnime));
  },

  async getAnime(id: string) {
    const cached = await Anime.findOne(isValidObjectId(id) ? { _id: id } : { providerId: id.includes(':') ? id.split(':').slice(1).join(':') : id, ...(id.includes(':') ? { source: id.split(':')[0] } : {}) }).lean();
    if (cached) return cached;
    const { data } = await providerManager.execute<NormalizedAnime | null>(
      'anime_metadata',
      { operation: 'anime.getById', cacheKey: `anime:id:${id}` },
      async (provider) => (provider.providerId === 'jikan' ? jikan.getById(id) : anilist.getById(id)),
    );
    return data ? upsertAnime(data) : null;
  },

  async getEpisodes(animeId: string): Promise<NormalizedEpisode[]> {
    const anime = await Anime.findOne(isValidObjectId(animeId) ? { _id: animeId } : { providerId: animeId }).lean();
    if (anime) {
      const cached = await AnimeEpisode.find({ anime: anime._id }).sort({ number: 1 }).lean();
      if (cached.length > 0) return cached as unknown as NormalizedEpisode[];
    }
    const { data } = await providerManager.execute<NormalizedEpisode[]>(
      'anime_metadata',
      { operation: 'anime.episodes', cacheKey: `anime:episodes:${animeId}` },
      async (provider) => (provider.providerId === 'jikan' ? jikan.getEpisodes(anime?.providerId ?? animeId) : anilist.getEpisodes(anime?.providerId ?? animeId)),
      (r) => !isNonEmptyArray(r),
    );
    if (anime && data.length > 0) {
      await Promise.all(
        data.map((ep) =>
          AnimeEpisode.findOneAndUpdate(
            { anime: anime._id, number: ep.number },
            { $set: { ...ep, anime: anime._id } },
            { upsert: true, new: true },
          ),
        ),
      );
    }
    return data;
  },

  async relatedAnime(id: string) {
    const { data } = await providerManager.execute<NormalizedAnime[]>(
      'anime_metadata',
      { operation: 'anime.related', cacheKey: `anime:related:${id}` },
      async (provider) => (provider.providerId === 'jikan' ? jikan.related(id) : anilist.related(id)),
      (r) => !isNonEmptyArray(r),
    );
    return Promise.all(data.map(upsertAnime));
  },

  async randomAnime() {
    const { data } = await providerManager.execute<NormalizedAnime | null>(
      'anime_metadata',
      { operation: 'anime.random' },
      async (provider) => (provider.providerId === 'jikan' ? jikan.random() : anilist.random()),
    );
    return data ? upsertAnime(data) : null;
  },
};
