import { env, hasLicensedAnime } from '../../config/env';
import { AnimeProvider, NormalizedAnime, NormalizedEpisode } from './types';

/**
 * Licensed anime streaming provider slot.
 *
 * Licensed anime video (with official subtitles, quality variants,
 * intro/skip metadata) requires a commercial streaming agreement.
 * This adapter is intentionally NOT a scraper and does NOT bypass
 * DRM, geo-restrictions, or paywalls.
 *
 * Status: NEEDS CREDENTIALS — set LICENSED_ANIME_API_KEY and
 * LICENSED_ANIME_BASE_URL in backend/.env once a licensed provider
 * agreement is in place. Until then, the app shows full metadata,
 * episode schedules, trailers, and watchlist/history tracking.
 */
export class LicensedAnimeProvider implements AnimeProvider {
  id = 'licensed_anime';
  name = 'Licensed Anime Streaming (needs credentials)';

  get configured(): boolean {
    return hasLicensedAnime;
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new Error(
        'Licensed anime streaming is not configured. Set LICENSED_ANIME_API_KEY and LICENSED_ANIME_BASE_URL.',
      );
    }
  }

  async search(): Promise<{ items: NormalizedAnime[]; total: number }> {
    this.assertConfigured();
    return { items: [], total: 0 };
  }

  async trending(): Promise<NormalizedAnime[]> {
    this.assertConfigured();
    return [];
  }

  async popular(): Promise<NormalizedAnime[]> {
    this.assertConfigured();
    return [];
  }

  async topRated(): Promise<NormalizedAnime[]> {
    this.assertConfigured();
    return [];
  }

  async seasonal(): Promise<NormalizedAnime[]> {
    this.assertConfigured();
    return [];
  }

  async upcoming(): Promise<NormalizedAnime[]> {
    this.assertConfigured();
    return [];
  }

  async getById(id: string): Promise<NormalizedAnime | null> {
    this.assertConfigured();
    void env.LICENSED_ANIME_BASE_URL;
    void id;
    return null;
  }

  async getEpisodes(): Promise<NormalizedEpisode[]> {
    this.assertConfigured();
    return [];
  }

  async related(): Promise<NormalizedAnime[]> {
    this.assertConfigured();
    return [];
  }

  async random(): Promise<NormalizedAnime | null> {
    this.assertConfigured();
    return null;
  }
}
