import { connectDatabase, disconnectDatabase, initIndexes } from './database';
import { env } from './env';
import { User, AdminRole, AdminUser, ApiProvider, FeatureFlag, AppSetting, MusicGenre, AnimeGenre } from '../models';
import { hashPassword } from '../utils/crypto';

/**
 * Database initialization + seed data.
 * Run: npm run seed
 * Creates: admin user, admin role, default providers (official/public),
 * feature flags, app settings, music + anime genres.
 */
async function seed(): Promise<void> {
  if (env.ADMIN_PASSWORD.length < 12) throw new Error('Set ADMIN_PASSWORD to a unique secret of at least 12 characters before seeding');
  await connectDatabase();
  await initIndexes();

  // ── Admin role + user ───────────────────────────────────────────────
  const role = await AdminRole.findOneAndUpdate(
    { name: 'super_admin' },
    { $set: { name: 'super_admin', permissions: ['*'], description: 'Full administrative access' } },
    { upsert: true, new: true },
  );

  const adminEmail = env.ADMIN_EMAIL.toLowerCase();
  let admin = await User.findOne({ email: adminEmail });
  if (!admin) {
    admin = await User.create({
      email: adminEmail,
      username: 'admin',
      passwordHash: await hashPassword(env.ADMIN_PASSWORD),
      role: 'admin',
      status: 'active',
      emailVerified: true,
    });
    // eslint-disable-next-line no-console
    console.log(`[seed] Admin user created: ${adminEmail} (password from ADMIN_PASSWORD env)`);
  }
  await AdminUser.findOneAndUpdate(
    { user: admin._id },
    { $set: { user: admin._id, role: role._id } },
    { upsert: true, new: true },
  );

  // ── Default providers (official / public, no key required) ──────────
  const providers = [
    { providerId: 'deezer', name: 'Deezer (public API)', type: 'music_metadata', baseUrl: 'https://api.deezer.com', authMethod: 'none', priority: 10, requiresCredentials: false, notes: 'Music metadata + 30s previews' },
    { providerId: 'itunes', name: 'iTunes Search API (public)', type: 'music_metadata', baseUrl: 'https://itunes.apple.com', authMethod: 'none', priority: 20, requiresCredentials: false, notes: 'Fallback music metadata + 30s previews' },
    { providerId: 'musicbrainz', name: 'MusicBrainz (public API)', type: 'music_metadata', baseUrl: 'https://musicbrainz.org/ws/2', authMethod: 'none', priority: 30, requiresCredentials: false, notes: 'Rich metadata fallback (no audio)' },
    { providerId: 'lrclib', name: 'LRCLIB (public API)', type: 'music_lyrics', baseUrl: 'https://lrclib.net', authMethod: 'none', priority: 10, requiresCredentials: false, notes: 'Plain + synced lyrics' },
    { providerId: 'anilist', name: 'AniList (public GraphQL API)', type: 'anime_metadata', baseUrl: 'https://graphql.anilist.co', authMethod: 'none', priority: 10, requiresCredentials: false, notes: 'Anime metadata (no streaming video)' },
    { providerId: 'jikan', name: 'Jikan (public REST API)', type: 'anime_metadata', baseUrl: 'https://api.jikan.moe/v4', authMethod: 'none', priority: 20, requiresCredentials: false, notes: 'Anime metadata + schedule fallback' },
    { providerId: 'licensed_music', name: 'Licensed Music Streaming', type: 'music_audio', baseUrl: 'https://api.example.com', authMethod: 'api_key', priority: 5, enabled: false, requiresCredentials: true, notes: 'NEEDS CREDENTIALS: LICENSED_MUSIC_API_KEY + LICENSED_MUSIC_BASE_URL' },
    { providerId: 'licensed_anime', name: 'Licensed Anime Streaming', type: 'anime_video', baseUrl: 'https://api.example.com', authMethod: 'api_key', priority: 5, enabled: false, requiresCredentials: true, notes: 'NEEDS CREDENTIALS: LICENSED_ANIME_API_KEY + LICENSED_ANIME_BASE_URL' },
  ];
  for (const p of providers) {
    await ApiProvider.findOneAndUpdate(
      { providerId: p.providerId },
      { $setOnInsert: { ...p, enabled: p.enabled ?? true } },
      { upsert: true, new: true },
    );
  }
  // eslint-disable-next-line no-console
  console.log('[seed] Providers seeded');

  // ── Feature flags ───────────────────────────────────────────────────
  const flags = [
    { key: 'offline_downloads', enabled: false, description: 'Enable offline downloads (requires licensed content + storage)' },
    { key: 'collaborative_playlists', enabled: false, description: 'Collaborative playlists (requires realtime infra)' },
    { key: 'google_signin', enabled: false, description: 'Google Sign-In (requires GOOGLE_CLIENT_ID/SECRET)' },
    { key: 'premium_payments', enabled: false, description: 'Premium payments (requires payment provider credentials)' },
  ];
  for (const f of flags) {
    await FeatureFlag.findOneAndUpdate({ key: f.key }, { $setOnInsert: f }, { upsert: true, new: true });
  }

  // ── App settings ────────────────────────────────────────────────────
  await AppSetting.findOneAndUpdate(
    { key: 'maintenance_mode' },
    { $setOnInsert: { key: 'maintenance_mode', value: false, description: 'When true, the app shows a maintenance screen' } },
    { upsert: true, new: true },
  );

  // ── Genres ──────────────────────────────────────────────────────────
  const musicGenres = ['Pop', 'Rock', 'Hip-hop', 'R&B', 'Jazz', 'Classical', 'Electronic', 'Indie', 'K-pop', 'J-pop', 'Anime Soundtrack', 'Lo-fi'];
  for (const name of musicGenres) {
    await MusicGenre.findOneAndUpdate(
      { name },
      { $setOnInsert: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } },
      { upsert: true, new: true },
    );
  }
  const animeGenres = ['Action', 'Adventure', 'Comedy', 'Drama', 'Fantasy', 'Romance', 'Sci-Fi', 'Mystery', 'Horror', 'Slice of Life', 'Sports', 'Supernatural', 'Isekai', 'Mecha', 'Psychological'];
  for (const name of animeGenres) {
    await AnimeGenre.findOneAndUpdate(
      { name },
      { $setOnInsert: { name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-') } },
      { upsert: true, new: true },
    );
  }

  // eslint-disable-next-line no-console
  console.log('[seed] Done.');
  await disconnectDatabase();
}

seed().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed] Failed:', err);
  process.exit(1);
});
