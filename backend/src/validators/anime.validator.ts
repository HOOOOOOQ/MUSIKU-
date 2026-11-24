import { z } from 'zod';

/**
 * Animeku request + Animasu provider-response validation.
 *
 * Two jobs live here on purpose:
 *  1. **Request validation** — every Animeku query parameter is parsed with zod
 *     before it reaches a service, so malformed input becomes a 400 instead of a
 *     provider call.
 *  2. **Response normalization** — the Animasu payload is a third-party shape we
 *     do not control: `type` can be an empty string, `rating` can be null,
 *     `latestEpisode` can be `"??"`, `schedule` can be an object keyed by day or
 *     a flat array, and `episodes` may arrive in reverse order or without a
 *     usable episode number. Everything is coerced into a stable, fully typed
 *     shape here so neither the REST layer nor Flutter has to guess.
 *
 * No temporary stream URL is ever logged or persisted by this module.
 */

/* ─────────────────────────── request schemas ─────────────────────────── */

export const ANIME_TYPES = ['TV', 'Movie', 'Special', 'OVA', 'ONA', 'Other'] as const;
export type AnimeType = (typeof ANIME_TYPES)[number];

export const animeListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(500).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  type: z
    .string()
    .optional()
    .transform((value) => canonicalAnimeType(value ?? ''))
    .pipe(z.union([z.literal(''), z.enum(ANIME_TYPES)])),
});

export const animeSearchQuerySchema = animeListQuerySchema.extend({
  q: z.string().trim().min(1, 'q is required').max(120),
});

/**
 * Provider-relative target (`link` / `episodeUrl`). Accepted shapes:
 *   - a relative path such as `/anime/jujutsu-kaisen`
 *   - a same-origin absolute URL, which is reduced to its path + query
 * Everything else is rejected before any HTTP request is made (SSRF guard);
 * the provider host check happens in the adapter because it owns the base URL.
 */
export const providerTargetSchema = z
  .string()
  .trim()
  .min(1, 'target is required')
  .max(2048, 'target is too long')
  .refine((value) => !/[\s\u0000-\u001f\\]/.test(value), 'target must not contain whitespace or control characters')
  .refine((value) => !value.startsWith('//'), 'protocol-relative targets are not accepted');

export const animeDetailsQuerySchema = z.object({ link: providerTargetSchema });
export const animeEpisodesQuerySchema = z.object({ link: providerTargetSchema });
export const animeStreamQuerySchema = z.object({ episodeUrl: providerTargetSchema });

/* ─────────────────────── provider response schemas ───────────────────── */

/**
 * Anything the provider may send for a text field: string, number, null — or
 * nothing at all. Every field is optional on purpose: a missing key must never
 * invalidate a whole payload.
 */
const looseText = z.union([z.string(), z.number(), z.null(), z.undefined()]).optional();
/** Free-form field: the normalizers, not zod, decide how to read it. */
const looseValue = z.unknown().optional();

const animasuItemSchema = z.object({
  title: looseText,
  link: looseText,
  image: looseText,
  latestEpisode: looseText,
  type: looseText,
  rating: looseText,
});

const animasuListDataSchema = z.object({
  page: looseText,
  total: looseText,
  animeList: looseValue,
  results: looseValue,
  query: looseText,
});

export const animasuEnvelopeSchema = z.object({
  success: z.boolean().optional(),
  status: looseText,
  message: looseText,
  /* Deliberately permissive: each normalizer applies its own shape-specific
   * schema to `data`. A typed object schema here would silently strip the keys
   * the other endpoints rely on (`schedule`, `episodes`, `streamUrl`, …). */
  data: z.union([z.array(z.unknown()), z.record(z.string(), z.unknown())]).optional(),
});

const animasuEpisodeSchema = z.object({
  episode: looseText,
  title: looseText,
  episodeUrl: looseText,
  date: looseText,
});

const animasuDetailsDataSchema = z.object({
  title: looseText,
  image: looseText,
  info: looseValue,
  genres: looseValue,
  sinopsis: looseText,
  synopsis: looseText,
  rating: looseText,
  totalEpisodes: looseText,
  episodes: looseValue,
});

const animasuStreamDataSchema = z.object({
  streamUrl: looseText,
  alternativeLinks: looseValue,
  episodeInfo: looseValue,
});

/* ───────────────────────── normalized shapes ───────────────────────── */

export interface NormalizedEpisodePointer {
  /** Human text exactly as the provider phrased it (may be `??`). */
  text: string;
  /** Parsed episode number when one is present, otherwise null. */
  number: number | null;
}

