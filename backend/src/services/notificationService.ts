import { Notification, NotificationPreference } from '../models';
import { notFound } from '../utils/apiResponse';

export const notificationService = {
  async list(userId: string, page = 1, limit = 30, unreadOnly = false) {
    const filter: Record<string, unknown> = { user: userId };
    if (unreadOnly) filter.read = false;
    const total = await Notification.countDocuments(filter);
    const items = await Notification.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
    const unread = await Notification.countDocuments({ user: userId, read: false });
    return { items, total, unread };
  },

  async create(userId: string, input: { type: string; title: string; body?: string; deepLink?: string }) {
    const prefs = await NotificationPreference.findOne({ user: userId }).lean();
    if (prefs && (prefs as unknown as Record<string, boolean>)[input.type] === false) return null;
    return Notification.create({ user: userId, ...input });
  },

  async markRead(userId: string, notificationId: string) {
    const doc = await Notification.findOneAndUpdate(
      { _id: notificationId, user: userId },
      { $set: { read: true, readAt: new Date() } },
      { new: true },
    );
    if (!doc) throw notFound('Notification not found');
    return doc;
  },

  async markAllRead(userId: string): Promise<void> {
    await Notification.updateMany({ user: userId, read: false }, { $set: { read: true, readAt: new Date() } });
  },

  async remove(userId: string, notificationId: string): Promise<void> {
    const res = await Notification.deleteOne({ _id: notificationId, user: userId });
    if (res.deletedCount === 0) throw notFound('Notification not found');
  },

  async getPreferences(userId: string) {
    return NotificationPreference.findOneAndUpdate(
      { user: userId },
      { $setOnInsert: { user: userId } },
      { upsert: true, new: true },
    );
  },

  async updatePreferences(userId: string, patch: Record<string, unknown>) {
    const allowed = ['pushEnabled', 'newMusic', 'newEpisodes', 'artistUpdates', 'animeUpdates', 'playlistUpdates', 'account', 'premium', 'security'];
    const clean: Record<string, unknown> = {};
    for (const key of allowed) if (patch[key] !== undefined) clean[key] = patch[key];
    return NotificationPreference.findOneAndUpdate({ user: userId }, { $set: clean }, { upsert: true, new: true });
  },
};
