import { normalizeLocale, type TranslationCatalogs } from "./locale.ts";

export type TranslationLoadFailure = "timeout" | "http" | "invalid" | "network";
export interface TranslationLoadOptions {
  cacheVersion?: string | number;
  timeoutMs?: number;
  onError?: (reason: TranslationLoadFailure) => void;
}

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