export interface AnimasuListItem {
  title: string;
  link: string;
  image: string;
  type: AnimeType | '';
  rawType: string;
  rating: number;
  latestEpisode: NormalizedEpisodePointer;
}

export interface AnimasuListPage {
  kind: 'popular' | 'ongoing' | 'completed' | 'search';
  items: AnimasuListItem[];
  page: number;
  total: number;
  query: string;
}

export interface AnimasuScheduleDay {
  key: string;
  label: string;
  items: AnimasuListItem[];
}

export interface AnimasuSchedule {
  days: AnimasuScheduleDay[];
  totalDays: number;
  /** How the provider shaped the payload — useful for diagnostics. */
  shape: 'object' | 'array' | 'empty';
}

export interface AnimasuEpisode {
  number: number;
  /** Display label: the provider's own text when usable, else `Episode N`. */
  label: string;
  title: string;
  episodeUrl: string;
  date: string;
}

export interface AnimasuEpisodeList {
  items: AnimasuEpisode[];
  /** True when the provider sent descending order and we flipped it. */
  reversed: boolean;
  /** Where the episode numbers came from. */
  numberSource: 'episode' | 'title' | 'index';
}

export interface AnimasuDetails {
  title: string;
  image: string;
  info: Record<string, string>;
  genres: string[];
  synopsis: string;
  rating: number;
  totalEpisodes: number;
  episodes: AnimasuEpisodeList;
}

export interface AnimasuStream {
  streamUrl: string;
  alternativeLinks: string[];
  episodeTitle: string;
  heading: string;
}

/* ─────────────────────────── normalizers ─────────────────────────── */

