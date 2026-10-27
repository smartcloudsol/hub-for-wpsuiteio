import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  assertBackendProfileConfiguration, assertBackendProfileCurrent, assertBackendProfileFresh, backendProfileHeaders, backendProfileStorageKey,
  createBackendProfileStorage, getBackendProfileContext, parseBackendProfile, resolveBackendProfileLegacyTargets,
  installBackendProfileGuards,
} from "../src/backend-profile.ts";
import { getSitePluginSettings, putSitePluginSettings } from "../src/site-configuration.ts";

const globals = globalThis as unknown as Record<PropertyKey, unknown>;
const profile = { enabled: true as const, id: "production" as const, generation: 3, bindingRevision: 2,
  legacyApiBaseUrl: "https://api.wpsuite.io", legacyConfigUrl: "https://wpsuite.io/static/config/prod.json", identity: { awsRegion: "us-east-1", userPoolId: "us-east-1_Fixture", identityPoolId: "us-east-1:00000000-0000-0000-0000-000000000001", appClientPlugin: "fixtureclient", baseUrl: "https://wpsuite.io" } };
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
const set = (value: unknown = profile) => { globals.WpSuite = { backendProfile: value, restUrl: "https://dev.wpsuite.io/wp-json/smartcloud-wpsuite/v1" }; };
const reset = () => { delete globals.WpSuite; delete globals[Symbol.for("wpsuite.backend-profile.runtime.v1")]; delete globals.location; };
afterEach(reset);

test("unconfigured and other sites retain original legacy targets and storage behavior", () => {
  assert.equal(getBackendProfileContext(), undefined);
  assert.deepEqual(resolveBackendProfileLegacyTargets("https://old.example", "https://old.example/dev.json"), { apiBaseUrl: "https://old.example", configUrl: "https://old.example/dev.json" });
  assert.equal(backendProfileStorageKey("legacy-token"), "legacy-token");
  assert.deepEqual(backendProfileHeaders(), {});
});

test("production profile overrides dev-host legacy defaults without changing explicit bindings", async () => {
  set();
  assert.deepEqual(resolveBackendProfileLegacyTargets("https://api-dev.wpsuite.io", "https://wpsuite.io/static/config/dev.json"), { apiBaseUrl: profile.legacyApiBaseUrl, configUrl: profile.legacyConfigUrl });
  const target = { legacyApiBaseUrl: "https://api-dev.wpsuite.io", workspaceId: "workspace", siteId: "site", siteKey: "synthetic", pluginKey: "flow" };
  let actual = "";
  await getSitePluginSettings(target, (async url => { actual = String(url); return response({ settings: {} }); }) as typeof fetch);
  assert.equal(actual, "https://api.wpsuite.io/account/workspace/site/site/settings");
  await assert.rejects(getSitePluginSettings({ ...target, connection: { workspaceApiMode: "legacy", platformApiBaseUrl: "https://foundation.example", platformConfigUrl: "https://foundation.example/dev.json" } }), /workspace/);
});

test("malformed profile metadata fails closed without a fallback request", () => {
  for (const value of [false, {}, { ...profile, identity: undefined }, { ...profile, identity: { ...profile.identity, userPoolId: "eu-central-1_Foreign" } }, { ...profile, generation: -1 }, { ...profile, bindingRevision: 0 }, { ...profile, id: "unknown" }, { ...profile, legacyApiBaseUrl: "https://user:password@api.example" }, { ...profile, legacyConfigUrl: "http://example/dev.json" }, { ...profile, legacyConfigUrl: "https://example/dev.json?token=hidden" }]) assert.throws(() => parseBackendProfile(value));
});

test("captured contexts reject in-page profile replacement and expose only public revision headers", () => {
  set();
  const captured = getBackendProfileContext();
  assert.deepEqual(backendProfileHeaders(), { "X-WPSuite-Backend-Profile": "production", "X-WPSuite-Backend-Generation": "3", "X-WPSuite-Backend-Binding-Revision": "2" });
  set({ ...profile, id: "development", generation: 4, identity: { ...profile.identity, baseUrl: "https://dev.wpsuite.io" } });
  assert.throws(() => assertBackendProfileCurrent(captured), /Reload/);
});

test("freshness check uses same-origin context only and rejects a server-side switch", async () => {
  set(); let called = 0;
  const fetcher = (async (url: RequestInfo | URL, init: RequestInit) => {
    called++; assert.equal(String(url), "https://dev.wpsuite.io/wp-json/smartcloud-wpsuite/v1/backend-profile-context");
    assert.equal(init.cache, "no-store"); assert.equal(init.credentials, "same-origin");
    return response({ enabled: true, active: called === 1 ? "production" : "development", generation: called === 1 ? 3 : 4, bindingRevision: 2 });
  }) as typeof fetch;
  await assertBackendProfileFresh(undefined, fetcher);
  await assert.rejects(assertBackendProfileFresh(undefined, fetcher), /Reload/);
  assert.throws(() => backendProfileHeaders(), /Reload/);
});

test("unavailable current-context service never grants permission to write", async () => {
  set();
  await assert.rejects(assertBackendProfileFresh(undefined, (async () => response({}, 503)) as typeof fetch), /could not be verified/);
});

test("published staging pages retain captured profiles and do not query the active CMS context", async () => {
  globals.location = { origin: "https://staging.wpsuite.io" }; set({ ...profile, id: "development", identity: { ...profile.identity, baseUrl: "https://dev.wpsuite.io" } });
  let called = false;
  await assertBackendProfileFresh(undefined, (async () => { called = true; throw new Error("Must not query CMS"); }) as typeof fetch);
  assert.equal(called, false);
});

