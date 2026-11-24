/**
 * Animeku / Animasu response normalization.
 *
 * The Animasu payload is a third-party shape the backend does not control:
 * `rating` may be null, `type` may be `""`, `latestEpisode` may be `"??"`,
 * `schedule` may be an object keyed by day or a flat array, and episode numbers
 * may be missing, wrong or descending. These tests pin the normalized contract
 * that the REST layer and Flutter rely on — no network, no database.
 */
import {
  animeListQuerySchema,
  animeSearchQuerySchema,
  canonicalAnimeType,
  normalizeAnimasuDetails,
  normalizeAnimasuEpisodes,
  normalizeAnimasuList,
  normalizeAnimasuSchedule,
  normalizeAnimasuStream,
  normalizeGenres,
  normalizeInfo,
  normalizeRating,
  parseEpisodeNumber,
  providerTargetSchema,
} from '../../src/validators/anime.validator';

const envelope = (data: unknown) => ({ success: true, status: 200, data });

describe('Animasu list normalization', () => {
  it('coerces null rating, empty type and "??" latestEpisode into stable values', () => {
    const page = normalizeAnimasuList(
      envelope({
        page: 2,
        total: 41,
        animeList: [
          { title: 'Jujutsu Kaisen', link: '/anime/jujutsu-kaisen', image: 'https://img.example/a.jpg', latestEpisode: '??', type: '', rating: null },
          { title: 'Frieren', link: '/anime/frieren', image: 'https://img.example/b.jpg', latestEpisode: 'Episode 12', type: 'TV', rating: '8,75' },
        ],
      }),
      'ongoing',
      2,
    );
    expect(page.kind).toBe('ongoing');
    expect(page.page).toBe(2);
    expect(page.total).toBe(41);
    expect(page.items).toHaveLength(2);
    expect(page.items[0]).toMatchObject({
      title: 'Jujutsu Kaisen',
      link: '/anime/jujutsu-kaisen',
      type: '',
      rawType: '',
      rating: 0,
      latestEpisode: { text: '', number: null },
    });
    expect(page.items[1]).toMatchObject({ type: 'TV', rating: 8.75, latestEpisode: { text: 'Episode 12', number: 12 } });
  });

  it('accepts the alternative `results` key and a bare array payload', () => {
    const fromResults = normalizeAnimasuList(envelope({ results: [{ title: 'A', link: '/a' }] }), 'search', 1);
    expect(fromResults.items).toHaveLength(1);
    expect(fromResults.total).toBe(1);

    const fromArray = normalizeAnimasuList(envelope([{ title: 'B', link: '/b' }]), 'popular', 1);
    expect(fromArray.items.map((item) => item.link)).toEqual(['/b']);
  });

  it('drops entries without a link or title and de-duplicates by link', () => {
    const page = normalizeAnimasuList(
      envelope({ animeList: [{ title: 'No link' }, { link: '/only-link' }, { title: 'Dup', link: '/dup' }, { title: 'Dup again', link: '/dup' }] }),
      'popular',
      1,
    );
    expect(page.items.map((item) => item.link)).toEqual(['/dup']);
  });

  it('never throws on a malformed or missing envelope', () => {
    for (const bad of [null, undefined, {}, 'text', 42, { data: null }, { data: { animeList: 'nope' } }]) {
      const page = normalizeAnimasuList(bad, 'completed', 3);
      expect(page.items).toEqual([]);
      expect(page.page).toBe(3);
      expect(page.total).toBe(0);
    }
  });

  it('maps unknown provider type vocabulary to "Other" while keeping the raw text', () => {
    const page = normalizeAnimasuList(envelope({ animeList: [{ title: 'Odd', link: '/odd', type: 'Web Anime' }] }), 'popular', 1);
    expect(page.items[0].type).toBe('Other');
    expect(page.items[0].rawType).toBe('Web Anime');
  });
});

