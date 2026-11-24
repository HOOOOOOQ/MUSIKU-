/** Normalized music types shared by all music providers. */

export interface NormalizedTrack {
  providerId: string;
  source: string;
  title: string;
  artistName: string;
  artistProviderId: string;
  albumName: string;
  albumProviderId: string;
  artworkUrl: string;
  durationSec: number;
  previewUrl: string;
  streamUrl: string;
  genres: string[];
  releaseDate?: string;
  explicit: boolean;
  popularity: number;
  isrc: string;
}

export interface NormalizedArtist {
  providerId: string;
  source: string;
  name: string;
  imageUrl: string;
  biography: string;
  genres: string[];
  followers: number;
  popularity: number;
}

export interface NormalizedAlbum {
  providerId: string;
  source: string;
  title: string;
  artistName: string;
  artistProviderId: string;
  artworkUrl: string;
  trackCount: number;
  releaseDate?: string;
  genres: string[];
  popularity: number;
}

export interface NormalizedLyrics {
  plain: string;
  synced?: string;
  language?: string;
}

export interface MusicProvider {
  id: string;
  name: string;
  searchTracks(query: string, limit?: number): Promise<NormalizedTrack[]>;
  searchArtists(query: string, limit?: number): Promise<NormalizedArtist[]>;
  searchAlbums(query: string, limit?: number): Promise<NormalizedAlbum[]>;
  getTrack(id: string): Promise<NormalizedTrack | null>;
  getArtist(id: string): Promise<NormalizedArtist | null>;
  getAlbum(id: string): Promise<NormalizedAlbum | null>;
  getLyrics(artist: string, title: string): Promise<NormalizedLyrics | null>;
  trending(limit?: number): Promise<NormalizedTrack[]>;
  newReleases(limit?: number): Promise<NormalizedTrack[]>;
}
