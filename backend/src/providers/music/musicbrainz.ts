import { fetchJson } from '../http';
import { MusicProvider, NormalizedAlbum, NormalizedArtist, NormalizedLyrics, NormalizedTrack } from './types';

/**
 * MusicBrainz API (public, no key; requires descriptive User-Agent —
 * already set in providers/http.ts).
 * Docs: https://musicbrainz.org/doc/MusicBrainz_API
 * Used for rich metadata: artist biographies, release groups, genres.
 * Does not provide audio streams.
 */
const BASE = 'https://musicbrainz.org/ws/2';

interface MbArtist {
  id: string;
  name: string;
  type?: string;
  'artist-credit'?: string;
  tags?: { name: string }[];
  annotation?: string;
}
interface MbReleaseGroup {
  id: string;
  'primary-type'?: string;
  'first-release-date'?: string;
  'artist-credit'?: { name: string }[];
  tags?: { name: string }[];
}
interface MbRecording {
  id: string;
  title: string;
  'first-release-date'?: string;
  'artist-credit'?: { name: string }[];
  tags?: { name: string }[];
}

const mapArtist = (a: MbArtist): NormalizedArtist => ({
  providerId: a.id,
  source: 'musicbrainz',
  name: a.name,
  imageUrl: '',
  biography: a.annotation ?? '',
  genres: (a.tags ?? []).map((t) => t.name),
  followers: 0,
  popularity: 0,
});

const mapAlbum = (r: MbReleaseGroup): NormalizedAlbum => ({
  providerId: r.id,
  source: 'musicbrainz',
  title: r['primary-type'] ?? 'Release',
  artistName: r['artist-credit']?.[0]?.name ?? '',
  artistProviderId: '',
  artworkUrl: '',
  trackCount: 0,
  releaseDate: r['first-release-date'],
  genres: (r.tags ?? []).map((t) => t.name),
  popularity: 0,
});

const mapTrack = (r: MbRecording): NormalizedTrack => ({
  providerId: r.id,
  source: 'musicbrainz',
  title: r.title,
  artistName: r['artist-credit']?.[0]?.name ?? '',
  artistProviderId: '',
  albumName: '',
  albumProviderId: '',
  artworkUrl: '',
  durationSec: 0,
  previewUrl: '',
  streamUrl: '',
  genres: (r.tags ?? []).map((t) => t.name),
  releaseDate: r['first-release-date'],
  explicit: false,
  popularity: 0,
  isrc: '',
});

export class MusicBrainzProvider implements MusicProvider {
  id = 'musicbrainz';
  name = 'MusicBrainz (public API)';

  async searchTracks(query: string, limit = 20): Promise<NormalizedTrack[]> {
    const data = await fetchJson<{ recordings: MbRecording[] }>(
      `${BASE}/recording/?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`,
    );
    return (data.recordings ?? []).map(mapTrack);
  }

  async searchArtists(query: string, limit = 20): Promise<NormalizedArtist[]> {
    const data = await fetchJson<{ artists: MbArtist[] }>(
      `${BASE}/artist/?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`,
    );
    return (data.artists ?? []).map(mapArtist);
  }

  async searchAlbums(query: string, limit = 20): Promise<NormalizedAlbum[]> {
    const data = await fetchJson<{ 'release-groups': MbReleaseGroup[] }>(
      `${BASE}/release-group/?query=${encodeURIComponent(query)}&fmt=json&limit=${limit}`,
    );
    return (data['release-groups'] ?? []).map(mapAlbum);
  }

  async getTrack(id: string): Promise<NormalizedTrack | null> {
    const data = await fetchJson<MbRecording>(`${BASE}/recording/${encodeURIComponent(id)}?fmt=json`);
    return data?.id ? mapTrack(data) : null;
  }

  async getArtist(id: string): Promise<NormalizedArtist | null> {
    const data = await fetchJson<MbArtist>(`${BASE}/artist/${encodeURIComponent(id)}?fmt=json`);
    return data?.id ? mapArtist(data) : null;
  }

  async getAlbum(id: string): Promise<NormalizedAlbum | null> {
    const data = await fetchJson<MbReleaseGroup>(`${BASE}/release-group/${encodeURIComponent(id)}?fmt=json`);
    return data?.id ? mapAlbum(data) : null;
  }

  async getLyrics(): Promise<NormalizedLyrics | null> {
    return null;
  }

  async trending(): Promise<NormalizedTrack[]> {
    return [];
  }

  async newReleases(): Promise<NormalizedTrack[]> {
    return [];
  }
}
