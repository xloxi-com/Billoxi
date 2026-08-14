import type { ClientLoaderFunctionArgs } from "react-router";

const DEFAULT_TTL_MS = 120_000;
const DEFAULT_MAX = 24;

export function createAppPageClientCache(options?: {
  ttlMs?: number;
  max?: number;
}) {
  const ttlMs = options?.ttlMs ?? DEFAULT_TTL_MS;
  const max = options?.max ?? DEFAULT_MAX;
  const cache = new Map<string, { expires: number; data: unknown }>();

  function keyFromUrl(url: URL) {
    return `${url.pathname}${url.search}`;
  }

  return {
    bust() {
      cache.clear();
    },
    get(request: Request) {
      const url = new URL(request.url);
      if (url.searchParams.get("fresh") === "1") return null;
      const hit = cache.get(keyFromUrl(url));
      if (hit && hit.expires > Date.now()) return hit.data;
      return null;
    },
    set(request: Request, data: unknown) {
      const url = new URL(request.url);
      if (url.searchParams.get("fresh") === "1") return;
      cache.set(keyFromUrl(url), {
        expires: Date.now() + ttlMs,
        data,
      });
      while (cache.size > max) {
        const oldest = cache.keys().next().value;
        if (oldest === undefined) break;
        cache.delete(oldest);
      }
    },
  };
}

export async function cachedClientLoader(
  cache: ReturnType<typeof createAppPageClientCache>,
  { request, serverLoader }: ClientLoaderFunctionArgs,
  options?: { bypassCache?: boolean },
) {
  if (!options?.bypassCache) {
    const hit = cache.get(request);
    if (hit) return hit;
  }
  const data = await serverLoader();
  cache.set(request, data);
  return data;
}
