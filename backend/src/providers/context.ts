import { AsyncLocalStorage } from 'async_hooks';
export const providerContext = new AsyncLocalStorage<{ timeoutMs: number; retries: number }>();