function storage(): Storage {
  const data = new Map<string, string>();
  return { get length() { return data.size; }, key: i => [...data.keys()][i] ?? null,
    getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); }, removeItem: key => { data.delete(key); }, clear: () => { data.clear(); } };
}

test("auth storage separates profiles/bindings, preserves sessions on switchback, and clears only its own prefix", async () => {
  set(); const backing = storage(); backing.setItem("unrelated", "keep"); backing.setItem("wpsuite-profile:development:2:token", "other");
  const selected = createBackendProfileStorage(backing)!;
  await selected.setItem("token", "synthetic-token");
  assert.equal(await selected.getItem("token"), "synthetic-token");
  assert.equal(backing.getItem("token"), null);
  const key = backendProfileStorageKey("token");
  reset(); set({ ...profile, generation: 8 });
  assert.equal(backendProfileStorageKey("token"), key);
  const returned = createBackendProfileStorage(backing)!;
  assert.equal(await returned.getItem("token"), "synthetic-token");
  await returned.clear();
  assert.equal(backing.getItem("unrelated"), "keep");
  assert.equal(backing.getItem("wpsuite-profile:development:2:token"), "other");
  assert.equal(await returned.getItem("token"), null);
});

test("direct configuration PUT is blocked before transport when the active profile changed", async () => {
  set(); const original = globalThis.fetch;
  globalThis.fetch = (async () => response({ enabled: true, active: "development", generation: 4, bindingRevision: 2 })) as typeof fetch;
  let writes = 0;
  try {
    await assert.rejects(putSitePluginSettings({ legacyApiBaseUrl: "https://api-dev.wpsuite.io", workspaceId: "workspace", siteId: "site", siteKey: "synthetic", pluginKey: "flow" }, {}, (async () => { writes++; return response({ settings: {} }); }) as typeof fetch), /Reload/);
    assert.equal(writes, 0);
  } finally { globalThis.fetch = original; }
});

test("browser guard pins REST mutations, leaves CORS headers unchanged, and blocks stale tabs without reloading", async () => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const events = new Map<string, (event: unknown) => void>();
  globals.location = { origin: "https://dev.wpsuite.io", href: "https://dev.wpsuite.io/wp-admin/post.php" };
  globals.localStorage = storage();
  globals.document = { visibilityState: "visible", getElementById: () => ({}), addEventListener() {} };
  globals.window = { addEventListener: (name: string, callback: (event: unknown) => void) => { events.set(name, callback); }, setInterval() {} };
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return response(String(url).endsWith("backend-profile-context") ? { enabled: true, active: "production", generation: 3, bindingRevision: 2 } : {});
  }) as typeof fetch;
  set();
  try {
    installBackendProfileGuards();
    await fetch("https://dev.wpsuite.io/wp-json/wp/v2/posts/10", { method: "POST", headers: { "X-WP-Nonce": "synthetic-nonce" }, body: "{}" });
    const headers = new Headers(calls[1].init?.headers);
    assert.equal(headers.get("X-WPSuite-Backend-Profile"), "production");
    assert.equal(headers.get("X-WPSuite-Backend-Generation"), "3");
    assert.equal(headers.get("X-WP-Nonce"), "synthetic-nonce");
    await fetch("https://api.wpsuite.io/account/workspace/site/site/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: "{}" });
    assert.equal(new Headers(calls[3].init?.headers).has("X-WPSuite-Backend-Profile"), false);
    events.get("storage")?.({ key: "wpsuite:backend-profile:active:v1", newValue: JSON.stringify({ id: "development", generation: 4, bindingRevision: 1 }) });
    const count = calls.length;
    await assert.rejects(fetch("https://api.wpsuite.io/account/workspace/site/site/settings", { method: "PUT" }), /Reload/);
    assert.equal(calls.length, count);
  } finally {
    globalThis.fetch = original;
    delete globals.window; delete globals.document; delete globals.localStorage;
  }
});


test("public configuration remains compatible without an enabled profile", () => {
  assert.doesNotThrow(() => assertBackendProfileConfiguration({ userPoolId: "historical" }));
});

test("captured public identity is copied, frozen and accepts unchanged bootstrap with PHP defaults", () => {
  const source = { ...profile, identity: { ...profile.identity } }; set(source);
  const captured = getBackendProfileContext()!;
  assert.ok(Object.isFrozen(captured.identity));
  source.identity.userPoolId = "us-east-1_Changed";
  assert.equal(captured.identity.userPoolId, "us-east-1_Fixture");
  reset(); set();
  assert.doesNotThrow(() => assertBackendProfileConfiguration({ ...profile.identity, workspaceApiMode: "legacy", foundationApiBaseUrl: "", unrelated: "ignored" }));
});

for (const field of ["awsRegion", "userPoolId", "identityPoolId", "appClientPlugin", "appClient", "baseUrl", "workspaceApiMode", "foundationApiBaseUrl"]) {
  test(`same-URL bootstrap change of ${field} fails closed before identity can be used`, () => {
    set();
    assert.throws(() => assertBackendProfileConfiguration({ ...profile.identity, [field]: "changed" }), /identity changed/);
    assert.throws(() => assertBackendProfileCurrent(), /Reload/);
  });
}

test("published static context rejects changed public identity without querying the CMS", () => {
  globals.location = { origin: "https://staging.wpsuite.io" };
  set({ ...profile, id: "development", identity: { ...profile.identity, baseUrl: "https://dev.wpsuite.io" } });
  assert.throws(() => assertBackendProfileConfiguration(profile.identity), /identity changed/);
});

test("replacing in-page identity without changing revision cannot retarget captured context", () => {
  set(); getBackendProfileContext();
  set({ ...profile, identity: { ...profile.identity, userPoolId: "us-east-1_Changed" } });
  assert.throws(() => assertBackendProfileCurrent(), /Reload/);
});
