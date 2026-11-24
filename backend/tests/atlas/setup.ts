/**
 * Environment for the Atlas integration suite.
 *
 * Unlike `tests/setup.ts` this file does NOT overwrite `MONGODB_URI`,
 * `JWT_SECRET` or `JWT_REFRESH_SECRET`: the whole point of the suite is to run
 * against the real configured values (in CI, the repository secrets). Local
 * fallbacks are only used when nothing is configured, so the suite still
 * compiles and reports itself as skipped.
 */
process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';

if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'local-atlas-suite-access-secret';
}
if (!process.env.JWT_REFRESH_SECRET) {
  process.env.JWT_REFRESH_SECRET = 'local-atlas-suite-refresh-secret';
}
// Placeholder audience for the mocked Google verifier in this suite. It is not a
// credential and no request is ever sent to Google from these tests.
if (!process.env.GOOGLE_WEB_CLIENT_ID) {
  process.env.GOOGLE_WEB_CLIENT_ID = 'atlas-suite-placeholder.apps.googleusercontent.com';
}

if (!process.env.MONGODB_URI) {
  // Deliberately unreachable placeholder: the pre-flight probe marks the suite
  // as skipped instead of pretending a database exists.
  process.env.MONGODB_URI = 'mongodb://127.0.0.1:1/musiku_plus_unavailable';
}
