import mongoose, { Schema, Types } from 'mongoose';

/* ── users ─────────────────────────────────────────────────────────────── */
export interface IUser extends mongoose.Document {
  email: string;
  username: string;
  passwordHash?: string;
  googleId?: string;
  role: 'user' | 'admin';
  status: 'active' | 'suspended' | 'deleted';
  emailVerified: boolean;
  premium: boolean;
  premiumExpiresAt?: Date;
  lastLoginAt?: Date;
}

const userSchema = new Schema<IUser>(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true, minlength: 3, maxlength: 30, index: true },
    passwordHash: { type: String, default: undefined },
    googleId: { type: String, default: undefined, unique: true, sparse: true },
    role: { type: String, enum: ['user', 'admin'], default: 'user', index: true },
    status: { type: String, enum: ['active', 'suspended', 'deleted'], default: 'active', index: true },
    emailVerified: { type: Boolean, default: false },
    premium: { type: Boolean, default: false, index: true },
    premiumExpiresAt: { type: Date, default: undefined },
    lastLoginAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);
userSchema.index({ createdAt: -1 });
export const User = mongoose.model<IUser>('User', userSchema, 'users');

/* ── user_profiles ─────────────────────────────────────────────────────── */
const profileSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    displayName: { type: String, trim: true, maxlength: 60, default: '' },
    avatarUrl: { type: String, default: '' },
    bio: { type: String, maxlength: 500, default: '' },
    country: { type: String, maxlength: 60, default: '' },
    language: { type: String, default: 'id' },
    favoriteMusicGenres: { type: [String], default: [] },
    favoriteAnimeGenres: { type: [String], default: [] },
    favoriteArtists: { type: [String], default: [] },
    favoriteAnime: { type: [String], default: [] },
  },
  { timestamps: true },
);
export const UserProfile = mongoose.model('UserProfile', profileSchema, 'user_profiles');

/* ── user_sessions (refresh-token sessions) ────────────────────────────── */
const sessionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    refreshTokenHash: { type: String, required: true, unique: true, index: true },
    deviceId: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    ip: { type: String, default: '' },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL cleanup
export const UserSession = mongoose.model('UserSession', sessionSchema, 'user_sessions');

/* ── user_devices ──────────────────────────────────────────────────────── */
const deviceSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    deviceId: { type: String, required: true },
    platform: { type: String, default: 'android' },
    model: { type: String, default: '' },
    appVersion: { type: String, default: '' },
    lastSeenAt: { type: Date, default: Date.now },
    trusted: { type: Boolean, default: false },
  },
  { timestamps: true },
);
deviceSchema.index({ user: 1, deviceId: 1 }, { unique: true });
export const UserDevice = mongoose.model('UserDevice', deviceSchema, 'user_devices');

/* ── user_preferences ──────────────────────────────────────────────────── */
const preferencesSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    theme: { type: String, enum: ['system', 'dark', 'light'], default: 'system' },
    language: { type: String, default: 'id' },
    defaultAudioQuality: { type: String, default: 'auto' },
    autoplay: { type: Boolean, default: true },
    crossfade: { type: Boolean, default: false },
    normalizeVolume: { type: Boolean, default: false },
    explicitContent: { type: Boolean, default: true },
    defaultSubtitle: { type: String, default: 'id' },
    defaultVideoQuality: { type: String, default: 'auto' },
    autoplayNextEpisode: { type: Boolean, default: true },
    skipIntro: { type: Boolean, default: false },
    backgroundPlayback: { type: Boolean, default: true },
    playbackSpeed: { type: Number, default: 1 },
    personalizedRecommendations: { type: Boolean, default: true },
    listeningActivity: { type: Boolean, default: true },
    watchHistoryEnabled: { type: Boolean, default: true },
    landingPage: { type: String, default: 'home' },
  },
  { timestamps: true },
);
export const UserPreference = mongoose.model('UserPreference', preferencesSchema, 'user_preferences');

/* ── login_histories ───────────────────────────────────────────────────── */
const loginHistorySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    success: { type: Boolean, required: true },
    method: { type: String, default: 'email' },
    ip: { type: String, default: '' },
    userAgent: { type: String, default: '' },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);
loginHistorySchema.index({ user: 1, createdAt: -1 });
export const LoginHistory = mongoose.model('LoginHistory', loginHistorySchema, 'login_histories');

/* ── password_resets / email_verifications (token flows) ───────────────── */
const passwordResetSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const PasswordReset = mongoose.model('PasswordReset', passwordResetSchema, 'password_resets');

const emailVerificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true, index: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);
emailVerificationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const EmailVerification = mongoose.model('EmailVerification', emailVerificationSchema, 'email_verifications');

export type ObjectId = Types.ObjectId;

const oauthReplaySchema = new Schema({ tokenHash: { type: String, required: true, unique: true }, expiresAt: { type: Date, required: true } }, { timestamps: true });
oauthReplaySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const OAuthReplay = mongoose.model('OAuthReplay', oauthReplaySchema, 'oauth_replays');
