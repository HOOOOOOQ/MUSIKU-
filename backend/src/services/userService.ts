import { UserSession, User, UserProfile, UserPreference, UserDevice, LoginHistory, LikedSong, FollowedArtist, SavedAlbum, AnimeWatchlist, AnimeFavorite, AnimeWatchHistory, MusicHistory } from '../models';
import { notFound, conflict } from '../utils/apiResponse';

export const userService = {
  async getProfile(userId: string) {
    const user = await User.findById(userId).lean();
    if (!user) throw notFound('User not found');
    const profile = await UserProfile.findOne({ user: userId }).lean();
    return { user: stripSecrets(user), profile };
  },

  async updateProfile(userId: string, patch: Record<string, unknown>) {
    const user = await User.findById(userId);
    if (!user) throw notFound('User not found');
    if (patch.username) {
      const clash = await User.findOne({ username: String(patch.username).toLowerCase(), _id: { $ne: userId } }).lean();
      if (clash) throw conflict('Username is already taken');
      user.username = String(patch.username).toLowerCase();
      await user.save();
    }
    const profilePatch: Record<string, unknown> = {};
    for (const key of ['displayName', 'avatarUrl', 'bio', 'country', 'language', 'favoriteMusicGenres', 'favoriteAnimeGenres', 'favoriteArtists', 'favoriteAnime']) {
      if (patch[key] !== undefined) profilePatch[key] = patch[key];
    }
    let profile = await UserProfile.findOne({ user: userId });
    if (!profile) {
      profile = await UserProfile.create({ user: userId, ...profilePatch });
    } else {
      Object.assign(profile, profilePatch);
      await profile.save();
    }
    return { user: stripSecrets(user.toObject()), profile };
  },

  async getPreferences(userId: string) {
    const prefs = await UserPreference.findOneAndUpdate(
      { user: userId },
      { $setOnInsert: { user: userId } },
      { upsert: true, new: true },
    );
    return prefs;
  },

  async updatePreferences(userId: string, patch: Record<string, unknown>) {
    const allowed = [
      'theme', 'language', 'defaultAudioQuality', 'autoplay', 'crossfade', 'normalizeVolume',
      'explicitContent', 'defaultSubtitle', 'defaultVideoQuality', 'autoplayNextEpisode',
      'skipIntro', 'backgroundPlayback', 'playbackSpeed', 'personalizedRecommendations',
      'listeningActivity', 'watchHistoryEnabled', 'landingPage',
    ];
    const clean: Record<string, unknown> = {};
    for (const key of allowed) if (patch[key] !== undefined) clean[key] = patch[key];
    const prefs = await UserPreference.findOneAndUpdate(
      { user: userId },
      { $set: clean },
      { upsert: true, new: true },
    );
    return prefs;
  },

  async listDevices(userId: string) {
    return UserDevice.find({ user: userId }).sort({ lastSeenAt: -1 }).lean();
  },

  async removeDevice(userId: string, deviceId: string) {
    await UserSession.updateMany({ user: userId, deviceId }, { $set: { revokedAt: new Date(), revokedReason: 'logout' } });
    const res = await UserDevice.deleteOne({ user: userId, deviceId });
    if (res.deletedCount === 0) throw notFound('Device not found');
  },

  async loginHistory(userId: string, limit = 20) {
    return LoginHistory.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).lean();
  },

  /** Aggregated music + anime statistics for the profile screen. */
  async stats(userId: string) {
    const [liked, followed, saved, watchlist, favorites, musicPlays, animeWatches] = await Promise.all([
      LikedSong.countDocuments({ user: userId }),
      FollowedArtist.countDocuments({ user: userId }),
      SavedAlbum.countDocuments({ user: userId }),
      AnimeWatchlist.countDocuments({ user: userId }),
      AnimeFavorite.countDocuments({ user: userId }),
      MusicHistory.countDocuments({ user: userId }),
      AnimeWatchHistory.countDocuments({ user: userId }),
    ]);
    const watchlistByStatus = await AnimeWatchlist.aggregate([
      { $match: { user: userId } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);
    return {
      likedSongs: liked,
      followedArtists: followed,
      savedAlbums: saved,
      watchlistTotal: watchlist,
      animeFavorites: favorites,
      musicPlays,
      animeEpisodesWatched: animeWatches,
      watchlistByStatus: Object.fromEntries(watchlistByStatus.map((w: { _id: string; count: number }) => [w._id, w.count])),
    };
  },
};

function stripSecrets(user: unknown): Record<string, unknown> {
  const { passwordHash, ...rest } = user as Record<string, unknown>;
  void passwordHash;
  return rest;
}
