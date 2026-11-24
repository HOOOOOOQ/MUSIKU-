import { User, Subscription, Payment } from '../models';
import { env, hasPayments } from '../config/env';
import { notFound, badRequest } from '../utils/apiResponse';

/**
 * Premium subscription system.
 *
 * Plans are configured server-side. Actual charging requires a
 * payment provider (Stripe / Midtrans / Xendit / etc.) — without
 * PAYMENT_* credentials, checkout returns `needs_credentials`
 * instead of faking a transaction. Status/validation logic is
 * fully implemented and tested.
 */

export const PLANS = [
  { id: 'free', name: 'Free', priceIdr: 0, features: ['Basic catalog access', 'Standard audio quality', 'Watchlist & history'] },
  { id: 'premium_monthly', name: 'Premium Monthly', priceIdr: 49000, features: ['Ad-free experience', 'Higher audio quality when available', 'Advanced personalization', 'Offline access when licensed'] },
  { id: 'premium_yearly', name: 'Premium Yearly', priceIdr: 399000, features: ['Ad-free experience', 'Higher audio quality when available', 'Advanced personalization', 'Offline access when licensed', '2 months free vs monthly'] },
];

export const subscriptionService = {
  listPlans() {
    return PLANS;
  },

  async getStatus(userId: string) {
    const user = await User.findById(userId).lean();
    if (!user) throw notFound('User not found');
    const subscription = await Subscription.findOne({ user: userId }).sort({ createdAt: -1 }).lean();
    const premiumActive = Boolean(user.premium && (!user.premiumExpiresAt || new Date(user.premiumExpiresAt).getTime() > Date.now()));
    return {
      plan: premiumActive ? (subscription?.plan ?? 'premium_monthly') : 'free',
      premium: premiumActive,
      premiumExpiresAt: user.premiumExpiresAt ?? null,
      subscription: subscription ?? null,
      paymentsConfigured: hasPayments,
    };
  },

  /** Begin checkout. Requires a configured payment provider. */
  async checkout(userId: string, planId: string) {
    const plan = PLANS.find((p) => p.id === planId);
    if (!plan) throw badRequest(`Unknown plan: ${planId}`);
    if (plan.id === 'free') throw badRequest('Free plan does not require checkout');
    if (!hasPayments) {
      const err = new Error('Payment provider is not configured') as Error & { code?: string; details?: unknown };
      err.code = 'NEEDS_CREDENTIALS';
      err.details = { integration: 'payments', missing: ['PAYMENT_PROVIDER', 'PAYMENT_SECRET_KEY'] };
      throw err;
    }
    // Never create an unchargeable transaction or claim checkout is ready.
    throw badRequest('A concrete signed payment-provider adapter must be configured before checkout');
  },

  /** Webhook handler: mark payment paid and activate premium. */
  async confirmPayment(providerPaymentId: string, paid: boolean) {
    const payment = await Payment.findOne({ providerPaymentId });
    if (!payment) throw notFound('Payment not found');
    payment.status = paid ? 'paid' : 'failed';
    payment.paidAt = paid ? new Date() : undefined;
    await payment.save();
    if (paid) {
      const months = payment.plan === 'premium_yearly' ? 12 : 1;
      const expires = new Date(Date.now() + months * 30 * 24 * 60 * 60 * 1000);
      await User.updateOne({ _id: payment.user }, { $set: { premium: true, premiumExpiresAt: expires } });
      await Subscription.create({
        user: payment.user,
        plan: payment.plan || 'premium_monthly',
        status: 'active',
        provider: payment.provider,
        providerSubscriptionId: providerPaymentId,
        currentPeriodEnd: expires,
      });
    }
    return payment;
  },

  async cancel(userId: string) {
    const subscription = await Subscription.findOne({ user: userId, status: 'active' }).sort({ createdAt: -1 });
    if (!subscription) throw notFound('Active subscription not found');
    subscription.cancelAtPeriodEnd = true;
    subscription.autoRenew = false;
    await subscription.save();
    return subscription;
  },

  async paymentHistory(userId: string, limit = 30) {
    return Payment.find({ user: userId }).sort({ createdAt: -1 }).limit(limit).lean();
  },
};
