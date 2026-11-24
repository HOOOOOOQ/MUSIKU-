import { fetchJson } from '../http';
import { AnimeProvider, NormalizedAnime, NormalizedEpisode } from './types';

/**
 * AniList GraphQL API (public, no key required).
 * Docs: https://docs.anilist.co/
 * Rich metadata: titles, synopsis, genres, studios, seasons, ratings,
 * trailers. AniList does NOT host licensed streaming video — episode
 * stream URLs are only populated by a licensed provider.
 */
const ENDPOINT = 'https://graphql.anilist.co';

interface AniListMedia {
  id: number;
  title?: { romaji?: string; english?: string; native?: string };
  description?: string;
  coverImage?: { large?: string };
  bannerImage?: string;
  genres?: string[];
  studios?: { nodes?: { name?: string }[] };
  season?: string;
  seasonYear?: number;
  status?: string;
  format?: string;
  episodes?: number;
  averageScore?: number;
  popularity?: number;
  isAdult?: boolean;
  startDate?: { year?: number; month?: number; day?: number };
  nextAiringEpisode?: { airingAt?: number };
  trailer?: { url?: string };
}

const mapMedia = (m: AniListMedia): NormalizedAnime => ({
  providerId: String(m.id),
  source: 'anilist',
  title: m.title?.romaji ?? m.title?.english ?? '',
  titleEnglish: m.title?.english ?? '',
  titleNative: m.title?.native ?? '',
  synopsis: (m.description ?? '').replace(/<[^>]*>/g, ''),
  posterUrl: m.coverImage?.large ?? '',
  bannerUrl: m.bannerImage ?? '',
  genres: m.genres ?? [],
  studio: m.studios?.nodes?.[0]?.name ?? '',
  season: m.season ?? '',
  seasonYear: m.seasonYear,
  status: m.status ?? '',
  format: m.format ?? '',
  episodeCount: m.episodes ?? 0,
  rating: m.averageScore ? m.averageScore / 10 : 0,
  popularity: m.popularity ?? 0,
  ageRating: m.isAdult ? '18+' : '',
  releaseDate: m.startDate?.year
    ? `${m.startDate.year}-${String(m.startDate.month ?? 1).padStart(2, '0')}-${String(m.startDate.day ?? 1).padStart(2, '0')}`
    : undefined,
  nextAiringAt: m.nextAiringEpisode?.airingAt ? new Date(m.nextAiringEpisode.airingAt * 1000).toISOString() : undefined,
  trailerUrl: m.trailer?.url ?? '',
});

const MEDIA_FIELDS = `
  id title { romaji english native } description
  coverImage { large } bannerImage genres
  studios { nodes { name } }
  season seasonYear status format episodes averageScore popularity isAdult
  startDate { year month day }
  nextAiringEpisode { airingAt }
  trailer { url }
`;

async function gql<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const data = await fetchJson<{ data: T; errors?: { message: string }[] }>(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (data.errors?.length) throw new Error(`AniList error: ${data.errors[0].message}`);
  return data.data;
}

export class AniListProvider implements AnimeProvider {
  id = 'anilist';
  name = 'AniList (public GraphQL API)';

  async search(query: string, page = 1, perPage = 20): Promise<{ items: NormalizedAnime[]; total: number }> {
    const data = await gql<{ Page: { pageInfo: { total: number }; media: AniListMedia[] } }>(
      `query ($q: String, $page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          pageInfo { total }
          media(search: $q, type: ANIME, sort: SEARCH_MATCH) { ${MEDIA_FIELDS} }
        }
      }`,
      { q: query, page, perPage },
    );
    return { items: (data.Page.media ?? []).map(mapMedia), total: data.Page.pageInfo.total };
  }

  async trending(page = 1, perPage = 20): Promise<NormalizedAnime[]> {
    const data = await gql<{ Page: { media: AniListMedia[] } }>(
      `query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(type: ANIME, sort: TRENDING_DESC) { ${MEDIA_FIELDS} }
        }
      }`,
      { page, perPage },
    );
    return (data.Page.media ?? []).map(mapMedia);
  }

  async popular(page = 1, perPage = 20): Promise<NormalizedAnime[]> {
    const data = await gql<{ Page: { media: AniListMedia[] } }>(
      `query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(type: ANIME, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} }
        }
      }`,
      { page, perPage },
    );
    return (data.Page.media ?? []).map(mapMedia);
  }

  async topRated(page = 1, perPage = 20): Promise<NormalizedAnime[]> {
    const data = await gql<{ Page: { media: AniListMedia[] } }>(
      `query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(type: ANIME, sort: SCORE_DESC) { ${MEDIA_FIELDS} }
        }
      }`,
      { page, perPage },
    );
    return (data.Page.media ?? []).map(mapMedia);
  }

  async seasonal(year: number, season: string): Promise<NormalizedAnime[]> {
    const data = await gql<{ Page: { media: AniListMedia[] } }>(
      `query ($y: Int, $s: MediaSeason) {
        Page(page: 1, perPage: 50) {
          media(type: ANIME, season: $s, seasonYear: $y, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} }
        }
      }`,
      { y: year, s: season.toUpperCase() },
    );
    return (data.Page.media ?? []).map(mapMedia);
  }

  async upcoming(page = 1, perPage = 20): Promise<NormalizedAnime[]> {
    const data = await gql<{ Page: { media: AniListMedia[] } }>(
      `query ($page: Int, $perPage: Int) {
        Page(page: $page, perPage: $perPage) {
          media(type: ANIME, status: NOT_YET_RELEASED, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} }
        }
      }`,
      { page, perPage },
    );
    return (data.Page.media ?? []).map(mapMedia);
  }

  async getById(id: string): Promise<NormalizedAnime | null> {
    const data = await gql<{ Media: AniListMedia }>(
      `query ($id: Int) { Media(id: $id, type: ANIME) { ${MEDIA_FIELDS} } }`,
      { id: Number(id) },
    );
    return data.Media ? mapMedia(data.Media) : null;
  }

  async getEpisodes(id: string): Promise<NormalizedEpisode[]> {
    // AniList does not expose per-episode streaming metadata.
    // Episode lists are served by the licensed video provider when
    // configured; otherwise the app shows episode count + schedule.
    void id;
    return [];
  }

  async related(id: string): Promise<NormalizedAnime[]> {
    const data = await gql<{ Media: { relations?: { edges?: { node?: AniListMedia }[] } } }>(
      `query ($id: Int) {
        Media(id: $id, type: ANIME) {
          relations { edges { node { ${MEDIA_FIELDS} } } }
        }
      }`,
      { id: Number(id) },
    );
    const edges = data.Media?.relations?.edges ?? [];
    return edges.map((e) => e.node).filter((n): n is AniListMedia => Boolean(n)).map(mapMedia);
  }

  async random(): Promise<NormalizedAnime | null> {
    const data = await gql<{ Page: { media: AniListMedia[] } }>(
      `query { Page(page: 1, perPage: 1) { media(type: ANIME, sort: POPULARITY_DESC) { ${MEDIA_FIELDS} } } }`,
      {},
    );
    const first = data.Page.media?.[0];
    return first ? mapMedia(first) : null;
  }
}
