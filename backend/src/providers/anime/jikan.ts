import { fetchJson } from '../http';
import { AnimeProvider, NormalizedAnime, NormalizedEpisode } from './types';

/**
 * Jikan REST API (public, no key required; rate-limited ~3 req/s).
 * Docs: https://docs.jikan.moe/
 * Fallback metadata + schedule provider for AniList.
 * Does NOT host licensed streaming video.
 */
const BASE = 'https://api.jikan.moe/v4';

interface JikanAnime {
  mal_id: number;
  title?: string;
  title_english?: string;
  title_japanese?: string;
  synopsis?: string;
  images?: { jpg?: { large_image_url?: string } };
  genres?: { name: string }[];
  studios?: { name: string }[];
  season?: string;
  year?: number;
  status?: string;
  type?: string;
  episodes?: number;
  score?: number;
  popularity?: number;
  rating?: string;
  aired?: { from?: string };
  trailer?: { url?: string };
}

const mapAnime = (a: JikanAnime): NormalizedAnime => ({
  providerId: String(a.mal_id),
  source: 'jikan',
  title: a.title ?? '',
  titleEnglish: a.title_english ?? '',
  titleNative: a.title_japanese ?? '',
  synopsis: a.synopsis ?? '',
  posterUrl: a.images?.jpg?.large_image_url ?? '',
  bannerUrl: '',
  genres: (a.genres ?? []).map((g) => g.name),
  studio: a.studios?.[0]?.name ?? '',
  season: a.season ?? '',
  seasonYear: a.year,
  status: a.status ?? '',
  format: a.type ?? '',
  episodeCount: a.episodes ?? 0,
  rating: a.score ?? 0,
  popularity: a.popularity ?? 0,
  ageRating: a.rating ?? '',
  releaseDate: a.aired?.from,
  trailerUrl: a.trailer?.url ?? '',
});

export class JikanProvider implements AnimeProvider {
  id = 'jikan';
  name = 'Jikan (public REST API)';

  async search(query: string, page = 1, perPage = 20): Promise<{ items: NormalizedAnime[]; total: number }> {
    const data = await fetchJson<{ data: JikanAnime[]; pagination: { items: { total: number } } }>(
      `${BASE}/anime?q=${encodeURIComponent(query)}&page=${page}&limit=${perPage}&order_by=members&sort=desc`,
    );
    return { items: (data.data ?? []).map(mapAnime), total: data.pagination?.items?.total ?? 0 };
  }

  async trending(page = 1, perPage = 20): Promise<NormalizedAnime[]> {
    const data = await fetchJson<{ data: JikanAnime[] }>(
      `${BASE}/top/anime?page=${page}&limit=${perPage}&filter=bypopularity`,
    );
    return (data.data ?? []).map(mapAnime);
  }

  async popular(page = 1, perPage = 20): Promise<NormalizedAnime[]> {
    const data = await fetchJson<{ data: JikanAnime[] }>(
      `${BASE}/top/anime?page=${page}&limit=${perPage}&filter=bypopularity`,
    );
    return (data.data ?? []).map(mapAnime);
  }

  async topRated(page = 1, perPage = 20): Promise<NormalizedAnime[]> {
    const data = await fetchJson<{ data: JikanAnime[] }>(
      `${BASE}/top/anime?page=${page}&limit=${perPage}`,
    );
    return (data.data ?? []).map(mapAnime);
  }

  async seasonal(year: number, season: string): Promise<NormalizedAnime[]> {
    const data = await fetchJson<{ data: JikanAnime[] }>(`${BASE}/seasons/${year}/${season.toLowerCase()}`);
    return (data.data ?? []).map(mapAnime);
  }

  async upcoming(page = 1, perPage = 20): Promise<NormalizedAnime[]> {
    const data = await fetchJson<{ data: JikanAnime[] }>(
      `${BASE}/top/anime?page=${page}&limit=${perPage}&filter=upcoming`,
    );
    return (data.data ?? []).map(mapAnime);
  }

  async getById(id: string): Promise<NormalizedAnime | null> {
    const data = await fetchJson<{ data: JikanAnime }>(`${BASE}/anime/${encodeURIComponent(id)}`);
    return data.data ? mapAnime(data.data) : null;
  }

  async getEpisodes(id: string): Promise<NormalizedEpisode[]> {
    const data = await fetchJson<{ data: { episode: number; title?: string; aired?: string }[] }>(
      `${BASE}/anime/${encodeURIComponent(id)}/episodes?page=1`,
    );
    return (data.data ?? []).map((e) => ({
      providerEpisodeId: String(e.episode),
      number: e.episode,
      title: e.title ?? `Episode ${e.episode}`,
      thumbnailUrl: '',
      durationSec: 0,
      releaseDate: e.aired,
      streamUrl: '',
      subtitles: [],
    }));
  }

  async related(id: string): Promise<NormalizedAnime[]> {
    const data = await fetchJson<{ data: { entry: { mal_id: number } }[] }>(
      `${BASE}/anime/${encodeURIComponent(id)}/relations`,
    );
    const ids = (data.data ?? []).slice(0, 5).map((r) => r.entry?.mal_id).filter(Boolean);
    const out: NormalizedAnime[] = [];
    for (const rid of ids) {
      try {
        const one = await this.getById(String(rid));
        if (one) out.push(one);
      } catch {
        /* skip */
      }
    }
    return out;
  }

  async random(): Promise<NormalizedAnime | null> {
    const data = await fetchJson<{ data: JikanAnime }>(`${BASE}/random/anime`);
    return data.data ? mapAnime(data.data) : null;
  }
}
