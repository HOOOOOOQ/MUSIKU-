import { subscriptionService, PLANS } from '../../src/services/subscriptionService';

describe('subscriptionService', () => {
  it('exposes free + premium plans', () => {
    expect(PLANS.map((p) => p.id)).toEqual(['free', 'premium_monthly', 'premium_yearly']);
    expect(PLANS[0].priceIdr).toBe(0);
    expect(PLANS[1].priceIdr).toBeGreaterThan(0);
  });

  it('rejects unknown plans', async () => {
    await expect(subscriptionService.checkout('user-1', 'nope')).rejects.toThrow(/Unknown plan/);
  });

  it('rejects checkout for the free plan', async () => {
    await expect(subscriptionService.checkout('user-1', 'free')).rejects.toThrow(/does not require checkout/);
  });

  it('returns NEEDS_CREDENTIALS when no payment provider is configured', async () => {
    const err = await subscriptionService.checkout('user-1', 'premium_monthly').catch((e) => e);
    expect(err.code).toBe('NEEDS_CREDENTIALS');
    expect(err.details.missing).toContain('PAYMENT_PROVIDER');
  });
});