describe('Animasu schedule normalization', () => {
  it('handles the nested object shape keyed by day, including the "All" bucket', () => {
    const schedule = normalizeAnimasuSchedule(
      envelope({
        totalDays: 7,
        schedule: {
          All: [{ title: 'Frieren', link: '/frieren', type: 'TV', latestEpisode: 'Episode 10', rating: 9 }],
          Senin: [{ title: 'One Piece', link: '/one-piece', type: 'TV', latestEpisode: '??', rating: null }],
          Tuesday: [{ title: 'Solo Leveling', link: '/solo-leveling', type: 'TV', latestEpisode: 'Episode 3' }],
        },
      }),
    );
    expect(schedule.shape).toBe('object');
    expect(schedule.totalDays).toBe(7);
    expect(schedule.days.map((day) => day.key)).toEqual(['all', 'senin', 'tuesday']);
    expect(schedule.days.map((day) => day.label)).toEqual(['Semua', 'Senin', 'Selasa']);
    expect(schedule.days[1].items[0].latestEpisode).toEqual({ text: '', number: null });
    expect(schedule.days[1].items[0].rating).toBe(0);
  });

  it('handles a flat array payload as a single "all" bucket', () => {
    const schedule = normalizeAnimasuSchedule(envelope({ schedule: [{ title: 'A', link: '/a' }] }));
    expect(schedule.shape).toBe('array');
    expect(schedule.days).toHaveLength(1);
    expect(schedule.days[0].key).toBe('all');
    expect(schedule.totalDays).toBe(1);
  });

  it('reports an empty schedule instead of inventing days', () => {
    expect(normalizeAnimasuSchedule(envelope({ schedule: {} })).shape).toBe('object');
    expect(normalizeAnimasuSchedule(envelope({})).shape).toBe('empty');
    expect(normalizeAnimasuSchedule(envelope({})).days).toEqual([]);
    expect(normalizeAnimasuSchedule(null).totalDays).toBe(0);
  });
});

describe('Animasu episode numbering (the provider `episode` field is not trusted)', () => {
  const episode = (label: string, url: string, title = '') => ({ episode: label, title, episodeUrl: url, date: '2026-01-05' });

  it('derives numbers from the episode field and flips a descending payload', () => {
    const list = normalizeAnimasuEpisodes([
      episode('Episode 3', '/ep/3'),
      episode('Episode 2', '/ep/2'),
      episode('Episode 1', '/ep/1'),
    ]);
    expect(list.numberSource).toBe('episode');
    expect(list.reversed).toBe(true);
    expect(list.items.map((item) => item.number)).toEqual([1, 2, 3]);
    expect(list.items.map((item) => item.episodeUrl)).toEqual(['/ep/1', '/ep/2', '/ep/3']);
  });

  it('falls back to the title when the episode field carries no number', () => {
    const list = normalizeAnimasuEpisodes([
      episode('??', '/ep/a', 'Jujutsu Kaisen Episode 1'),
      episode('??', '/ep/b', 'Jujutsu Kaisen Episode 2'),
    ]);
    expect(list.numberSource).toBe('title');
    expect(list.items.map((item) => item.number)).toEqual([1, 2]);
    expect(list.items[0].label).toBe('??');
  });

  it('falls back to the array index and synthesizes a display label', () => {
    const list = normalizeAnimasuEpisodes([
      episode('Sub Indo', '/ep/1'),
      episode('Sub Indo', '/ep/2'),
      episode('Sub Indo', '/ep/3'),
    ]);
    expect(list.numberSource).toBe('index');
    expect(list.items.map((item) => item.number)).toEqual([1, 2, 3]);
    expect(list.items[0].label).toBe('Sub Indo');
  });

  it('de-duplicates repeated episode URLs and ignores entries without one', () => {
    const list = normalizeAnimasuEpisodes([episode('Episode 1', '/ep/1'), episode('Episode 1 (mirror)', '/ep/1'), { episode: 'Episode 2' }]);
    expect(list.items).toHaveLength(1);
    expect(list.items[0].number).toBe(1);
  });

  it('keeps an already ascending list untouched', () => {
    const list = normalizeAnimasuEpisodes([episode('Episode 1', '/ep/1'), episode('Episode 2', '/ep/2'), episode('Episode 3', '/ep/3')]);
    expect(list.reversed).toBe(false);
    expect(list.items.map((item) => item.number)).toEqual([1, 2, 3]);
  });

  it('tolerates a non-array payload', () => {
    expect(normalizeAnimasuEpisodes(undefined).items).toEqual([]);
    expect(normalizeAnimasuEpisodes('Episode 1').items).toEqual([]);
  });
});

