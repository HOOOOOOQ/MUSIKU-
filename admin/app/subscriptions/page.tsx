'use client';

import { useEffect, useState } from 'react';
import { apiGet } from '@/lib/api';
import Sidebar from '@/components/Sidebar';

interface Plan {
  id: string;
  name: string;
  priceIdr: number;
  features: string[];
}

export default function SubscriptionsPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet<Plan[]>('/api/premium/plans')
      .then(setPlans)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-bold mb-6">Premium Subscriptions</h1>
        {error && <div className="card mb-6 text-red-700">{error}</div>}
        <div className="grid md:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <div key={plan.id} className="card">
              <h2 className="text-lg font-semibold">{plan.name}</h2>
              <div className="text-3xl font-bold mt-2">
                {plan.priceIdr === 0 ? 'Free' : `Rp ${plan.priceIdr.toLocaleString('id-ID')}`}
              </div>
              <ul className="mt-4 space-y-2 text-sm text-gray-600">
                {plan.features.map((f) => (
                  <li key={f}>✓ {f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="card mt-6">
          <h2 className="font-semibold mb-2">Payment Integration</h2>
          <p className="text-sm text-gray-600">
            Checkout requires a configured payment provider (<code>PAYMENT_PROVIDER</code> + <code>PAYMENT_SECRET_KEY</code> in
            backend/.env). Without credentials, checkout returns <code>NEEDS_CREDENTIALS</code> — no fake transactions are created.
            Subscription status, cancellation, and payment history are fully functional.
          </p>
        </div>
      </main>
    </div>
  );
}
