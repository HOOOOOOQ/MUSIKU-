'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPut } from '@/lib/api';
import Sidebar from '@/components/Sidebar';

interface Setting {
  _id: string;
  key: string;
  value: unknown;
  description: string;
}

interface Flag {
  _id: string;
  key: string;
  enabled: boolean;
  description: string;
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([]);
  const [flags, setFlags] = useState<Flag[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () => {
    Promise.all([apiGet<Setting[]>('/api/admin/settings'), apiGet<Flag[]>('/api/admin/feature-flags')])
      .then(([s, f]) => {
        setSettings(s);
        setFlags(f);
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, []);

  const saveFlags = async () => {
    setError('');
    try {
      await apiPut('/api/admin/feature-flags', {
        flags: flags.map((f) => ({ key: f.key, enabled: f.enabled, description: f.description })),
      });
      setNotice('Feature flags saved');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  const saveSettings = async () => {
    setError('');
    try {
      await apiPut('/api/admin/settings', {
        settings: settings.map((s) => ({ key: s.key, value: s.value, description: s.description })),
      });
      setNotice('Settings saved');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    }
  };

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-bold mb-6">Settings & Feature Flags</h1>
        {error && <div className="card mb-6 text-red-700">{error}</div>}
        {notice && <div className="card mb-6 text-brand-700">{notice}</div>}

        <div className="card mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Feature Flags</h2>
            <button className="btn-primary" onClick={saveFlags}>
              Save Flags
            </button>
          </div>
          {flags.map((f, i) => (
            <label key={f._id} className="flex items-start gap-3 py-3 border-t border-gray-100">
              <input
                type="checkbox"
                checked={f.enabled}
                onChange={(e) => {
                  const next = [...flags];
                  next[i] = { ...f, enabled: e.target.checked };
                  setFlags(next);
                }}
              />
              <span>
                <span className="font-mono text-sm">{f.key}</span>
                <span className="block text-xs text-gray-500">{f.description}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold">Application Settings</h2>
            <button className="btn-primary" onClick={saveSettings}>
              Save Settings
            </button>
          </div>
          {settings.map((s, i) => (
            <div key={s._id} className="py-3 border-t border-gray-100">
              <div className="font-mono text-sm">{s.key}</div>
              <div className="text-xs text-gray-500 mb-2">{s.description}</div>
              <input
                className="input max-w-md"
                value={typeof s.value === 'string' ? s.value : JSON.stringify(s.value)}
                onChange={(e) => {
                  const next = [...settings];
                  let value: unknown = e.target.value;
                  try {
                    value = JSON.parse(e.target.value);
                  } catch {
                    /* keep as string */
                  }
                  next[i] = { ...s, value };
                  setSettings(next);
                }}
              />
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
