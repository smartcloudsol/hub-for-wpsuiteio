import assert from "node:assert/strict";
import test from "node:test";
import { connectionKeyInputBinding, enteredConnectionKey, connectionIdentity, createPendingSiteKey, failureStatus, reusableLocalSiteKey, usableSiteKey, validateRotationResponse } from "./site-connection.ts";

const target = { workspaceId: "workspace-a", accountId: "workspace-a", siteId: "site-a", workspaceApiMode: "workspace", platformApiBaseUrl: "https://eu.example/dev", platformConfigUrl: "https://delivery.example/dev.json" };

test("missing, coerced and whitespace credentials cannot authenticate", () => {
  for (const key of [undefined, null, "", "undefined", "UNDEFINED", "null", "NuLl", " key", "key\n", "key\0", false, 123]) assert.equal(usableSiteKey(key), false);
  assert.equal(usableSiteKey("legacy-synthetic-key"), true);
});
test("local credentials are reused only for the complete identical binding", () => {
  const current = { ...target, siteKey: "synthetic-key" };
  assert.equal(reusableLocalSiteKey(current, target), "synthetic-key");
  for (const changed of [{workspaceId:"other",accountId:"other"}, {siteId:"other"}, {platformApiBaseUrl:"https://other.example/dev"}, {platformConfigUrl:"https://delivery.example/other.json"}, {workspaceApiMode:"legacy"}, {workspaceId:"conflicting"}]) assert.equal(reusableLocalSiteKey(current, { ...target, ...changed }), undefined);
  assert.equal(reusableLocalSiteKey({ ...current, siteKey:"undefined" }, target), undefined);
  assert.equal(connectionIdentity(target).includes(current.siteKey), false);
});
test("replacement generates 256 bits as 43 base64url characters and retains CAS metadata", () => {
  let calls = 0;
  const entropy = { getRandomValues<T extends ArrayBufferView | null>(bytes:T):T { calls++; (bytes as Uint8Array).fill(255); return bytes; }, randomUUID: () => "00000000-0000-4000-8000-000000000001" as const };
  assert.throws(() => createPendingSiteKey(target, "", entropy));
  assert.equal(calls, 0, "Missing CAS metadata must not generate a credential");
  const pending = createPendingSiteKey(target, "old-key-id", entropy);
  assert.match(pending.siteKey, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(Buffer.from(pending.siteKey, "base64url").length, 32);
  assert.equal(pending.expectedSiteKeyId, "old-key-id");
  assert.equal(pending.binding, connectionIdentity(target));
  assert.equal(calls, 1);
});
test("replacement requires a metadata receipt, never a downloadable key", () => {
  for (const receipt of [undefined, null, [], {}, {siteKeyId:""}, {siteKey:"synthetic"}]) assert.throws(() => validateRotationResponse(receipt));
  assert.doesNotThrow(() => validateRotationResponse({siteKeyId:"new-key-id"}));
});
test("only actual HTTP status describes authorization failures", () => {
  assert.equal(failureStatus(new Error("network unavailable")), undefined);
  assert.equal(failureStatus({response:{statusCode:403}}), 403);
  assert.equal(failureStatus({$metadata:{httpStatusCode:409}}), 409);
  assert.equal(failureStatus({status:503}), 503);
});

test("entered existing key is RAM-only and scoped to selection, API and configuration", () => {
  const entered = {binding:connectionKeyInputBinding(target,"https://eu.example/dev"),key:"synthetic-existing"};
  assert.equal(enteredConnectionKey(entered,target,"https://eu.example/dev"),"synthetic-existing");
  for(const changed of [{workspaceId:"other",accountId:"other"},{siteId:"other"},{platformApiBaseUrl:"https://other.example"},{platformConfigUrl:"https://delivery.example/other.json"}]) {
    assert.equal(enteredConnectionKey(entered,{...target,...changed},"https://eu.example/dev"),undefined);
  }
  assert.equal(enteredConnectionKey(entered,target,"https://other.example"),undefined);
  assert.equal(enteredConnectionKey(undefined,target,"https://eu.example/dev"),undefined);
  assert.throws(() => enteredConnectionKey({...entered,key:"undefined"},target,"https://eu.example/dev"), /entered connection key/);
  assert.equal(enteredConnectionKey({...entered,key:""},target,"https://eu.example/dev"),undefined);
  assert.equal(entered.binding.includes(entered.key),false);
});
