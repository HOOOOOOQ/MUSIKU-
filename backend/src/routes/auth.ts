import { UserSession } from '../models';
import { notFound } from '../utils/apiResponse';
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { authService } from '../services/authService';
import { ok, created, needsCredentials } from '../utils/apiResponse';
import { hasGoogleOAuth } from '../config/env';

export const authRouter = Router();

const registerSchema = z.object({
  email: z.string().email(),
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(8).max(128),
  displayName: z.string().max(60).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceId: z.string().max(128).optional(),
});

const googleSchema = z.object({ idToken: z.string().min(1).max(8192), deviceId: z.string().max(128).optional() });
const refreshSchema = z.object({ refreshToken: z.string().min(1) });
const forgotSchema = z.object({ email: z.string().email() });
const resetSchema = z.object({ token: z.string().min(1), newPassword: z.string().min(8).max(128) });
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

const meta = (req: AuthedRequest) => ({
  ip: req.ip,
  userAgent: req.headers['user-agent'],
  deviceId: (req.body as { deviceId?: string })?.deviceId,
});

/**
 * Public authentication capability list. Clients use it to avoid rendering a
 * provider button the backend cannot actually verify. Contains no credentials.
 */
authRouter.get('/providers', (_req, res) => {
  ok(res, [
    { id: 'google', label: 'Google', enabled: hasGoogleOAuth, exchangeEndpoint: '/auth/google' },
  ]);
});

authRouter.post('/register', validate(registerSchema), asyncHandler(async (req, res) => {
  const result = await authService.register(req.body);
  created(res, result);
}));

authRouter.post('/login', validate(loginSchema), asyncHandler(async (req, res) => {
  const result = await authService.login(req.body.email, req.body.password, meta(req));
  ok(res, result);
}));

authRouter.post('/google', validate(googleSchema), asyncHandler(async (req, res) => {
  if (!hasGoogleOAuth) {
    needsCredentials(res, 'Google Sign-In', ['GOOGLE_CLIENT_ID']);
    return;
  }
  const result = await authService.loginWithGoogle(req.body.idToken, meta(req));
  ok(res, result);
}));

authRouter.post('/refresh', validate(refreshSchema), asyncHandler(async (req, res) => {
  const tokens = await authService.refresh(req.body.refreshToken);
  ok(res, tokens);
}));

authRouter.post('/logout', validate(refreshSchema), asyncHandler(async (req, res) => {
  await authService.logout(req.body.refreshToken);
  ok(res, { loggedOut: true });
}));

authRouter.post('/forgot-password', validate(forgotSchema), asyncHandler(async (req, res) => {
  const result = await authService.forgotPassword(req.body.email);
  ok(res, result);
}));

authRouter.post('/reset-password', validate(resetSchema), asyncHandler(async (req, res) => {
  await authService.resetPassword(req.body.token, req.body.newPassword);
  ok(res, { reset: true });
}));

authRouter.post('/verify-email', validate(z.object({ token: z.string().min(1) })), asyncHandler(async (req, res) => {
  await authService.verifyEmail(req.body.token);
  ok(res, { verified: true });
}));

authRouter.get('/me', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const me = await authService.getMe(req.userId!);
  ok(res, me);
}));

authRouter.post('/change-password', requireAuth, validate(changePasswordSchema), asyncHandler(async (req: AuthedRequest, res) => {
  await authService.changePassword(req.userId!, req.body.currentPassword, req.body.newPassword);
  ok(res, { changed: true });
}));

authRouter.delete('/account', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  await authService.deleteAccount(req.userId!);
  ok(res, { deleted: true });
}));

authRouter.get('/sessions', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await UserSession.find({ user: req.userId, revokedAt: { $exists: false }, expiresAt: { $gt: new Date() } }).select('_id deviceId userAgent createdAt expiresAt').sort({ createdAt: -1 }).limit(100).lean());
}));
authRouter.delete('/sessions/:id', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  const session = await UserSession.findOneAndUpdate({ _id: req.params.id, user: req.userId }, { $set: { revokedAt: new Date() } }, { new: true });
  if (!session) throw notFound('Session not found');
  ok(res, { revoked: true });
}));
authRouter.post('/revoke-all', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  await UserSession.updateMany({ user: req.userId }, { $set: { revokedAt: new Date() } });
  ok(res, { revoked: true });
}));

authRouter.post('/resend-verification', requireAuth, asyncHandler(async (req: AuthedRequest, res) => {
  await authService.resendVerification(req.userId!); ok(res, { sent: true });
}));
