import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { fetchPlatformConfiguration, resolvePlatformConnection, validatePlatformConfiguration } from "./platform-connection.ts";

const globals = globalThis as unknown as Record<PropertyKey, unknown>;
afterEach(() => { delete globals.WpSuite; delete globals[Symbol.for("wpsuite.backend-profile.runtime.v1")]; });
const context = { enabled: true, id: "production", generation: 1, bindingRevision: 1,
  legacyApiBaseUrl: "https://api.wpsuite.io", legacyConfigUrl: "https://wpsuite.io/static/config/prod.json", identity: { awsRegion: "us-east-1", userPoolId: "us-east-1_Fixture", identityPoolId: "us-east-1:00000000-0000-0000-0000-000000000001", appClientPlugin: "fixtureclient", baseUrl: "https://wpsuite.io" } };

test("Hub production profile selects production legacy config on the dev CMS", () => {
  globals.WpSuite = { backendProfile: context };
  const selected = resolvePlatformConnection({ workspaceApiMode: "legacy" }, "https://api-dev.wpsuite.io", "https://wpsuite.io/static/config/dev.json");
  assert.deepEqual(selected, { apiBaseUrl: context.legacyApiBaseUrl, configUrl: context.legacyConfigUrl, explicit: false, profiled: true });
});

test("profile selection never weakens Foundation endpoint/config identity validation", () => {
  globals.WpSuite = { backendProfile: context };
  const selected = resolvePlatformConnection({ workspaceApiMode: "workspace", platformApiBaseUrl: "https://api-dev.wpsuite.io", platformConfigUrl: "https://wpsuite.io/static/config/foundation/dev/config.json" }, "https://legacy.example", "https://legacy.example/prod.json");
  assert.equal(selected.apiBaseUrl, "https://api-dev.wpsuite.io");
  assert.throws(() => validatePlatformConfiguration(selected, { ...context.identity, workspaceApiMode: "workspace", foundationApiBaseUrl: context.legacyApiBaseUrl }), /identity changed/);
  assert.throws(() => resolvePlatformConnection({ workspaceApiMode: "legacy", platformApiBaseUrl: context.legacyApiBaseUrl, platformConfigUrl: context.legacyConfigUrl }, "", ""), /requires workspace/);
});

test("network errors in a selected profile cannot silently load fallback production identity", async () => {
  globals.WpSuite = { backendProfile: context };
  const selected = resolvePlatformConnection({}, "https://dev.example", "https://dev.example/dev.json");
  let fallbackCalled = false;
  await assert.rejects(fetchPlatformConfiguration(selected, () => { fallbackCalled = true; return {}; }, async () => { throw new Error("synthetic network error"); }), /network/);
  assert.equal(fallbackCalled, false);
});
