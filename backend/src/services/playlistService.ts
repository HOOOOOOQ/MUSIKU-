import crypto from 'crypto';
import { MusicPlaylist, PlaylistTrack, PlaylistFollow, MusicTrack } from '../models';
import { notFound, forbidden, badRequest } from '../utils/apiResponse';

export interface CreatePlaylistInput {
  name: string;
  description?: string;
  coverUrl?: string;
  visibility?: 'private' | 'public';
  collaborative?: boolean;
}

async function getOwnedPlaylist(playlistId: string, userId: string) {
  const playlist = await MusicPlaylist.findById(playlistId);
  if (!playlist) throw notFound('Playlist not found');
  if (String(playlist.owner) !== userId) throw forbidden('You do not own this playlist');
  return playlist;
}

async function recount(playlistId: string): Promise<void> {
  const count = await PlaylistTrack.countDocuments({ playlist: playlistId });
  await MusicPlaylist.updateOne({ _id: playlistId }, { $set: { trackCount: count } });
}

export const playlistService = {
  async list(userId: string) {
    const owned = await MusicPlaylist.find({ owner: userId }).sort({ updatedAt: -1 }).lean();
    const followed = await PlaylistFollow.find({ user: userId }).populate('playlist').lean();
    const followedPlaylists = followed
      .map((f) => (f as unknown as { playlist: unknown }).playlist)
      .filter(Boolean);
    return { owned, followed: followedPlaylists };
  },

  async create(userId: string, input: CreatePlaylistInput) {
    const playlist = await MusicPlaylist.create({
      owner: userId,
      name: input.name.trim(),
      description: input.description ?? '',
      coverUrl: input.coverUrl ?? '',
      visibility: input.visibility ?? 'private',
      collaborative: input.collaborative ?? false,
      shareToken: crypto.randomBytes(12).toString('hex'),
    });
    return playlist;
  },

  async getById(playlistId: string, userId?: string) {
    const playlist = await MusicPlaylist.findById(playlistId).lean();
    if (!playlist) throw notFound('Playlist not found');
    const isOwner = userId && String(playlist.owner) === userId;
    if (playlist.visibility !== 'public' && !isOwner) throw forbidden('This playlist is private');
    const tracks = await PlaylistTrack.find({ playlist: playlistId })
      .sort({ position: 1 })
      .populate('track')
      .lean();
    return { ...playlist, tracks };
  },

  async getByShareToken(token: string) {
    const playlist = await MusicPlaylist.findOne({ shareToken: token }).lean();
    if (!playlist) throw notFound('Playlist not found');
    const tracks = await PlaylistTrack.find({ playlist: playlist._id }).sort({ position: 1 }).populate('track').lean();
    return { ...playlist, tracks };
  },

  async update(playlistId: string, userId: string, patch: Partial<CreatePlaylistInput>) {
    const playlist = await getOwnedPlaylist(playlistId, userId);
    for (const key of ['name', 'description', 'coverUrl', 'visibility', 'collaborative'] as const) {
      if (patch[key] !== undefined) (playlist as unknown as Record<string, unknown>)[key] = patch[key];
    }
    await playlist.save();
    return playlist;
  },

  async remove(playlistId: string, userId: string): Promise<void> {
    await getOwnedPlaylist(playlistId, userId);
    await PlaylistTrack.deleteMany({ playlist: playlistId });
    await PlaylistFollow.deleteMany({ playlist: playlistId });
    await MusicPlaylist.deleteOne({ _id: playlistId });
  },

  async addTracks(playlistId: string, userId: string, trackIds: string[]) {
    await getOwnedPlaylist(playlistId, userId);
    const tracks = await MusicTrack.find({ _id: { $in: trackIds } }).lean();
    if (tracks.length === 0) throw badRequest('No valid tracks found');
    const max = await PlaylistTrack.findOne({ playlist: playlistId }).sort({ position: -1 }).lean();
    let position = (max?.position ?? -1) + 1;
    const docs = tracks.map((t) => ({ playlist: playlistId, track: t._id, position: position++, addedBy: userId }));
    await PlaylistTrack.insertMany(docs, { ordered: false }).catch(() => undefined);
    await recount(playlistId);
    return PlaylistTrack.find({ playlist: playlistId }).sort({ position: 1 }).populate('track').lean();
  },

  async removeTrack(playlistId: string, userId: string, trackId: string): Promise<void> {
    await getOwnedPlaylist(playlistId, userId);
    await PlaylistTrack.deleteOne({ playlist: playlistId, track: trackId });
    // Re-compact positions.
    const remaining = await PlaylistTrack.find({ playlist: playlistId }).sort({ position: 1 }).lean();
    await Promise.all(
      remaining.map((r, i) => PlaylistTrack.updateOne({ _id: r._id }, { $set: { position: i } })),
    );
    await recount(playlistId);
  },

  async reorder(playlistId: string, userId: string, orderedTrackIds: string[]): Promise<void> {
    await getOwnedPlaylist(playlistId, userId);
    await Promise.all(
      orderedTrackIds.map((trackId, i) =>
        PlaylistTrack.updateOne({ playlist: playlistId, track: trackId }, { $set: { position: i } }),
      ),
    );
  },

  async duplicate(playlistId: string, userId: string) {
    const source = await MusicPlaylist.findById(playlistId).lean();
    if (!source) throw notFound('Playlist not found');
    const copy = await MusicPlaylist.create({
      owner: userId,
      name: `${source.name} (copy)`,
      description: source.description,
      coverUrl: source.coverUrl,
      visibility: 'private',
      shareToken: crypto.randomBytes(12).toString('hex'),
    });
    const tracks = await PlaylistTrack.find({ playlist: playlistId }).sort({ position: 1 }).lean();
    if (tracks.length > 0) {
      await PlaylistTrack.insertMany(
        tracks.map((t) => ({ playlist: copy._id, track: t.track, position: t.position, addedBy: userId })),
      );
    }
    await recount(String(copy._id));
    return copy;
  },

  async follow(playlistId: string, userId: string): Promise<void> {
    const playlist = await MusicPlaylist.findById(playlistId);
    if (!playlist) throw notFound('Playlist not found');
    await PlaylistFollow.findOneAndUpdate(
      { playlist: playlistId, user: userId },
      { $setOnInsert: { playlist: playlistId, user: userId } },
      { upsert: true, new: true },
    );
    await MusicPlaylist.updateOne({ _id: playlistId }, { $inc: { followers: 1 } });
  },

  async unfollow(playlistId: string, userId: string): Promise<void> {
    const res = await PlaylistFollow.deleteOne({ playlist: playlistId, user: userId });
    if (res.deletedCount > 0) {
      await MusicPlaylist.updateOne({ _id: playlistId }, { $inc: { followers: -1 } });
    }
  },
};
