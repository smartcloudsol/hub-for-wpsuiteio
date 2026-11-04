import { assertBackendProfileCurrent, getBackendProfileContext } from "./backend-profile.ts";

const registryKey = Symbol.for("wpsuite.document-request-cache.v1");
type Registry = WeakMap<Document, Map<string, Promise<unknown>>>;
const globals = globalThis as typeof globalThis & { [registryKey]?: Registry };

/** Return no key when platform hashing is unavailable; callers then load independently. */
export async function requestKeyDigest(value: string): Promise<string | null> {
  if (!globalThis.crypto?.subtle || typeof TextEncoder === "undefined") return null;
  try {
    const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/** Public, non-secret context only. Capture it before starting an asynchronous load. */
export function requestContext(): string {
  const profile = getBackendProfileContext();
  assertBackendProfileCurrent(profile);
  // Consumers may declare a narrower WpSuite global while still supplying these
  // public fields at runtime. Keep the same partition without widening theirs.
  const settings = globalThis.WpSuite?.siteSettings as unknown as {
    siteId?: string; workspaceId?: string; accountId?: string;
    workspaceApiMode?: string; platformApiBaseUrl?: string; platformConfigUrl?: string;
  } | undefined;
  return JSON.stringify([typeof location === "undefined" ? null : location.origin, profile ?? null,
    settings?.siteId ?? null, settings?.workspaceId ?? null, settings?.accountId ?? null,
    settings?.workspaceApiMode ?? null, settings?.platformApiBaseUrl ?? null, settings?.platformConfigUrl ?? null]);
}

export function documentRequest<T>(key: string, load: () => Promise<T>, valid: (value: T) => boolean): { promise: Promise<T>; evict: () => void } {
  if (typeof document === "undefined") return { promise: load(), evict: () => {} };
  const registry = globals[registryKey] ??= new WeakMap();
  let cache = registry.get(document);
  if (!cache) { cache = new Map(); registry.set(document, cache); }
  const entries = cache;
  let hashed: string | null = null;
  let captured: Promise<T> | undefined;
  let evicted = false;
  const evict = () => {
    evicted = true;
    if (hashed && captured && entries.get(hashed) === captured) entries.delete(hashed);
  };
  const promise = (async () => {
    hashed = await requestKeyDigest(key);
    if (!hashed || evicted) return load();
    let shared = entries.get(hashed) as Promise<T> | undefined;
    if (!shared) {
      shared = Promise.resolve().then(load);
      entries.set(hashed, shared);
      const current = shared;
      const currentKey = hashed;
      void shared.then((value) => { if (!valid(value) && entries.get(currentKey) === current) entries.delete(currentKey); }, () => { if (entries.get(currentKey) === current) entries.delete(currentKey); });
    }
    captured = shared;
    return shared;
  })();
  return { promise, evict };
}
