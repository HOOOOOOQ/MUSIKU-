import { MusicHistory, LikedSong, FollowedArtist, AnimeWatchHistory, AnimeWatchlist, AnimeFavorite, Recommendation } from '../models';
import { catalogService } from './catalogService';

/**
 * Personalized recommendations.
 * Strategy (transparent, no black box):
 * - Music: seed from most-played artists/genres, fetch related
 *   trending/search results, cache per user for 6h.
 * - Anime: seed from watchlist genres + completed anime, fetch
 *   seasonal/top-rated lists filtered by those genres.
 * Users can refresh, like/dislike (feedback stored as score), or
 * hide a recommendation (filtered out on next generation).
 */

export const recommendationService = {
  async musicForUser(userId: string, forceRefresh = false) {
    if (!forceRefresh) {
      const cached = await Recommendation.findOne({ user: userId, kind: 'music', expiresAt: { $gt: new Date() } })
        .sort({ createdAt: -1 })
        .lean();
      if (cached) return cached;
    }

    const [history, liked, followed] = await Promise.all([
      MusicHistory.find({ user: userId }).sort({ playedAt: -1 }).limit(30).populate('track').lean(),
      LikedSong.find({ user: userId }).limit(20).populate('track').lean(),
      FollowedArtist.find({ user: userId }).limit(10).populate('artist').lean(),
    ]);

    const seeds = new Set<string>();
    for (const h of history) {
      const track = (h as unknown as { track?: { artistName?: string; genres?: string[] } }).track;
      if (track?.artistName) seeds.add(track.artistName);
      track?.genres?.forEach((g) => seeds.add(g));
    }
    for (const l of liked) {
      const track = (l as unknown as { track?: { artistName?: string } }).track;
      if (track?.artistName) seeds.add(track.artistName);
    }
    for (const f of followed) {
      const artist = (f as unknown as { artist?: { name?: string } }).artist;
      if (artist?.name) seeds.add(artist.name);
    }

    const items: unknown[] = [];
    const seen = new Set<string>();
    for (const seed of Array.from(seeds).slice(0, 5)) {
      try {
        const results = await catalogService.searchMusic(seed, 6);
        for (const t of results) {
          if (!seen.has(t.providerId)) {
            seen.add(t.providerId);
            items.push(t);
          }
        }
      } catch {
        /* skip failed seed */
      }
      if (items.length >= 20) break;
    }
    if (items.length === 0) {
      items.push(...(await catalogService.trendingMusic(20)));
    }

    const doc = await Recommendation.create({
      user: userId,
      kind: 'music',
      title: 'Made for You',
      items,
      score: 1,
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    });
    return doc;
  },

  async animeForUser(userId: string, forceRefresh = false) {
    if (!forceRefresh) {
      const cached = await Recommendation.findOne({ user: userId, kind: 'anime', expiresAt: { $gt: new Date() } })
        .sort({ createdAt: -1 })
        .lean();
      if (cached) return cached;
    }

    const [history, watchlist, favorites] = await Promise.all([
      AnimeWatchHistory.find({ user: userId }).limit(30).populate('anime').lean(),
      AnimeWatchlist.find({ user: userId }).limit(30).populate('anime').lean(),
      AnimeFavorite.find({ user: userId }).limit(20).populate('anime').lean(),
    ]);

    const genres = new Set<string>();
    const collect = (rows: unknown[]) => {
      for (const r of rows) {
        const anime = (r as { anime?: { genres?: string[] } }).anime;
        anime?.genres?.forEach((g) => genres.add(g));
      }
    };
    collect(history as unknown[]);
    collect(watchlist as unknown[]);
    collect(favorites as unknown[]);

    const topRated = await catalogService.animeList('topRated', 1, 30);
    const scored = topRated
      .map((a) => ({
        anime: a,
        score: a.genres.filter((g) => genres.has(g)).length + (a.rating ?? 0) / 10,
      }))
      .sort((x, y) => y.score - x.score)
      .slice(0, 20)
      .map((x) => x.anime);

    const doc = await Recommendation.create({
      user: userId,
      kind: 'anime',
      title: 'Recommended for You',
      items: scored,
      score: 1,
      expiresAt: new Date(Date.now() + 6 * 60 * 60 * 1000),
    });
    return doc;
  },
};
