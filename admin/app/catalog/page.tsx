'use client';

import { useEffect, useState } from 'react';
import { apiGet, CatalogItem } from '@/lib/api';
import Sidebar from '@/components/Sidebar';

export default function CatalogPage() {
  const [tab, setTab] = useState<'music' | 'anime'>('music');
  const [items, setItems] = useState<CatalogItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [error, setError] = useState('');

  const load = () => {
    const path = tab === 'music' ? `/api/admin/catalog/music?page=${page}&limit=20` : `/api/admin/catalog/anime?page=${page}&limit=20`;
    apiGet<{ items: CatalogItem[]; total: number }>(path)
      .then((d) => {
        setItems(d.items);
        setTotal(d.total);
      })
      .catch((e: Error) => setError(e.message));
  };

  useEffect(load, [tab, page]);

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-bold mb-6">Catalog Management</h1>
        {error && <div className="card mb-6 text-red-700">{error}</div>}
        <div className="flex gap-2 mb-6">
          <button className={tab === 'music' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setTab('music'); setPage(1); }}>
            Music
          </button>
          <button className={tab === 'anime' ? 'btn-primary' : 'btn-secondary'} onClick={() => { setTab('anime'); setPage(1); }}>
            Anime
          </button>
        </div>
        <div className="card">
          <table className="table w-full">
            <thead>
              <tr>
                <th>Title</th>
                <th>Source</th>
                <th>Popularity</th>
                <th>Cached At</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item._id}>
                  <td>{item.title ?? item.name ?? '—'}</td>
                  <td>{item.source ?? '—'}</td>
                  <td>{item.popularity ?? '—'}</td>
                  <td>{new Date(item.createdAt).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex items-center gap-3 mt-4 text-sm">
            <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
              Prev
            </button>
            <span>
              Page {page} · {total} items
            </span>
            <button className="btn-secondary" onClick={() => setPage(page + 1)}>
              Next
            </button>
          </div>
          <p className="text-xs text-gray-400 mt-4">
            Catalog entries are cached from official/public providers (Deezer, iTunes, MusicBrainz, AniList, Jikan).
            Metadata sync runs automatically on user searches.
          </p>
        </div>
      </main>
    </div>
  );
}
