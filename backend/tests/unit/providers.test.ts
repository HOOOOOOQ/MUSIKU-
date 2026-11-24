import { DeezerProvider } from '../../src/providers/music/deezer';
import { ItunesProvider } from '../../src/providers/music/itunes';
import { LrclibProvider } from '../../src/providers/music/lrclib';
import { AniListProvider } from '../../src/providers/anime/anilist';
import { JikanProvider } from '../../src/providers/anime/jikan';
import { LicensedMusicProvider } from '../../src/providers/music/licensedMusic';
import { LicensedAnimeProvider } from '../../src/providers/anime/licensedAnime';

const mockFetch = jest.fn();
(global as unknown as { fetch: unknown }).fetch = mockFetch;

const jsonResponse = (payload: unknown) => ({ ok: true, status: 200, json: async () => payload });

describe('Deezer provider', () => {
  beforeEach(() => mockFetch.mockReset());

  it('maps search results to normalized tracks', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      data: [{
        id: 3135556, title: 'Test Song', duration: 200, rank: 900000, preview: 'https://cdn.example/preview.mp3',
        artist: { id: 27, name: 'Test Artist' }, album: { id: 302127, title: 'Test Album', cover_medium: 'https://img.example/cover.jpg' },
      }],
    }));
    const tracks = await new DeezerProvider().searchTracks('test song');
    expect(tracks).toHaveLength(1);
    expect(tracks[0]).toMatchObject({
      providerId: '3135556', source: 'deezer', title: 'Test Song', artistName: 'Test Artist',
      previewUrl: 'https://cdn.example/preview.mp3', durationSec: 200,
    });
  });

  it('returns empty array on empty provider response', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ data: [] }));
    await expect(new DeezerProvider().searchTracks('nothing')).resolves.toEqual([]);
  });
});

describe('iTunes provider', () => {
  beforeEach(() => mockFetch.mockReset());

  it('upgrades artwork to 600x600', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      results: [{
        trackId: 123, artistId: 456, collectionId: 789, trackName: 'Song', artistName: 'Artist',
        collectionName: 'Album', artworkUrl100: 'https://img.example/100x100bb.jpg',
        trackTimeMillis: 180000, previewUrl: 'https://preview.example/song.m4a', primaryGenreName: 'Pop',
      }],
    }));
    const tracks = await new ItunesProvider().searchTracks('song');
    expect(tracks[0].artworkUrl).toBe('https://img.example/600x600bb.jpg');
    expect(tracks[0].source).toBe('itunes');
  });
});

describe('LRCLIB provider', () => {
  beforeEach(() => mockFetch.mockReset());

  it('returns synced lyrics when available', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ plainLyrics: 'la la', syncedLyrics: '[00:01.00] la la' }));
    const lyrics = await new LrclibProvider().getLyrics('Artist', 'Song');
    expect(lyrics?.synced).toContain('[00:01.00]');
  });

  it('returns null on provider error', async () => {
    mockFetch.mockRejectedValue(new Error('404'));
    await expect(new LrclibProvider().getLyrics('A', 'B')).resolves.toBeNull();
  });
});

describe('AniList provider', () => {
  beforeEach(() => mockFetch.mockReset());

  it('maps GraphQL media to normalized anime', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      data: {
        Page: {
          pageInfo: { total: 1 },
          media: [{
            id: 1, title: { romaji: 'Cowboy Bebop', english: 'Cowboy Bebop', native: 'カウボーイビバップ' },
            description: 'Space <b>western</b>', coverImage: { large: 'https://img.example/poster.jpg' },
            genres: ['Action', 'Sci-Fi'], studios: { nodes: [{ name: 'Sunrise' }] },
            season: 'SPRING', seasonYear: 1998, status: 'FINISHED', format: 'TV', episodes: 26,
            averageScore: 86, popularity: 200000,
          }],
        },
      },
    }));
    const result = await new AniListProvider().search('bebop');
    expect(result.total).toBe(1);
    expect(result.items[0]).toMatchObject({
      providerId: '1', source: 'anilist', title: 'Cowboy Bebop', studio: 'Sunrise',
      episodeCount: 26, rating: 8.6, synopsis: 'Space western',
    });
  });
});

describe('Jikan provider', () => {
  beforeEach(() => mockFetch.mockReset());

  it('maps REST anime to normalized anime', async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({
      data: [{
        mal_id: 1, title: 'Cowboy Bebop', title_english: 'Cowboy Bebop', synopsis: 'Bounty hunters',
        images: { jpg: { large_image_url: 'https://img.example/poster.jpg' } },
        genres: [{ name: 'Action' }], studios: [{ name: 'Sunrise' }], episodes: 26, score: 8.9,
      }],
      pagination: { items: { total: 1 } },
    }));
    const result = await new JikanProvider().search('bebop');
    expect(result.items[0].source).toBe('jikan');
    expect(result.items[0].rating).toBe(8.9);
  });
});

describe('Licensed providers (needs credentials)', () => {
  it('licensed music provider refuses without credentials', async () => {
    await expect(new LicensedMusicProvider().searchTracks()).rejects.toThrow(/not configured/);
  });

  it('licensed anime provider refuses without credentials', async () => {
    await expect(new LicensedAnimeProvider().search()).rejects.toThrow(/not configured/);
  });
});
