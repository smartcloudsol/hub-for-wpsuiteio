/** Browser-wide locale state. No React, WordPress, or translation-provider dependency. */
export type LocaleRouteMode = "content" | "app" | "docs" | "docs-entry";
export interface SiteLocaleSnapshot {
  locale: string;
  direction: "ltr" | "rtl";
  source: string;
  routeMode: LocaleRouteMode;
  revision: number;
}
export interface SiteLocaleConfig {
  defaultLocale?: string;
  supportedLocales?: string[];
  pageLocale?: string;
  /** Live provider request language; omit for frozen exported app shells. */
  providerLocale?: string;
  routeMode?: LocaleRouteMode;
  /** Only configured preference keys are read. False disables persistence. */
  cookieName?: string | false;
  providerCookie?: { name: string; values: Record<string, string>; writable?: boolean };
  queryParameter?: string | false;
}
export interface SiteLocaleRuntime {
  getSnapshot(): SiteLocaleSnapshot;
  subscribe(listener: () => void): () => void;
  setLocale(locale: string, options?: { persist?: boolean }): void;
  configure(config: Partial<SiteLocaleConfig>): void;
}
declare global {
  var WpSuiteLocaleConfig: SiteLocaleConfig | undefined;
  var WpSuiteLocale: SiteLocaleRuntime | undefined;
}

const inherited = new Set(["", "system", "default", "inherit", "site", "auto"]);
export function normalizeLocale(value?: string | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const candidate = value.trim().replaceAll("_", "-");
  if (inherited.has(candidate.toLowerCase()) || candidate.toLowerCase() === "browser") return undefined;
  // Keep legacy vocabulary names compatible without emitting invalid language tags.
  const aliased = candidate.replace(/^ua(?=-|$)/i, "uk").replace(/^no(?=-|$)/i, "nb");
  try { return Intl.getCanonicalLocales(aliased)[0]; } catch { return undefined; }
}
export function getLocaleDirection(locale: string): "ltr" | "rtl" {
  const tag = normalizeLocale(locale) ?? "en";
  const script = new Intl.Locale(tag).maximize().script;
  return ["Arab", "Hebr", "Thaa", "Nkoo", "Adlm", "Syrc", "Rohg"].includes(script ?? "") ? "rtl" : "ltr";
}
export function matchLocale(value: string | null | undefined, supported?: readonly string[]): string | undefined {
  const locale = normalizeLocale(value);
  if (!locale) return undefined;
  if (!supported?.length) return locale;
  const choices = supported.map(normalizeLocale).filter((item): item is string => Boolean(item));
  return choices.find((item) => item === locale)
    ?? choices.find((item) => item.split("-")[0] === locale.split("-")[0]);
}
export interface LocaleInputs {
  pageLocale?: string;
  documentLocale?: string;
  preferredLocale?: string;
  providerLocale?: string;
  queryLocale?: string;
  selectedLocale?: string;
  browserLocales?: readonly string[];
}
export function resolveSiteLocale(config: SiteLocaleConfig, inputs: LocaleInputs): Omit<SiteLocaleSnapshot, "revision"> {
  const routeMode = config.routeMode ?? "content";
  const page = inputs.pageLocale ?? config.pageLocale;
  const content = routeMode === "content" || routeMode === "docs";
  const candidates: [string, string | undefined][] = content
    ? [["page", page], ["document", inputs.documentLocale], ["provider", inputs.providerLocale], ["preference", inputs.preferredLocale]]
    : [["query", inputs.queryLocale], ["selection", inputs.selectedLocale], ["provider", inputs.providerLocale ?? config.providerLocale], ["preference", inputs.preferredLocale], ["page", page]];
  // App shells deliberately do not treat their exported English html lang as content.
  for (const [source, candidate] of [...candidates, ...(inputs.browserLocales ?? []).map((item): [string, string] => ["browser", item]), ["default", config.defaultLocale ?? "en"] as [string, string]]) {
    const locale = matchLocale(candidate, config.supportedLocales);
    if (locale) return { locale, direction: getLocaleDirection(locale), source, routeMode };
  }
  const locale = normalizeLocale(config.supportedLocales?.[0]) ?? "en";
  return { locale, direction: getLocaleDirection(locale), source: "default", routeMode };
}

/** Fixed block > explicit application override > current frontend language. */
export function resolveComponentLocale(block: string | null | undefined, application: string | null | undefined, site: string): string {
  for (const value of [block, application]) {
    if (value?.toLowerCase() === "browser" && typeof navigator !== "undefined") {
      return normalizeLocale(navigator.language) ?? site;
    }
    const fixed = normalizeLocale(value);
    if (fixed) return fixed;
  }
  return normalizeLocale(site) ?? "en";
}

