'use client';

import { useEffect, useState } from 'react';
import { apiGet, AuditLog, ProviderLog, SystemEvent } from '@/lib/api';
import Sidebar from '@/components/Sidebar';

export default function LogsPage() {
  const [tab, setTab] = useState<'audit' | 'providers' | 'system'>('audit');
  const [audit, setAudit] = useState<AuditLog[]>([]);
  const [providerLogs, setProviderLogs] = useState<ProviderLog[]>([]);
  const [system, setSystem] = useState<SystemEvent[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([
      apiGet<AuditLog[]>('/api/admin/audit-logs?limit=100'),
      apiGet<ProviderLog[]>('/api/providers/logs?limit=100'),
      apiGet<{ audit: AuditLog[]; system: SystemEvent[] }>('/api/admin/logs?limit=100'),
    ])
      .then(([a, p, combined]) => {
        setAudit(a);
        setProviderLogs(p);
        setSystem(combined.system);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-bold mb-6">Logs & Audit Trail</h1>
        {error && <div className="card mb-6 text-red-700">{error}</div>}
        <div className="flex gap-2 mb-6">
          {(['audit', 'providers', 'system'] as const).map((t) => (
            <button key={t} className={tab === t ? 'btn-primary' : 'btn-secondary'} onClick={() => setTab(t)}>
              {t === 'audit' ? 'Audit Logs' : t === 'providers' ? 'Provider Logs' : 'System Events'}
            </button>
          ))}
        </div>

        {tab === 'audit' && (
          <div className="card">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Action</th>
                  <th>Target</th>
                  <th>IP</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((a) => (
                  <tr key={a._id}>
                    <td>{new Date(a.createdAt).toLocaleString()}</td>
                    <td className="font-mono text-xs">{a.action}</td>
                    <td>
                      {a.targetType} {a.targetId}
                    </td>
                    <td>{a.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'providers' && (
          <div className="card">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Provider</th>
                  <th>Operation</th>
                  <th>Success</th>
                  <th>Latency</th>
                  <th>Error</th>
                </tr>
              </thead>
              <tbody>
                {providerLogs.map((l) => (
                  <tr key={l._id}>
                    <td>{new Date(l.createdAt).toLocaleString()}</td>
                    <td>{l.providerId}</td>
                    <td>{l.operation}</td>
                    <td>
                      <span className={`badge ${l.success ? 'badge-green' : 'badge-red'}`}>{l.success ? 'ok' : 'fail'}</span>
                    </td>
                    <td>{l.latencyMs}ms</td>
                    <td className="text-red-600 text-xs">{l.errorMessage}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {tab === 'system' && (
          <div className="card">
            <table className="table w-full">
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Level</th>
                  <th>Source</th>
                  <th>Message</th>
                </tr>
              </thead>
              <tbody>
                {system.map((s) => (
                  <tr key={s._id}>
                    <td>{new Date(s.createdAt).toLocaleString()}</td>
                    <td>
                      <span className={`badge ${s.level === 'error' ? 'badge-red' : s.level === 'warn' ? 'badge-yellow' : 'badge-gray'}`}>
                        {s.level}
                      </span>
                    </td>
                    <td>{s.source}</td>
                    <td>{s.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
