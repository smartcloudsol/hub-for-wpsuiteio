import assert from "node:assert/strict";
import test from "node:test";
import { fetchRecoverableSiteKey, fetchSiteInfoWithSiteKey, rememberCreatedSite } from "./site-info.ts";
import { connectionIdentity } from "./site-connection.ts";
const target = { workspaceId: "selected-workspace", accountId: "selected-workspace", siteId: "selected-site", workspaceApiMode: "workspace", platformApiBaseUrl: "https://foundation.example", platformConfigUrl: "https://delivery.example/dev.json" };
const site = { workspaceId: target.workspaceId, siteId: target.siteId, name: "Selected", subscriptionType: "PROFESSIONAL" };
function reply(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status }); }
test("local admin verifies selected site without session, authorization or cookies", async () => {
  let calls = 0;
  const metadata = await fetchSiteInfoWithSiteKey(target, target.platformApiBaseUrl, "synthetic-key", async (url, options) => {
    calls++;
    assert.equal(url, "https://foundation.example/workspace/selected-workspace/site/selected-site/settings");
    assert.equal(options?.method, "GET"); assert.equal(options?.credentials, "omit"); assert.equal(options?.redirect, "error");
    assert.deepEqual([...new Headers(options?.headers)], [["x-site-key", "synthetic-key"]]);
    return reply({ site: { ...site, siteKey: "must-not-be-used" }, configurations: [{pluginKey:"gatey",settings:{enabled:true},revision:2}] });
  });
  assert.equal(calls, 1); assert.equal(metadata.siteKey, undefined); assert.equal(metadata.subscriptionType, "PROFESSIONAL");
  assert.deepEqual(metadata.settings, {gatey:{enabled:true}});
});
test("creation key survives metadata cache and verifies newly selected tuple before handoff", async () => {
  const keys = new Map<string,string>();
  const created = { ...site, accountId: site.workspaceId, siteKey:"one-time-synthetic" };
  const metadata = rememberCreatedSite(created, target, keys);
  assert.equal("siteKey" in metadata, false);
  assert.equal(keys.get(connectionIdentity({...target,siteId:"old-installed-site"})), undefined);
  const key = keys.get(connectionIdentity(target))!;
  const verified = await fetchSiteInfoWithSiteKey(target, target.platformApiBaseUrl, key, async () => reply({site:metadata}));
  const persisted = {...target,siteKey:key,subscriber:verified.subscriptionType === "PROFESSIONAL"};
  assert.equal(persisted.siteId, "selected-site"); assert.equal(persisted.siteKey, "one-time-synthetic"); assert.equal(persisted.subscriber, true);
  assert.throws(() => rememberCreatedSite({...created, workspaceId:"foreign",accountId:"foreign"},target,keys));
});
test("invalid and mismatched bindings never send credentials or fall back", async () => {
  let calls = 0;
  const network: typeof fetch = async () => { calls++; throw new Error("Must not call"); };
  for (const changed of [{...target,accountId:"foreign"}, {...target,platformConfigUrl:undefined}, {...target,platformApiBaseUrl:undefined,platformConfigUrl:undefined}, {...target,workspaceApiMode:"legacy"}, {...target,siteId:undefined}]) await assert.rejects(fetchSiteInfoWithSiteKey(changed,target.platformApiBaseUrl,"synthetic",network));
  for (const base of ["https://other.example", "http://foundation.example", "https://u:p@foundation.example", "https://foundation.example?x=1"]) await assert.rejects(fetchSiteInfoWithSiteKey(target,base,"synthetic",network));
  await assert.rejects(fetchSiteInfoWithSiteKey(target,target.platformApiBaseUrl,"undefined",network)); assert.equal(calls, 0);
});
test("denied, network, malformed or foreign responses never retry or recover keys", async () => {
  for (const response of [reply({},403),reply({},409),reply({site:{...site,siteId:"foreign"}}),reply({site:{...site,workspaceId:"foreign"}}),reply(null),new Response("not-json")]) {
    let calls = 0; await assert.rejects(fetchSiteInfoWithSiteKey(target,target.platformApiBaseUrl,"synthetic",async () => {calls++;return response;})); assert.equal(calls,1);
  }
  await assert.rejects(fetchSiteInfoWithSiteKey(target,target.platformApiBaseUrl,"synthetic",async()=>{throw new Error("network");}),/network/);
});
test("legacy SiteKey GET retains shape and encodes selected identifiers", async () => {
  const legacy = {accountId:"space+#ő",siteId:"site/#",workspaceApiMode:"legacy"};
  const result = await fetchSiteInfoWithSiteKey(legacy,"https://legacy.example/dev/","synthetic",async (url,options)=>{
    assert.equal(url,"https://legacy.example/dev/account/space%2B%23%C5%91/site/site%2F%23/settings"); assert.equal(new Headers(options?.headers).has("authorization"),false);
    return reply({...legacy,subscriptionType:"AGENCY",siteKey:"response-key"});
  });
  assert.equal(result.subscriptionType,"AGENCY"); assert.equal("siteKey" in result,false);
});

test("owner credential recovery uses selected native backend and bound receipt before SiteKey verification", async () => {
  let reads = 0;
  const key = await fetchRecoverableSiteKey(target,target.platformApiBaseUrl,target.platformApiBaseUrl,async path => {
    reads++;assert.equal(path,"/workspace/selected-workspace/site/selected-site/site-key");
    return {workspaceId:target.workspaceId,siteId:target.siteId,siteKeyId:"synthetic-key-id",siteKey:"synthetic-recovered"};
  });
  assert.equal(reads,1);
  const verified = await fetchSiteInfoWithSiteKey(target,target.platformApiBaseUrl,key,async (_url,options)=>{
    assert.deepEqual([...new Headers(options?.headers)],[["x-site-key","synthetic-recovered"]]);
    return reply({site});
  });
  assert.equal(verified.siteId,target.siteId);
});
test("recovery rejects wrong native endpoint or selected binding before JWT request", async () => {
  let reads=0;const read=async()=>{reads++;return {};};
  for(const endpoint of [undefined,"https://other.example","https://foundation.example?query=1"])
    await assert.rejects(fetchRecoverableSiteKey(target,target.platformApiBaseUrl,endpoint,read));
  await assert.rejects(fetchRecoverableSiteKey({...target,accountId:"foreign"},target.platformApiBaseUrl,target.platformApiBaseUrl,read));
  assert.equal(reads,0);
});
test("recovery unavailable, denied or malformed never rotates or retries", async () => {
  const good={workspaceId:target.workspaceId,siteId:target.siteId,siteKeyId:"synthetic-id",siteKey:"synthetic-key"};
  for(const body of [{...good,workspaceId:"foreign"},{...good,siteId:"foreign"},{...good,siteKeyId:""},{...good,siteKey:"undefined"},null]){
    let calls=0;await assert.rejects(fetchRecoverableSiteKey(target,target.platformApiBaseUrl,target.platformApiBaseUrl,async()=>{calls++;return body;}));assert.equal(calls,1);
  }
  for(const status of [403,409]){
    let calls=0;await assert.rejects(fetchRecoverableSiteKey(target,target.platformApiBaseUrl,target.platformApiBaseUrl,async()=>{calls++;throw Object.assign(new Error("synthetic"),{status});}),error=>(error as {status:number}).status===status);assert.equal(calls,1);
  }
});
