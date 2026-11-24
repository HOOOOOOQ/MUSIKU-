'use client';

import { useCallback, useEffect, useState } from 'react';
import Sidebar from '@/components/Sidebar';
import HealthBadge from '@/components/HealthBadge';
import { apiGet, apiPost } from '@/lib/api';

interface IntegrationFlag {
  configured?: boolean;
  credentialsPresent?: boolean;
  adapterReady?: boolean;
  liveVerified?: boolean;
  adapter?: string;
  verifier?: string;
  webhookSignatureVerification?: boolean;
}

interface GithubBuild {
  available: boolean;
  reason?: string;
  branch?: string;
  id?: number;
  status?: string;
  conclusion?: string | null;
  url?: string;
  updatedAt?: string;
}

interface StatusPayload {
  integrations: Record<string, IntegrationFlag | GithubBuild | string> & {
    githubBuild: GithubBuild;
    environment: string;
  };
  database: { status: string; latencyMs: number };
  authentication: {
    emailUsers: number;
    googleUsers: number;
    activeSessions: number;
    recentLogins: { _id: { method: string; success: boolean }; count: number }[];
  };
}

interface ProviderHealth {
  _id: string;
  provider: string;
  status: string;
  uptimePct: number;
  avgLatencyMs: number;
  lastCheckAt?: string;
}

const LABELS: Record<string, string> = {
  google: 'Google OAuth',
  email: 'Email delivery (SMTP)',
  payments: 'Payments',
  musicStreaming: 'Licensed music streaming',
  animeStreaming: 'Licensed anime streaming',
};

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className={`badge ${ok ? 'badge-green' : 'badge-gray'}`}>{label}</span>
  );
}

