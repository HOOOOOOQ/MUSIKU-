import { fetchJson } from '../http';
import { NormalizedLyrics } from './types';

/**
 * LRCLIB — free lyrics API (no key required).
 * Docs: https://lrclib.net/docs
 * Returns plain + synchronized (LRC) lyrics when available.
 */
interface LrclibResponse {
  plainLyrics?: string;
  syncedLyrics?: string;
  instrumental?: boolean;
}

export class LrclibProvider {
  id = 'lrclib';
  name = 'LRCLIB (public API)';

  async getLyrics(artist: string, title: string): Promise<NormalizedLyrics | null> {
    try {
      const data = await fetchJson<LrclibResponse>(
        `https://lrclib.net/api/get?artist_name=${encodeURIComponent(artist)}&track_name=${encodeURIComponent(title)}`,
      );
      if (!data || (!data.plainLyrics && !data.syncedLyrics)) return null;
      return {
        plain: data.plainLyrics ?? '',
        synced: data.syncedLyrics,
        language: undefined,
      };
    } catch {
      return null;
    }
  }
}
