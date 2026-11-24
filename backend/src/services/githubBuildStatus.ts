import { env } from '../config/env';
let cached: { expires: number; value: Record<string, unknown> } | undefined;
/** Server-only, fixed repository/workflow: no arbitrary URL or token returned to browser. */
export async function githubBuildStatus(): Promise<Record<string, unknown>> {
  if (cached && cached.expires > Date.now()) return cached.value;
  try {
    const response = await fetch('https://api.github.com/repos/HOOOOOOQ/MUSIKU-/actions/workflows/android-build.yml/runs?per_page=1&branch=main', {
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(env.GITHUB_BUILD_TOKEN ? { Authorization: `Bearer ${env.GITHUB_BUILD_TOKEN}` } : {}) },
      signal: AbortSignal.timeout(4000),
    });
    if (!response.ok) throw new Error('GitHub unavailable');
    const body = await response.json() as { workflow_runs?: { id: number; status: string; conclusion: string | null; html_url: string; updated_at: string }[] };
    const run = body.workflow_runs?.[0];
    const value = run ? { available: true, branch: 'main', id: run.id, status: run.status, conclusion: run.conclusion, url: run.html_url.startsWith('https://github.com/HOOOOOOQ/MUSIKU-/actions/runs/') ? run.html_url : undefined, updatedAt: run.updated_at } : { available: true, branch: 'main', status: 'no_runs' };
    cached = { expires: Date.now() + 60000, value }; return value;
  } catch { return { available: false, reason: 'GitHub status unavailable or repository permission required' }; }
}
