import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { buildSiteReconnectTarget, captureFoundationReconnectConnection, createSiteSelectorApi, getFoundationReconnectConnection, resolvePlatformConnection } from "./platform-connection.ts";
import { connectionIdentity, reusableLocalSiteKey } from "./license-handler/site-connection.ts";
import { fetchRecoverableSiteKey, fetchSiteInfoWithSiteKey } from "./license-handler/site-info.ts";
const api = "https://api.wpsuite.io", configUrl = "https://wpsuite.io/static/config/foundation/prod/config.json";
const catalog = { workspaceApiMode: "workspace", foundationApiBaseUrl: api, baseUrl: "https://wpsuite.io", awsRegion: "us-east-1", userPoolId: "us-east-1_Fixture", identityPoolId: "us-east-1:00000000-0000-0000-0000-000000000001", appClientPlugin: "fixtureclient" };
const previous = () => ({ workspaceId: "old-workspace", accountId: "old-workspace", siteId: "old-site", siteKey: "synthetic-old-key", workspaceApiMode: "legacy", platformApiBaseUrl: "", platformConfigUrl: "", useRecaptchaNet: true });
function offer(current = previous()) { captureFoundationReconnectConnection(current, resolvePlatformConnection(current, api, configUrl), catalog); return current; }
const globals = globalThis as unknown as Record<PropertyKey, unknown>;
afterEach(() => { delete globals.WpSuite; delete globals[Symbol.for("wpsuite.backend-profile.runtime.v1")]; });
type SelectorApi = Parameters<typeof createSiteSelectorApi>[0];
type Call = { method: string; path: string; apiName: string };
function transport(reply: unknown, calls: Call[], failure?: Error): SelectorApi {
  return Object.fromEntries(["get", "post", "put", "del"].map(method => [method, (input: { path: string; apiName: string }) => {
    calls.push({ method, path: input.path, apiName: input.apiName });
    return { cancel() {}, response: failure ? Promise.reject(failure) : Promise.resolve({ statusCode: 200, headers: {}, body: { json: async () => reply } }) };
  }])) as unknown as SelectorApi;
}
test("verified Foundation reconnect leaves old runtime/AAD intact and removes inherited key from new target", () => {
  const current = previous(), original = { ...current }; assert.equal(getFoundationReconnectConnection(current), undefined); offer(current);
  assert.deepEqual(current, original); assert.deepEqual(getFoundationReconnectConnection(current), { apiBaseUrl: api, configUrl, explicit: true }); assert.ok(Object.isFrozen(getFoundationReconnectConnection(current)));
  for (const [workspace, site] of [["new-workspace", "new-site"], [current.workspaceId, current.siteId]]) {
    const target = buildSiteReconnectTarget(current, workspace, site);
    assert.equal(target.workspaceApiMode, "workspace"); assert.equal(target.platformApiBaseUrl, api); assert.equal(target.platformConfigUrl, configUrl); assert.equal(target.siteKey, undefined); assert.equal(target.useRecaptchaNet, true);
    assert.notEqual(connectionIdentity(current), connectionIdentity(target)); assert.equal(reusableLocalSiteKey(current, target), undefined);
  }
  assert.deepEqual(current, original);
});
test("DEV reconnect requires exact api-dev endpoint and never retargets the old /dev base", () => {
  const current = previous(), devApi = "https://api-dev.wpsuite.io", devConfig = "https://wpsuite.io/static/config/foundation/dev/config.json";
  const config = { ...catalog, foundationApiBaseUrl: devApi, baseUrl: "https://dev.wpsuite.io" };
  captureFoundationReconnectConnection(current, { apiBaseUrl: devApi, configUrl: devConfig, explicit: false }, config); assert.equal(getFoundationReconnectConnection(current)?.apiBaseUrl, devApi);
  const old = previous(); captureFoundationReconnectConnection(old, { apiBaseUrl: "https://api.wpsuite.io/dev", configUrl: devConfig, explicit: false }, config); assert.equal(getFoundationReconnectConnection(old), undefined);
});
for (const changed of [{ workspaceApiMode: "legacy" }, { foundationApiBaseUrl: "https://foreign.example" }, { baseUrl: "https://foreign.example" }, { userPoolId: "eu-central-1_Foreign" }, { identityPoolId: "invalid" }, { appClientPlugin: "bad client" }, { awsRegion: "invalid" }]) test(`foreign/malformed Foundation bootstrap fails closed: ${Object.keys(changed)[0]}`, () => {
  const current = previous(), original = { ...current }; assert.throws(() => captureFoundationReconnectConnection(current, { apiBaseUrl: api, configUrl, explicit: false }, { ...catalog, ...changed })); assert.equal(getFoundationReconnectConnection(current), undefined); assert.deepEqual(current, original);
});
test("custom and explicit endpoints receive no automatic reconnect offer", () => {
  for (const [settings, connection] of [[previous(), { apiBaseUrl: "https://custom.example", configUrl, explicit: false }], [previous(), { apiBaseUrl: api, configUrl: "https://custom.example/config.json", explicit: false }], [{ ...previous(), platformApiBaseUrl: api, platformConfigUrl: configUrl, workspaceApiMode: "workspace" }, { apiBaseUrl: api, configUrl, explicit: true }]] as const) { captureFoundationReconnectConnection(settings, connection, catalog); assert.equal(getFoundationReconnectConnection(settings), undefined); }
});
test("backend profiles retain their selected binding and bypass standalone reconnect adoption", () => {
  const current = previous(); globals.WpSuite = { backendProfile: { enabled: true, id: "production", generation: 1, bindingRevision: 1, legacyApiBaseUrl: api, legacyConfigUrl: configUrl, identity: catalog } };
  captureFoundationReconnectConnection(current, { apiBaseUrl: api, configUrl, explicit: false }, catalog); assert.equal(getFoundationReconnectConnection(current), undefined); assert.equal(buildSiteReconnectTarget(current, "new-workspace", "new-site").workspaceApiMode, "legacy");
});
test("proof cannot be copied with settings or survive an in-page binding/key replacement", () => {
  for (const changed of [{ workspaceId: "foreign" }, { siteId: "foreign" }, { siteKey: "synthetic-rotated" }, { workspaceApiMode: "workspace" }, { platformApiBaseUrl: "https://custom.example" }, { platformConfigUrl: "https://custom.example/config.json" }]) { const current = offer(); assert.equal(getFoundationReconnectConnection({ ...current }), undefined); Object.assign(current, changed); assert.throws(() => getFoundationReconnectConnection(current), /connection changed/); }
});
test("only reconnect selector uses canonical workspace envelope while ordinary callers retain legacy", async () => {
  const current = offer(), old: Call[] = [], calls: Call[] = [], legacy = transport([], old);
  const selector = createSiteSelectorApi(legacy, transport({ workspaces: [{ workspaceId: "selected" }] }, calls), current, () => api);
  const payload = await (await selector.get({ apiName: "backendWithIam", path: "/account" }).response).body.json() as unknown as Array<{ accountId: string }>;
  assert.equal(payload[0].accountId, "selected"); assert.deepEqual(calls, [{ method: "get", path: "/workspace", apiName: "backendWithIam" }]); assert.equal(old.length, 0);
  assert.equal(resolvePlatformConnection(current, api, configUrl).explicit, false); assert.equal(current.workspaceApiMode, "legacy"); await legacy.get({ apiName: "backend", path: "/account/old-workspace/site/old-site" }).response; assert.equal(old[0].path, "/account/old-workspace/site/old-site");
});
test("canonical create preserves one-time key envelope and canonical delete transport", async () => {
  const current = offer(), calls: Call[] = [], old: Call[] = [], selector = createSiteSelectorApi(transport({}, old), transport({ site: { workspaceId: "selected", siteId: "created" }, siteKey: "synthetic-created" }, calls), current, () => api);
  const created = await (await selector.post({ apiName: "backend", path: "/account/selected/site" }).response).body.json() as unknown as { accountId: string; siteId: string; siteKey: string };
  assert.equal(created.accountId, "selected"); assert.equal(created.siteId, "created"); assert.equal(created.siteKey, "synthetic-created"); await selector.del({ apiName: "backend", path: "/account/selected/site/created" }).response; assert.deepEqual(calls.map(x => x.path), ["/workspace/selected/site", "/workspace/selected/site/created"]); assert.equal(old.length, 0);
});
test("denied canonical request and foreign SDK endpoint never fall back to legacy", async () => {
  const current = offer(), calls: Call[] = [], old: Call[] = [], failure = Object.assign(new Error("synthetic denied"), { statusCode: 403 });
  const canonical = transport({}, calls, failure), legacy = transport({}, old), selector = createSiteSelectorApi(legacy, canonical, current, () => api);
  await assert.rejects(selector.get({ apiName: "backend", path: "/account/selected/site" }).response, error => error === failure); assert.equal(old.length, 0); assert.equal(calls.length, 1);
  const wrong = createSiteSelectorApi(legacy, canonical, current, () => "https://foreign.example"); assert.throws(() => wrong.get({ apiName: "backend", path: "/account/selected/site" }), /authenticated backend/); assert.equal(calls.length, 1); assert.equal(old.length, 0);
});
test("explicit reconnect recovers and verifies key with canonical site routes before normal save", async () => {
  const current = offer(), target = buildSiteReconnectTarget(current, "selected-workspace", "selected-site"), paths: string[] = [];
  const key = await fetchRecoverableSiteKey(target, api, api, async path => { paths.push(path); return { workspaceId: "selected-workspace", siteId: "selected-site", siteKeyId: "fixture-key-id", siteKey: "synthetic-recovered" }; });
  const site = await fetchSiteInfoWithSiteKey(target, api, key, (async (url, init) => { paths.push(String(url)); assert.equal(new Headers(init?.headers).get("X-Site-Key"), "synthetic-recovered"); return new Response(JSON.stringify({ site: { workspaceId: "selected-workspace", siteId: "selected-site" }, configurations: [] })); }) as typeof fetch);
  assert.equal(site.siteId, "selected-site"); assert.deepEqual(paths, ["/workspace/selected-workspace/site/selected-site/site-key", api + "/workspace/selected-workspace/site/selected-site/settings"]); assert.equal(target.siteKey, undefined); assert.equal(current.workspaceApiMode, "legacy");
});

test("a selector created from verified authority cannot revert to legacy when that proof is revoked", () => {
  const current = offer(), calls: Call[] = [], old: Call[] = [];
  const selector = createSiteSelectorApi(transport({}, old), transport({}, calls), current, () => api);
  assert.throws(() => captureFoundationReconnectConnection(current, { apiBaseUrl: api, configUrl, explicit: false }, { ...catalog, userPoolId: "invalid" }));
  assert.throws(() => selector.get({ apiName: "backend", path: "/account/selected/site" }), /no longer verified/);
  assert.equal(old.length, 0); assert.equal(calls.length, 0);
});
test("selectors without verified Foundation adoption preserve their existing transport", async () => {
  const current = previous(), calls: Call[] = [], old: Call[] = [];
  const selector = createSiteSelectorApi(transport([], old), transport({}, calls), current, () => api);
  await selector.get({ apiName: "backend", path: "/account/selected/site" }).response;
  assert.equal(old[0].path, "/account/selected/site"); assert.equal(calls.length, 0);
});
