import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import test from "node:test";
import ts from "typescript";
import type { SiteLocaleConfig, SiteLocaleRuntime } from "../src/locale.ts";

const compile = (filename: string) => ts.transpileModule(readFileSync(new URL(filename, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const compiledRuntime = compile("../src/locale.ts");
const compiledEntry = compile("../src/locale-browser.ts");

class LocaleElement {
  dataset: { wpsuiteLocale?: string; wpsuiteLocaleUrl?: string };
  attributes = new Map<string, string>();
  constructor(locale: string, url?: string) {
    this.dataset = { wpsuiteLocale: locale, wpsuiteLocaleUrl: url };
    if (url) this.attributes.set("href", url);
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  closest() { return this; }
}

function browser({ cookies = "", url = "https://example.test/dashboard/", blockedCookies = false } = {}) {
  const jar = new Map(cookies.split(";").map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    const separator = entry.indexOf("=");
    return [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
  const writes: string[] = [], events: unknown[] = [];
  const historyCalls: { state: unknown; href: string }[] = [];
  const assignedUrls: string[] = [];
  const location = new URL(url) as URL & { assign(value: string): void };
  location.assign = (value) => assignedUrls.push(value);
  const elements = [new LocaleElement("en-US"), new LocaleElement("hu-HU"), new LocaleElement("de-DE")];
  const document = Object.assign(new EventTarget(), {
    documentElement: { lang: "en-US", dir: "ltr" }, readyState: "loading", querySelectorAll: () => elements,
  });
  Object.defineProperty(document, "cookie", {
    get() {
      if (blockedCookies) throw new Error("Cookie access disabled");
      return [...jar].map(([name, value]) => `${name}=${value}`).join("; ");
    },
    set(value: string) {
      if (blockedCookies) throw new Error("Cookie access disabled");
      writes.push(value);
      const pair = value.split(";")[0], separator = pair.indexOf("=");
      jar.set(pair.slice(0, separator), pair.slice(separator + 1));
    },
  });
  const target = new EventTarget();
  target.addEventListener("wpsuite:locale:change", (event) => events.push((event as CustomEvent).detail));
  const state = { route: "customer/123", modal: "open" };
  const module = { exports: {} };
  const context = createContext({
    URL, URLSearchParams, Intl, Event, CustomEvent, EventTarget, Element: LocaleElement,
    AbortController, fetch, setTimeout, clearTimeout,
    document, location, navigator: { language: "en-US", languages: ["en-US"] },
    history: { state, replaceState(next: unknown, _title: string, href: string) {
      historyCalls.push({ state: next, href }); location.href = new URL(href, location.href).href;
    } },
    addEventListener: target.addEventListener.bind(target), dispatchEvent: target.dispatchEvent.bind(target),
    exports: module.exports, module,
  });
  runInContext("globalThis.window = globalThis;", context);
  runInContext(compiledRuntime, context, { filename: "locale.js" });
  const api = module.exports as {
    createSiteLocaleRuntime(config?: SiteLocaleConfig): SiteLocaleRuntime;
    getSiteLocaleRuntime(): SiteLocaleRuntime;
  };
  context.require = (specifier: string) => { assert.equal(specifier, "./locale"); return api; };
  return {
    ...api, document, location, jar, writes, events, historyCalls, assignedUrls, elements, state,
    bootstrap(config: SiteLocaleConfig) {
      context.WpSuiteLocaleConfig = config;
      runInContext(compiledEntry, context, { filename: "locale-browser.js" });
      return context.WpSuiteLocale as SiteLocaleRuntime;
    },
    popstate() { target.dispatchEvent(new Event("popstate")); },
  };
}

const supportedLocales = ["en-US", "hu-HU", "de-DE"];
const providerCookie = { name: "custom_pll_language", values: { "en-US": "english", "hu-HU": "magyar", "de-DE": "deutsch" }, writable: true };

test("active provider cookie wins over stale suite preference without rewriting either", () => {
  const env = browser({ cookies: "wpsuite_locale=de-DE; custom_pll_language=magyar" });
  const runtime = env.createSiteLocaleRuntime({ routeMode: "app", supportedLocales, cookieName: "wpsuite_locale", providerCookie });
  assert.equal(runtime.getSnapshot().locale, "hu-HU");
  assert.equal(runtime.getSnapshot().source, "provider");
  assert.equal(env.writes.length, 0);
});

test("cookie-less live provider works despite stale preference and English carrier", () => {
  const env = browser({ cookies: "wpsuite_locale=de-DE" });
  const runtime = env.createSiteLocaleRuntime({ routeMode: "app", supportedLocales, providerLocale: "hu-HU", cookieName: "wpsuite_locale" });
  assert.equal(runtime.getSnapshot().locale, "hu-HU");
  assert.equal(env.document.documentElement.lang, "en-US", "Core factory does not mutate carrier DOM");
});

test("custom cookie names and regional provider mappings persist only declared keys", () => {
  const env = browser({ cookies: "pll_language=de; language=de; random_locale=de" });
  const runtime = env.createSiteLocaleRuntime({ routeMode: "app", supportedLocales, cookieName: "site_preference", providerCookie });
  assert.equal(runtime.getSnapshot().locale, "en-US");
  runtime.setLocale("hu");
  assert.equal(env.jar.get("site_preference"), "hu-HU");
  assert.equal(env.jar.get("custom_pll_language"), "magyar");
  assert.equal(env.jar.get("pll_language"), "de", "Default provider cookie is not guessed");
  assert.equal(env.document.documentElement.lang, "hu-HU");
  assert.ok(env.writes.every((value) => value.includes("SameSite=Lax") && value.includes("; Secure")));
});

test("disabled preference cookie and read-only provider preserve only in-memory selection", () => {
  const env = browser({ cookies: "wpsuite_locale=de-DE; custom_pll_language=magyar" });
  const runtime = env.createSiteLocaleRuntime({ routeMode: "app", supportedLocales, cookieName: false, providerCookie: { ...providerCookie, writable: false } });
  runtime.setLocale("de-DE"); runtime.configure({});
  assert.equal(runtime.getSnapshot().locale, "de-DE");
  assert.deepEqual(env.writes, []);
});

test("persist:false suppresses both suite and writable provider writes", () => {
  const env = browser({ cookies: "wpsuite_locale=de-DE; custom_pll_language=deutsch" });
  const runtime = env.createSiteLocaleRuntime({ routeMode: "app", supportedLocales, cookieName: "wpsuite_locale", providerCookie });
  runtime.setLocale("hu-HU", { persist: false }); runtime.configure({});
  assert.equal(runtime.getSnapshot().locale, "hu-HU");
  assert.deepEqual(env.writes, []);
  assert.equal(env.jar.get("custom_pll_language"), "deutsch");
});

test("blocked cookies preserve reactive selection, RTL direction and unsubscribe", () => {
  const env = browser({ blockedCookies: true });
  const runtime = env.createSiteLocaleRuntime({ routeMode: "app", supportedLocales: ["en", "ar-SA"], cookieName: "wpsuite_locale", providerCookie });
  let notifications = 0;
  const unsubscribe = runtime.subscribe(() => notifications++);
  assert.doesNotThrow(() => runtime.setLocale("ar-SA"));
  assert.equal(runtime.getSnapshot().locale, "ar-SA");
  assert.equal(env.document.documentElement.dir, "rtl");
  assert.equal(notifications, 1);
  unsubscribe(); runtime.setLocale("en");
  assert.equal(notifications, 1);
});

test("selection reconciles existing query while preserving route, state, other query and fragment", () => {
  const env = browser({ url: "https://example.test/dashboard/customer/123?language=de-DE&tab=billing#invoices" });
  const runtime = env.bootstrap({ routeMode: "app", supportedLocales, queryParameter: "language", cookieName: false });
  assert.equal(runtime.getSnapshot().locale, "de-DE");
  runtime.setLocale("hu-HU", { persist: false });
  assert.equal(env.location.searchParams.get("language"), "hu-HU");
  assert.equal(env.location.searchParams.get("tab"), "billing");
  assert.equal(env.location.pathname, "/dashboard/customer/123");
  assert.equal(env.location.hash, "#invoices");
  assert.equal(env.historyCalls.length, 1);
  assert.strictEqual(env.historyCalls[0].state, env.state);
  runtime.configure({}); env.popstate();
  assert.equal(runtime.getSnapshot().locale, "hu-HU");
  assert.equal(env.assignedUrls.length, 0);
});

test("app selection does not introduce an unsolicited locale query parameter", () => {
  const env = browser({ url: "https://example.test/dashboard/?tab=billing" });
  env.createSiteLocaleRuntime({ routeMode: "app", supportedLocales, queryParameter: "language" }).setLocale("hu-HU");
  assert.equal(env.location.searchParams.has("language"), false);
  assert.equal(env.historyCalls.length, 0);
});

test("late browser entry repairs early singleton and notifies mounted consumers", () => {
  const env = browser();
  const early = env.getSiteLocaleRuntime();
  assert.equal(early.getSnapshot().routeMode, "content");
  const runtime = env.bootstrap({ routeMode: "app", supportedLocales, providerLocale: "hu-HU" });
  assert.strictEqual(runtime, early);
  assert.equal(runtime.getSnapshot().routeMode, "app");
  assert.equal(runtime.getSnapshot().locale, "hu-HU");
  assert.equal(env.document.documentElement.lang, "hu-HU");
  assert.ok(env.events.length > 0);
  assert.equal(env.elements[1].getAttribute("aria-current"), "true");
  assert.equal(env.elements[0].getAttribute("aria-current"), null);
});

test("fresh browser entry announces readiness without needing a locale change", () => {
  const env = browser();
  env.bootstrap({ routeMode: "app", supportedLocales, providerLocale: "hu-HU" });
  assert.ok(env.events.length > 0);
  assert.equal((env.events.at(-1) as { locale: string }).locale, "hu-HU");
});

test("docs URL stays authoritative while another language is persisted for navigation", () => {
  const env = browser({ cookies: "wpsuite_locale=hu-HU; custom_pll_language=magyar", url: "https://example.test/docs/setup/?language=hu-HU" });
  const runtime = env.bootstrap({ routeMode: "docs", pageLocale: "en-US", supportedLocales, cookieName: "wpsuite_locale", providerCookie, queryParameter: "language" });
  assert.equal(runtime.getSnapshot().locale, "en-US");
  const before = env.events.length;
  runtime.setLocale("de-DE");
  assert.equal(env.jar.get("custom_pll_language"), "deutsch");
  assert.equal(runtime.getSnapshot().locale, "en-US");
  assert.equal(env.document.documentElement.lang, "en-US");
  assert.equal(env.events.length, before);
  assert.equal(env.historyCalls.length, 0);
});

test("trusted live request language precedes a stale native provider cookie", () => {
  const env = browser({ cookies: "wpsuite_locale=de-DE; custom_pll_language=deutsch" });
  const runtime = env.createSiteLocaleRuntime({ routeMode: "app", supportedLocales, providerLocale: "hu-HU", cookieName: "wpsuite_locale", providerCookie });
  assert.equal(runtime.getSnapshot().locale, "hu-HU");
});

test("explicit cookie-less provider choice survives reload until the live provider changes", () => {
  const env = browser();
  const config: SiteLocaleConfig = { routeMode: "app", supportedLocales, providerLocale: "en-US", cookieName: "wpsuite_locale" };
  const runtime = env.createSiteLocaleRuntime(config);
  runtime.setLocale("hu-HU");
  assert.equal(env.jar.get("wpsuite_locale"), "hu-HU");
  assert.equal(decodeURIComponent(env.jar.get("wpsuite_locale_provider") ?? ""), JSON.stringify(["en-US", ""]));
  assert.equal(env.createSiteLocaleRuntime(config).getSnapshot().locale, "hu-HU", "Reload preserves the explicit app choice over the unchanged provider default");
  assert.equal(env.createSiteLocaleRuntime({ ...config, providerLocale: "de-DE" }).getSnapshot().locale, "de-DE", "A changed native provider signal invalidates the previous app choice");
});

test("provider fingerprint records native cookie state and detects a native change on reload", () => {
  const env = browser({ cookies: "custom_pll_language=english" });
  const config: SiteLocaleConfig = { routeMode: "app", supportedLocales, cookieName: "wpsuite_locale", providerCookie: { ...providerCookie, writable: false } };
  env.createSiteLocaleRuntime(config).setLocale("hu-HU");
  assert.equal(decodeURIComponent(env.jar.get("wpsuite_locale_provider") ?? ""), JSON.stringify(["", "english"]));
  assert.equal(env.jar.get("custom_pll_language"), "english");
  assert.equal(env.createSiteLocaleRuntime(config).getSnapshot().locale, "hu-HU");
  env.jar.set("custom_pll_language", "deutsch");
  assert.equal(env.createSiteLocaleRuntime(config).getSnapshot().locale, "de-DE");
});

test("writable provider fingerprint captures the cookie after the explicit native update", () => {
  const env = browser({ cookies: "custom_pll_language=english" });
  const config: SiteLocaleConfig = { routeMode: "app", supportedLocales, providerLocale: "en-US", cookieName: "wpsuite_locale", providerCookie };
  env.createSiteLocaleRuntime(config).setLocale("hu-HU");
  assert.equal(env.jar.get("custom_pll_language"), "magyar");
  assert.equal(decodeURIComponent(env.jar.get("wpsuite_locale_provider") ?? ""), JSON.stringify(["en-US", "magyar"]));
  assert.equal(env.createSiteLocaleRuntime(config).getSnapshot().locale, "hu-HU");
});

test("persistence opt-out writes neither explicit-choice marker nor native provider state", () => {
  const env = browser({ cookies: "custom_pll_language=english" });
  const config: SiteLocaleConfig = { routeMode: "app", supportedLocales, providerLocale: "en-US", cookieName: "wpsuite_locale", providerCookie };
  env.createSiteLocaleRuntime(config).setLocale("hu-HU", { persist: false });
  assert.equal(env.jar.has("wpsuite_locale_provider"), false);
  assert.equal(env.jar.has("wpsuite_locale"), false);
  assert.equal(env.jar.get("custom_pll_language"), "english");
  assert.deepEqual(env.writes, []);
});

test("matching app preference marker cannot override an explicit content or docs URL", () => {
  const env = browser();
  const config: SiteLocaleConfig = { routeMode: "app", supportedLocales, providerLocale: "en-US", cookieName: "wpsuite_locale" };
  env.createSiteLocaleRuntime(config).setLocale("hu-HU");
  for (const routeMode of ["content", "docs"] as const) {
    const runtime = env.createSiteLocaleRuntime({ ...config, routeMode, pageLocale: "en-US" });
    assert.equal(runtime.getSnapshot().locale, "en-US");
  }
});