function readCookie(name?: string | false): string | undefined {
  if (!name || typeof document === "undefined") return undefined;
  try {
    const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${encodeURIComponent(name)}=`));
    return entry ? decodeURIComponent(entry.slice(entry.indexOf("=") + 1)) : undefined;
  } catch { return undefined; }
}
function writeCookie(name: string, value: string): void {
  if (typeof document === "undefined" || !/^[a-zA-Z0-9_.-]+$/.test(name)) return;
  try {
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax${globalThis.location?.protocol === "https:" ? "; Secure" : ""}`;
  } catch { /* In-memory switching remains available with blocked storage. */ }
}
export function createSiteLocaleRuntime(initial: SiteLocaleConfig = {}): SiteLocaleRuntime {
  let config = { ...initial };
  const listeners = new Set<() => void>();
  let chosen: string | undefined;
  const read = () => {
    const providerValue = readCookie(config.providerCookie?.name);
    const providerLocale = providerValue && config.providerCookie
      ? Object.entries(config.providerCookie.values).find(([, value]) => value === providerValue)?.[0] : undefined;
    const preferred = readCookie(config.cookieName);
    const providerStamp = JSON.stringify([config.providerLocale ?? "", providerValue ?? ""]);
    const persistedSelection = config.cookieName && readCookie(`${config.cookieName}_provider`) === providerStamp ? preferred : undefined;
    const queryName = config.queryParameter;
    let queryLocale: string | undefined;
    if (queryName && typeof location !== "undefined") queryLocale = new URLSearchParams(location.search).get(queryName) ?? undefined;
    return resolveSiteLocale(config, {
      documentLocale: typeof document === "undefined" ? undefined : document.documentElement.lang,
      preferredLocale: preferred, selectedLocale: chosen ?? persistedSelection, providerLocale: config.providerLocale ?? providerLocale, queryLocale,
      browserLocales: typeof navigator === "undefined" ? [] : navigator.languages?.length ? navigator.languages : [navigator.language],
    });
  };
  let snapshot: SiteLocaleSnapshot = { ...read(), revision: 0 };
  const notify = (next: Omit<SiteLocaleSnapshot, "revision">) => {
    if (next.locale === snapshot.locale && next.direction === snapshot.direction && next.source === snapshot.source && next.routeMode === snapshot.routeMode) return;
    snapshot = { ...next, revision: snapshot.revision + 1 };
    for (const listener of listeners) listener();
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("wpsuite:locale:change", { detail: snapshot }));
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    setLocale(value, options) {
      const locale = matchLocale(value, config.supportedLocales);
      if (!locale) return;
      chosen = locale;
      if (options?.persist !== false) {
        if (config.cookieName) writeCookie(config.cookieName, locale);
        const provider = config.providerCookie;
        const value = provider?.values[locale] ?? (provider && Object.entries(provider.values).find(([key]) => normalizeLocale(key) === locale)?.[1]);
        if (provider?.writable && value) writeCookie(provider.name, value);
        if (config.cookieName) writeCookie(`${config.cookieName}_provider`, JSON.stringify([config.providerLocale ?? "", readCookie(provider?.name) ?? ""]));
      }
      // Content navigation persists a choice but does not relabel the current document.
      if (snapshot.routeMode === "content" || snapshot.routeMode === "docs") return;
      if (config.queryParameter && typeof location !== "undefined" && typeof history !== "undefined") {
        const url = new URL(location.href);
        if (url.searchParams.has(config.queryParameter)) {
          url.searchParams.set(config.queryParameter, locale);
          history.replaceState(history.state, "", url.href);
        }
      }
      notify({ locale, direction: getLocaleDirection(locale), source: "selection", routeMode: snapshot.routeMode });
      if (typeof document !== "undefined") {
        document.documentElement.lang = snapshot.locale;
        document.documentElement.dir = snapshot.direction;
      }
    },
    configure(next) {
      config = { ...config, ...next };
      notify(read());
    },
  };
}
export function getSiteLocaleRuntime(): SiteLocaleRuntime {
  if (typeof window === "undefined") return createSiteLocaleRuntime(globalThis.WpSuiteLocaleConfig);
  return globalThis.WpSuiteLocale ??= createSiteLocaleRuntime(globalThis.WpSuiteLocaleConfig);
}

export type TranslationCatalogs = Record<string, Record<string, string>>;
export function createTranslator(
  locale: string,
  catalogs: TranslationCatalogs,
  custom?: TranslationCatalogs | null,
  fallback?: string,
  siteDefaultLocale = globalThis.WpSuite?.siteSettings.customTranslationsDefaultLocale,
) {
  const normalizeCatalogs = (input?: TranslationCatalogs | null) => {
    const result: TranslationCatalogs = {};
    if (!input || typeof input !== "object" || Array.isArray(input)) return result;
    for (const [key, values] of Object.entries(input)) {
      const normalized = normalizeLocale(key);
      if (!normalized || !values || typeof values !== "object" || Array.isArray(values)) continue;
      result[normalized] = Object.fromEntries(Object.entries(values).filter(([, value]) => typeof value === "string"));
    }
    return result;
  };
  const base = normalizeCatalogs(catalogs);
  const overrides = normalizeCatalogs(custom);
  const normalized = normalizeLocale(locale) ?? normalizeLocale(fallback) ?? normalizeLocale(siteDefaultLocale) ?? "en";
  const keys: string[] = [];
  const addLocale = (candidate?: string) => {
    const resolved = normalizeLocale(candidate);
    if (!resolved) return;
    if (!keys.includes(resolved)) keys.push(resolved);
    const baseLanguage = resolved.split("-")[0];
    if (!keys.includes(baseLanguage)) keys.push(baseLanguage);
  };
  addLocale(normalized);
  addLocale(fallback);
  addLocale(siteDefaultLocale);
  addLocale("en");
  return (key: string, defaultValue?: string): string => {
    for (const language of keys) {
      for (const dictionary of [overrides[language], base[language]]) {
        if (dictionary && Object.prototype.hasOwnProperty.call(dictionary, key)) return dictionary[key];
      }
    }
    return defaultValue ?? key;
  };
}
