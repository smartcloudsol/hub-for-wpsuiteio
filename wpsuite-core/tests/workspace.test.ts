import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorkspaceIdentity, resolveWorkspaceId, workspaceApiMode, workspaceManagementIds } from "../src/workspace.ts";

test("legacy state gains canonical identity without losing extension fields", () => {
  const legacy = { accountId: "same-id", siteId: "site", extension: { enabled: true } };
  const migrated = normalizeWorkspaceIdentity(legacy);
  assert.equal(migrated.workspaceId, "same-id");
  assert.equal(migrated.accountId, "same-id");
  assert.strictEqual(migrated.extension, legacy.extension);
  assert.equal(legacy.accountId, "same-id");
  assert.equal(resolveWorkspaceId({ workspaceId: "canonical" }), "canonical");
});
test("contradictory or malformed identities fail closed", () => {
  assert.throws(() => resolveWorkspaceId({ workspaceId: "one", accountId: "two" }), /Conflicting/);
  assert.throws(() => resolveWorkspaceId({ workspaceId: " one" }), /whitespace/);
  assert.throws(() => resolveWorkspaceId({ accountId: 123 } as never), /string/);
});
test("workspace API requires an explicit valid switch", () => {
  assert.equal(workspaceApiMode(undefined), "legacy");
  assert.equal(workspaceApiMode("workspace"), "workspace");
  assert.throws(() => workspaceApiMode("automatic"), /Unsupported/);
});
test("owner and explicit admin claims accept both namespaces without conflating member permission", () => {
  assert.deepEqual(workspaceManagementIds(["sc.workspace.owner.ws_1", "sc.account.admin.ws_1", "sc.workspace.admin.ws_2", "sc.workspace.member.ws_3"]), ["ws_1", "ws_2"]);
});
