import { documentRequest, requestContext, requestKeyDigest } from "./document-request-cache.ts";
import { normalizeLocale, type TranslationCatalogs } from "./locale.ts";

export type TranslationLoadFailure = "timeout" | "http" | "invalid" | "network";
export interface TranslationLoadOptions {
  cacheVersion?: string | number;
  timeoutMs?: number;
  onError?: (reason: TranslationLoadFailure) => void;
}

export interface CustomTranslationLoadOptions extends TranslationLoadOptions {
  /** Temporary fallback for plugin-specific settings during rolling upgrades. */
  legacyUrl?: string | null;
}

const customTranslationRequests = new Map<
  string,
  Promise<{ catalogs: TranslationCatalogs | null; reason?: TranslationLoadFailure }>
>();

/** Invalid remote dictionaries never prevent a plugin from mounting with built-ins. */
export async function loadTranslationCatalogs(url?: string | null, options: TranslationLoadOptions = {}): Promise<TranslationCatalogs | null> {
  if (!url) return null;
  const controller = new AbortController();
  let reason: TranslationLoadFailure = "network";
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const target = new URL(url, typeof document === "undefined" ? undefined : document.baseURI);
    if (options.cacheVersion !== undefined) target.searchParams.set("t", String(options.cacheVersion));
    const load = async () => {
      const response = await fetch(target.href, { signal: controller.signal });
      if (!response.ok) { reason = "http"; throw new Error("Translation request failed"); }
      reason = "invalid";
      const input: unknown = await response.json();
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Invalid dictionary");
      const dictionaries: TranslationCatalogs = {};
      for (const [language, values] of Object.entries(input)) {
        const locale = normalizeLocale(language);
        if (!locale || !values || typeof values !== "object" || Array.isArray(values)) throw new Error("Invalid dictionary locale");
        if (Object.values(values).some((value) => typeof value !== "string")) throw new Error("Invalid dictionary value");
        // Preserve supported legacy vocabulary names; each scoped translator normalizes them.
        Object.defineProperty(dictionaries, language, { value: { ...values }, enumerable: true });
      }
      return dictionaries;
    };
    return await Promise.race([
      load(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => { reason = "timeout"; controller.abort(); reject(new Error("Translation request timed out")); }, options.timeoutMs ?? 5000);
      }),
    ]);
  } catch {
    options.onError?.(reason);
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("wpsuite:translations:error", { detail: { reason } }));
    return null;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * Loads the site-wide custom translation catalog.
 *
 * The shared site setting is authoritative. `legacyUrl` exists only so plugin
 * upgrades can retain their previous per-plugin URL until an administrator
 * saves the new common setting.
 */
export async function getCustomTranslations(
  options: CustomTranslationLoadOptions = {},
): Promise<TranslationCatalogs | null> {
  const siteSettings = globalThis.WpSuite?.siteSettings;
  const url = siteSettings?.customTranslationsUrl?.trim() || options.legacyUrl?.trim();
  if (!url) return null;

  const cacheVersion = options.cacheVersion ?? siteSettings?.lastUpdate;
  const context = requestContext();
  const requestDocument = typeof document === "undefined" ? undefined : document;
  const requestBase = requestDocument?.baseURI;
  let target: URL;
  try {
    target = new URL(url, typeof document === "undefined" ? undefined : document.baseURI);
  } catch {
    return loadTranslationCatalogs(url, { ...options, cacheVersion });
  }
  if (cacheVersion !== undefined) target.searchParams.set("t", String(cacheVersion));
  const cacheKey = JSON.stringify(["translations-v1", target.href, context, options.timeoutMs ?? 5000]);
  const load = async () => {
    let reason: TranslationLoadFailure | undefined;
    // Report once per caller below, including callers joining an existing request.
    const catalogs = await loadTranslationCatalogs(target.href, { timeoutMs: options.timeoutMs, onError: (value) => { reason = value; } });
    return { catalogs, reason };
  };
  let promise: Promise<{ catalogs: TranslationCatalogs | null; reason?: TranslationLoadFailure }>;
  if (typeof document === "undefined") {
    const nodeKey = await requestKeyDigest(cacheKey);
    if (!nodeKey) {
      promise = load();
    } else {
      promise = customTranslationRequests.get(nodeKey) ?? load();
      customTranslationRequests.set(nodeKey, promise);
      const captured = promise;
      void promise.then((result) => { if (!result.catalogs && customTranslationRequests.get(nodeKey) === captured) customTranslationRequests.delete(nodeKey); }, () => { if (customTranslationRequests.get(nodeKey) === captured) customTranslationRequests.delete(nodeKey); });
    }
  } else {
    promise = documentRequest(cacheKey, load, (result) => result.catalogs !== null).promise;
  }
  const result = await promise;
  if (!result.catalogs) {
    if (result.reason) options.onError?.(result.reason);
    return null;
  }
  if (requestContext() !== context || (typeof document === "undefined" ? undefined : document) !== requestDocument || requestDocument?.baseURI !== requestBase || (globalThis.WpSuite?.siteSettings?.customTranslationsUrl?.trim() || options.legacyUrl?.trim()) !== url || (options.cacheVersion ?? globalThis.WpSuite?.siteSettings?.lastUpdate) !== cacheVersion) return null;
  return Object.fromEntries(Object.entries(result.catalogs).map(([language, values]) => [language, { ...values }]));
}
