import { auditService } from './auditService';
import { googleIdentity } from './googleIdentity';
import { deliverActionEmail } from './emailService';
import crypto from 'crypto';
import { User, UserProfile, UserSession, UserPreference, UserDevice, LoginHistory, PasswordReset, EmailVerification, NotificationPreference, OAuthReplay } from '../models';
import { hashPassword, verifyPassword, sha256, randomToken, signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/crypto';
import { env, googleOAuthConfig, hasEmail } from '../config/env';
import { ApiError, badRequest, unauthorized, conflict, notFound } from '../utils/apiResponse';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface RegisterInput {
  email: string;
  username: string;
  password: string;
  displayName?: string;
}

async function issueTokens(
  userId: string,
  role: string,
  deviceId = '',
  ip = '',
  userAgent = '',
  family = '',
): Promise<AuthTokens> {
  const refreshToken = signRefreshToken(userId);
  // A new login starts a rotation family; a rotation continues the existing one.
  const familyId = family || crypto.randomUUID();
  const session = await UserSession.create({
    user: userId,
    refreshTokenHash: sha256(refreshToken),
    family: familyId,
    deviceId,
    ip,
    userAgent,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  return { accessToken: signAccessToken(userId, role, String(session._id)), refreshToken };
}

/** Revoke every live session of one rotation family (theft containment). */
async function revokeFamily(user: unknown, family: string, reason: string): Promise<number> {
  const result = await UserSession.updateMany(
    { user, family, revokedAt: { $exists: false } },
    { $set: { revokedAt: new Date(), revokedReason: reason } },
  );
  return (result as { modifiedCount?: number }).modifiedCount ?? 0;
}

async function ensureProfile(userId: string, displayName = ''): Promise<void> {
  await UserProfile.findOneAndUpdate({ user: userId }, { $setOnInsert: { user: userId, displayName } }, { upsert: true, new: true });
  await UserPreference.findOneAndUpdate({ user: userId }, { $setOnInsert: { user: userId } }, { upsert: true, new: true });
  await NotificationPreference.findOneAndUpdate({ user: userId }, { $setOnInsert: { user: userId } }, { upsert: true, new: true });
}

export const authService = {
  async register(input: RegisterInput): Promise<{ user: unknown; tokens: AuthTokens }> {
    if (env.NODE_ENV === 'production' && !hasEmail) throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email delivery is not configured');
    const email = input.email.toLowerCase().trim();
    const username = input.username.toLowerCase().trim();
    const existing = await User.findOne({ $or: [{ email }, { username }] }).lean();
    if (existing) throw conflict('Email or username is already registered');

    const user = await User.create({
      email,
      username,
      passwordHash: await hashPassword(input.password),
      role: 'user',
      status: 'active',
    });
    await ensureProfile(String(user._id), input.displayName ?? username);

    // Email verification token (delivered via email provider when configured).
    const verifyToken = randomToken();
    await EmailVerification.create({
      user: user._id,
      tokenHash: sha256(verifyToken),
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    await deliverActionEmail(email, 'verify-email', verifyToken);
    const tokens = await issueTokens(String(user._id), user.role);
    await auditService.log(String(user._id), 'auth.session.issued', 'User', String(user._id));
    return { user: sanitizeUser(user), tokens };
  },

  async login(email: string, password: string, meta: { ip?: string; userAgent?: string; deviceId?: string } = {}): Promise<{ user: unknown; tokens: AuthTokens }> {
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    const okLogin = user && (await verifyPassword(password, user.passwordHash));
    await LoginHistory.create({
      user: user?._id,
      success: Boolean(okLogin),
      method: 'email',
      ip: meta.ip ?? '',
      userAgent: meta.userAgent ?? '',
    });
    if (!user || !okLogin) throw unauthorized('Invalid email or password');
    if (user.status === 'suspended') throw unauthorized('Account is suspended');
    if (user.status === 'deleted') throw unauthorized('Account has been deleted');

    user.lastLoginAt = new Date();
    await user.save();

    if (meta.deviceId) {
      await UserDevice.findOneAndUpdate(
        { user: user._id, deviceId: meta.deviceId },
        { $set: { lastSeenAt: new Date(), platform: 'android' } },
        { upsert: true, new: true },
      );
    }

    const tokens = await issueTokens(String(user._id), user.role, meta.deviceId ?? '', meta.ip ?? '', meta.userAgent ?? '');
    await auditService.log(String(user._id), 'auth.session.issued', 'User', String(user._id));
    return { user: sanitizeUser(user), tokens };
  },

  /** Google Sign-In: verifies the ID token against Google's JWKS via fetch. */
  async loginWithGoogle(idToken: string, meta: { ip?: string; userAgent?: string; deviceId?: string } = {}): Promise<{ user: unknown; tokens: AuthTokens }> {
    if (!googleOAuthConfig().configured) {
      throw new Error('GOOGLE_NOT_CONFIGURED');
    }
    const info = await googleIdentity.verify(idToken);
    try { await OAuthReplay.create({ tokenHash: sha256(idToken), expiresAt: new Date(info.exp * 1000) }); }
    catch (error) { if ((error as {code?: number}).code === 11000) throw unauthorized('Google token already exchanged'); throw error; }

    let user = await User.findOne({ googleId: info.sub });
    if (!user) {
      user = await User.findOne({ email: info.email!.toLowerCase() });
      if (user) {
        if (user.status !== 'active') throw unauthorized('Account unavailable');
        if (!user.emailVerified || (user.googleId && user.googleId !== info.sub)) throw conflict('Verify the existing account email before linking Google');
        user.googleId = info.sub;
        await user.save();
      } else {
        const username = info.email!.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24) || `user${Date.now()}`;
        user = await User.create({
          email: info.email!.toLowerCase(),
          username: `${username.slice(0, 17)}_${crypto.randomBytes(6).toString('hex')}`,
          googleId: info.sub,
          emailVerified: true,
          role: 'user',
          status: 'active',
        });
        await ensureProfile(String(user._id), info.name ?? username);
        await UserProfile.updateOne({ user: user._id }, { $set: { avatarUrl: info.picture ?? '' } });
      }
    }
    if (user.status !== 'active') throw unauthorized('Account unavailable');
    await LoginHistory.create({ user: user._id, success: true, method: 'google', ip: meta.ip ?? '', userAgent: meta.userAgent ?? '' });
    if (meta.deviceId) await UserDevice.findOneAndUpdate({ user: user._id, deviceId: meta.deviceId }, { $set: { platform: 'android', lastSeenAt: new Date() } }, { upsert: true, new: true });
    const tokens = await issueTokens(String(user._id), user.role, meta.deviceId ?? '', meta.ip ?? '', meta.userAgent ?? '');
    await auditService.log(String(user._id), 'auth.session.issued', 'User', String(user._id));
    return { user: sanitizeUser(user), tokens };
  },

  /**
   * Refresh-token rotation with reuse detection.
   *
   * The presented token is consumed atomically (`findOneAndUpdate` on an
   * unrevoked, unexpired session), so only one of two concurrent rotations can
   * win. A token that has already been consumed is a replay:
   *   - inside `REFRESH_REUSE_GRACE_MS` it is treated as a benign duplicate
   *     request (two tabs / a retried network call) and rejected without
   *     punishing the session that legitimately rotated;
   *   - after the grace window, or when the token was revoked by logout rather
   *     than rotation, it is treated as theft: the whole rotation family is
   *     revoked, an audit entry and a system event are written, and the caller
   *     gets a generic 401.
   */
  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: { sub: string };
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw unauthorized('Invalid or expired refresh token');
    }

    const now = new Date();
    const tokenHash = sha256(refreshToken);
    const session = await UserSession.findOneAndUpdate(
      { refreshTokenHash: tokenHash, revokedAt: { $exists: false }, expiresAt: { $gt: now } },
      { $set: { revokedAt: now, rotatedAt: now, revokedReason: 'rotated' } },
      { new: true },
    );

    if (!session) {
      const prior = await UserSession.findOne({ refreshTokenHash: tokenHash });
      if (!prior) throw unauthorized('Session expired or revoked');
      const rotatedAt = prior.rotatedAt ? new Date(prior.rotatedAt as unknown as string).getTime() : 0;
      const withinGrace = rotatedAt > 0 && Date.now() - rotatedAt <= env.REFRESH_REUSE_GRACE_MS;
      if (withinGrace) throw unauthorized('Refresh token already rotated');

      const family = (prior.family as string) || String(prior._id);
      const revoked = await revokeFamily(prior.user, family, 'reuse_detected');
      await auditService.log(String(prior.user), 'auth.refresh.reuse_detected', 'UserSession', String(prior._id), { family, revokedSessions: revoked });
      await auditService.event('warn', 'auth', 'Refresh token reuse detected; rotation family revoked', { family, revokedSessions: revoked });
      throw unauthorized('Session expired or revoked');
    }

    if (new Date(session.expiresAt).getTime() < Date.now()) {
      throw unauthorized('Session expired or revoked');
    }
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active') throw unauthorized('Account unavailable');

    // Rotate within the same family so a stolen ancestor token can be contained.
    return issueTokens(String(user._id), user.role, session.deviceId, session.ip, session.userAgent, (session.family as string) || String(session._id));
  },

  async logout(refreshToken: string): Promise<void> {
    await UserSession.updateOne(
      { refreshTokenHash: sha256(refreshToken) },
      { $set: { revokedAt: new Date(), revokedReason: 'logout' } },
    );
  },

  async forgotPassword(email: string): Promise<{ sent: boolean; token?: string }> {
    if (env.NODE_ENV === 'production' && !hasEmail) throw new ApiError(503, 'EMAIL_NOT_CONFIGURED', 'Email delivery is not configured');
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) return { sent: true }; // Do not leak account existence.
    const token = randomToken();
    await PasswordReset.create({
      user: user._id,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    });
    await deliverActionEmail(user.email, 'reset-password', token);
    // Email delivery happens via the configured email provider (needs credentials).
    // Outside production (dev/test) the token is returned so flows can be tested;
    // in production it is delivered by email only.
    return { sent: true, token: process.env.NODE_ENV === 'test' ? token : undefined };
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await PasswordReset.findOneAndUpdate({ tokenHash: sha256(token), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } }, { new: true });
    if (!record || new Date(record.expiresAt).getTime() < Date.now()) {
      throw badRequest('Invalid or expired reset token');
    }
    const user = await User.findById(record.user);
    if (!user) throw notFound('User not found');
    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    record.usedAt = new Date();
    await record.save();
    await UserSession.updateMany({ user: user._id }, { $set: { revokedAt: new Date(), revokedReason: 'password_changed' } });
    await auditService.log(String(user._id), 'auth.password.reset', 'User', String(user._id));
  },

  async resendVerification(userId: string): Promise<void> {
    const user = await User.findById(userId);
    if (!user || user.status !== 'active') throw notFound('Account unavailable');
    if (user.emailVerified) return;
    const token = randomToken();
    await EmailVerification.create({ user: user._id, tokenHash: sha256(token), expiresAt: new Date(Date.now() + 86400000) });
    await deliverActionEmail(user.email, 'verify-email', token);
  },

  async verifyEmail(token: string): Promise<void> {
    const record = await EmailVerification.findOneAndUpdate({ tokenHash: sha256(token), usedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { usedAt: new Date() } }, { new: true });
    if (!record || new Date(record.expiresAt).getTime() < Date.now()) {
      throw badRequest('Invalid or expired verification token');
    }
    await User.updateOne({ _id: record.user }, { $set: { emailVerified: true } });
    record.usedAt = new Date();
    await record.save();
  },

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await User.findById(userId);
    if (!user) throw notFound('User not found');
    if (!(await verifyPassword(currentPassword, user.passwordHash))) {
      throw badRequest('Current password is incorrect');
    }
    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    await UserSession.updateMany({ user: userId }, { $set: { revokedAt: new Date(), revokedReason: 'password_changed' } });
  },

  async deleteAccount(userId: string): Promise<void> {
    await auditService.log(userId, 'auth.account.delete', 'User', userId);
    const user = await User.findById(userId);
    if (!user) throw notFound('User not found');
    user.status = 'deleted';
    user.email = `deleted-${user._id}@deleted.local`;
    user.username = `del_${String(user._id).slice(-24)}`;
    user.googleId = undefined;
    user.passwordHash = undefined;
    await user.save();
    await UserSession.updateMany({ user: userId }, { $set: { revokedAt: new Date(), revokedReason: 'account_deleted' } });
  },

  async getMe(userId: string): Promise<unknown> {
    const user = await User.findById(userId).lean();
    if (!user) throw notFound('User not found');
    const profile = await UserProfile.findOne({ user: userId }).lean();
    const preferences = await UserPreference.findOne({ user: userId }).lean();
    return { ...sanitizeUser(user), profile, preferences };
  },
};

export function sanitizeUser(user: unknown): Record<string, unknown> {
  const { passwordHash, ...rest } = ((user as { toObject?: () => unknown }).toObject?.() ?? user) as Record<string, unknown>;
  void passwordHash;
  return rest;
}

export const newSessionId = (): string => crypto.randomUUID();
