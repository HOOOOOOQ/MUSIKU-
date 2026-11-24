import { googleIdentity } from './googleIdentity';
import { deliverActionEmail } from './emailService';
import crypto from 'crypto';
import { User, UserProfile, UserSession, UserPreference, UserDevice, LoginHistory, PasswordReset, EmailVerification, NotificationPreference, OAuthReplay } from '../models';
import { hashPassword, verifyPassword, sha256, randomToken, signAccessToken, signRefreshToken, verifyRefreshToken } from '../utils/crypto';
import { env, hasGoogleOAuth } from '../config/env';
import { badRequest, unauthorized, conflict, notFound } from '../utils/apiResponse';

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

async function issueTokens(userId: string, role: string, deviceId = '', ip = '', userAgent = ''): Promise<AuthTokens> {
  const accessToken = signAccessToken(userId, role);
  const refreshToken = signRefreshToken(userId);
  await UserSession.create({
    user: userId,
    refreshTokenHash: sha256(refreshToken),
    deviceId,
    ip,
    userAgent,
    expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
  });
  return { accessToken, refreshToken };
}

async function ensureProfile(userId: string, displayName = ''): Promise<void> {
  await UserProfile.findOneAndUpdate({ user: userId }, { $setOnInsert: { user: userId, displayName } }, { upsert: true, new: true });
  await UserPreference.findOneAndUpdate({ user: userId }, { $setOnInsert: { user: userId } }, { upsert: true, new: true });
  await NotificationPreference.findOneAndUpdate({ user: userId }, { $setOnInsert: { user: userId } }, { upsert: true, new: true });
}

export const authService = {
  async register(input: RegisterInput): Promise<{ user: unknown; tokens: AuthTokens }> {
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
    return { user: sanitizeUser(user), tokens };
  },

  /** Google Sign-In: verifies the ID token against Google's JWKS via fetch. */
  async loginWithGoogle(idToken: string, meta: { ip?: string; userAgent?: string; deviceId?: string } = {}): Promise<{ user: unknown; tokens: AuthTokens }> {
    if (!hasGoogleOAuth) {
      throw new Error('GOOGLE_NOT_CONFIGURED');
    }
    const info = await googleIdentity.verify(idToken);
    try { await OAuthReplay.create({ tokenHash: sha256(idToken), expiresAt: new Date(info.exp * 1000) }); }
    catch (error) { if ((error as {code?: number}).code === 11000) throw unauthorized('Google token already exchanged'); throw error; }

    let user = await User.findOne({ googleId: info.sub });
    if (!user) {
      user = await User.findOne({ email: info.email!.toLowerCase() });
      if (user) {
        if (!user.emailVerified || (user.googleId && user.googleId !== info.sub)) throw conflict('Verify the existing account email before linking Google');
        user.googleId = info.sub;
        await user.save();
      } else {
        const username = info.email!.split('@')[0].replace(/[^a-zA-Z0-9_]/g, '').slice(0, 24) || `user${Date.now()}`;
        user = await User.create({
          email: info.email!.toLowerCase(),
          username: `${username}${Math.floor(Math.random() * 1000)}`,
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
    return { user: sanitizeUser(user), tokens };
  },

  async refresh(refreshToken: string): Promise<AuthTokens> {
    let payload: { sub: string };
    try {
      payload = verifyRefreshToken(refreshToken);
    } catch {
      throw unauthorized('Invalid or expired refresh token');
    }
    const session = await UserSession.findOneAndUpdate({ refreshTokenHash: sha256(refreshToken), revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { revokedAt: new Date() } }, { new: true });
    if (!session || new Date(session.expiresAt).getTime() < Date.now()) {
      throw unauthorized('Session expired or revoked');
    }
    const user = await User.findById(payload.sub);
    if (!user || user.status !== 'active') throw unauthorized('Account unavailable');

    // Rotate refresh token.
    return issueTokens(String(user._id), user.role, session.deviceId, session.ip, session.userAgent);
  },

  async logout(refreshToken: string): Promise<void> {
    await UserSession.updateOne({ refreshTokenHash: sha256(refreshToken) }, { $set: { revokedAt: new Date() } });
  },

  async forgotPassword(email: string): Promise<{ sent: boolean; token?: string }> {
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
    return { sent: true, token: process.env.NODE_ENV !== 'production' ? token : undefined };
  },

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const record = await PasswordReset.findOne({ tokenHash: sha256(token), usedAt: { $exists: false } });
    if (!record || new Date(record.expiresAt).getTime() < Date.now()) {
      throw badRequest('Invalid or expired reset token');
    }
    const user = await User.findById(record.user);
    if (!user) throw notFound('User not found');
    user.passwordHash = await hashPassword(newPassword);
    await user.save();
    record.usedAt = new Date();
    await record.save();
    await UserSession.updateMany({ user: user._id }, { $set: { revokedAt: new Date() } });
  },

  async verifyEmail(token: string): Promise<void> {
    const record = await EmailVerification.findOne({ tokenHash: sha256(token), usedAt: { $exists: false } });
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
    await UserSession.updateMany({ user: userId }, { $set: { revokedAt: new Date() } });
  },

  async deleteAccount(userId: string): Promise<void> {
    const user = await User.findById(userId);
    if (!user) throw notFound('User not found');
    user.status = 'deleted';
    user.email = `deleted-${user._id}@deleted.local`;
    user.username = `del_${String(user._id).slice(-24)}`;
    user.googleId = undefined;
    user.passwordHash = undefined;
    await user.save();
    await UserSession.updateMany({ user: userId }, { $set: { revokedAt: new Date() } });
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
