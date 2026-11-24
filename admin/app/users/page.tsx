'use client';

import { useEffect, useState } from 'react';
import { apiGet, apiPatch, apiPost, AdminUser } from '@/lib/api';
import Sidebar from '@/components/Sidebar';

export default function UsersPage() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');

  const load = () => {
    const params = new URLSearchParams({ page: String(page), limit: '20' });
    if (q) params.set('q', q);
    apiGet<{ items: AdminUser[]; total: number }>(`/api/admin/users?${params}`)
      .then((d) => {
        setUsers(d.items);
        setTotal(d.total);
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, [page]);

  const suspend = async (id: string) => {
    await apiPost(`/api/admin/users/${id}/suspend`, {});
    load();
  };
  const restore = async (id: string) => {
    await apiPost(`/api/admin/users/${id}/restore`, {});
    load();
  };
  const togglePremium = async (u: AdminUser) => {
    await apiPatch(`/api/admin/users/${u._id}`, { premium: !u.premium });
    load();
  };
  const toggleRole = async (u: AdminUser) => {
    await apiPatch(`/api/admin/users/${u._id}`, { role: u.role === 'admin' ? 'user' : 'admin' });
    load();
  };

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-bold mb-6">User Management</h1>
        {error && <div className="card mb-6 text-red-700">{error}</div>}
        <div className="flex gap-3 mb-6">
          <input
            className="input max-w-sm"
            placeholder="Search email or username…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && load()}
          />
          <button className="btn-secondary" onClick={load}>
            Search
          </button>
        </div>
        <div className="card">
          <table className="table w-full">
            <thead>
              <tr>
                <th>Email</th>
                <th>Username</th>
                <th>Role</th>
                <th>Status</th>
                <th>Premium</th>
                <th>Joined</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u._id}>
                  <td>{u.email}</td>
                  <td>{u.username}</td>
                  <td>
                    <span className={`badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'}`}>{u.role}</span>
                  </td>
                  <td>
                    <span className={`badge ${u.status === 'active' ? 'badge-green' : 'badge-red'}`}>{u.status}</span>
                  </td>
                  <td>{u.premium ? '★' : '—'}</td>
                  <td>{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td>
                    <div className="flex gap-2">
                      {u.status === 'active' ? (
                        <button className="btn-danger text-xs px-2 py-1" onClick={() => suspend(u._id)}>
                          Suspend
                        </button>
                      ) : (
                        <button className="btn-primary text-xs px-2 py-1" onClick={() => restore(u._id)}>
                          Restore
                        </button>
                      )}
                      <button className="btn-secondary text-xs px-2 py-1" onClick={() => togglePremium(u)}>
                        Premium
                      </button>
                      <button className="btn-secondary text-xs px-2 py-1" onClick={() => toggleRole(u)}>
                        Role
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3 mt-4 text-sm">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
            </button>
            <span>
              Page {page} · {total} users
            </span>
            <button className="btn-secondary" onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
