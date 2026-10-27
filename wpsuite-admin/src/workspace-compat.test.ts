import assert from "node:assert/strict";
import test from "node:test";
import { resolveApiMode, workspaceRequestPath, workspaceLicenseRequestPath, workspaceResponseView, settingsView } from "./workspace-compat.ts";

test("wire migration is explicit and never changes unrelated paths", () => {
  assert.equal(resolveApiMode(undefined), "legacy");
  assert.equal(workspaceRequestPath("/account/ws/site/site", "legacy"), "/account/ws/site/site");
  assert.equal(workspaceRequestPath("/account/ws/site/site", "workspace"), "/workspace/ws/site/site");
  assert.equal(workspaceRequestPath("/accounting", "workspace"), "/accounting");
  assert.throws(() => resolveApiMode({ workspaceApiMode: "automatic" }), /Unsupported/);
});
test("workspace envelopes retain identity, ownership and independent admin role", () => {
  const result = workspaceResponseView("/workspace", { workspaces: [{ workspaceId: "ws", ownerUserId: "owner", role: "admin", stripeCustomerId: "customer", extension: true }] }) as Record<string, unknown>[];
  assert.deepEqual(result[0], { workspaceId: "ws", accountId: "ws", ownerUserId: "owner", owner: "owner", role: "admin", stripeCustomerId: "customer", customerId: "customer", customer: { id: "customer" }, extension: true });
  assert.throws(() => workspaceResponseView("/workspace/ws", { workspace: { workspaceId: "ws", accountId: "other" } }), /Conflicting/);
  assert.throws(() => workspaceResponseView("/workspace", []), /Invalid/);
});
test("canonical site list adapts complete results, ordering and search without invented pagination", () => {
  const site = (name: string) => ({ workspaceId: "ws", siteId: name, name, domain: name + ".test" });
  const result = workspaceResponseView("/workspace/ws/site", { sites: [site("beta"), site("alpha")] }, { search: "a", order: "name", limit: "1" });
  assert.deepEqual(result, { list: [{ ...site("alpha"), accountId: "ws" }], lastKey: null });
  assert.throws(() => workspaceResponseView("/workspace/ws/site", { sites: [] }, { last_key: "legacy" }), /cursors/);
});
test("site creation merges the separately returned site key", () => {
  assert.deepEqual(workspaceResponseView("/workspace/ws/site", { site: { workspaceId: "ws", siteId: "site" }, siteKey: "synthetic" }), { workspaceId: "ws", accountId: "ws", siteId: "site", siteKey: "synthetic" });
});
test("settings preserve plugin nesting, revisions and site subscription metadata", () => {
  assert.deepEqual(settingsView({ configurations: [{ pluginKey: "flow", settings: { enabled: true }, revision: 2 }, { pluginKey: "gatey", settings: { domains: [] }, revision: 4 }] }, { site: { workspaceId: "ws", siteId: "site", subscriptionType: "AGENCY" } }), { workspaceId: "ws", accountId: "ws", siteId: "site", subscriptionType: "AGENCY", settings: { flow: { enabled: true }, gatey: { domains: [] } }, revisions: { flow: 2, gatey: 4 } });
});
test("billing and licence payloads retain their original contract", () => {
  const payload = { config: "synthetic", jws: "synthetic", version: 2 };
  assert.strictEqual(workspaceResponseView("/workspace/ws/site/site/license", payload), payload);
});

test("canonical licence paths explicitly retain the existing v1 verifier contract", () => {
  assert.equal(workspaceLicenseRequestPath("/account/ws/site/site/license", "legacy"), "/account/ws/site/site/license");
  assert.equal(workspaceLicenseRequestPath("/account/ws/site/site/license", "workspace"), "/workspace/ws/site/site/license?licenseVersion=1");
});
