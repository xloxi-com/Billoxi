import type { ClientLoaderFunctionArgs } from "react-router";

const DEFAULT_TTL_MS = 120_000;
/** Within soft TTL, return cache and skip network (instant nav). */
const DEFAULT_SOFT_TTL_MS = 45_000;
const DEFAULT_MAX = 24;

export function createAppPageClientCache(options?: {
  ttlMs?: number;
  softTtlMs?: number;
  max?: number;
}) {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const softTtlMs = Math.min(options?.softTtlMs ?? DEFAULT_SOFT_TTL_MS, ttlMs);
  const max = options?.max ?? DEFAULT_MAX;
  const cache = new Map<
    string,
    { created: number; expires: number; data: unknown }
  >();
  const refreshing = new Set<string>();

  function keyFromUrl(url: URL) {
    return `${url.pathname}${url.search}`;
  }

  function prune() {
    while (cache.size > max) {
      const oldest = cache.keys().next().value;
      if (oldest === undefined) break;
      cache.delete(oldest);
      refreshing.delete(oldest);
    }
  }

  return {
    bust() {
      cache.clear();
      refreshing.clear();
    },
    /** Fresh within soft TTL — safe to skip server entirely. */
    getFresh(request: Request) {
      const url = new URL(request.url);
      if (url.searchParams.get("fresh") === "1") return null;
      const hit = cache.get(keyFromUrl(url));
      if (hit && Date.now() - hit.created < softTtlMs) return hit.data;
      return null;
    },
    /**
     * Still within hard TTL (or short grace) — usable for stale-while-revalidate.
     */
    getStale(request: Request) {
      const url = new URL(request.url);
      if (url.searchParams.get("fresh") === "1") return null;
      const hit = cache.get(keyFromUrl(url));
      if (!hit) return null;
      const now = Date.now();
      if (hit.expires > now) return hit.data;
      // Brief grace so a soft-expired tab switch still paints instantly.
      if (hit.expires > now - 30_000) return hit.data;
      return null;
    },
    get(request: Request) {
      return this.getFresh(request) ?? this.getStale(request);
    },
    set(request: Request, data: unknown) {
      const url = new URL(request.url);
      if (url.searchParams.get("fresh") === "1") return;
      const key = keyFromUrl(url);
      const now = Date.now();
      cache.set(key, {
        created: now,
        expires: now + ttlMs,
        data,
      });
      prune();
    },
    beginRefresh(request: Request) {
      const key = keyFromUrl(new URL(request.url));
      if (refreshing.has(key)) return false;
      refreshing.add(key);
      return true;
    },
    endRefresh(request: Request) {
      refreshing.delete(keyFromUrl(new URL(request.url)));
    },
  };
}

/**
 * Instant nav when cache is warm; soft-expired entries return immediately
 * while a background serverLoader refresh updates the cache for next time.
 */
export async function cachedClientLoader(
  cache: ReturnType<typeof createAppPageClientCache>,
  { request, serverLoader }: ClientLoaderFunctionArgs,
  options?: { bypassCache?: boolean },
) {
  if (!options?.bypassCache) {
    const fresh = cache.getFresh(request);
    if (fresh) return fresh;

    const stale = cache.getStale(request);
    if (stale) {
      if (cache.beginRefresh(request)) {
        void serverLoader()
          .then((data) => cache.set(request, data))
          .catch(() => {})
          .finally(() => cache.endRefresh(request));
      }
      return stale;
    }
  }
  const data = await serverLoader();
  cache.set(request, data);
  return data;
}
