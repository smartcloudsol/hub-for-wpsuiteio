import assert from "node:assert/strict";
import test from "node:test";
import { getSitePluginSettings, putSitePluginSettings } from "../src/site-configuration.ts";
const connection = { workspaceApiMode: "workspace", platformApiBaseUrl: "https://foundation.example/dev", platformConfigUrl: "https://public.example/config.json", workspaceId: "workspace", siteId: "site" };
const target = { connection, legacyApiBaseUrl: "https://legacy.example/dev", workspaceId: "workspace", siteId: "site", siteKey: "synthetic-key", pluginKey: "ai-kit" };
const config = (revision = 3, settings: unknown = { enabled: true }, pluginKey = "aiKit") => ({ workspaceId: "workspace", siteId: "site", pluginKey, revision, settings });
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
test("workspace routes and plugin keys use read revision for consecutive CAS saves", async () => {
 const calls: Array<{url:string,init?:RequestInit}> = [];
 const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
  calls.push({url:String(url),init});
  return init?.method === "GET" ? response({site:{workspaceId:"workspace",siteId:"site"},configuration:config()}) : response({configuration:config(calls.length+2,JSON.parse(String(init?.body)).settings)});
 }) as typeof fetch;
 assert.deepEqual((await getSitePluginSettings(target,fetcher)).settings,{enabled:true});
 await putSitePluginSettings(target,{enabled:false},fetcher);
 await putSitePluginSettings(target,{enabled:true},fetcher);
 assert.equal(calls[0].url,"https://foundation.example/dev/workspace/workspace/site/site/settings");
 assert.equal((calls[0].init?.headers as Record<string,string>)["X-Plugin"],"aiKit");
 assert.deepEqual(JSON.parse(String(calls[1].init?.body)),{pluginKey:"aiKit",expectedRevision:3,settings:{enabled:false}});
 assert.equal(JSON.parse(String(calls[2].init?.body)).expectedRevision,4);
});
test("legacy account routing and payload stay compatible", async () => {
 const calls: RequestInit[]=[];const legacy={...target,connection:undefined};
 const fetcher=(async (url: RequestInfo | URL, init:RequestInit={})=>{
  assert.equal(String(url),"https://legacy.example/dev/account/workspace/site/site/settings");calls.push(init);
  return response({accountId:"workspace",siteId:"site",settings:{legacy:true}});
 }) as typeof fetch;
 await getSitePluginSettings(legacy,fetcher);await putSitePluginSettings(legacy,{legacy:false},fetcher);
 assert.equal((calls[0].headers as Record<string,string>)["X-Plugin"],"ai-kit");
 assert.deepEqual(JSON.parse(String(calls[1].body)),{settings:{legacy:false}});
});
test("invalid or foreign explicit bindings never fall back or send requests", async () => {
 const invalid=[{...connection,workspaceApiMode:"automatic",platformApiBaseUrl:"",platformConfigUrl:""},{...connection,platformApiBaseUrl:""},{...connection,platformConfigUrl:""},{...connection,platformApiBaseUrl:"https://user:password@foundation.example/dev"},{...connection,platformConfigUrl:"https://public.example/config.json?credential=hidden"},{...connection,workspaceApiMode:"legacy"},{...connection,workspaceId:"other"},{...connection,siteId:"other"}];
 let requests=0;const fetcher=(async()=>{requests++;return response({});}) as typeof fetch;
 for(const binding of invalid)await assert.rejects(getSitePluginSettings({...target,connection:binding},fetcher));
 assert.equal(requests,0);
});
test("failed reload discards revision and prevents blind save", async()=>{
 const isolated={...target,pluginKey:"flow"};let requests=0;
 const never=(async()=>{requests++;return response({});}) as typeof fetch;
 await assert.rejects(putSitePluginSettings(isolated,{},never),/Reload/);
 await getSitePluginSettings(isolated,(async()=>response({site:{workspaceId:"workspace",siteId:"site"},configuration:config(3,{},"flow")})) as typeof fetch);
 await assert.rejects(getSitePluginSettings(isolated,(async()=>response({},403)) as typeof fetch),/403/);
 await assert.rejects(putSitePluginSettings(isolated,{},never),/Reload/);assert.equal(requests,0);
});
test("foreign responses and conflicts cannot overwrite newer settings", async()=>{
 const isolated={...target,pluginKey:"gatey"};
 const foreign=(async()=>response({site:{workspaceId:"workspace",siteId:"site"},configuration:{...config(),workspaceId:"foreign",pluginKey:"gatey"}})) as typeof fetch;
 await assert.rejects(getSitePluginSettings(isolated,foreign),/match/);
 await assert.rejects(putSitePluginSettings(isolated,{}),/Reload/);
 await getSitePluginSettings(isolated,(async()=>response({site:{workspaceId:"workspace",siteId:"site"},configuration:config(3,{},"gatey")})) as typeof fetch);
 await assert.rejects(putSitePluginSettings(isolated,{},(async()=>response({secret:"not surfaced"},409)) as typeof fetch),/changed/);
});
test("missing canonical config is created with revision zero",async()=>{
 const isolated={...target,pluginKey:"publisher"};
 const fetcher=(async(_url:RequestInfo|URL,init:RequestInit={})=>{
  if(init.method==="GET")return response({site:{workspaceId:"workspace",siteId:"site"},configuration:null});
  assert.equal(JSON.parse(String(init.body)).expectedRevision,0);
  return response({configuration:config(1,{new:true},"publisher")});
 }) as typeof fetch;
 assert.deepEqual((await getSitePluginSettings(isolated,fetcher)).settings,{});
 assert.deepEqual(await putSitePluginSettings(isolated,{new:true},fetcher),{new:true});
});

test("malformed existing settings never become an empty replaceable configuration", async()=>{
 const isolated={...target,pluginKey:"malformed-test"};
 for(const settings of [null, [], "text", false]) {
  const fetcher=(async()=>response({site:{workspaceId:"workspace",siteId:"site"},configuration:config(1,settings,"malformed-test")})) as typeof fetch;
  await assert.rejects(getSitePluginSettings(isolated,fetcher),/match/);
  await assert.rejects(putSitePluginSettings(isolated,{}),/Reload/);
 }
});
