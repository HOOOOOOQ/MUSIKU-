'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete, Provider } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import HealthBadge from '@/components/HealthBadge';

const EMPTY: Partial<Provider> = {
  providerId: '',
  name: '',
  type: 'music_metadata',
  baseUrl: '',
  authMethod: 'none',
  enabled: true,
  priority: 100,
  timeoutMs: 8000,
  maxRetries: 2,
  cacheTtlSec: 3600,
  rateLimitPerMin: 60,
  requiresCredentials: false,
  notes: '',
};

export default function ProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [form, setForm] = useState<Partial<Provider>>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    apiGet<Provider[]>('/api/providers')
      .then(setProviders)
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setNotice('');
    try {
      const payload = { ...form, ...(apiKey ? { apiKey } : {}) };
      if (editingId) {
        await apiPatch(`/api/providers/${editingId}`, payload);
        setNotice('Provider updated');
      } else {
        await apiPost('/api/providers', payload);
        setNotice('Provider created');
      }
      setForm(EMPTY);
      setEditingId(null);
      setApiKey('');
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const edit = (p: Provider) => {
    setForm(p);
    setEditingId(p._id);
    setApiKey('');
  };

  const remove = async (id: string) => {
    if (!confirm('Delete this provider?')) return;
    await apiDelete(`/api/providers/${id}`);
    load();
  };

  const healthCheck = async () => {
    const res = await apiPost<{ providerId: string; status: string; latencyMs: number }[]>('/api/providers/health-check', {});
    setNotice(`Health check complete: ${res.map((r) => `${r.providerId}=${r.status}`).join(', ')}`);
    load();
  };

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-8">
        <div className="flex items-center justify-between mb-6">
          <h1 className="text-2xl font-bold">API Provider Management</h1>
          <button className="btn-secondary" onClick={healthCheck}>
            Run Health Check
          </button>
        </div>
        {error && <div className="card mb-6 text-red-700">{error}</div>}
        {notice && <div className="card mb-6 text-brand-700">{notice}</div>}

        <form onSubmit={submit} className="card mb-6">
          <h2 className="font-semibold mb-4">{editingId ? 'Edit Provider' : 'Add Provider'}</h2>
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Provider ID</label>
              <input className="input" required value={form.providerId ?? ''} onChange={(e) => setForm({ ...form, providerId: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Name</label>
              <input className="input" required value={form.name ?? ''} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Type</label>
              <select className="input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {['music_metadata', 'music_artwork', 'music_lyrics', 'music_audio', 'anime_metadata', 'anime_artwork', 'anime_schedule', 'anime_video', 'anime_subtitle'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Base URL</label>
              <input className="input" required value={form.baseUrl ?? ''} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Auth Method</label>
              <select className="input" value={form.authMethod} onChange={(e) => setForm({ ...form, authMethod: e.target.value })}>
                {['none', 'api_key', 'bearer', 'oauth2'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Priority (lower = tried first)</label>
              <input className="input" type="number" value={form.priority ?? 100} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) })} />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">API Key (write-only, never displayed)</label>
              <input className="input" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={editingId ? 'Leave blank to keep existing' : 'Required for keyed providers'} />
            </div>
            <div className="flex items-end gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={Boolean(form.enabled)} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} />
                Enabled
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={Boolean(form.requiresCredentials)} onChange={(e) => setForm({ ...form, requiresCredentials: e.target.checked })} />
                Needs credentials
              </label>
            </div>
          </div>
          <div className="flex gap-3 mt-5">
            <button className="btn-primary" type="submit">
              {editingId ? 'Update' : 'Create'}
            </button>
            {editingId && (
              <button
                className="btn-secondary"
                type="button"
                onClick={() => {
                  setEditingId(null);
                  setForm(EMPTY);
                }}
              >
                Cancel
              </button>
            )}
          </div>
        </form>

        <div className="card">
          <table className="table w-full">
            <thead>
              <tr>
                <th>Provider</th>
                <th>Type</th>
                <th>Priority</th>
                <th>Health</th>
                <th>Success / Errors</th>
                <th>Latency</th>
                <th>Enabled</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((p) => (
                <tr key={p._id}>
                  <td>
                    <div className="font-medium">{p.name}</div>
                    <div className="text-xs text-gray-400">{p.providerId}</div>
                  </td>
                  <td>{p.type}</td>
                  <td>{p.priority}</td>
                  <td>
                    <HealthBadge status={p.healthStatus} />
                  </td>
                  <td>
                    {p.successCount} / {p.errorCount}
                  </td>
                  <td>{p.avgLatencyMs}ms</td>
                  <td>{p.enabled ? 'Yes' : 'No'}</td>
                  <td>
                    <div className="flex gap-2">
                      <button className="btn-secondary text-xs px-2 py-1" onClick={() => edit(p)}>
                        Edit
                      </button>
                      <button className="btn-danger text-xs px-2 py-1" onClick={() => remove(p._id)}>
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
