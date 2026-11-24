import mongoose from 'mongoose';
import * as models from '../../src/models';

describe('MongoDB schema contracts (no database connection)', () => {
  test.each(Object.entries(models).filter(([, value]) => value instanceof Function && 'schema' in value))('%s has timestamps and explicit collection', (_name, value) => {
    const model = value as mongoose.Model<unknown>;
    expect(model.schema.options.timestamps).toBe(true);
    expect(model.schema.path('createdAt')).toBeDefined();
    expect(model.schema.path('updatedAt')).toBeDefined();
    expect(model.collection.collectionName).toMatch(/^[a-z_]+$/);
  });
  test('user identity indexes are unique', () => {
    const indexes = models.User.schema.indexes();
    expect(indexes.some(([keys, opts]) => keys.email === 1 && opts.unique)).toBe(true);
    expect(indexes.some(([keys, opts]) => keys.username === 1 && opts.unique)).toBe(true);
  });
  test('invalid user rejected before persistence', () => {
    expect(new models.User({ email: 'a@b.id', username: 'ab', role: 'owner' }).validateSync()).toBeDefined();
  });
  test('temporary provider cache has TTL', () => {
    expect(models.ProviderCache.schema.indexes().some(([keys, opts]) => keys.expiresAt === 1 && opts.expireAfterSeconds === 0)).toBe(true);
  });
  test('required collection names are preserved exactly', () => {
    expect(models.MusicTrack.collection.collectionName).toBe('music_tracks');
    expect(models.UserProfile.collection.collectionName).toBe('user_profiles');
    expect(models.Anime.collection.collectionName).toBe('anime');
    expect(models.ApiProvider.collection.collectionName).toBe('api_providers');
    expect(models.AnimeWatchHistory.collection.collectionName).toBe('anime_watch_history');
  });
});
