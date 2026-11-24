import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { authService } from '../services/authService';
import { userService } from '../services/userService';
import { ok } from '../utils/apiResponse';

export const usersRouter = Router();
usersRouter.use(requireAuth);

const profilePatchSchema = z.object({
  username: z.string().min(3).max(30).regex(/^[a-zA-Z0-9_]+$/).optional(),
  displayName: z.string().max(60).optional(),
  avatarUrl: z.string().url().optional().or(z.literal('')),
  bio: z.string().max(500).optional(),
  country: z.string().max(60).optional(),
  language: z.string().max(10).optional(),
  favoriteMusicGenres: z.array(z.string()).max(20).optional(),
  favoriteAnimeGenres: z.array(z.string()).max(20).optional(),
  favoriteArtists: z.array(z.string()).max(50).optional(),
  favoriteAnime: z.array(z.string()).max(50).optional(),
});

const preferencesSchema = z.object({
  theme: z.enum(['system', 'dark', 'light']).optional(),
  language: z.string().max(10).optional(),
  defaultAudioQuality: z.string().max(20).optional(),
  autoplay: z.boolean().optional(),
  crossfade: z.boolean().optional(),
  normalizeVolume: z.boolean().optional(),
  explicitContent: z.boolean().optional(),
  defaultSubtitle: z.string().max(10).optional(),
  defaultVideoQuality: z.string().max(20).optional(),
  autoplayNextEpisode: z.boolean().optional(),
  skipIntro: z.boolean().optional(),
  backgroundPlayback: z.boolean().optional(),
  playbackSpeed: z.number().min(0.25).max(4).optional(),
  personalizedRecommendations: z.boolean().optional(),
  listeningActivity: z.boolean().optional(),
  watchHistoryEnabled: z.boolean().optional(),
  landingPage: z.string().max(30).optional(),
});

usersRouter.get('/profile', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await userService.getProfile(req.userId!));
}));

usersRouter.patch('/profile', validate(profilePatchSchema), asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await userService.updateProfile(req.userId!, req.body));
}));

usersRouter.get('/preferences', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await userService.getPreferences(req.userId!));
}));

usersRouter.patch('/preferences', validate(preferencesSchema), asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await userService.updatePreferences(req.userId!, req.body));
}));

usersRouter.get('/devices', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await userService.listDevices(req.userId!));
}));

usersRouter.delete('/devices/:deviceId', asyncHandler(async (req: AuthedRequest, res) => {
  await userService.removeDevice(req.userId!, req.params.deviceId);
  ok(res, { removed: true });
}));

usersRouter.get('/login-history', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await userService.loginHistory(req.userId!));
}));

usersRouter.get('/stats', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await userService.stats(req.userId!));
}));

usersRouter.delete('/account', asyncHandler(async (req: AuthedRequest, res) => { await authService.deleteAccount(req.userId!); ok(res, { deleted: true }); }));
