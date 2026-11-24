'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiPost, setToken } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiPost<{ tokens: { accessToken: string }; user: { role: string } }>('/api/auth/login', {
        email,
        password,
      });
      if (data.user.role !== 'admin') {
        throw new Error('Account does not have admin access');
      }
      setToken(data.tokens.accessToken);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900">
      <form onSubmit={submit} className="card w-full max-w-sm">
        <div className="text-2xl font-bold mb-1">
          MUSIKU<span className="text-brand-500">+</span>
        </div>
        <div className="text-sm text-gray-500 mb-6">Admin sign in</div>
        {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>}
        <label className="block text-sm font-medium mb-1">Email</label>
        <input className="input mb-4" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <label className="block text-sm font-medium mb-1">Password</label>
        <input className="input mb-6" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn-primary w-full" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
