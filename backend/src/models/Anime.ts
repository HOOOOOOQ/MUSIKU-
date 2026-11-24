import mongoose, { Schema } from 'mongoose';

/* Catalog collections are populated from official/public metadata
 * providers (AniList GraphQL, Jikan REST). Streaming URLs are only
 * stored when supplied by a licensed provider — never scraped. */

const animeSchema = new Schema(
  {
    providerId: { type: String, required: true, index: true },
    source: { type: String, required: true, index: true },
    title: { type: String, required: true },
    titleEnglish: { type: String, default: '' },
    titleNative: { type: String, default: '' },
    synopsis: { type: String, default: '' },
    posterUrl: { type: String, default: '' },
    bannerUrl: { type: String, default: '' },
    genres: { type: [String], default: [] },
    studio: { type: String, default: '' },
    season: { type: String, default: '' },
    seasonYear: { type: Number, default: undefined },
    status: { type: String, default: '' },
    format: { type: String, default: '' },
    episodeCount: { type: Number, default: 0 },
    /* Latest-episode pointer as reported by the catalog provider. Text is kept
     * verbatim (providers send labels such as "Ep 12" or "??"); the number is
     * only set when one could be parsed. Stream URLs are NEVER stored here. */
    latestEpisodeText: { type: String, default: '' },
    latestEpisodeNumber: { type: Number, default: undefined },
    rating: { type: Number, default: 0, index: true },
    popularity: { type: Number, default: 0, index: true },
    ageRating: { type: String, default: '' },
    releaseDate: { type: Date, default: undefined },
    nextAiringAt: { type: Date, default: undefined },
    trailerUrl: { type: String, default: '' },
  },
  { timestamps: true },
);
animeSchema.index({ providerId: 1, source: 1 }, { unique: true });
animeSchema.index({ title: 'text', titleEnglish: 'text', synopsis: 'text' });
animeSchema.index({ createdAt: -1 });
export const Anime = mongoose.model('Anime', animeSchema, 'anime');

const animeGenreSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    slug: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);
export const AnimeGenre = mongoose.model('AnimeGenre', animeGenreSchema, 'anime_genres');

const animeSeasonSchema = new Schema(
  {
    year: { type: Number, required: true, index: true },
    season: { type: String, required: true, index: true },
    animeIds: { type: [Schema.Types.ObjectId], ref: 'Anime', default: [] },
  },
  { timestamps: true },
);
animeSeasonSchema.index({ year: 1, season: 1 }, { unique: true });
export const AnimeSeason = mongoose.model('AnimeSeason', animeSeasonSchema, 'anime_seasons');

const animeEpisodeSchema = new Schema(
  {
    anime: { type: Schema.Types.ObjectId, ref: 'Anime', required: true, index: true },
    providerEpisodeId: { type: String, default: '' },
    number: { type: Number, required: true },
    title: { type: String, default: '' },
    thumbnailUrl: { type: String, default: '' },
    durationSec: { type: Number, default: 0 },
    releaseDate: { type: Date, default: undefined },
    streamUrl: { type: String, default: '' },
    subtitles: { type: [{ language: String, url: String }], default: [] },
    introStartSec: { type: Number, default: undefined },
    introEndSec: { type: Number, default: undefined },
  },
  { timestamps: true },
);
animeEpisodeSchema.index({ anime: 1, number: 1 }, { unique: true });
export const AnimeEpisode = mongoose.model('AnimeEpisode', animeEpisodeSchema, 'anime_episodes');

const animeStudioSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    imageUrl: { type: String, default: '' },
  },
  { timestamps: true },
);
export const AnimeStudio = mongoose.model('AnimeStudio', animeStudioSchema, 'anime_studios');

/* ── user anime collections ────────────────────────────────────────────── */
export const WATCHLIST_STATUSES = ['plan_to_watch', 'watching', 'completed', 'on_hold', 'dropped'] as const;

const watchlistSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    anime: { type: Schema.Types.ObjectId, ref: 'Anime', required: true },
    status: { type: String, enum: WATCHLIST_STATUSES, default: 'plan_to_watch', index: true },
    rating: { type: Number, min: 0, max: 10, default: 0 },
    notes: { type: String, maxlength: 1000, default: '' },
  },
  { timestamps: true },
);
watchlistSchema.index({ user: 1, anime: 1 }, { unique: true });
watchlistSchema.index({ user: 1, status: 1, updatedAt: -1 });
export const AnimeWatchlist = mongoose.model('AnimeWatchlist', watchlistSchema, 'anime_watchlists');

const animeFavoriteSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    anime: { type: Schema.Types.ObjectId, ref: 'Anime', required: true },
  },
  { timestamps: true },
);
animeFavoriteSchema.index({ user: 1, anime: 1 }, { unique: true });
export const AnimeFavorite = mongoose.model('AnimeFavorite', animeFavoriteSchema, 'anime_favorites');

const animeWatchHistorySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    anime: { type: Schema.Types.ObjectId, ref: 'Anime', required: true },
    episode: { type: Schema.Types.ObjectId, ref: 'AnimeEpisode', default: undefined },
    episodeNumber: { type: Number, default: 0 },
    positionSec: { type: Number, default: 0 },
    durationSec: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    watchedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);
animeWatchHistorySchema.index({ user: 1, watchedAt: -1 });
animeWatchHistorySchema.index({ user: 1, anime: 1, watchedAt: -1 });
export const AnimeWatchHistory = mongoose.model('AnimeWatchHistory', animeWatchHistorySchema, 'anime_watch_history');

const animeRatingSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    anime: { type: Schema.Types.ObjectId, ref: 'Anime', required: true },
    rating: { type: Number, required: true, min: 1, max: 10 },
  },
  { timestamps: true },
);
animeRatingSchema.index({ user: 1, anime: 1 }, { unique: true });
export const AnimeRating = mongoose.model('AnimeRating', animeRatingSchema, 'anime_ratings');
