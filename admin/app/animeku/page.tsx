'use client';

/**
 * Animeku administration.
 *
 * Animeku is the consumer-facing anime section; the upstream catalog provider is
 * internally called **Animasu**. This page is the operator surface for it:
 *
 *  1. what the backend asserts (`/anime/status`) — enabled, metadata available,
 *     playback authorized, allow-listed stream host count;
 *  2. upstream reachability (`/providers/health-check` probes Animeku through its
 *     own adapter, not by hitting a base URL);
 *  3. the provider record (priority, timeouts, cache TTL, rate limit, enabled);
 *  4. a live catalog / detail / episode inspector, so a normalization regression
 *     is visible without a phone;
 *  5. a persistence audit proving the contract "metadata is cached, media URLs
 *     are not".
 *
 * Media URLs are never fetched for display: the playback probe reduces the
 * backend answer to a verdict plus a source count. Playback authorization itself
 * is backend environment configuration (`ANIMASU_STREAMING_AUTHORIZED` +
 * `ANIMASU_ALLOWED_STREAM_HOSTS`) and cannot be flipped from a dashboard, which
 * is stated on the page instead of hidden behind a disabled control.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ANIMEKU_CATALOG_KINDS,
  AnimekuAnime,
  AnimekuCatalogKind,
  AnimekuDetails,
  AnimekuHealthResult,
  AnimekuStatus,
  AnimekuStreamProbe,
  PersistedAnimeDoc,
  PersistedAnimeEpisode,
  Provider,
  animekuCatalog,
  animekuDetails,
  animekuHealthCheck,
  animekuPersistedCatalog,
  animekuPersistedEpisodes,
  animekuProviderRecord,
  animekuStatus,
  animekuStreamProbe,
  persistedMediaUrlCount,
  updateProvider,
} from '@/lib/api';
import Sidebar from '@/components/Sidebar';
import HealthBadge from '@/components/HealthBadge';
import StatCard from '@/components/StatCard';

const KIND_LABELS: Record<AnimekuCatalogKind, string> = {
  popular: 'Popular',
  ongoing: 'Ongoing',
  completed: 'Completed',
};

/** Tunable provider fields an operator may change from the dashboard. */
interface Tuning {
  priority: number;
  timeoutMs: number;
  maxRetries: number;
  cacheTtlSec: number;
  rateLimitPerMin: number;
}

const TUNING_FIELDS: { key: keyof Tuning; label: string; min: number; max: number }[] = [
  { key: 'priority', label: 'Priority (lower = tried first)', min: 1, max: 1000 },
  { key: 'timeoutMs', label: 'Timeout (ms)', min: 1000, max: 60000 },
  { key: 'maxRetries', label: 'Max retries', min: 0, max: 5 },
  { key: 'cacheTtlSec', label: 'Cache TTL (s)', min: 0, max: 86400 },
  { key: 'rateLimitPerMin', label: 'Rate limit / min', min: 1, max: 10000 },
];

function tuningOf(provider: Provider | null): Tuning {
  return {
    priority: provider?.priority ?? 100,
    timeoutMs: provider?.timeoutMs ?? 8000,
    maxRetries: provider?.maxRetries ?? 2,
    cacheTtlSec: provider?.cacheTtlSec ?? 3600,
    rateLimitPerMin: provider?.rateLimitPerMin ?? 60,
  };
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-sm font-medium break-words">{value}</div>
    </div>
  );
}

/** Episode numbering is derived by the backend; operators need to see how. */
function orderingNote(details: AnimekuDetails): string {
  const source = details.episodeOrder.numberSource || 'unknown';
  const reversed = details.episodeOrder.reversed ? ' The provider list arrived in descending order and was reversed to ascending.' : '';
  return `Numbers derived from: ${source}.${reversed}`;
}

