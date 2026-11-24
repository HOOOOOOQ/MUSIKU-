import mongoose, { Schema } from 'mongoose';

/* ── notifications ─────────────────────────────────────────────────────── */
const notificationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: {
      type: String,
      enum: ['new_music', 'new_episode', 'artist_update', 'anime_update', 'playlist_update', 'account', 'premium', 'security', 'system'],
      default: 'system',
      index: true,
    },
    title: { type: String, required: true },
    body: { type: String, default: '' },
    deepLink: { type: String, default: '' },
    read: { type: Boolean, default: false, index: true },
    readAt: { type: Date, default: undefined },
  },
  { timestamps: true },
);
notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ user: 1, read: 1, createdAt: -1 });
export const Notification = mongoose.model('Notification', notificationSchema, 'notifications');

const notificationPrefSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    pushEnabled: { type: Boolean, default: true },
    newMusic: { type: Boolean, default: true },
    newEpisodes: { type: Boolean, default: true },
    artistUpdates: { type: Boolean, default: true },
    animeUpdates: { type: Boolean, default: true },
    playlistUpdates: { type: Boolean, default: true },
    account: { type: Boolean, default: true },
    premium: { type: Boolean, default: true },
    security: { type: Boolean, default: true },
  },
  { timestamps: true },
);
export const NotificationPreference = mongoose.model('NotificationPreference', notificationPrefSchema, 'notification_preferences');

/* ── search_histories ──────────────────────────────────────────────────── */
const searchHistorySchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    query: { type: String, required: true, trim: true },
    category: { type: String, default: 'all' },
    searchedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true },
);
searchHistorySchema.index({ user: 1, searchedAt: -1 });
searchHistorySchema.index({ user: 1, query: 1 }, { unique: true });
export const SearchHistory = mongoose.model('SearchHistory', searchHistorySchema, 'search_histories');

/* ── recommendations (cached personalized picks) ───────────────────────── */
const recommendationSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['music', 'anime'], required: true, index: true },
    title: { type: String, required: true },
    items: { type: [Schema.Types.Mixed], default: [] },
    score: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);
recommendationSchema.index({ user: 1, kind: 1, createdAt: -1 });
recommendationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
export const Recommendation = mongoose.model('Recommendation', recommendationSchema, 'recommendations');

/* ── subscriptions & payments ──────────────────────────────────────────── */
export const SUBSCRIPTION_PLANS = ['free', 'premium_monthly', 'premium_yearly'] as const;

const subscriptionSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    plan: { type: String, enum: SUBSCRIPTION_PLANS, default: 'free', index: true },
    status: { type: String, enum: ['active', 'canceled', 'expired', 'past_due'], default: 'active', index: true },
    provider: { type: String, default: '' },
    providerSubscriptionId: { type: String, default: '' },
    currentPeriodEnd: { type: Date, default: undefined },
    cancelAtPeriodEnd: { type: Boolean, default: false },
    autoRenew: { type: Boolean, default: true },
  },
  { timestamps: true },
);
subscriptionSchema.index({ user: 1, createdAt: -1 });
export const Subscription = mongoose.model('Subscription', subscriptionSchema, 'subscriptions');

const paymentSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    subscription: { type: Schema.Types.ObjectId, ref: 'Subscription', default: undefined },
    provider: { type: String, default: '' },
    providerPaymentId: { type: String, default: '' },
    amount: { type: Number, required: true },
    currency: { type: String, default: 'IDR' },
    status: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending', index: true },
    plan: { type: String, default: '' },
    paidAt: { type: Date, default: undefined },
    raw: { type: Schema.Types.Mixed, default: undefined },
  },
  { timestamps: true },
);
paymentSchema.index({ user: 1, createdAt: -1 });
export const Payment = mongoose.model('Payment', paymentSchema, 'payments');

/* ── download_records (authorized content only) ────────────────────────── */
const downloadRecordSchema = new Schema(
  {
    user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    kind: { type: String, enum: ['audio', 'video'], required: true },
    contentId: { type: String, required: true },
    title: { type: String, default: '' },
    quality: { type: String, default: 'auto' },
    status: { type: String, enum: ['queued', 'downloading', 'paused', 'completed', 'failed', 'deleted'], default: 'queued', index: true },
    progress: { type: Number, default: 0 },
    sizeBytes: { type: Number, default: 0 },
    storageKey: { type: String, default: '' },
    licenseRef: { type: String, default: '' },
  },
  { timestamps: true },
);
downloadRecordSchema.index({ user: 1, createdAt: -1 });
export const DownloadRecord = mongoose.model('DownloadRecord', downloadRecordSchema, 'download_records');

/* ── app_settings / feature_flags ──────────────────────────────────────── */
const appSettingSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: Schema.Types.Mixed, default: null },
    description: { type: String, default: '' },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: undefined },
  },
  { timestamps: true },
);
export const AppSetting = mongoose.model('AppSetting', appSettingSchema, 'app_settings');

const featureFlagSchema = new Schema(
  {
    key: { type: String, required: true, unique: true, index: true },
    enabled: { type: Boolean, default: false, index: true },
    description: { type: String, default: '' },
  },
  { timestamps: true },
);
export const FeatureFlag = mongoose.model('FeatureFlag', featureFlagSchema, 'feature_flags');
