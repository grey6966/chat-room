import { config } from './config.js';

/**
 * Simple sliding-window limiter keyed per user. Node's event loop is
 * single-threaded, so plain Maps are sufficient — no locking needed.
 */
const hits = new Map<string, number[]>();

export function rateLimited(key: string): boolean {
  const now = Date.now();
  const cutoff = now - config.rateWindowMs;
  const recent = (hits.get(key) ?? []).filter((t) => t > cutoff);

  if (recent.length >= config.rateLimitPerWindow) {
    hits.set(key, recent);
    return true;
  }

  recent.push(now);
  hits.set(key, recent);
  return false;
}

export function resetRateLimit(key: string): void {
  hits.delete(key);
}

// Periodically drop expired buckets so memory does not grow unbounded.
setInterval(() => {
  const cutoff = Date.now() - config.rateWindowMs;
  for (const [key, times] of hits) {
    const live = times.filter((t) => t > cutoff);
    if (live.length === 0) hits.delete(key);
    else hits.set(key, live);
  }
}, config.rateWindowMs).unref();