export default function Integrations() {
  const [data, setData] = useState<StatusPayload | null>(null);
  const [health, setHealth] = useState<ProviderHealth[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setError('');
    apiGet<StatusPayload>('/api/admin/integration-status')
      .then(setData)
      .catch((e: Error) => setError(e.message));
    apiGet<ProviderHealth[]>('/api/providers/health')
      .then(setHealth)
      .catch(() => setHealth([]));
  }, []);

  useEffect(load, [load]);

  const runHealthCheck = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiPost('/api/providers/health-check', {});
      setNotice('Provider health checks executed.');
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Health check failed');
    } finally {
      setBusy(false);
    }
  };

  const integrations = data?.integrations;
  const github = integrations?.githubBuild;

  return (
    <div className="flex">
      <Sidebar />
      <main className="flex-1 p-8">
        <h1 className="text-2xl font-bold">Authentication &amp; Integration Health</h1>
        <div className="flex gap-3 my-4">
          <button className="btn-primary" onClick={load}>
            Refresh status
          </button>
          <button className="btn-secondary" onClick={runHealthCheck} disabled={busy}>
            {busy ? 'Running…' : 'Run provider health checks'}
          </button>
        </div>

        {error && (
          <p role="alert" className="text-red-600 mb-4">
            {error}
          </p>
        )}
        {notice && <p className="text-green-600 mb-4">{notice}</p>}

        {!data && !error && <p>Loading…</p>}

        {data && (
          <>
            <section className="card mb-4">
              <h2 className="font-bold mb-3">Integration configuration</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-gray-500">
                    <th className="py-2">Integration</th>
                    <th>Configuration</th>
                    <th>Implementation</th>
                    <th>Live verified</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(LABELS).map(([key, label]) => {
                    const flag = integrations?.[key] as IntegrationFlag | undefined;
                    const configured = Boolean(flag?.configured ?? flag?.credentialsPresent);
                    const ready = key.endsWith('Streaming') ? Boolean(flag?.adapterReady) : configured;
                    const detail =
                      flag?.verifier ??
                      (flag?.adapter
                        ? `${flag.adapter}${flag?.webhookSignatureVerification ? ' · webhook signature verification' : ''}`
                        : configured
                          ? 'credentials present'
                          : 'no credentials configured');
                    return (
                      <tr key={key} className="border-t border-gray-100">
                        <td className="py-2 font-medium">{label}</td>
                        <td>
                          <Badge ok={configured} label={configured ? 'configured' : 'not configured'} />
                        </td>
                        <td className="text-gray-600">{detail}</td>
                        <td>
                          <Badge ok={ready && flag?.liveVerified === true} label={ready && flag?.liveVerified === true ? 'yes' : 'no'} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className="text-xs text-gray-500 mt-3">
                “Configured” means the environment variable exists — it is not proof of a successful live provider
                test. Licensed streaming adapters report <code>adapterReady: false</code> until concrete adapters are
                implemented. Credential values are never sent to the browser.
              </p>
            </section>

            <div className="grid md:grid-cols-2 gap-4 mb-4">
              <section className="card">
                <h2 className="font-bold mb-2">MongoDB Atlas</h2>
                <p className="flex items-center gap-2">
                  <HealthBadge status={data.database.status} />
                  <span className="text-sm text-gray-600">ping {data.database.latencyMs} ms</span>
                </p>
                <p className="text-xs text-gray-500 mt-2">
                  Environment: {String(integrations?.environment ?? 'unknown')}
                </p>
              </section>

              <section className="card">
                <h2 className="font-bold mb-2">GitHub Android build (main)</h2>
                {github?.available ? (
                  <div className="text-sm">
                    <p>
                      Status: {github.status ?? 'unknown'}
                      {github.conclusion ? ` · ${github.conclusion}` : ''}
                    </p>
                    <p className="text-gray-600">
                      Branch {github.branch ?? 'main'} · run {github.id ?? 'n/a'}
                      {github.updatedAt ? ` · updated ${github.updatedAt}` : ''}
                    </p>
                    {github.url ? (
                      <a
                        className="text-brand-500 underline"
                        href={github.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Open workflow run
                      </a>
                    ) : (
                      <p className="text-gray-500">No public run URL returned.</p>
                    )}
                  </div>
                ) : (
                  <p className="text-sm text-gray-600">
                    {github?.reason ?? 'GitHub build status unavailable.'}
                  </p>
                )}
                <p className="text-xs text-gray-500 mt-2">
                  Sanitized server-side lookup of this repository&apos;s Android workflow; no token or raw payload is
                  exposed.
                </p>
              </section>
            </div>

            <section className="card mb-4">
              <h2 className="font-bold mb-2">Authentication statistics</h2>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-2xl font-semibold">{data.authentication.emailUsers}</div>
                  <div className="text-gray-500">Email/password users</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold">{data.authentication.googleUsers}</div>
                  <div className="text-gray-500">Google-linked users</div>
                </div>
                <div>
                  <div className="text-2xl font-semibold">{data.authentication.activeSessions}</div>
                  <div className="text-gray-500">Active sessions</div>
                </div>
              </div>
              <h3 className="font-semibold mt-4 mb-2 text-sm">Login attempts (24h)</h3>
              {data.authentication.recentLogins.length === 0 ? (
                <p className="text-sm text-gray-500">No login attempts recorded.</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-1">Method</th>
                      <th>Result</th>
                      <th>Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.authentication.recentLogins.map((row) => (
                      <tr key={`${row._id.method}-${row._id.success}`} className="border-t border-gray-100">
                        <td className="py-1">{row._id.method}</td>
                        <td>
                          <Badge ok={row._id.success} label={row._id.success ? 'success' : 'failed'} />
                        </td>
                        <td>{row.count}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>

            <section className="card">
              <h2 className="font-bold mb-2">Provider health</h2>
              {health.length === 0 ? (
                <p className="text-sm text-gray-500">
                  No provider health records yet. Run a health check to populate them.
                </p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="py-1">Provider</th>
                      <th>Status</th>
                      <th>Uptime</th>
                      <th>Avg latency</th>
                      <th>Last check</th>
                    </tr>
                  </thead>
                  <tbody>
                    {health.map((row) => (
                      <tr key={row._id} className="border-t border-gray-100">
                        <td className="py-1 font-mono text-xs">{row.provider}</td>
                        <td>
                          <HealthBadge status={row.status} />
                        </td>
                        <td>{row.uptimePct.toFixed(1)}%</td>
                        <td>{row.avgLatencyMs} ms</td>
                        <td className="text-gray-500">{row.lastCheckAt ?? 'never'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
