import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/errorHandler';
import { validate } from '../middleware/validate';
import { requireAuth, AuthedRequest } from '../middleware/auth';
import { subscriptionService } from '../services/subscriptionService';
import { ok, needsCredentials } from '../utils/apiResponse';

export const premiumRouter = Router();
premiumRouter.use(requireAuth);

premiumRouter.get('/plans', asyncHandler(async (_req, res) => {
  ok(res, subscriptionService.listPlans());
}));

premiumRouter.get('/status', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await subscriptionService.getStatus(req.userId!));
}));

premiumRouter.post('/checkout', validate(z.object({ planId: z.string().min(1) })), asyncHandler(async (req: AuthedRequest, res) => {
  try {
    ok(res, await subscriptionService.checkout(req.userId!, req.body.planId));
  } catch (err) {
    const e = err as Error & { code?: string; details?: unknown };
    if (e.code === 'NEEDS_CREDENTIALS') {
      needsCredentials(res, 'Payment processing', ['PAYMENT_PROVIDER', 'PAYMENT_SECRET_KEY']);
      return;
    }
    throw err;
  }
}));

premiumRouter.post('/cancel', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await subscriptionService.cancel(req.userId!));
}));

premiumRouter.get('/payments', asyncHandler(async (req: AuthedRequest, res) => {
  ok(res, await subscriptionService.paymentHistory(req.userId!));
}));

// The signed payment webhook is registered in app.ts before the JSON body
// parser (raw body is required for signature verification), so this router
// intentionally does not declare a competing /webhook route.
