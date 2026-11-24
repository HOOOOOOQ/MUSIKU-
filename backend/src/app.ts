import { processStripeWebhook } from './services/stripePayments';
import { asyncHandler } from './middleware/errorHandler';
import { hasPayments } from './config/env';
import { fail } from './utils/apiResponse';
import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { env } from './config/env';
import { requireAuth, requireAdmin } from './middleware/auth';
import { sanitizeInput } from './middleware/validate';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { z } from 'zod';
import { ok } from './utils/apiResponse';
import { authRouter } from './routes/auth';
import { usersRouter } from './routes/users';
import { musicRouter } from './routes/music';
import { playlistsRouter } from './routes/playlists';
import { animeRouter } from './routes/anime';
import { libraryRouter } from './routes/library';
import { historyRouter } from './routes/history';
import { searchRouter } from './routes/search';
import { notificationsRouter } from './routes/notifications';
import { premiumRouter } from './routes/premium';
import { downloadsRouter } from './routes/downloads';
import { providersRouter } from './routes/providers';
import { adminRouter } from './routes/admin';

/** Express app factory — exported for tests (no DB connection needed). */
export function createApp(): Application {
  const app = express();

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: [env.CLIENT_URL, env.ADMIN_URL], credentials: true }));
  app.post('/api/premium/webhook', rateLimit({ windowMs: 60000, max: 120 }), express.raw({ type: 'application/json', limit: '1mb' }), asyncHandler(async (req, res) => {
    if (!hasPayments) { fail(res, 501, 'INTEGRATION_NOT_CONFIGURED', 'Stripe webhook not configured'); return; }
    await processStripeWebhook(req.body as Buffer, req.get('stripe-signature') ?? '');
    res.json({ received: true });
  }));
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  if (env.NODE_ENV !== 'test') app.use(morgan('combined'));
  app.use(sanitizeInput);
  app.use((req, _res, next) => {
    try {
      z.object({ page: z.coerce.number().int().min(1).max(100000).optional(), limit: z.coerce.number().int().min(1).max(500).optional() }).parse(req.query);
      next();
    } catch (error) { next(error); }
  });

  // Global rate limit (generous; auth endpoints get stricter limits below).
  app.use(rateLimit({ windowMs: 15 * 60 * 1000, max: 1000, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/auth', rateLimit({ windowMs: 15 * 60 * 1000, max: 100, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/auth/login', rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false }));
  app.use('/api/auth/register', rateLimit({ windowMs: 60 * 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false }));

  app.get('/health', (_req: Request, res: Response) => {
    ok(res, { status: 'ok', service: 'musiku-plus-api', env: env.NODE_ENV, time: new Date().toISOString() });
  });

  app.use('/api/auth', authRouter);
  app.use('/api/users', usersRouter);
  app.use('/api/music', musicRouter);
  app.use('/api/playlists', playlistsRouter);
  app.use('/api/anime', animeRouter);
  app.use('/api/library', libraryRouter);
  app.use('/api/watchlist', (req, res, next) => { req.url = '/watchlist' + (req.url === '/' ? '' : req.url); libraryRouter(req, res, next); });
  app.use('/api/history', historyRouter);
  app.use('/api/search', searchRouter);
  app.use('/api/notifications', notificationsRouter);
  app.use('/api/premium', premiumRouter);
  app.use('/api/downloads', downloadsRouter);
  app.use('/api/providers', providersRouter);
  app.use('/api/admin/providers', requireAuth, requireAdmin, providersRouter);
  app.use('/api/admin', adminRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
