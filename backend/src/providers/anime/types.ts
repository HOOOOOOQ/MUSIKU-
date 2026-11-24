/** Normalized anime types shared by all anime providers. */

export interface NormalizedAnime {
  providerId: string;
  source: string;
  title: string;
  titleEnglish: string;
  titleNative: string;
  synopsis: string;
  posterUrl: string;
  bannerUrl: string;
  genres: string[];
  studio: string;
  season: string;
  seasonYear?: number;
  status: string;
  format: string;
  episodeCount: number;
  rating: number;
  popularity: number;
  ageRating: string;
  releaseDate?: string;
  nextAiringAt?: string;
  trailerUrl: string;
}

export interface NormalizedEpisode {
  providerEpisodeId: string;
  number: number;
  title: string;
  thumbnailUrl: string;
  durationSec: number;
  releaseDate?: string;
  streamUrl: string;
  subtitles: { language: string; url: string }[];
  introStartSec?: number;
  introEndSec?: number;
}

export interface AnimeProvider {
  id: string;
  name: string;
  search(query: string, page?: number, perPage?: number): Promise<{ items: NormalizedAnime[]; total: number }>;
  trending(page?: number, perPage?: number): Promise<NormalizedAnime[]>;
  popular(page?: number, perPage?: number): Promise<NormalizedAnime[]>;
  topRated(page?: number, perPage?: number): Promise<NormalizedAnime[]>;
  seasonal(year: number, season: string): Promise<NormalizedAnime[]>;
  upcoming(page?: number, perPage?: number): Promise<NormalizedAnime[]>;
  getById(id: string): Promise<NormalizedAnime | null>;
  getEpisodes(id: string): Promise<NormalizedEpisode[]>;
  related(id: string): Promise<NormalizedAnime[]>;
  random(): Promise<NormalizedAnime | null>;
}
