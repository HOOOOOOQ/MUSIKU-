'use client';

import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';
import { apiGet, DashboardData } from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import StatCard from '@/components/StatCard';
import HealthBadge from '@/components/HealthBadge';

const PIE_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#ef4444', '#8b5cf6'];

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    apiGet<DashboardData>('/api/admin/dashboard')
      .then(setData)
      .catch((e: Error) => setError(e.message));
  }, []);

  const catalogChart = data
    ? [
        { name: 'Tracks', value: data.catalog.tracks },
        { name: 'Artists', value: data.catalog.artists },
        { name: 'Albums', value: data.catalog.albums },
        { name: 'Anime', value: data.catalog.anime },
        { name: 'Episodes', value: data.catalog.episodes },
      ]
    : [];

  const userPie = data
    ? [
        { name: 'Active', value: data.users.active },
        { name: 'Premium', value: data.users.premium },
        { name: 'Other', value: Math.max(0, data.users.total - data.users.active) },
      ]
    : [];

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-bold mb-6">Dashboard Overview</h1>
        {error && <div className="card mb-6 text-red-700">{error}</div>}
        {!data && !error && <div className="card">Loading…</div>}
        {data && (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <StatCard label="Total Users" value={data.users.total} sub={`${data.users.active} active`} />
              <StatCard label="Premium Users" value={data.users.premium} accent="text-brand-600" />
              <StatCard label="Music Catalog" value={data.catalog.tracks} sub={`${data.catalog.artists} artists · ${data.catalog.albums} albums`} />
              <StatCard label="Anime Catalog" value={data.catalog.anime} sub={`${data.catalog.episodes} episodes`} />
              <StatCard label="Active Subscriptions" value={data.subscriptions.active} />
              <StatCard label="Paid Payments" value={data.subscriptions.paidPayments} />
              <StatCard label="Enabled Providers" value={data.providers.enabled} />
              <StatCard label="Database" value={data.database.status} sub={`${data.database.latencyMs}ms ping`} accent={data.database.status === 'ok' ? 'text-brand-600' : 'text-red-600'} />
            </div>

            <div className="grid lg:grid-cols-2 gap-6 mb-6">
              <div className="card">
                <h2 className="font-semibold mb-4">Catalog Size</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={catalogChart}>
                    <XAxis dataKey="name" />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="value" fill="#22c55e" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="card">
                <h2 className="font-semibold mb-4">Users</h2>
                <ResponsiveContainer width="100%" height={260}>
                  <PieChart>
                    <Pie data={userPie} dataKey="value" nameKey="name" outerRadius={90} label>
                      {userPie.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="card">
              <h2 className="font-semibold mb-4">API Provider Status</h2>
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Type</th>
                    <th>Health</th>
                    <th>Avg Latency</th>
                    <th>Last Checked</th>
                  </tr>
                </thead>
                <tbody>
                  {data.providers.status.map((p) => (
                    <tr key={p.providerId}>
                      <td>{p.name}</td>
                      <td>{p.type}</td>
                      <td>
                        <HealthBadge status={p.healthStatus} />
                      </td>
                      <td>{p.avgLatencyMs}ms</td>
                      <td>{p.lastCheckedAt ? new Date(p.lastCheckedAt).toLocaleString() : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
