/**
 * Redaction helpers for anything that gets persisted or logged.
 *
 * Temporary provider URLs (episode media links, signed CDN links, thumbnail
 * links carrying query credentials) must never end up in Mongo documents,
 * provider logs or the audit trail: they expire, they are user/agent specific,
 * and they can carry access tokens. Every message that leaves a provider call
 * is passed through these helpers before it is stored.
 */

const URL_PATTERN = /https?:\/\/[^\s"',;)\]}>]+/gi;

/** Replaces every absolute http(s) URL in `text` with a fixed placeholder. */
export function redactUrls(text: string, replacement = '<url-redacted>'): string {
  return String(text ?? '').replace(URL_PATTERN, replacement);
}

/**
 * Keeps a URL's host and path (useful for debugging provider errors) but strips
 * the query string and fragment, which is where credentials live.
 */
export function redactUrlQuery(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return '<invalid-url>';
  }
}

/**
 * Masks a secret-ish value, keeping only enough to identify it in logs.
 * Returns a fixed marker for empty input so nothing is accidentally echoed.
 */
export function maskSecret(value: string | undefined | null, visible = 4): string {
  const text = String(value ?? '');
  if (!text) return '<empty>';
  if (text.length <= visible * 2) return '*'.repeat(Math.min(text.length, 8));
  return `${text.slice(0, visible)}${'*'.repeat(8)}${text.slice(-visible)}`;
}

/** Truncates after redaction so the bounded DB fields never see raw URLs. */
export function safeErrorMessage(message: string, max = 500): string {
  return redactUrls(message).slice(0, max);
}