describe('Animasu details normalization', () => {
  it('is null-safe for every optional field', () => {
    const details = normalizeAnimasuDetails(envelope({ title: 'Frieren' }));
    expect(details).toMatchObject({ title: 'Frieren', image: '', synopsis: '', rating: 0, totalEpisodes: 0, genres: [] });
    expect(details.info).toEqual({});
    expect(details.episodes.items).toEqual([]);
  });

  it('parses info from an object or a "Key: Value" string and accepts `synopsis` or `sinopsis`', () => {
    const objectInfo = normalizeAnimasuDetails(
      envelope({ title: 'A', info: { Type: 'TV', Studio: ['MAPPA', 'Toho'], Status: 'Ongoing', Rating: null }, synopsis: 'English key' }),
    );
    expect(objectInfo.info).toEqual({ Type: 'TV', Studio: 'MAPPA, Toho', Status: 'Ongoing' });
    expect(objectInfo.synopsis).toBe('English key');

    const stringInfo = normalizeAnimasuDetails(envelope({ title: 'B', info: 'Type: Movie\nStudio: Ghibli\nNoise line', sinopsis: 'Indonesian key' }));
    expect(stringInfo.info).toEqual({ Type: 'Movie', Studio: 'Ghibli' });
    expect(stringInfo.synopsis).toBe('Indonesian key');
  });

  it('normalizes genres from an array of strings, objects or a delimited string', () => {
    expect(normalizeGenres(['Action', ' Drama '])).toEqual(['Action', 'Drama']);
    expect(normalizeGenres([{ name: 'Action' }, { genre: 'Fantasy' }])).toEqual(['Action', 'Fantasy']);
    expect(normalizeGenres('Action, Fantasy; Drama')).toEqual(['Action', 'Fantasy', 'Drama']);
    expect(normalizeGenres(null)).toEqual([]);
  });

  it('counts episodes from the episode list when totalEpisodes is missing or zero', () => {
    const details = normalizeAnimasuDetails(
      envelope({ title: 'C', totalEpisodes: 0, episodes: [{ episode: 'Episode 1', episodeUrl: '/ep/1' }, { episode: 'Episode 2', episodeUrl: '/ep/2' }] }),
    );
    expect(details.totalEpisodes).toBe(2);
    expect(details.episodes.items.map((item) => item.number)).toEqual([1, 2]);
  });

  it('prefers an explicit totalEpisodes when the provider supplies one', () => {
    const details = normalizeAnimasuDetails(envelope({ title: 'D', totalEpisodes: '24', episodes: [{ episode: 'Episode 1', episodeUrl: '/ep/1' }] }));
    expect(details.totalEpisodes).toBe(24);
  });
});

describe('Animasu stream normalization', () => {
  it('reads streamUrl, alternativeLinks (string or object entries) and episodeInfo', () => {
    const stream = normalizeAnimasuStream(
      envelope({
        streamUrl: 'https://cdn.example/video.m3u8',
        alternativeLinks: [{ url: 'https://mirror.example/a.m3u8' }, { link: 'https://mirror.example/b.m3u8' }, 'https://mirror.example/c.m3u8'],
        episodeInfo: { title: 'Episode 12', heading: 'Jujutsu Kaisen' },
      }),
    );
    expect(stream.streamUrl).toBe('https://cdn.example/video.m3u8');
    expect(stream.alternativeLinks).toEqual(['https://mirror.example/a.m3u8', 'https://mirror.example/b.m3u8', 'https://mirror.example/c.m3u8']);
    expect(stream.episodeTitle).toBe('Episode 12');
    expect(stream.heading).toBe('Jujutsu Kaisen');
  });

  it('returns an empty stream URL rather than a placeholder when the provider omits it', () => {
    const stream = normalizeAnimasuStream(envelope({ episodeInfo: {} }));
    expect(stream.streamUrl).toBe('');
    expect(stream.alternativeLinks).toEqual([]);
  });
});