export function text(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

/** `rating` arrives as a number, a numeric string, or null. */
export function normalizeRating(value: unknown): number {
  const raw = text(value).replace(',', '.');
  if (!raw) return 0;
  const parsed = Number.parseFloat(raw.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

export function canonicalAnimeType(value: unknown): AnimeType | '' {
  const raw = text(value).toUpperCase();
  if (!raw) return '';
  if (raw === 'TV' || raw.startsWith('TV ')) return 'TV';
  if (raw === 'MOVIE' || raw === 'FILM') return 'Movie';
  if (raw === 'SPECIAL') return 'Special';
  if (raw === 'OVA' || raw === 'OAV') return 'OVA';
  if (raw === 'ONA') return 'ONA';
  if (raw === 'MUSIC' || raw === 'OTHER' || raw === 'UNKNOWN') return 'Other';
  // Unknown provider vocabulary is preserved verbatim by callers via `rawType`
  // but grouped under "Other" for filtering.
  return 'Other';
}

const EPISODE_NUMBER_RE = /(?:episode|ep\.?|eps\.?|第|話|第\s*)\s*([0-9]+(?:\.[0-9]+)?)|^\s*([0-9]+(?:\.[0-9]+)?)\s*$/i;

/** Parses `12`, `Episode 12`, `Ep 12`, `第12話`; returns null for `??`/empty. */
export function parseEpisodeNumber(value: unknown): number | null {
  const raw = text(value);
  if (!raw || raw === '??' || raw === '?') return null;
  const direct = Number.parseFloat(raw);
  if (Number.isFinite(direct) && /^\s*[0-9]+(?:\.[0-9]+)?\s*$/.test(raw)) return direct;
  const match = EPISODE_NUMBER_RE.exec(raw);
  const candidate = match?.[1] ?? match?.[2];
  if (!candidate) return null;
  const parsed = Number.parseFloat(candidate);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeEpisodePointer(value: unknown): NormalizedEpisodePointer {
  const raw = text(value);
  return { text: raw === '??' ? '' : raw, number: parseEpisodeNumber(raw) };
}

function toListItem(unknownItem: unknown): AnimasuListItem | null {
  const parsed = animasuItemSchema.safeParse(unknownItem);
  if (!parsed.success) return null;
  const link = text(parsed.data.link);
  const title = text(parsed.data.title);
  if (!link || !title) return null;
  const rawType = text(parsed.data.type);
  return {
    title,
    link,
    image: text(parsed.data.image),
    type: canonicalAnimeType(rawType),
    rawType,
    rating: normalizeRating(parsed.data.rating),
    latestEpisode: normalizeEpisodePointer(parsed.data.latestEpisode),
  };
}

function toListItems(values: unknown): AnimasuListItem[] {
  // Some deployments return an index-keyed object instead of an array.
  const list = Array.isArray(values)
    ? values
    : values && typeof values === 'object'
      ? Object.values(values as Record<string, unknown>)
      : [];
  const items: AnimasuListItem[] = [];
  const seen = new Set<string>();
  for (const value of list) {
    const item = toListItem(value);
    if (!item || seen.has(item.link)) continue;
    seen.add(item.link);
    items.push(item);
  }
  return items;
}

function readData(envelope: unknown): Record<string, unknown> {
  const parsed = animasuEnvelopeSchema.safeParse(envelope);
  if (!parsed.success || parsed.data.data === undefined) return {};
  const data = parsed.data.data;
  if (Array.isArray(data)) return { animeList: data };
  return data as Record<string, unknown>;
}

/** `popular` / `ongoing` / `completed` / `search` share one envelope shape. */
export function normalizeAnimasuList(
  envelope: unknown,
  kind: AnimasuListPage['kind'],
  fallbackPage = 1,
): AnimasuListPage {
  const data = readData(envelope);
  const parsed = animasuListDataSchema.safeParse(data);
  const list = (parsed.success ? parsed.data : {}) as Partial<z.infer<typeof animasuListDataSchema>>;
  const items = toListItems(list.animeList ?? list.results ?? []);
  const page = Number.parseInt(text(list.page), 10);
  const total = Number.parseInt(text(list.total), 10);
  return {
    kind,
    items,
    page: Number.isFinite(page) && page > 0 ? page : fallbackPage,
    total: Number.isFinite(total) && total >= 0 ? total : items.length,
    query: text(list.query),
  };
}

const DAY_LABELS: Record<string, string> = {
  all: 'Semua',
  senin: 'Senin',
  monday: 'Senin',
  selasa: 'Selasa',
  tuesday: 'Selasa',
  rabu: 'Rabu',
  wednesday: 'Rabu',
  kamis: 'Kamis',
  thursday: 'Kamis',
  jumat: 'Jumat',
  friday: 'Jumat',
  sabtu: 'Sabtu',
  saturday: 'Sabtu',
  minggu: 'Minggu',
  sunday: 'Minggu',
};

/**
 * The schedule payload is not reliably a flat array: the provider may return an
 * object keyed by day or category (including an `"All"` bucket). Both shapes are
 * normalized into ordered day buckets, and `totalDays` is honoured when present.
 */
export function normalizeAnimasuSchedule(envelope: unknown): AnimasuSchedule {
  const data = readData(envelope);
  const rawSchedule = data.schedule;
  const totalDaysRaw = Number.parseInt(text(data.totalDays), 10);
  const days: AnimasuScheduleDay[] = [];

  if (Array.isArray(rawSchedule)) {
    const items = toListItems(rawSchedule);
    if (items.length > 0) days.push({ key: 'all', label: DAY_LABELS.all, items });
    return { days, totalDays: Number.isFinite(totalDaysRaw) ? totalDaysRaw : days.length, shape: 'array' };
  }

  if (rawSchedule && typeof rawSchedule === 'object') {
    for (const [key, value] of Object.entries(rawSchedule as Record<string, unknown>)) {
      const items = toListItems(value);
      const normalizedKey = key.trim().toLowerCase();
      days.push({ key: normalizedKey || 'other', label: DAY_LABELS[normalizedKey] ?? key.trim(), items });
    }
    return { days, totalDays: Number.isFinite(totalDaysRaw) ? totalDaysRaw : days.length, shape: 'object' };
  }

  return { days, totalDays: Number.isFinite(totalDaysRaw) ? totalDaysRaw : 0, shape: 'empty' };
}

/** `info` may be an object, a "Key: Value" newline string, or absent. */
export function normalizeInfo(value: unknown): Record<string, string> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) {
    const result: Record<string, string> = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const textValue = Array.isArray(raw) ? raw.map(text).filter(Boolean).join(', ') : text(raw);
      if (textValue) result[key.trim()] = textValue;
    }
    return result;
  }
  const result: Record<string, string> = {};
  for (const line of text(value).split(/\r?\n|;/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const parsed = line.slice(separator + 1).trim();
    if (key && parsed) result[key] = parsed;
  }
  return result;
}

export function normalizeGenres(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => (typeof entry === 'object' && entry !== null ? text((entry as Record<string, unknown>).name ?? (entry as Record<string, unknown>).genre) : text(entry)))
      .filter(Boolean);
  }
  return text(value)
    .split(/[,;\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Episode normalization.
 *
 * The provider's `episode` field is **not** guaranteed to be the real episode
 * number: it can be a label, an index, or missing entirely, and the array may be
 * ordered newest-first. Numbers are therefore derived from `episode`, then from
 * the title text, then from the array position — and the list is flipped to
 * ascending order when the provider clearly sent it descending.
 */
export function normalizeAnimasuEpisodes(values: unknown): AnimasuEpisodeList {
  const rawList = Array.isArray(values) ? values : [];
  const parsed: { candidate: AnimasuEpisode; fromEpisode: number | null; fromTitle: number | null }[] = [];
  const seen = new Set<string>();

  for (const entry of rawList) {
    const result = animasuEpisodeSchema.safeParse(entry);
    if (!result.success) continue;
    const episodeUrl = text(result.data.episodeUrl);
    const label = text(result.data.episode) || text(result.data.title);
    if (!episodeUrl || seen.has(episodeUrl)) continue;
    seen.add(episodeUrl);
    parsed.push({
      candidate: {
        number: 0,
        label,
        title: text(result.data.title),
        episodeUrl,
        date: text(result.data.date),
      },
      fromEpisode: parseEpisodeNumber(result.data.episode),
      fromTitle: parseEpisodeNumber(result.data.title),
    });
  }

  const fromEpisodeCount = parsed.filter((entry) => entry.fromEpisode !== null).length;
  const fromTitleCount = parsed.filter((entry) => entry.fromTitle !== null).length;
  const numberSource: AnimasuEpisodeList['numberSource'] =
    fromEpisodeCount >= Math.max(1, Math.ceil(parsed.length * 0.6))
      ? 'episode'
      : fromTitleCount >= Math.max(1, Math.ceil(parsed.length * 0.6))
        ? 'title'
        : 'index';

  const items = parsed.map((entry, index) => {
    const derived =
      numberSource === 'episode'
        ? entry.fromEpisode
        : numberSource === 'title'
          ? entry.fromTitle
          : null;
    const number = derived ?? index + 1;
    return {
      ...entry.candidate,
      number,
      label: entry.candidate.label || `Episode ${number}`,
    };
  });

  // Detect a descending payload: first number greater than last, and the
  // sequence non-increasing overall.
  let reversed = false;
  if (items.length > 2) {
    const descending = items.every((item, index) => index === 0 || items[index - 1].number >= item.number);
    const ascending = items.every((item, index) => index === 0 || items[index - 1].number <= item.number);
    if (descending && !ascending) {
      items.reverse();
      reversed = true;
    }
  }

  return { items, reversed, numberSource };
}

export function normalizeAnimasuDetails(envelope: unknown): AnimasuDetails {
  const parsed = animasuEnvelopeSchema.safeParse(envelope);
  const raw = parsed.success && parsed.data.data && !Array.isArray(parsed.data.data) ? (parsed.data.data as Record<string, unknown>) : {};
  const details = animasuDetailsDataSchema.safeParse(raw);
  const data = (details.success ? details.data : {}) as Partial<z.infer<typeof animasuDetailsDataSchema>>;
  const totalEpisodesRaw = Number.parseInt(text(data.totalEpisodes), 10);
  const episodes = normalizeAnimasuEpisodes(data.episodes ?? []);
  return {
    title: text(data.title),
    image: text(data.image),
    info: normalizeInfo(data.info),
    genres: normalizeGenres(data.genres),
    synopsis: text(data.sinopsis) || text(data.synopsis),
    rating: normalizeRating(data.rating),
    totalEpisodes: Number.isFinite(totalEpisodesRaw) && totalEpisodesRaw > 0 ? totalEpisodesRaw : episodes.items.length,
    episodes,
  };
}

export function normalizeAnimasuStream(envelope: unknown): AnimasuStream {
  const parsed = animasuEnvelopeSchema.safeParse(envelope);
  const raw = parsed.success && parsed.data.data && !Array.isArray(parsed.data.data) ? (parsed.data.data as Record<string, unknown>) : {};
  const stream = animasuStreamDataSchema.safeParse(raw);
  const data = (stream.success ? stream.data : {}) as Partial<z.infer<typeof animasuStreamDataSchema>>;
  const rawAlternatives = Array.isArray(data.alternativeLinks)
    ? data.alternativeLinks
    : data.alternativeLinks && typeof data.alternativeLinks === 'object'
      ? Object.values(data.alternativeLinks as Record<string, unknown>)
      : [];
  const alternatives = rawAlternatives
    .map((entry: unknown) => (typeof entry === 'object' && entry !== null ? text((entry as Record<string, unknown>).url ?? (entry as Record<string, unknown>).link) : text(entry)))
    .filter(Boolean);
  const episodeInfo = data.episodeInfo;
  const infoRecord = episodeInfo && typeof episodeInfo === 'object' ? (episodeInfo as Record<string, unknown>) : {};
  return {
    streamUrl: text(data.streamUrl),
    alternativeLinks: alternatives,
    // `episodeInfo` may be an object or a plain label string.
    episodeTitle: text(infoRecord.title) || (typeof episodeInfo === 'string' ? text(episodeInfo) : ''),
    heading: text(infoRecord.heading),
  };
}
