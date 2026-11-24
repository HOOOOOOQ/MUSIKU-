import mongoose, { Schema } from 'mongoose';

/* Catalog collections are populated from official/public providers
 * (Deezer, iTunes, MusicBrainz) and cached here. `providerId` is the
 * provider-side identifier; `source` records which provider supplied it. */

const trackSchema = new Schema(
  {
    providerId: { type: String, required: true, index: true },
    source: { type: String, required: true, index: true },
    title: { type: String, required: true },
    artistName: { type: String, default: '' },
    artistProviderId: { type: String, default: '' },
    albumName: { type: String, default: '' },
    albumProviderId: { type: String, default: '' },
    artworkUrl: { type: String, default: '' },
    durationSec: { type: Number, default: 0 },
    previewUrl: { type: String, default: '' },
    streamUrl: { type: String, default: '' },
    genres: { type: [String], default: [] },
    releaseDate: { type: Date, default: undefined },
    explicit: { type: Boolean, default: false },
    popularity: { type: Number, default: 0, index: true },
    isrc: { type: String, default: '' },
  },
  { timestamps: true },
);
trackSchema.index({ providerId: 1, source: 1 }, { unique: true });
trackSchema.index({ title: 'text', artistName: 'text' });
trackSchema.index({ createdAt: -1 });
export const MusicTrack = mongoose.model('MusicTrack', trackSchema, 'music_tracks');

const artistSchema = new Schema(
  {
    providerId: { type: String, required: true, index: true },
    source: { type: String, required: true, index: true },
    name: { type: String, required: true },
    imageUrl: { type: String, default: '' },
    biography: { type: String, default: '' },
    genres: { type: [String], default: [] },
    followers: { type: Number, default: 0 },
    popularity: { type: Number, default: 0, index: true },
  },
  { timestamps: true },
);
artistSchema.index({ providerId: 1, source: 1 }, { unique: true });
artistSchema.index({ name: 'text' });
export const MusicArtist = mongoose.model('MusicArtist', artistSchema, 'music_artists');

const albumSchema = new Schema(
  {
    providerId: { type: String, required: true, index: true },
    source: { type: String, required: true, index: true },
    title: { type: String, required: true },
    artistName: { type: String, default: '' },
    artistProviderId: { type: String, default: '' },
    artworkUrl: { type: String, default: '' },
    trackCount: { type: Number, default: 0 },
    releaseDate: { type: Date, default: undefined },
    genres: { type: [String], default: [] },
    popularity: { type: Number, default: 0, index: true },
  },
  { timestamps: true },
);
albumSchema.index({ providerId: 1, source: 1 }, { unique: true });
albumSchema.index({ title: 'text', artistName: 'text' });
export const MusicAlbum = mongoose.model('MusicAlbum', albumSchema, 'music_albums');

const genreSchema = new Schema(
  {
    name: { type: String, required: true, unique: true, index: true },
    slug: { type: String, required: true, unique: true },
    imageUrl: { type: String, default: '' },
    mood: { type: String, default: '' },
  },
  { timestamps: true },
);
export const MusicGenre = mongoose.model('MusicGenre', genreSchema, 'music_genres');

/* ── playlists ─────────────────────────────────────────────────────────── */
const playlistSchema = new Schema(
  {
    owner: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 100 },
    description: { type: String, maxlength: 500, default: '' },
    coverUrl: { type: String, default: '' },
    visibility: { type: String, enum: ['private', 'public'], default: 'private', index: true },
    collaborative: { type: Boolean, default: false },
    trackCount: { type: Number, default: 0 },
    followers: { type: Number, default: 0 },
    shareToken: { type: String, default: undefined, index: true },
  },
  { timestamps: true },
);
playlistSchema.index({ owner: 1, createdAt: -1 });
playlistSchema.index({ name: 'text' });
export const MusicPlaylist = mongoose.model('MusicPlaylist', playlistSchema, 'music_playlists');

const playlistTrackSchema = new Schema(
  {
    playlist: { type: Schema.Types.ObjectId, ref: 'MusicPlaylist', required: true, index: true },
    track: { type: Schema.Types.ObjectId, ref: 'MusicTrack', required: true },
    position: { type: Number, required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: 'User', default: undefined },
  },
  { timestamps: true },
);
playlistTrackSchema.index({ playlist: 1, position: 1 });
playlistTrackSchema.index({ playlist: 1, track: 1 }, { unique: true });
export const PlaylistTrack = mongoose.model('PlaylistTrack', playlistTrackSchema, 'playlist_tracks');

const playlistFollowSchema = new Schema(
  {
    playlist: { type: Schema.Types.ObjectId, ref: 'MusicPlaylist', required: true, index: true },
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: true },
);
playlistFollowSchema.index({ playlist: 1, user: 1 }, { unique: true });
export const PlaylistFollow = mongoose.model('PlaylistFollow', playlistFollowSchema, 'playlist_follows');

/* ── user music collections ────────────────────────────────────────────── */
const likedSongSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    track: { type: Schema.Types.ObjectId, ref: 'MusicTrack', required: true },
  },
  { timestamps: true },
);
likedSongSchema.index({ user: 1, track: 1 }, { unique: true });
likedSongSchema.index({ user: 1, createdAt: -1 });
export const LikedSong = mongoose.model('LikedSong', likedSongSchema, 'liked_songs');

const followedArtistSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    artist: { type: Schema.Types.ObjectId, ref: 'MusicArtist', required: true },
  },
  { timestamps: true },
);
followedArtistSchema.index({ user: 1, artist: 1 }, { unique: true });
export const FollowedArtist = mongoose.model('FollowedArtist', followedArtistSchema, 'followed_artists');

const savedAlbumSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    album: { type: Schema.Types.ObjectId, ref: 'MusicAlbum', required: true },
  },
  { timestamps: true },
);
savedAlbumSchema.index({ user: 1, album: 1 }, { unique: true });
export const SavedAlbum = mongoose.model('SavedAlbum', savedAlbumSchema, 'saved_albums');

const musicHistorySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    track: { type: Schema.Types.ObjectId, ref: 'MusicTrack', required: true },
    positionSec: { type: Number, default: 0 },
    playedAt: { type: Date, default: Date.now, index: true },
    completed: { type: Boolean, default: false },
  },
  { timestamps: true },
);
musicHistorySchema.index({ user: 1, playedAt: -1 });
export const MusicHistory = mongoose.model('MusicHistory', musicHistorySchema, 'music_history');

const musicQueueSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    trackIds: { type: [String], default: [] },
    currentIndex: { type: Number, default: 0 },
    positionSec: { type: Number, default: 0 },
    shuffle: { type: Boolean, default: false },
    repeat: { type: String, enum: ['off', 'all', 'one'], default: 'off' },
  },
  { timestamps: true },
);
export const MusicQueue = mongoose.model('MusicQueue', musicQueueSchema, 'music_queues');
