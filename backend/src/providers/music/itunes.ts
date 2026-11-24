import { fetchJson } from '../http';
import { MusicProvider, NormalizedAlbum, NormalizedArtist, NormalizedLyrics, NormalizedTrack } from './types';

/**
 * iTunes Search API (public, no key required).
 * Docs: https://developer.apple.com/documentation/itunes-store-web-service/search-api
 * Provides 30-second preview streams (`previewUrl`) officially exposed
 * by Apple for embedding. Artwork URLs are upgraded from 100x100 to
 * 600x600 by rewriting the size suffix.
 */
const BASE = 'https://itunes.apple.com/search';

interface ItunesResult {
  trackId?: number;
  artistId?: number;
  collectionId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  artworkUrl100?: string;
  trackTimeMillis?: number;
  previewUrl?: string;
  primaryGenreName?: string;
  releaseDate?: string;
  trackExplicitness?: string;
  trackNumber?: number;
  trackCount?: number;
}

const upgradeArtwork = (url?: string): string => (url ? url.replace('100x100bb.jpg', '600x600bb.jpg') : '');

const mapTrack = (t: ItunesResult): NormalizedTrack => ({
  providerId: String(t.trackId ?? ''),
  source: 'itunes',
  title: t.trackName ?? '',
  artistName: t.artistName ?? '',
  artistProviderId: String(t.artistId ?? ''),
  albumName: t.collectionName ?? '',
  albumProviderId: String(t.collectionId ?? ''),
  artworkUrl: upgradeArtwork(t.artworkUrl100),
  durationSec: Math.round((t.trackTimeMillis ?? 0) / 1000),
  previewUrl: t.previewUrl ?? '',
  streamUrl: t.previewUrl ?? '',
  genres: t.primaryGenreName ? [t.primaryGenreName] : [],
  releaseDate: t.releaseDate,
  explicit: t.trackExplicitness === 'explicit',
  popularity: 0,
  isrc: '',
});

const mapArtist = (a: ItunesResult): NormalizedArtist => ({
  providerId: String(a.artistId ?? ''),
  source: 'itunes',
  name: a.artistName ?? '',
  imageUrl: upgradeArtwork(a.artworkUrl100),
  biography: '',
  genres: a.primaryGenreName ? [a.primaryGenreName] : [],
  followers: 0,
  popularity: 0,
});

const mapAlbum = (a: ItunesResult): NormalizedAlbum => ({
  providerId: String(a.collectionId ?? ''),
  source: 'itunes',
  title: a.collectionName ?? '',
  artistName: a.artistName ?? '',
  artistProviderId: String(a.artistId ?? ''),
  artworkUrl: upgradeArtwork(a.artworkUrl100),
  trackCount: a.trackCount ?? 0,
  releaseDate: a.releaseDate,
  genres: a.primaryGenreName ? [a.primaryGenreName] : [],
  popularity: 0,
});

export class ItunesProvider implements MusicProvider {
  id = 'itunes';
  name = 'iTunes Search API (public)';

  private async search(query: string, entity: string, limit: number): Promise<ItunesResult[]> {
    const data = await fetchJson<{ results: ItunesResult[] }>(
      `${BASE}?term=${encodeURIComponent(query)}&entity=${entity}&limit=${limit}&country=ID`,
    );
    return data.results ?? [];
  }

  async searchTracks(query: string, limit = 20): Promise<NormalizedTrack[]> {
    return (await this.search(query, 'song', limit)).map(mapTrack);
  }

  async searchArtists(query: string, limit = 20): Promise<NormalizedArtist[]> {
    return (await this.search(query, 'musicArtist', limit)).map(mapArtist);
  }

  async searchAlbums(query: string, limit = 20): Promise<NormalizedAlbum[]> {
    return (await this.search(query, 'album', limit)).map(mapAlbum);
  }

  async getTrack(id: string): Promise<NormalizedTrack | null> {
    const data = await fetchJson<{ results: ItunesResult[] }>(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=song`,
    );
    const first = data.results?.[0];
    return first ? mapTrack(first) : null;
  }

  async getArtist(id: string): Promise<NormalizedArtist | null> {
    const data = await fetchJson<{ results: ItunesResult[] }>(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=musicArtist`,
    );
    const first = data.results?.[0];
    return first ? mapArtist(first) : null;
  }

  async getAlbum(id: string): Promise<NormalizedAlbum | null> {
    const data = await fetchJson<{ results: ItunesResult[] }>(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(id)}&entity=album`,
    );
    const first = data.results?.[0];
    return first ? mapAlbum(first) : null;
  }

  async getLyrics(): Promise<NormalizedLyrics | null> {
    return null;
  }

  async trending(limit = 20): Promise<NormalizedTrack[]> {
    // iTunes has no chart endpoint; fall back to a broad popular query.
    return this.searchTracks('top hits', limit);
  }

  async newReleases(limit = 20): Promise<NormalizedTrack[]> {
    return this.searchTracks('new music', limit);
  }
}
