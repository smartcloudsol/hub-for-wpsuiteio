/** Compiled Hub/Main + real Core profile guards; all browser requests intercepted. */
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { build } from "esbuild";
import { chromium, expect } from "@playwright/test";

const root = fileURLToPath(new URL("..", import.meta.url));
const mocks = {
  "@aws-amplify/auth": "export async function fetchAuthSession(){return {tokens:{accessToken:{payload:{scope:''}}}}}",
  "@aws-amplify/auth/cognito": "export const cognitoUserPoolsTokenProvider={setKeyValueStorage(){}};",
  "aws-amplify": "export const Amplify={configure(){window.fixtureAmplifyCalls=(window.fixtureAmplifyCalls||0)+1}};",
  "aws-amplify/utils": "export const Hub={listen(){return ()=>{}}};",
  "@wordpress/components": "import {createElement} from 'react'; export const __experimentalHeading=({children})=>createElement('h2',{},children);",
  "@wordpress/i18n": "export const __=value=>value;",
  "./license-handler": "import {createElement} from 'react'; export const LicenseHandler=({apiUrl,amplifyConfigured})=>createElement('div',{'data-testid':'license-bootstrap','data-auth-ready':String(amplifyConfigured)},apiUrl);",
};
const bundle = await build({
  absWorkingDir: root,
  stdin: { contents: "import '@mantine/core/styles.css'; import React from 'react'; import {createRoot} from 'react-dom/client'; import {MantineProvider} from '@mantine/core'; import {QueryClient,QueryClientProvider} from '@tanstack/react-query'; import Main from './src/main'; const host=document.getElementById('smartcloud-wpsuite-admin'); const mount=window.fixtureShadow?host.attachShadow({mode:'open'}):host; if(window.fixtureShadow){const style=document.createElement('link');style.rel='stylesheet';style.href='/fixture.css';mount.appendChild(style);} const container=document.createElement('div');mount.appendChild(container);createRoot(container).render(<QueryClientProvider client={new QueryClient({defaultOptions:{queries:{retry:false}}})}><MantineProvider><Main nonce='fixture-nonce' embedded /></MantineProvider></QueryClientProvider>);", resolveDir: root, loader: "tsx" },
  bundle: true, write: false, outdir: "/tmp/wpsuite-backend-profile-browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"', __WPSUITE_PREMIUM__: "true" },
  plugins: [{ name: "fixture-bootstrap-license", setup(plugin) {
    plugin.onResolve({filter:/.*/},({path})=>Object.hasOwn(mocks,path)?{path,namespace:"fixture"}:undefined);
    plugin.onLoad({filter:/.*/,namespace:"fixture"},({path})=>({contents:mocks[path],loader:"js",resolveDir:root}));
  }}],
});
const js = bundle.outputFiles.find(file=>file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find(file=>file.path.endsWith(".css")).text;
const browser = await chromium.launch({headless:true,args:["--disable-gpu","--disable-software-rasterizer"]});
const rest = "/wp-json/smartcloud-wpsuite/v1";
const profile = (id, configured=true, valid=true)=>({id,configured,valid});
const identity=id=>({awsRegion:"us-east-1",userPoolId:"us-east-1_FIXTURE",identityPoolId:"us-east-1:00000000-0000-0000-0000-000000000001",appClientPlugin:"fixtureclient",baseUrl:id==="production"?"https://wpsuite.io":"https://dev.wpsuite.io"});
const enabled = active=>({enabled:true,active,generation:3,profiles:[profile("production"),profile("development")],currentConnection:{workspaceId:"fixture-workspace",siteId:"fixture-site",workspaceApiMode:active==="development"?"workspace":"legacy",platformApiBaseUrl:active==="development"?"https://api-dev.wpsuite.io":"",platformConfigUrl:active==="development"?"https://wpsuite.io/static/config/foundation/dev/config.json":""}});

async function fixture({available=true,status=enabled("development"),statusFailure=false,activateFailure=0,configureFailure=0,width=1280,configOverride,shadow=false}={}) {
  const page=await browser.newPage({viewport:{width,height:1000}});
  page.setDefaultTimeout(5000);
  const calls=[], errors=[], unexpected=[];
  const state={status:structuredClone(status),context:null,documents:0};
  const context=()=>state.context??{enabled:state.status.enabled,active:state.status.active,generation:state.status.generation,bindingRevision:1};
  page.on("pageerror",error=>errors.push(error.message));
  await page.route("**/*",async route=>{
    const request=route.request(),url=new URL(request.url()),path=url.pathname;
    if(url.origin==="https://dev.wpsuite.io"&&path==="/fixture"){
      state.documents++;
      const id=state.status.active;
      const suite={backendProfilesAvailable:available,restUrl:rest,nonce:"fixture-nonce",siteSettings:{accountId:"fixture-workspace",siteId:"fixture-site",siteKey:"fixture-only-key",subscriber:true},...(state.status.enabled?{backendProfile:{enabled:true,id,generation:state.status.generation,bindingRevision:1,identity:identity(id),legacyApiBaseUrl:id==="production"?"https://api.wpsuite.io":"https://api-dev.wpsuite.io",legacyConfigUrl:`https://wpsuite.io/static/config/${id==="production"?"prod":"dev"}.json`}}:{})};
      return route.fulfill({contentType:"text/html",body:`<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"><style>body{margin:0;background:#f0f0f1}#wpadminbar{position:fixed;top:0;height:32px;z-index:99999}#wpcontent{margin:32px 20px 0;position:relative}#smartcloud-wpsuite-admin{max-width:960px}input,select{font-size:14px;line-height:2}summary{display:list-item}</style></head><body><div id="wpadminbar">WordPress fixture</div><main id="wpcontent"><div id="smartcloud-wpsuite-admin"></div></main><script>window.fixtureShadow=${shadow};window.WpSuite=${JSON.stringify(suite)}</script><script src="/fixture.js"></script></body></html>`});
    }
    if(path==="/fixture.js")return route.fulfill({contentType:"text/javascript",body:js});
    if(path==="/fixture.css")return route.fulfill({contentType:"text/css",body:css});
    if(url.origin==="https://wpsuite.io"&&/^\/static\/config\/(dev|prod)\.json$/.test(path))return route.fulfill({json:{...identity(path.endsWith("/prod.json")?"production":"development"),...configOverride}});
    if(path===`${rest}/backend-profile-context`)return route.fulfill({json:context()});
    if(path.startsWith(`${rest}/backend-profiles`)){
      const body=request.method()==="POST"?request.postDataJSON():undefined;
      calls.push({path,method:request.method(),body,headers:request.headers()});
      if(request.method()==="GET")return route.fulfill({status:statusFailure?503:200,json:statusFailure?{message:"fixture"}:state.status});
      const failure=path.endsWith("/activate")?activateFailure:configureFailure;
      if(failure)return route.fulfill({status:failure,json:{message:"fixture-only failure"}});
      if(body.expectedGeneration!==state.status.generation)return route.fulfill({status:409,json:{message:"changed"}});
      if(path.endsWith("/activate")){state.status.active=body.profileId;state.status.generation++;}
      else {state.status={...state.status,enabled:true,active:state.status.enabled?state.status.active:"development",generation:state.status.generation+1,profiles:[profile("production"),profile("development")]};}
      return route.fulfill({json:state.status});
    }
    unexpected.push(request.url());
    return route.abort(); // Never let a fixture fall through to a real endpoint.
  });
  await page.goto("https://dev.wpsuite.io/fixture");
  await expect(page.getByTestId("license-bootstrap")).toBeVisible();
  if(available&&!statusFailure&&!configOverride)await expect(page.getByText("Loading backend profiles…")).toHaveCount(0);
  const close=async()=>{await page.unrouteAll({behavior:"wait"});await page.close();assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);};
  return {page,state,calls,close};
}
async function select(page,label,value){await page.getByRole("combobox",{name:label,exact:true}).selectOption({label:value});}
const posts=calls=>calls.filter(call=>call.method==="POST");

