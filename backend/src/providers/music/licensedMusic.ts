import { env, hasLicensedMusic } from '../../config/env';
import { MusicProvider, NormalizedAlbum, NormalizedArtist, NormalizedLyrics, NormalizedTrack } from './types';

/**
 * Licensed full-track music streaming provider slot.
 *
 * Full-track streaming requires a commercial license (e.g. a licensed
 * music API / label agreement). This adapter is intentionally NOT a
 * scraper and does NOT bypass any DRM or paywall.
 *
 * Status: NEEDS CREDENTIALS — set LICENSED_MUSIC_API_KEY and
 * LICENSED_MUSIC_BASE_URL in backend/.env once a licensed provider
 * agreement is in place. Until then, the app plays the officially
 * exposed 30-second previews from Deezer/iTunes.
 */
export class LicensedMusicProvider implements MusicProvider {
  id = 'licensed_music';
  name = 'Licensed Music Streaming (needs credentials)';

  get configured(): boolean {
    return hasLicensedMusic;
  }

  private assertConfigured(): void {
    if (!this.configured) {
      throw new Error(
        'Licensed music streaming is not configured. Set LICENSED_MUSIC_API_KEY and LICENSED_MUSIC_BASE_URL.',
      );
    }
  }

  async searchTracks(): Promise<NormalizedTrack[]> {
    this.assertConfigured();
    // Implement against the licensed provider's official API here.
    return [];
  }

  async searchArtists(): Promise<NormalizedArtist[]> {
    this.assertConfigured();
    return [];
  }

  async searchAlbums(): Promise<NormalizedAlbum[]> {
    this.assertConfigured();
    return [];
  }

  async getTrack(id: string): Promise<NormalizedTrack | null> {
    this.assertConfigured();
    void env.LICENSED_MUSIC_BASE_URL;
    void id;
    return null;
  }

  async getArtist(): Promise<NormalizedArtist | null> {
    this.assertConfigured();
    return null;
  }

  async getAlbum(): Promise<NormalizedAlbum | null> {
    this.assertConfigured();
    return null;
  }

  async getLyrics(): Promise<NormalizedLyrics | null> {
    return null;
  }

  async trending(): Promise<NormalizedTrack[]> {
    this.assertConfigured();
    return [];
  }

  async newReleases(): Promise<NormalizedTrack[]> {
    this.assertConfigured();
    return [];
  }
}
