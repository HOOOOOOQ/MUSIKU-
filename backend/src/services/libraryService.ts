import {
  LikedSong, FollowedArtist, SavedAlbum, MusicHistory, MusicQueue,
  AnimeWatchlist, AnimeFavorite, AnimeWatchHistory, AnimeRating, Anime, AnimeEpisode, MusicTrack,
} from '../models';
import { notFound, badRequest } from '../utils/apiResponse';
import { WATCHLIST_STATUSES } from '../models/Anime';

/** Unified library: liked songs, followed artists, saved albums,
 *  watchlist, favorites, music + anime history, queue persistence. */

export const libraryService = {
  /* ── Music library ─────────────────────────────────────────────────── */
  async listLiked(userId: string, page = 1, limit = 50) {
    const total = await LikedSong.countDocuments({ user: userId });
    const items = await LikedSong.find({ user: userId })
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('track')
      .lean();
    return { items, total };
  },

  async likeTrack(userId: string, trackId: string) {
    const track = await MusicTrack.findById(trackId);
    if (!track) throw notFound('Track not found');
    return LikedSong.findOneAndUpdate(
      { user: userId, track: trackId },
      { $setOnInsert: { user: userId, track: trackId } },
      { upsert: true, new: true },
    );
  },

  async unlikeTrack(userId: string, trackId: string): Promise<void> {
    await LikedSong.deleteOne({ user: userId, track: trackId });
  },

  async isLiked(userId: string, trackId: string): Promise<boolean> {
    return Boolean(await LikedSong.findOne({ user: userId, track: trackId }).lean());
  },

  async listFollowedArtists(userId: string) {
    return FollowedArtist.find({ user: userId }).sort({ createdAt: -1 }).populate('artist').lean();
  },

  async followArtist(userId: string, artistId: string) {
    return FollowedArtist.findOneAndUpdate(
      { user: userId, artist: artistId },
      { $setOnInsert: { user: userId, artist: artistId } },
      { upsert: true, new: true },
    );
  },

  async unfollowArtist(userId: string, artistId: string): Promise<void> {
    await FollowedArtist.deleteOne({ user: userId, artist: artistId });
  },

  async listSavedAlbums(userId: string) {
    return SavedAlbum.find({ user: userId }).sort({ createdAt: -1 }).populate('album').lean();
  },

  async saveAlbum(userId: string, albumId: string) {
    return SavedAlbum.findOneAndUpdate(
      { user: userId, album: albumId },
      { $setOnInsert: { user: userId, album: albumId } },
      { upsert: true, new: true },
    );
  },

  async unsaveAlbum(userId: string, albumId: string): Promise<void> {
    await SavedAlbum.deleteOne({ user: userId, album: albumId });
  },

  /* ── Music history + queue ─────────────────────────────────────────── */
  async recordMusicPlay(userId: string, trackId: string, positionSec = 0, completed = false) {
    const track = await MusicTrack.findById(trackId);
    if (!track) throw notFound('Track not found');
    return MusicHistory.create({ user: userId, track: trackId, positionSec, completed, playedAt: new Date() });
  },

  async listMusicHistory(userId: string, limit = 50) {
    return MusicHistory.find({ user: userId }).sort({ playedAt: -1 }).limit(limit).populate('track').lean();
  },

  async clearMusicHistory(userId: string): Promise<void> {
    await MusicHistory.deleteMany({ user: userId });
  },

  async saveQueue(userId: string, queue: { trackIds: string[]; currentIndex?: number; positionSec?: number; shuffle?: boolean; repeat?: string }) {
    return MusicQueue.findOneAndUpdate(
      { user: userId },
      { $set: { user: userId, ...queue } },
      { upsert: true, new: true },
    );
  },

  async getQueue(userId: string) {
    return MusicQueue.findOne({ user: userId }).lean();
  },

  /* ── Anime library ─────────────────────────────────────────────────── */
  async listWatchlist(userId: string, status?: string, page = 1, limit = 50) {
    const filter: Record<string, unknown> = { user: userId };
    if (status) {
      if (!(WATCHLIST_STATUSES as readonly string[]).includes(status)) throw badRequest(`Invalid status: ${status}`);
      filter.status = status;
    }
    const total = await AnimeWatchlist.countDocuments(filter);
    const items = await AnimeWatchlist.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .populate('anime')
      .lean();
    return { items, total };
  },

  async addToWatchlist(userId: string, animeId: string, status = 'plan_to_watch', rating = 0, notes = '') {
    const anime = await Anime.findById(animeId);
    if (!anime) throw notFound('Anime not found');
    if (!(WATCHLIST_STATUSES as readonly string[]).includes(status)) throw badRequest(`Invalid status: ${status}`);
    return AnimeWatchlist.findOneAndUpdate(
      { user: userId, anime: animeId },
      { $set: { status, rating, notes } },
      { upsert: true, new: true },
    );
  },

  async updateWatchlist(userId: string, entryId: string, patch: { status?: string; rating?: number; notes?: string }) {
    const entry = await AnimeWatchlist.findOne({ _id: entryId, user: userId });
    if (!entry) throw notFound('Watchlist entry not found');
    if (patch.status !== undefined) {
      if (!(WATCHLIST_STATUSES as readonly string[]).includes(patch.status)) throw badRequest(`Invalid status: ${patch.status}`);
      entry.status = patch.status as typeof entry.status;
    }
    if (patch.rating !== undefined) entry.rating = patch.rating;
    if (patch.notes !== undefined) entry.notes = patch.notes;
    await entry.save();
    return entry;
  },

  async removeFromWatchlist(userId: string, entryId: string): Promise<void> {
    const res = await AnimeWatchlist.deleteOne({ _id: entryId, user: userId });
    if (res.deletedCount === 0) throw notFound('Watchlist entry not found');
  },

  async listAnimeFavorites(userId: string) {
    return AnimeFavorite.find({ user: userId }).sort({ createdAt: -1 }).populate('anime').lean();
  },

  async favoriteAnime(userId: string, animeId: string) {
    const anime = await Anime.findById(animeId);
    if (!anime) throw notFound('Anime not found');
    return AnimeFavorite.findOneAndUpdate(
      { user: userId, anime: animeId },
      { $setOnInsert: { user: userId, anime: animeId } },
      { upsert: true, new: true },
    );
  },

  async unfavoriteAnime(userId: string, animeId: string): Promise<void> {
    await AnimeFavorite.deleteOne({ user: userId, anime: animeId });
  },

  async rateAnime(userId: string, animeId: string, rating: number) {
    const anime = await Anime.findById(animeId);
    if (!anime) throw notFound('Anime not found');
    return AnimeRating.findOneAndUpdate(
      { user: userId, anime: animeId },
      { $set: { rating } },
      { upsert: true, new: true },
    );
  },

  /* ── Anime watch history ───────────────────────────────────────────── */
  async recordAnimeWatch(userId: string, input: { animeId: string; episodeId?: string; episodeNumber?: number; positionSec?: number; durationSec?: number; completed?: boolean }) {
    const anime = await Anime.findById(input.animeId);
    if (!anime) throw notFound('Anime not found');
    return AnimeWatchHistory.create({
      user: userId,
      anime: input.animeId,
      episode: input.episodeId,
      episodeNumber: input.episodeNumber ?? 0,
      positionSec: input.positionSec ?? 0,
      durationSec: input.durationSec ?? 0,
      completed: input.completed ?? false,
      watchedAt: new Date(),
    });
  },

  async listAnimeHistory(userId: string, limit = 50, animeId?: string) {
    const filter: Record<string, unknown> = { user: userId };
    if (animeId) filter.anime = animeId;
    return AnimeWatchHistory.find(filter).sort({ watchedAt: -1 }).limit(limit).populate('anime').populate('episode').lean();
  },

  async continueWatching(userId: string, limit = 20) {
    // Latest unfinished episode per anime.
    const rows = await AnimeWatchHistory.find({ user: userId, completed: false })
      .sort({ watchedAt: -1 })
      .limit(limit * 3)
      .populate('anime')
      .populate('episode')
      .lean();
    const seen = new Set<string>();
    const out: unknown[] = [];
    for (const row of rows) {
      const key = String((row as { anime: { _id: unknown } }).anime?._id ?? '');
      if (!key || seen.has(key)) continue;
      seen.add(key);
      out.push(row);
      if (out.length >= limit) break;
    }
    return out;
  },

  async removeAnimeHistory(userId: string, historyId: string): Promise<void> {
    await AnimeWatchHistory.deleteOne({ _id: historyId, user: userId });
  },

  async clearAnimeHistory(userId: string): Promise<void> {
    await AnimeWatchHistory.deleteMany({ user: userId });
  },

  async getEpisode(episodeId: string) {
    return AnimeEpisode.findById(episodeId).lean();
  },
};