export default function AnimekuPage() {
  const [status, setStatus] = useState<AnimekuStatus | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [health, setHealth] = useState<AnimekuHealthResult | null>(null);
  const [tuning, setTuning] = useState<Tuning>(tuningOf(null));
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const [kind, setKind] = useState<AnimekuCatalogKind>('popular');
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<AnimekuAnime[]>([]);
  const [total, setTotal] = useState(0);
  const [fallbackNotice, setFallbackNotice] = useState('');

  const [link, setLink] = useState('');
  const [details, setDetails] = useState<AnimekuDetails | null>(null);
  const [probe, setProbe] = useState<AnimekuStreamProbe | null>(null);

  const [docs, setDocs] = useState<PersistedAnimeDoc[]>([]);
  const [docTotal, setDocTotal] = useState(0);
  const [docPage, setDocPage] = useState(1);
  const [episodes, setEpisodes] = useState<PersistedAnimeEpisode[] | null>(null);
  const [auditedDoc, setAuditedDoc] = useState<PersistedAnimeDoc | null>(null);

  const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Request failed');

  const loadOverview = useCallback(async () => {
    setError('');
    setBusy(true);
    try {
      const [nextStatus, record] = await Promise.all([animekuStatus(), animekuProviderRecord()]);
      setStatus(nextStatus);
      setProvider(record);
      setTuning(tuningOf(record));
      if (!record) {
        setNotice('No Animeku provider record found. Run the backend seed (npm run seed) to create providerId "animasu".');
      }
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    let cancelled = false;
    setFallbackNotice('');
    animekuCatalog(kind, page, 20)
      .then((payload) => {
        if (cancelled) return;
        const list = Array.isArray(payload?.items) ? payload.items : [];
        if (!Array.isArray(payload?.items)) {
          setFallbackNotice('Animeku did not answer; the backend served the AniList/Jikan metadata fallback instead. Items below are metadata only.');
        }
        setItems(list);
        setTotal(payload?.total ?? list.length);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(message(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [kind, page]);

  useEffect(() => {
    let cancelled = false;
    animekuPersistedCatalog(docPage, 20)
      .then((payload) => {
        if (cancelled) return;
        setDocs(payload.items ?? []);
        setDocTotal(payload.total ?? 0);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(message(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [docPage]);

  const runHealthCheck = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      const results = await animekuHealthCheck();
      const animeku = results.find((result) => result.providerId === 'animasu' || result.providerId === status?.provider) ?? null;
      setHealth(animeku);
      setNotice(
        animeku
          ? `Upstream probe: ${animeku.status} in ${animeku.latencyMs}ms.`
          : `Health check ran for ${results.length} provider(s); no Animeku record is enabled.`,
      );
      await loadOverview();
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  };

  const saveTuning = async () => {
    if (!provider) return;
    setError('');
    setNotice('');
    try {
      await updateProvider(provider._id, tuning);
      setNotice('Animeku provider updated.');
      await loadOverview();
    } catch (cause) {
      setError(message(cause));
    }
  };

  const toggleEnabled = async () => {
    if (!provider) return;
    setError('');
    setNotice('');
    try {
      await updateProvider(provider._id, { enabled: !provider.enabled });
      setNotice(provider.enabled ? 'Animeku disabled — the app now falls back to AniList/Jikan metadata.' : 'Animeku enabled.');
      await loadOverview();
    } catch (cause) {
      setError(message(cause));
    }
  };

  const inspect = async (target: string) => {
    setError('');
    setNotice('');
    setDetails(null);
    setProbe(null);
    if (!target.trim()) {
      setError('A provider link is required, e.g. ?anime/naruto.');
      return;
    }
    try {
      setDetails(await animekuDetails(target.trim()));
    } catch (cause) {
      setError(message(cause));
    }
  };

  const probePlayback = async (episodeId: string) => {
    if (!details) return;
    setError('');
    setNotice('');
    setProbe(await animekuStreamProbe(details.anime._id, episodeId));
  };

  const auditEpisodes = async (doc: PersistedAnimeDoc) => {
    setError('');
    setNotice('');
    try {
      setEpisodes(await animekuPersistedEpisodes(doc._id));
      setAuditedDoc(doc);
    } catch (cause) {
      setError(message(cause));
    }
  };

  const storedMediaUrls = episodes ? persistedMediaUrlCount(episodes) : 0;
  const playbackAuthorized = status?.playbackAuthorized ?? false;

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-8 space-y-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Animeku</h1>
            <p className="text-sm text-gray-500 mt-1">
              Consumer-facing anime section · upstream provider <code className="text-xs">{status?.provider ?? 'animasu'}</code> · metadata is cacheable, media
              URLs are not.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" disabled={busy} onClick={() => void loadOverview()}>
              Reload
            </button>
            <button className="btn-primary" disabled={busy} onClick={() => void runHealthCheck()}>
              {busy ? 'Working…' : 'Run upstream health check'}
            </button>
          </div>
        </div>

        {error && <div className="card text-red-700">{error}</div>}
        {notice && <div className="card text-brand-700">{notice}</div>}

        <div className="grid md:grid-cols-3 gap-4">
          <StatCard
            label="Metadata"
            value={status?.metadataAvailable ? 'Available' : 'Blocked'}
            sub={status?.enabled ? 'Provider enabled' : 'Provider disabled — AniList/Jikan fallback only'}
            accent={status?.metadataAvailable ? 'text-green-700' : 'text-red-700'}
          />
          <StatCard
            label="Playback"
            value={playbackAuthorized ? 'Authorized' : 'Not authorized'}
            sub={playbackAuthorized ? `${status?.streamHostCount ?? 0} allow-listed stream host(s)` : 'ANIMASU_STREAMING_AUTHORIZED is not set'}
            accent={playbackAuthorized ? 'text-green-700' : 'text-yellow-700'}
          />
          <StatCard
            label="Upstream health"
            value={health?.status ?? provider?.healthStatus ?? 'unknown'}
            sub={health ? `probed in ${health.latencyMs}ms` : provider?.lastCheckedAt ? `last checked ${new Date(provider.lastCheckedAt).toLocaleString()}` : 'not probed yet'}
            accent={health?.status === 'down' || provider?.healthStatus === 'down' ? 'text-red-700' : 'text-gray-900'}
          />
          <div className="card">
            <div className="text-sm text-gray-500">Provider health record</div>
            <div className="mt-2 flex items-center gap-2">
              <HealthBadge status={health?.status ?? provider?.healthStatus ?? 'unknown'} />
              <span className="text-xs text-gray-400">{provider?.enabled ? 'enabled' : 'disabled'}</span>
            </div>
            <div className="text-xs text-gray-400 mt-2">
              Priority {provider?.priority ?? '—'} · timeout {provider?.timeoutMs ?? '—'}ms · rate limit {provider?.rateLimitPerMin ?? '—'}/min
            </div>
          </div>
          <StatCard label="Cache TTL" value={`${status?.cacheTtlSec ?? provider?.cacheTtlSec ?? 0}s`} sub="Provider response caching" />
          <StatCard label="Persisted anime" value={docTotal} sub="Documents in the catalog collection" />
          <StatCard label="Provider type" value={provider?.type ?? 'animeku'} sub={provider?.name ?? 'No record found'} />
        </div>

        <section className="card">
          <h2 className="font-semibold mb-3">Playback authorization</h2>
          {playbackAuthorized ? (
            <p className="text-sm text-green-800">
              This deployment asserts distribution rights: <code className="text-xs">ANIMASU_STREAMING_AUTHORIZED=true</code> and{' '}
              <code className="text-xs">{status?.streamHostCount ?? 0}</code> allow-listed stream host(s). The backend resolves temporary media URLs per
              playback session. Those URLs are never shown here, never persisted and never logged.
            </p>
          ) : (
            <div className="text-sm text-yellow-800 space-y-2">
              <p>
                Playback is <strong>not authorized</strong>. Metadata, schedule, search and episode lists keep working; every media request answers{' '}
                <code className="text-xs">403 STREAM_NOT_AUTHORIZED</code> and the mobile player shows an honest &quot;playback unavailable&quot; state.
              </p>
              <p>
                To authorize playback, set <code className="text-xs">ANIMASU_STREAMING_AUTHORIZED=true</code> <em>and</em>{' '}
                <code className="text-xs">ANIMASU_ALLOWED_STREAM_HOSTS</code> (comma-separated; the backend refuses to start with the switch on and an empty
                allowlist, because an allowlist-free deployment would proxy any host).
              </p>
              <p className="text-xs text-gray-500">
                These are backend environment variables, not database fields: they are deliberately not editable from the dashboard so an admin session cannot
                silently grant itself distribution rights.
              </p>
            </div>
          )}
        </section>

        <section className="card">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold">Provider record</h2>
            {provider && (
              <button className={provider.enabled ? 'btn-danger' : 'btn-primary'} onClick={() => void toggleEnabled()}>
                {provider.enabled ? 'Disable Animeku' : 'Enable Animeku'}
              </button>
            )}
          </div>
          {!provider ? (
            <p className="text-sm text-gray-500">
              No <code className="text-xs">animeku</code> provider record exists. The backend still serves Animeku from environment configuration; the record
              adds caching, health tracking, priority and per-call logging. Seed it with <code className="text-xs">npm run seed</code> in{' '}
              <code className="text-xs">backend/</code>.
            </p>
          ) : (
            <>
              <div className="grid md:grid-cols-4 gap-4 mb-4">
                <Field label="Provider ID" value={provider.providerId} />
                <Field label="Name" value={provider.name} />
                <Field label="Base URL" value={provider.baseUrl} />
                <Field label="Auth method" value={provider.authMethod} />
                <div>
                  <div className="text-xs text-gray-500">Health</div>
                  <div className="mt-1">
                    <HealthBadge status={provider.healthStatus} />
                  </div>
                </div>
                <Field label="Success / errors" value={`${provider.successCount} / ${provider.errorCount}`} />
                <Field label="Average latency" value={`${provider.avgLatencyMs}ms`} />
                <Field label="Last checked" value={provider.lastCheckedAt ? new Date(provider.lastCheckedAt).toLocaleString() : 'never'} />
              </div>
              <div className="grid md:grid-cols-5 gap-4">
                {TUNING_FIELDS.map((field) => (
                  <div key={field.key}>
                    <label className="block text-sm font-medium mb-1">{field.label}</label>
                    <input
                      className="input"
                      type="number"
                      min={field.min}
                      max={field.max}
                      value={tuning[field.key]}
                      onChange={(event) => setTuning({ ...tuning, [field.key]: Number(event.target.value) })}
                    />
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button className="btn-primary" onClick={() => void saveTuning()}>
                  Save changes
                </button>
                {provider.notes && <p className="text-xs text-gray-500 max-w-xl">{provider.notes}</p>}
              </div>
            </>
          )}
        </section>

        <section className="card">
          <h2 className="font-semibold mb-3">Live catalog inspector</h2>
          <div className="flex flex-wrap items-center gap-2 mb-4">
            {ANIMEKU_CATALOG_KINDS.map((value) => (
              <button
                key={value}
                className={kind === value ? 'btn-primary' : 'btn-secondary'}
                onClick={() => {
                  setKind(value);
                  setPage(1);
                }}
              >
                {KIND_LABELS[value]}
              </button>
            ))}
            <span className="text-sm text-gray-500 ml-2">
              Page {page} · {total} items reported by the provider
            </span>
            <div className="ml-auto flex gap-2">
              <button className="btn-secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Prev
              </button>
              <button className="btn-secondary" onClick={() => setPage(page + 1)}>
                Next
              </button>
            </div>
          </div>
          {fallbackNotice && <div className="mb-4 text-sm text-yellow-800">{fallbackNotice}</div>}
          <table className="table w-full">
            <thead>
              <tr>
                <th>Title</th>
                <th>Type</th>
                <th>Status</th>
                <th>Rating</th>
                <th>Latest episode</th>
                <th>Provider link</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item._id || item.link || item.title}>
                  <td className="font-medium">{item.title || '—'}</td>
                  <td>{item.type || '—'}</td>
                  <td>{item.status || '—'}</td>
                  <td>{item.rating ? item.rating.toFixed(1) : '—'}</td>
                  <td>{item.latestEpisode?.text || '—'}</td>
                  <td className="text-xs text-gray-500 break-all">{item.link || item.providerId || '—'}</td>
                  <td>
                    <button
                      className="btn-secondary text-xs px-2 py-1"
                      disabled={!item.link}
                      onClick={() => {
                        setLink(item.link);
                        void inspect(item.link);
                      }}
                    >
                      Inspect
                    </button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-sm text-gray-500">
                    No items. Either the upstream catalog is empty or the provider is disabled.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="card">
          <h2 className="font-semibold mb-1">Details &amp; episode normalization</h2>
          <p className="text-sm text-gray-500 mb-4">
            Paste a provider link (it contains <code className="text-xs">/</code> and <code className="text-xs">?</code>, so it is always sent as an encoded
            query parameter) to verify titles, genres, episode numbers and ordering.
          </p>
          <div className="flex gap-2 mb-4">
            <input className="input flex-1" placeholder="?anime/naruto" value={link} onChange={(event) => setLink(event.target.value)} />
            <button className="btn-primary" onClick={() => void inspect(link)}>
              Inspect link
            </button>
          </div>
          {details && (
            <div className="space-y-4">
              <div className="grid md:grid-cols-4 gap-4">
                <Field label="Title" value={details.anime.title || '—'} />
                <Field label="Type" value={details.anime.type || '—'} />
                <Field label="Status" value={details.anime.status || '—'} />
                <Field label="Studio" value={details.anime.studio || '—'} />
                <Field label="Rating" value={details.anime.rating ? details.anime.rating.toFixed(1) : '—'} />
                <Field label="Episodes" value={details.anime.episodeCount ? String(details.anime.episodeCount) : '—'} />
                <Field label="Genres" value={details.anime.genres.length ? details.anime.genres.join(', ') : '—'} />
                <Field label="Playback" value={details.playback} />
              </div>
              {details.anime.synopsis && <p className="text-sm text-gray-600 whitespace-pre-line">{details.anime.synopsis}</p>}
              <div className="text-xs text-gray-500">
                {orderingNote(details)} · {details.episodes.length} episode(s) listed
              </div>
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Label</th>
                    <th>Title</th>
                    <th>Date</th>
                    <th>Persisted</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {details.episodes.map((episode) => (
                    <tr key={`${episode.number}-${episode.id || episode.label}`}>
                      <td>{episode.number}</td>
                      <td>{episode.label || '—'}</td>
                      <td>{episode.title || '—'}</td>
                      <td>{episode.date || '—'}</td>
                      <td>{episode.id ? <span className="badge badge-green">yes</span> : <span className="badge badge-gray">not stored</span>}</td>
                      <td>
                        <button className="btn-secondary text-xs px-2 py-1" disabled={!episode.id} onClick={() => void probePlayback(episode.id)}>
                          Probe playback
                        </button>
                      </td>
                    </tr>
                  ))}
                  {details.episodes.length === 0 && (
                    <tr>
                      <td colSpan={6} className="text-sm text-gray-500">
                        The provider returned no episodes for this link.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              {probe && (
                <div className={probe.authorized ? 'text-sm text-green-800' : probe.code === 'STREAM_NOT_AUTHORIZED' ? 'text-sm text-yellow-800' : 'text-sm text-red-700'}>
                  <span className={`badge ${probe.authorized ? 'badge-green' : probe.code === 'STREAM_NOT_AUTHORIZED' ? 'badge-yellow' : 'badge-red'}`}>
                    {probe.code}
                  </span>{' '}
                  {probe.message}
                  {probe.authorized && probe.temporary ? ' The resolved URL is temporary and is not displayed.' : ''}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="font-semibold mb-1">Persistence audit</h2>
          <p className="text-sm text-gray-500 mb-4">
            Cached metadata is expected; a stored media URL is a contract violation. Auditing a title loads its episode documents and counts non-empty{' '}
            <code className="text-xs">streamUrl</code> values.
          </p>
          <table className="table w-full">
            <thead>
              <tr>
                <th>Title</th>
                <th>Source</th>
                <th>Provider link</th>
                <th>Format</th>
                <th>Episodes</th>
                <th>Cached at</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {docs.map((doc) => (
                <tr key={doc._id}>
                  <td className="font-medium">{doc.title || '—'}</td>
                  <td>{doc.source ?? '—'}</td>
                  <td className="text-xs text-gray-500 break-all">{doc.providerId || '—'}</td>
                  <td>{doc.format ?? '—'}</td>
                  <td>{doc.episodeCount ?? '—'}</td>
                  <td>{doc.createdAt ? new Date(doc.createdAt).toLocaleString() : '—'}</td>
                  <td>
                    <button className="btn-secondary text-xs px-2 py-1" onClick={() => void auditEpisodes(doc)}>
                      Audit episodes
                    </button>
                  </td>
                </tr>
              ))}
              {docs.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-sm text-gray-500">
                    Nothing cached yet. Browse the live catalog above to populate it.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <div className="flex items-center gap-3 mt-4 text-sm">
            <button className="btn-secondary" disabled={docPage <= 1} onClick={() => setDocPage(docPage - 1)}>
              Prev
            </button>
            <span>
              Page {docPage} · {docTotal} documents
            </span>
            <button className="btn-secondary" onClick={() => setDocPage(docPage + 1)}>
              Next
            </button>
          </div>
          {episodes && auditedDoc && (
            <div className="mt-4 border-t pt-4">
              <div className="flex items-center gap-2 mb-2">
                <h3 className="font-semibold text-sm">{auditedDoc.title}</h3>
                <span className={`badge ${storedMediaUrls === 0 ? 'badge-green' : 'badge-red'}`}>
                  {storedMediaUrls === 0 ? '0 stored media URLs' : `${storedMediaUrls} stored media URL(s)`}
                </span>
                <span className="text-xs text-gray-500">
                  {episodes.length} episode document(s) · {episodes.filter((episode) => Boolean(episode.providerEpisodeId)).length} carry a provider link
                </span>
              </div>
              {storedMediaUrls > 0 && (
                <p className="text-sm text-red-700">
                  Contract violation: episode documents must never persist a media URL. Provider URLs are temporary and are resolved per playback session.
                </p>
              )}
              <table className="table w-full">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Title</th>
                    <th>Provider episode link</th>
                    <th>Stored media URL</th>
                  </tr>
                </thead>
                <tbody>
                  {episodes.map((episode) => (
                    <tr key={episode._id}>
                      <td>{episode.number ?? '—'}</td>
                      <td>{episode.title || '—'}</td>
                      <td className="text-xs text-gray-500 break-all">{episode.providerEpisodeId || '—'}</td>
                      <td>
                        {typeof episode.streamUrl === 'string' && episode.streamUrl.trim() !== '' ? (
                          <span className="badge badge-red">present</span>
                        ) : (
                          <span className="badge badge-green">empty</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