describe('scalar normalizers', () => {
  it('normalizes ratings from numbers, numeric strings, comma decimals and junk', () => {
    expect(normalizeRating(9)).toBe(9);
    expect(normalizeRating('8.5')).toBe(8.5);
    expect(normalizeRating('8,5')).toBe(8.5);
    expect(normalizeRating('Rating: 7.2')).toBe(7.2);
    expect(normalizeRating(null)).toBe(0);
    expect(normalizeRating('N/A')).toBe(0);
  });

  it('canonicalizes anime types', () => {
    expect(canonicalAnimeType('tv')).toBe('TV');
    expect(canonicalAnimeType('TV Series')).toBe('TV');
    expect(canonicalAnimeType('FILM')).toBe('Movie');
    expect(canonicalAnimeType('OAV')).toBe('OVA');
    expect(canonicalAnimeType('ONA')).toBe('ONA');
    expect(canonicalAnimeType('Special')).toBe('Special');
    expect(canonicalAnimeType('Music')).toBe('Other');
    expect(canonicalAnimeType('')).toBe('');
    expect(canonicalAnimeType(null)).toBe('');
  });

  it('parses episode numbers from several phrasings and rejects non-numbers', () => {
    expect(parseEpisodeNumber('12')).toBe(12);
    expect(parseEpisodeNumber('Episode 12')).toBe(12);
    expect(parseEpisodeNumber('Ep 3')).toBe(3);
    expect(parseEpisodeNumber('Eps 4')).toBe(4);
    expect(parseEpisodeNumber('第12話')).toBe(12);
    expect(parseEpisodeNumber('12.5')).toBe(12.5);
    expect(parseEpisodeNumber('??')).toBeNull();
    expect(parseEpisodeNumber('')).toBeNull();
    expect(parseEpisodeNumber('Final Episode')).toBeNull();
  });

  it('parses info strings without a separator into an empty object', () => {
    expect(normalizeInfo('no separators here')).toEqual({});
    expect(normalizeInfo('')).toEqual({});
  });
});

describe('Animeku request validation', () => {
  it('applies pagination defaults and canonicalizes the type filter', () => {
    expect(animeListQuerySchema.parse({})).toEqual({ page: 1, limit: 20, type: '' });
    expect(animeListQuerySchema.parse({ page: '3', limit: '5', type: 'tv' })).toEqual({ page: 3, limit: 5, type: 'TV' });
    expect(animeListQuerySchema.parse({ type: 'nonsense' }).type).toBe('Other');
  });

  it('rejects out-of-range pagination instead of hitting the provider', () => {
    expect(animeListQuerySchema.safeParse({ page: 0 }).success).toBe(false);
    expect(animeListQuerySchema.safeParse({ page: 5000 }).success).toBe(false);
    expect(animeListQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
  });

  it('requires a search query', () => {
    expect(animeSearchQuerySchema.safeParse({}).success).toBe(false);
    expect(animeSearchQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
    expect(animeSearchQuerySchema.safeParse({ q: 'frieren' }).success).toBe(true);
  });

  it('rejects protocol-relative and control-character provider targets', () => {
    expect(providerTargetSchema.safeParse('//evil.example/x').success).toBe(false);
    expect(providerTargetSchema.safeParse('/anime/a b').success).toBe(false);
    expect(providerTargetSchema.safeParse('/anime/a\nb').success).toBe(false);
    expect(providerTargetSchema.safeParse('x'.repeat(2049)).success).toBe(false);
    expect(providerTargetSchema.safeParse('/anime/jujutsu-kaisen').success).toBe(true);
  });
});
