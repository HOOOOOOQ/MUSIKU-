import Stripe from 'stripe';
import mongoose from 'mongoose';
import { env } from '../config/env';
import { Payment, Subscription, User } from '../models';
import { ApiError } from '../utils/apiResponse';

export function stripeClient(): Stripe {
  if (env.PAYMENT_PROVIDER !== 'stripe' || !env.PAYMENT_SECRET_KEY || !env.PAYMENT_WEBHOOK_SECRET) throw new ApiError(503, 'NEEDS_CREDENTIALS', 'Stripe is not configured');
  return new Stripe(env.PAYMENT_SECRET_KEY);
}
export async function stripeCheckout(userId: string, plan: {id: string; name: string; priceIdr: number}) {
  const stripe = stripeClient();
  const payment = await Payment.create({ user: userId, provider: 'stripe', amount: plan.priceIdr, currency: 'IDR', status: 'pending', plan: plan.id });
  try {
    const session = await stripe.checkout.sessions.create({ mode: 'payment', client_reference_id: String(payment._id), metadata: { paymentId: String(payment._id) }, line_items: [{ price_data: { currency: 'idr', unit_amount: plan.priceIdr * 100, product_data: { name: plan.name } }, quantity: 1 }], success_url: env.PAYMENT_SUCCESS_URL, cancel_url: env.PAYMENT_CANCEL_URL }, { idempotencyKey: String(payment._id) });
    payment.providerPaymentId = session.id; await payment.save();
    return { payment: { id: payment._id, status: payment.status }, checkoutUrl: session.url };
  } catch { await Payment.updateOne({ _id: payment._id }, { $set: { status: 'failed' } }); throw new ApiError(502, 'PAYMENT_PROVIDER_ERROR', 'Unable to create checkout session'); }
}
export async function processStripeWebhook(raw: Buffer, signature: string) {
  const stripe = stripeClient();
  let event: Stripe.Event;
  try { event = stripe.webhooks.constructEvent(raw, signature, env.PAYMENT_WEBHOOK_SECRET); }
  catch { throw new ApiError(400, 'INVALID_SIGNATURE', 'Invalid payment signature'); }
  if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) return;
  const checkout = event.data.object as Stripe.Checkout.Session;
  if (checkout.payment_status !== 'paid') return;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const payment = await Payment.findOne({ providerPaymentId: checkout.id, provider: 'stripe' }).session(session);
      if (!payment) throw new ApiError(400, 'UNKNOWN_PAYMENT', 'Unknown checkout');
      if (payment.status === 'paid') return;
      if (checkout.currency !== 'idr' || checkout.amount_total !== payment.amount * 100 || checkout.metadata?.paymentId !== String(payment._id)) throw new ApiError(400, 'PAYMENT_MISMATCH', 'Payment details do not match');
      const user = await User.findById(payment.user).session(session);
      if (!user || user.status !== 'active') throw new ApiError(400, 'ACCOUNT_UNAVAILABLE', 'Account unavailable');
      const start = Math.max(Date.now(), user.premiumExpiresAt?.getTime() ?? 0);
      const end = new Date(start + (payment.plan === 'premium_yearly' ? 365 : 30) * 86400000);
      payment.status = 'paid'; payment.paidAt = new Date(); await payment.save({ session });
      user.premium = true; user.premiumExpiresAt = end; await user.save({ session });
      await Subscription.create([{ user: user._id, plan: payment.plan, status: 'active', provider: 'stripe', providerSubscriptionId: checkout.id, currentPeriodEnd: end, autoRenew: false }], { session });
    });
  } finally { await session.endSession(); }
}
