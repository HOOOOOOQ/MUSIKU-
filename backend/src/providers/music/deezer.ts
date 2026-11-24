import { fetchJson } from '../http';
import { MusicProvider, NormalizedAlbum, NormalizedArtist, NormalizedLyrics, NormalizedTrack } from './types';

/**
 * Deezer public API (no key required for search/preview endpoints).
 * Docs: https://developers.deezer.com/api
 * Provides 30-second preview streams (`preview`) — officially exposed
 * by Deezer for embedding. Full-track streaming requires a licensed
 * provider (see licensedMusic.ts).
 */
const BASE = 'https://api.deezer.com';

interface DeezerTrack {
  id: number;
  title: string;
  duration: number;
  rank: number;
  explicit_lyrics?: boolean;
  isrc?: string;
  preview: string;
  release_date?: string;
  artist: { id: number; name: string; picture_medium?: string };
  album: { id: number; title: string; cover_medium?: string };
}
interface DeezerArtist {
  id: number;
  name: string;
  nb_fan?: number;
  picture_medium?: string;
}
interface DeezerAlbum {
  id: number;
  title: string;
  nb_tracks?: number;
  release_date?: string;
  cover_medium?: string;
  artist: { id: number; name: string };
}

const mapTrack = (t: DeezerTrack): NormalizedTrack => ({
  providerId: String(t.id),
  source: 'deezer',
  title: t.title,
  artistName: t.artist?.name ?? '',
  artistProviderId: String(t.artist?.id ?? ''),
  albumName: t.album?.title ?? '',
  albumProviderId: String(t.album?.id ?? ''),
  artworkUrl: t.album?.cover_medium ?? '',
  durationSec: t.duration ?? 0,
  previewUrl: t.preview ?? '',
  streamUrl: t.preview ?? '',
  genres: [],
  releaseDate: t.release_date,
  explicit: Boolean(t.explicit_lyrics),
  popularity: t.rank ?? 0,
  isrc: t.isrc ?? '',
});

const mapArtist = (a: DeezerArtist): NormalizedArtist => ({
  providerId: String(a.id),
  source: 'deezer',
  name: a.name,
  imageUrl: a.picture_medium ?? '',
  biography: '',
  genres: [],
  followers: a.nb_fan ?? 0,
  popularity: 0,
});

const mapAlbum = (a: DeezerAlbum): NormalizedAlbum => ({
  providerId: String(a.id),
  source: 'deezer',
  title: a.title,
  artistName: a.artist?.name ?? '',
  artistProviderId: String(a.artist?.id ?? ''),
  artworkUrl: a.cover_medium ?? '',
  trackCount: a.nb_tracks ?? 0,
  releaseDate: a.release_date,
  genres: [],
  popularity: 0,
});

export class DeezerProvider implements MusicProvider {
  id = 'deezer';
  name = 'Deezer (public API)';

  async searchTracks(query: string, limit = 20): Promise<NormalizedTrack[]> {
    const data = await fetchJson<{ data: DeezerTrack[] }>(
      `${BASE}/search?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
    return (data.data ?? []).map(mapTrack);
  }

  async searchArtists(query: string, limit = 20): Promise<NormalizedArtist[]> {
    const data = await fetchJson<{ data: DeezerArtist[] }>(
      `${BASE}/search/artist?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
    return (data.data ?? []).map(mapArtist);
  }

  async searchAlbums(query: string, limit = 20): Promise<NormalizedAlbum[]> {
    const data = await fetchJson<{ data: DeezerAlbum[] }>(
      `${BASE}/search/album?q=${encodeURIComponent(query)}&limit=${limit}`,
    );
    return (data.data ?? []).map(mapAlbum);
  }

  async getTrack(id: string): Promise<NormalizedTrack | null> {
    const data = await fetchJson<DeezerTrack>(`${BASE}/track/${encodeURIComponent(id)}`);
    return data?.id ? mapTrack(data) : null;
  }

  async getArtist(id: string): Promise<NormalizedArtist | null> {
    const data = await fetchJson<DeezerArtist>(`${BASE}/artist/${encodeURIComponent(id)}`);
    return data?.id ? mapArtist(data) : null;
  }

  async getAlbum(id: string): Promise<NormalizedAlbum | null> {
    const data = await fetchJson<DeezerAlbum>(`${BASE}/album/${encodeURIComponent(id)}`);
    return data?.id ? mapAlbum(data) : null;
  }

  async getLyrics(): Promise<NormalizedLyrics | null> {
    return null; // Deezer public API does not expose lyrics; LRCLIB handles this.
  }

  async trending(limit = 20): Promise<NormalizedTrack[]> {
    const data = await fetchJson<{ data: DeezerTrack[] }>(`${BASE}/chart/0/tracks?limit=${limit}`);
    return (data.data ?? []).map(mapTrack);
  }

  async newReleases(limit = 20): Promise<NormalizedTrack[]> {
    const data = await fetchJson<{ data: DeezerAlbum[] }>(`${BASE}/chart/0/albums?limit=${limit}`);
    const albums = data.data ?? [];
    const tracks: NormalizedTrack[] = [];
    for (const album of albums.slice(0, Math.min(5, albums.length))) {
      try {
        const detail = await fetchJson<{ data: DeezerTrack[] }>(`${BASE}/album/${album.id}/tracks?limit=4`);
        tracks.push(...(detail.data ?? []).map(mapTrack));
      } catch {
        /* skip failed album */
      }
      if (tracks.length >= limit) break;
    }
    return tracks.slice(0, limit);
  }
}
