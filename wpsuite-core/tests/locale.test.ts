import assert from "node:assert/strict";
import test from "node:test";
import { createTranslator, createSiteLocaleRuntime, resolveSiteLocale, resolveComponentLocale, normalizeLocale, getLocaleDirection } from "../src/locale.ts";

test("content locale precedes preference/browser; unprefixed English is explicit", () => {
  assert.equal(resolveSiteLocale({ routeMode: "content", pageLocale: "hu_HU" }, { preferredLocale: "de", browserLocales: ["en"] }).locale, "hu-HU");
  assert.equal(resolveSiteLocale({ routeMode: "docs", pageLocale: "en" }, { preferredLocale: "hu" }).locale, "en");
  assert.equal(resolveSiteLocale({}, { documentLocale: "hu", browserLocales: ["en"] }).locale, "hu");
});
test("neutral app uses preference and supported browser fallback, not exported html", () => {
  const config = { routeMode: "app" as const, supportedLocales: ["en-US", "hu-HU", "de-DE"] };
  assert.equal(resolveSiteLocale(config, { documentLocale: "en", preferredLocale: "hu" }).locale, "hu-HU");
  assert.equal(resolveSiteLocale(config, { documentLocale: "en", browserLocales: ["xx", "de-AT"] }).locale, "de-DE");
});
test("sentinels inherit; explicit block survives store changes; regional RTL and aliases normalize", () => {
  assert.equal(resolveComponentLocale("system", "default", "hu-HU"), "hu-HU");
  assert.equal(resolveComponentLocale("de", "es", "hu"), "de");
  assert.equal(normalizeLocale("ua_UA"), "uk-UA");
  assert.equal(normalizeLocale("bad/locale"), undefined);
  assert.equal(getLocaleDirection("ar_SA"), "rtl");
  assert.equal(getLocaleDirection("az-Latn"), "ltr");
});
test("runtime snapshots are stable, subscriptions clean up, and content choice does not relabel current URL", () => {
  const runtime = createSiteLocaleRuntime({ routeMode: "app", defaultLocale: "en" });
  assert.strictEqual(runtime.getSnapshot(), runtime.getSnapshot());
  let calls = 0;
  const off = runtime.subscribe(() => calls++);
  runtime.setLocale("hu");
  assert.equal(runtime.getSnapshot().locale, "hu");
  assert.equal(calls, 1);
  runtime.setLocale("hu");
  assert.equal(calls, 1);
  off();
  runtime.setLocale("de");
  assert.equal(calls, 1);
  runtime.configure({ routeMode: "docs", pageLocale: "en" });
  runtime.setLocale("hu");
  assert.equal(runtime.getSnapshot().locale, "en");
});
test("translators isolate locale and custom dictionaries across instances, removal and fallback", () => {
  const base = { en: { Send: "Send", OnlyEnglish: "Fallback" }, hu: { Send: "Küldés" }, de: { Send: "Senden" }, ua: { Send: "Надіслати" } };
  const hu = createTranslator("hu-HU", base, { hu: { Send: "Indítás", Custom: "Saját", Empty: "" } });
  const de = createTranslator("de", base);
  assert.equal(hu("Send"), "Indítás");
  assert.equal(de("Send"), "Senden");
  assert.equal(hu("Custom"), "Saját");
  assert.equal(hu("OnlyEnglish"), "Fallback");
  assert.equal(hu("Empty"), "");
  assert.equal(createTranslator("hu", base)("Send"), "Küldés");
  assert.equal(createTranslator("uk-UA", base)("Send"), "Надіслати");
  assert.equal(hu("My authored sentence"), "My authored sentence");
});

test("active provider beats stale preference on neutral routes, including cookie-less providers", () => {
  assert.equal(resolveSiteLocale({ routeMode: "app" }, { providerLocale: "hu", preferredLocale: "de", browserLocales: ["en"] }).locale, "hu");
  assert.equal(resolveSiteLocale({ routeMode: "app", providerLocale: "hu-HU" }, { browserLocales: ["en"] }).locale, "hu-HU");
  const early = createSiteLocaleRuntime();
  early.configure({ routeMode: "app", providerLocale: "hu-HU" });
  assert.equal(early.getSnapshot().locale, "hu-HU");
  early.setLocale("de");
  assert.equal(early.getSnapshot().locale, "de");
});