try {
  await test("unavailable profile bootstrap has no profile controls or profile requests",async()=>{
    const f=await fixture({available:false,status:{...enabled("production"),enabled:false}});
    try{await expect(f.page.getByText("Backend environment",{exact:true})).toHaveCount(0);assert.equal(f.calls.length,0);}finally{await f.close();}
  });
  await test("absent registry preserves current connection and explicitly configures legacy production without key echo",async()=>{
    const f=await fixture({status:{enabled:false,active:"production",generation:0,profiles:[profile("production",false),profile("development",false)],currentConnection:{workspaceId:"fixture-workspace",siteId:"fixture-site"}}});
    try{
      await expect(f.page.getByText(/current site connection remains active/)).toBeVisible();
      await expect(f.page.getByRole("combobox",{name:"Active backend",exact:true})).toHaveCount(0);
      assert.equal(posts(f.calls).length,0);
      await f.page.getByText("Configure a backend profile",{exact:true}).click();
      await f.page.getByRole("button",{name:"Validate and save profile",exact:true}).click();
      await expect(f.page.getByRole("combobox",{name:"Active backend",exact:true})).toHaveValue("development");
      const call=posts(f.calls)[0];assert.equal(call.body.expectedGeneration,0);assert.equal(call.body.profileId,"production");assert.equal(call.body.reuseCurrentKey,true);assert.equal(call.body.connection.workspaceApiMode,"legacy");assert.equal(call.body.legacyApiBaseUrl,"https://api.wpsuite.io");assert.equal(call.body.legacyConfigUrl,"https://wpsuite.io/static/config/prod.json");assert.equal(Object.hasOwn(call.body.connection,"siteKey"),false);assert.equal(f.state.documents,2);
    }finally{await f.close();}
  });
  for(const width of [1280,390])await test(`explicit development→production→development activation reloads exact selected backend (${width}px)`,async()=>{
    const f=await fixture({width});
    try{
      for(const [label,id,generation] of [["Production backend","production",3],["Development test backend","development",4]]){
        await select(f.page,"Active backend",label);
        await expect(f.page.getByRole("combobox",{name:"Active backend",exact:true})).toHaveValue(id);
        await expect(f.page.getByTestId("license-bootstrap")).toHaveText(id==="production"?"https://api.wpsuite.io":"https://api-dev.wpsuite.io");
        const call=posts(f.calls).at(-1);assert.deepEqual(call.body,{profileId:id,expectedGeneration:generation});assert.equal(call.headers["x-wp-nonce"],"fixture-nonce");assert.equal(call.headers["x-wpsuite-backend-generation"],String(generation));assert.equal(call.headers["x-wpsuite-backend-profile"],id==="production"?"development":"production");
      }
      assert.equal(f.state.documents,3);assert.equal(posts(f.calls).length,2);
    }finally{await f.close();}
  });
  await test("unconfigured or invalid targets remain disabled",async()=>{
    const f=await fixture({status:{...enabled("development"),profiles:[profile("production",false,false),profile("development")]}});
    try{await expect(f.page.getByRole("combobox",{name:"Active backend",exact:true}).getByRole("option",{name:"Production backend",exact:true})).toBeDisabled();assert.equal(posts(f.calls).length,0);}finally{await f.close();}
  });
  await test("server generation conflict preserves selected backend and presents reload guidance",async()=>{
    const f=await fixture({activateFailure:409});
    try{await select(f.page,"Active backend","Production backend");await expect(f.page.getByRole("alert")).toContainText("Reload this page before continuing");await expect(f.page.getByRole("combobox",{name:"Active backend",exact:true})).toHaveValue("development");assert.equal(f.state.documents,1);assert.equal(posts(f.calls).length,1);}finally{await f.close();}
  });
  await test("freshness mismatch blocks activation before POST and marks stale tab without automatic reload",async()=>{
    const f=await fixture();
    try{f.state.context={enabled:true,active:"production",generation:4,bindingRevision:1};await select(f.page,"Active backend","Production backend");await expect(f.page.locator("#wpsuite-backend-profile-stale")).toContainText("Saving and submissions are paused");await expect(f.page.getByRole("combobox",{name:"Active backend",exact:true})).toHaveValue("development");assert.equal(posts(f.calls).length,0);assert.equal(f.state.documents,1);}finally{await f.close();}
  });
  await test("status failure never activates or falls back to another profile",async()=>{
    const f=await fixture({statusFailure:true});
    try{await expect(f.page.getByRole("alert")).toContainText("Backend profiles could not be loaded");assert.equal(posts(f.calls).length,0);assert.equal(f.state.documents,1);await expect(f.page.getByTestId("license-bootstrap")).toHaveText("https://api-dev.wpsuite.io");}finally{await f.close();}
  });
  await test("same-URL public bootstrap identity drift blocks Auth initialization and pauses writes",async()=>{
    const f=await fixture({configOverride:{userPoolId:"us-east-1_Changed"}});
    try{await expect(f.page.locator("#wpsuite-backend-profile-stale")).toContainText("Saving and submissions are paused");await expect(f.page.getByTestId("license-bootstrap")).toHaveAttribute("data-auth-ready","false");assert.equal(await f.page.evaluate(()=>window.fixtureAmplifyCalls||0),0);assert.equal(posts(f.calls).length,0);assert.equal(f.state.documents,1);}finally{await f.close();}
  });
  await test("configuration denial clears typed key and keeps original connection active",async()=>{
    const f=await fixture({configureFailure:403});
    try{await f.page.getByText("Configure a backend profile",{exact:true}).click();await select(f.page,"Profile to configure","Development test backend");await f.page.getByLabel("Connection key",{exact:true}).fill("synthetic-one-use-key");await f.page.getByRole("button",{name:"Validate and save profile",exact:true}).click();await expect(f.page.getByRole("alert")).toContainText("could not be completed");await expect(f.page.getByLabel("Connection key",{exact:true})).toHaveValue("");await expect(f.page.getByRole("combobox",{name:"Active backend",exact:true})).toHaveValue("development");assert.equal(f.state.documents,1);assert.equal(posts(f.calls)[0].body.connection.siteKey,"synthetic-one-use-key");}finally{await f.close();}
  });

  await test("profile drafts stay separate and never retain a typed key across profile or backend-type changes",async()=>{
    const f=await fixture({status:enabled("production")});
    try{
      await f.page.getByText("Configure a backend profile",{exact:true}).click();
      await expect(f.page.getByRole("combobox",{name:"Production backend type",exact:true})).toHaveValue("legacy");
      await expect(f.page.getByLabel("Foundation API URL",{exact:true})).toHaveCount(0);
      await expect(f.page.getByLabel("Connection key",{exact:true})).toHaveValue("");
      await expect(f.page.getByLabel("Connection key",{exact:true})).toHaveAttribute("type","password");
      await expect(f.page.getByRole("button",{name:/show password/i})).toHaveCount(0);
      await f.page.getByLabel("Workspace ID",{exact:true}).fill("production-draft");
      await f.page.getByLabel("Connection key",{exact:true}).fill("synthetic-production-key");
      await select(f.page,"Profile to configure","Development test backend");
      await expect(f.page.getByLabel("Workspace ID",{exact:true})).toHaveValue("");
      await expect(f.page.getByLabel("Site ID",{exact:true})).toHaveValue("");
      await expect(f.page.getByLabel("Connection key",{exact:true})).toHaveValue("");
      await expect(f.page.getByRole("combobox",{name:"Production backend type",exact:true})).toHaveCount(0);
      await f.page.getByLabel("Workspace ID",{exact:true}).fill("development-draft");
      await f.page.getByLabel("Site ID",{exact:true}).fill("development-site");
      await select(f.page,"Profile to configure","Production backend");
      await expect(f.page.getByLabel("Workspace ID",{exact:true})).toHaveValue("production-draft");
      await f.page.getByLabel("Connection key",{exact:true}).fill("synthetic-production-key");
      await select(f.page,"Production backend type","Foundation API");
      await expect(f.page.getByLabel("Connection key",{exact:true})).toHaveValue("");
      await expect(f.page.getByLabel("Foundation API URL",{exact:true})).toBeVisible();
      await select(f.page,"Production backend type","Legacy production API");
      await expect(f.page.getByLabel("Foundation API URL",{exact:true})).toHaveCount(0);
      await select(f.page,"Profile to configure","Development test backend");
      await expect(f.page.getByLabel("Workspace ID",{exact:true})).toHaveValue("development-draft");
      await expect(f.page.getByLabel("Site ID",{exact:true})).toHaveValue("development-site");
      assert.equal(posts(f.calls).length,0);assert.equal(f.state.documents,1);
      await expect(f.page.getByText("Configure a backend profile",{exact:true})).toHaveCSS("cursor","pointer");
    }finally{await f.close();}
  });
  await test("initial Foundation DEV connection does not become the production legacy identity or key",async()=>{
    const f=await fixture({configureFailure:403});
    try{
      await f.page.getByText("Configure a backend profile",{exact:true}).click();
      await expect(f.page.getByRole("combobox",{name:"Profile to configure",exact:true})).toHaveValue("production");
      await expect(f.page.getByLabel("Workspace ID",{exact:true})).toHaveValue("");
      await expect(f.page.getByLabel("Site ID",{exact:true})).toHaveValue("");
      await expect(f.page.getByLabel("Connection key",{exact:true})).toHaveValue("");
      const save=f.page.getByRole("button",{name:"Validate and save profile",exact:true});await expect(save).toBeDisabled();
      await f.page.getByLabel("Workspace ID",{exact:true}).fill("synthetic-prod-workspace");
      await f.page.getByLabel("Site ID",{exact:true}).fill("synthetic-prod-site");await expect(save).toBeDisabled();
      await f.page.getByLabel("Connection key",{exact:true}).fill("synthetic-prod-key");await save.click();
      await expect(f.page.getByRole("alert")).toContainText("could not be completed");
      const {body}=posts(f.calls)[0];assert.equal(body.profileId,"production");assert.equal(body.reuseCurrentKey,false);
      assert.equal(body.connection.workspaceApiMode,"legacy");assert.equal(body.connection.platformApiBaseUrl,"");assert.equal(body.connection.platformConfigUrl,"");
      assert.equal(body.legacyApiBaseUrl,"https://api.wpsuite.io");assert.equal(body.legacyConfigUrl,"https://wpsuite.io/static/config/prod.json");
      assert.equal(body.connection.siteKey,"synthetic-prod-key");assert.equal(body.connection.workspaceId,"synthetic-prod-workspace");
      await expect(f.page.getByRole("combobox",{name:"Active backend",exact:true})).toHaveValue("development");
      assert.equal(f.state.documents,1);
    }finally{await f.close();}
  });
  await test("Foundation draft requires the correct HTTPS pair and a key for changed identity before any POST",async()=>{
    const f=await fixture({configureFailure:403});
    try{
      await f.page.getByText("Configure a backend profile",{exact:true}).click();
      await select(f.page,"Profile to configure","Development test backend");
      const save=f.page.getByRole("button",{name:"Validate and save profile",exact:true});
      await f.page.getByLabel("Workspace ID",{exact:true}).fill("different-workspace");
      await expect(save).toBeDisabled();
      await f.page.getByLabel("Connection key",{exact:true}).fill("synthetic-dev-key");
      for(const invalid of ["http://wpsuite.io/config.json","https://user:pass@wpsuite.io/config.json","https://wpsuite.io/config.json?secret=no","https://wpsuite.io/config.json#fragment"]){
        await f.page.getByLabel("Public platform configuration URL",{exact:true}).fill(invalid);await expect(save).toBeDisabled();
      }
      await f.page.getByLabel("Public platform configuration URL",{exact:true}).fill("https://wpsuite.io/static/config/foundation/dev/example.json");
      await f.page.getByLabel("Foundation API URL",{exact:true}).fill("https://api.wpsuite.io");await expect(save).toBeDisabled();
      await f.page.getByLabel("Foundation API URL",{exact:true}).fill("https://api-dev.wpsuite.io");await expect(save).toBeEnabled();
      assert.equal(posts(f.calls).length,0);await save.click();
      await expect(f.page.getByRole("alert")).toContainText("could not be completed");
      const call=posts(f.calls)[0];assert.equal(call.body.reuseCurrentKey,false);assert.equal(call.body.connection.workspaceApiMode,"workspace");assert.equal(call.body.connection.platformApiBaseUrl,"https://api-dev.wpsuite.io");assert.equal(call.body.connection.workspaceId,"different-workspace");assert.equal(call.headers["x-wp-nonce"],"fixture-nonce");
      await expect(f.page.getByLabel("Connection key",{exact:true})).toHaveValue("");
    }finally{await f.close();}
  });
  await test("native selectors support keyboard selection in the WordPress light-DOM mount",async()=>{
    const f=await fixture({status:enabled("production")});
    try{
      await f.page.getByText("Configure a backend profile",{exact:true}).click();
      const configure=f.page.getByRole("combobox",{name:"Profile to configure",exact:true});
      assert.equal(await configure.evaluate(element=>element.tagName),"SELECT");
      await configure.focus();await configure.press("End");
      await expect(configure).toHaveValue("development");
      await configure.press("Home");await expect(configure).toHaveValue("production");
      assert.equal(posts(f.calls).length,0);
      const active=f.page.getByRole("combobox",{name:"Active backend",exact:true});
      await active.focus();await active.press("End");
      await expect(active).toHaveValue("development");
      await expect(f.page.getByTestId("license-bootstrap")).toHaveText("https://api-dev.wpsuite.io");
      assert.equal(posts(f.calls).length,1);assert.equal(f.state.documents,2);
    }finally{await f.close();}
  });
  await test("native selectors work in a shadow-root robustness fixture without portal menus",async()=>{
    const f=await fixture({shadow:true,status:enabled("production")});
    try{
      await f.page.getByText("Configure a backend profile",{exact:true}).click();
      await select(f.page,"Profile to configure","Development test backend");
      await expect(f.page.getByLabel("Foundation API URL",{exact:true})).toBeVisible();
      await select(f.page,"Profile to configure","Production backend");
      await expect(f.page.getByRole("combobox",{name:"Production backend type",exact:true})).toHaveValue("legacy");
      assert.equal(posts(f.calls).length,0);
      await select(f.page,"Active backend","Development test backend");
      await expect(f.page.getByRole("combobox",{name:"Active backend",exact:true})).toHaveValue("development");
      assert.equal(posts(f.calls).length,1);assert.equal(f.state.documents,2);
    }finally{await f.close();}
  });
} finally {await browser.close();}
