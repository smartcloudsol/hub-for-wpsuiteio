/** Real Settings UI with synthetic connection/auth/API fixtures; no external requests. */
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = await build({
  absWorkingDir: root, bundle: true, write: false, outfile: '/tmp/reconnect-browser.js',
  format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
  stdin: { resolveDir: root, loader: 'tsx', contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { MantineProvider } from '@mantine/core';
    import { ModalsProvider } from '@mantine/modals';
    import { Notifications } from '@mantine/notifications';
    import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    import { Settings } from './src/license-handler/settings';
    import '@mantine/core/styles.css';
    import '@mantine/notifications/styles.css';
    import './src/index.css';
    const settings = window.testSettings;
    const rejectStateSwitch = () => { throw new Error('Connection changed before reload'); };
    createRoot(document.getElementById('smartcloud-wpsuite-admin')).render(
      <MantineProvider><ModalsProvider><QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <Notifications /><Settings amplifyConfigured={true} apiUrl="/mock" stripePublicKey="synthetic" pricingTable="synthetic"
          nonce="synthetic-nonce" ownAccountId="workspace" {...settings}
          compact={window.testCompact} platformLinks={[{ label:'Platform Settings', url:'/platform-settings' }]}
          setAccountId={rejectStateSwitch} setSiteId={rejectStateSwitch} setSiteKey={rejectStateSwitch} />
      </QueryClientProvider></ModalsProvider></MantineProvider>
    );
  ` },
  plugins: [{ name: 'synthetic-services', setup(builder) {
    builder.onResolve({ filter: /^(@aws-amplify\/(api|auth)|@smart-cloud\/(aws-amplify-ui-react|wpsuite-core)|aws-amplify\/api|@wordpress\/i18n)$/ }, ({path}) => ({path,namespace:'fixture'}));
    builder.onLoad({filter:/.*/, namespace:'fixture'}, ({path}) => {
      if (path === '@smart-cloud/aws-amplify-ui-react') return { loader:'jsx', resolveDir:root, contents:`import React from 'react'; export const Authenticator=({children})=><>{children}</>; export const Heading=({children})=><h3>{children}</h3>; export const useAuthenticator=()=>({authStatus:'authenticated',toSignIn(){},signOut(){}});` };
      if (path === '@smart-cloud/wpsuite-core') return {contents:`const captured=window.testSettings; export const TEXT_DOMAIN='test'; export const getWpSuite=()=>({siteSettings:captured,restUrl:'/rest'}); export const getConfig=async()=>({subscriptionType:captured.subscriber?'PROFESSIONAL':undefined});`};
      if (path === '@aws-amplify/auth') return {contents:`export const fetchUserAttributes=async()=>({email:'test@example.test'});`};
      if (path === '@wordpress/i18n') return {contents:`export const __=x=>x;`};
      return {contents:`export const get=({path,options})=>({response:fetch('/mock'+path,{headers:options?.headers}).then(r=>{if(!r.ok)throw Error('Synthetic lookup unavailable');return {body:{json:()=>r.json()}}})}); export const patch=()=>{throw Error('Unexpected PATCH')}; export const put=patch; export const post=patch; export const del=patch;`};
    });
  } }],
});
const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).contents;
const css=bundle.outputFiles.find(f=>f.path.endsWith('.css')).contents;
const sites=[
  {accountId:'workspace',siteId:'paid',siteKey:'synthetic-paid',name:'Paid fixture',domain:'paid.example.test',subscriptionType:'PROFESSIONAL',settings:{},subscription:{id:'synthetic-subscription',active:true,currentPeriodEnd:2000000000}},
  {accountId:'workspace',siteId:'free',siteKey:'synthetic-free',name:'Free fixture',domain:'free.example.test',settings:{}},
  {accountId:'workspace',siteId:'agency',siteKey:'synthetic-agency',name:'Agency fixture',domain:'agency.example.test',subscriptionType:'AGENCY',settings:{}},
];
const initial={accountId:'workspace',siteId:'paid',siteKey:'synthetic-paid',subscriber:true,reCaptchaPublicKey:'synthetic-public',useRecaptchaNet:true,useRecaptchaEnterprise:true,renderRecaptchaProvider:false};
let persisted={...initial};let existingCustomer=false;let failure;let pageLoads=0;let compactMode=false;let lookupFailure=false;let lookupDelay=0;const saves=[];const reads=[];
const server=createServer(async(req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(path==='/app.js'){res.setHeader('Content-Type','application/javascript');res.end(js);return;}
  if(path==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css);return;}
  if(path==='/rest/update-site-settings'){
    let raw='';for await(const part of req)raw+=part;
    const payload=JSON.parse(raw);saves.push(payload);
    assert.equal(req.headers['x-wp-nonce'],'synthetic-nonce');
    if(failure==='network'){req.socket.destroy();return;}
    res.setHeader('Content-Type','application/json');
    if(failure==='http'){res.writeHead(403).end(JSON.stringify({message:'Synthetic permission denied'}));return;}
    if(failure==='non-json'){res.writeHead(502).end('Bad gateway');return;}
    persisted=payload;res.end(JSON.stringify({success:true}));return;
  }
  if(path.startsWith('/mock')){
    reads.push({path,key:req.headers['x-site-key']});
    if(path.endsWith('/settings')) {
      if(lookupDelay)await new Promise(resolve=>setTimeout(resolve,lookupDelay));
      if(lookupFailure){res.writeHead(503).end('{}');return;}
    }
    const account={accountId:'workspace',name:'Synthetic workspace',owner:'synthetic',ownerEmail:'test@example.test',customer:existingCustomer?{}:null,customerId:existingCustomer?'synthetic-customer':undefined};
    const value=path==='/mock/account/workspace/billing-auth-session'?{token:'synthetic-session'}:path==='/mock/account'?[account]:path==='/mock/account/workspace'?account:path==='/mock/account/workspace/site'?{list:sites}:sites.find(s=>path===`/mock/account/workspace/site/${s.siteId}/settings`);
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value??{}));return;
  }
  pageLoads++;res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"></head><body><div id="smartcloud-wpsuite-admin"></div><script>window.testSettings=${JSON.stringify(persisted)};window.testCompact=${compactMode}</script><script src="/app.js"></script></body></html>`);
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1360,height:1000}});
const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
async function reconnect(target){
  await expandConnection();
  await page.getByRole('button',{name:'Settings',exact:true}).last().click();
  await page.getByRole('menuitem',{name:'Reconnect',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Connect Your Site'});
  await dialog.getByRole('radio').filter({hasText:target}).click();
  await dialog.getByRole('button',{name:'Connect',exact:true}).click();
}
async function expandConnection(){
  const manage=page.getByRole('button',{name:'Manage connection',exact:true});
  if(await manage.count() && await manage.getAttribute('aria-expanded')==='false')await manage.click();
}
async function verifyIdentity(id){
  const details=page.locator('#wpsuite-connection-details');
  await details.getByText(`${id==='paid'?'Paid':'Free'} fixture`,{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.testSettings.siteId),id);
  await details.getByText(id==='paid'?'Professional':'Free',{exact:true}).waitFor();
}
async function verifyConnectionDetails(name,plan){
  const details=page.locator('#wpsuite-connection-details');
  for(const [label,value]of[['Site',name],['Workspace','Synthetic workspace'],['Owner','test@example.test']]){
    const labelCell=details.getByText(label,{exact:true});
    await labelCell.waitFor();
    const valueCell=labelCell.locator('xpath=following-sibling::div[1]');
    const rowValue=await valueCell.innerText();
    assert.ok(rowValue.includes(value),`${label} has its own value row (${JSON.stringify(rowValue)})`);
  }
  await details.getByText(plan,{exact:true}).waitFor();
  assert.equal(await details.getByText('Status',{exact:true}).count(),0,'Expanded details do not repeat connection status');
  assert.equal(await details.locator('.mantine-Badge-root').count(),0,'Expanded details use plan names instead of duplicate pills');
  assert.equal(await details.getByRole('link',{name:'test@example.test',exact:true}).getAttribute('href'),'mailto:test@example.test');
}
async function verifyPlanColor(summary,plan){
  if(plan==='FREE')return;
  const color=await summary.getByText(plan,{exact:true}).evaluate(node=>getComputedStyle(node.closest('.mantine-Badge-root')).backgroundColor);
  const [red,green,blue]=color.match(/[\d.]+/g).map(Number);
  if(plan==='PRO')assert.ok(red>green && red>blue,`Professional summary pill is red: ${color}`);
  if(plan==='AGENCY')assert.ok(green>red && blue>red,`Agency summary pill is teal: ${color}`);
}
async function verifyPricing(session) {
  await page.getByRole('button',{name:'Settings',exact:true}).last().click();
  await page.getByRole('menuitem',{name:'Plans & Pricing',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Plans and Pricing'});
  await dialog.getByRole('heading',{name:'WP Suite Agency',exact:true}).waitFor();
  await dialog.getByText('Agency subscription through AWS Marketplace.',{exact:true}).waitFor();
  const cta=dialog.getByRole('link',{name:'Subscribe on AWS Marketplace',exact:true});
  assert.equal(await cta.getAttribute('href'),'https://aws.amazon.com/marketplace/pp/prodview-db6r5h44kydsa');
  assert.equal(await cta.getAttribute('target'),'_blank');
  assert.equal(await cta.getAttribute('rel'),'noopener noreferrer');
  const table=dialog.locator('stripe-pricing-table');
  assert.equal(await table.getAttribute('pricing-table-id'),'synthetic');
  assert.equal(await table.getAttribute('publishable-key'),'synthetic');
  assert.equal(await table.getAttribute('client-reference-id'),'workspace-free');
  assert.equal(await table.getAttribute('customer-session-client-secret'),session?'synthetic-session':null);
  assert.equal(await table.getAttribute('customer-email'),session?null:'test@example.test');
  assert.equal(await dialog.getByText(/coming soon/i).count(),0);
  await page.keyboard.press('Escape');
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}/`);await verifyIdentity('paid');
  for(const [target,id]of[['Free fixture','free'],['Paid fixture','paid']]){
    const before=pageLoads;await reconnect(target);await page.waitForFunction(id=>window.testSettings?.siteId===id,id);await verifyIdentity(id);assert(pageLoads>before);
    for(const field of ['reCaptchaPublicKey','useRecaptchaNet','useRecaptchaEnterprise','renderRecaptchaProvider'])assert.equal(persisted[field],initial[field]);
    assert(reads.some(r=>r.path.endsWith(`/${id}/settings`)&&r.key===`synthetic-${id}`));
    if(id==='free'){await verifyPricing(false);existingCustomer=true;await page.reload();await verifyIdentity('free');await verifyPricing(true);existingCustomer=false;}
  }
  await page.reload();await verifyIdentity('paid');
  for(const kind of ['http','network','non-json']){
    failure=kind;const before=pageLoads;await reconnect('Free fixture');
    await page.getByText('Error occured',{exact:true}).waitFor();
    assert.equal(pageLoads,before);assert.equal(persisted.siteId,'paid');assert.equal(await page.getByText('Settings saved',{exact:true}).count(),0);
    assert.equal(await page.evaluate(()=>window.testSettings.siteId),'paid');
    await page.getByRole('dialog',{name:'Connect Your Site'}).getByRole('button',{name:'Close',exact:true}).click();
    await page.reload();await verifyIdentity('paid');
  }
  failure=undefined;
  sites[0].siteKey='synthetic-rotated';const before=pageLoads;await reconnect('Paid fixture');
  await page.waitForFunction(()=>window.testSettings?.siteKey==='synthetic-rotated');assert(pageLoads>before);assert.equal(persisted.siteKey,'synthetic-rotated');
  // Cache refresh and disconnect share the save path and must surface failures.
  for (const action of ['Clear Cache','Disconnect']) {
    failure='http';const loadsBefore=pageLoads;
    await page.getByRole('button',{name:'Settings',exact:true}).last().click();
    await page.getByRole('menuitem',{name:action,exact:true}).click();
    if(action==='Disconnect')await page.getByRole('button',{name:'Yes, Disconnect',exact:true}).click();
    await page.getByText('Synthetic permission denied',{exact:true}).waitFor();
    assert.equal(pageLoads,loadsBefore);assert.equal(persisted.siteId,'paid');
    await page.reload();await verifyIdentity('paid');
  }
  failure=undefined;const cacheLoads=pageLoads;
  await page.getByRole('button',{name:'Settings',exact:true}).last().click();
  await page.getByRole('menuitem',{name:'Clear Cache',exact:true}).click();
  await page.waitForEvent('load');await verifyIdentity('paid');assert(pageLoads>cacheLoads);
  assert.equal(persisted.siteKey,'synthetic-rotated');
  await page.getByRole('button',{name:'Settings',exact:true}).last().click();
  await page.getByRole('menuitem',{name:'Disconnect',exact:true}).click();
  await page.getByRole('button',{name:'Yes, Disconnect',exact:true}).click();
  await page.waitForFunction(()=>window.testSettings && !window.testSettings.siteId);assert.equal(persisted.siteId,undefined);
  compactMode=true;
  for(const width of [1360,390]){
    await page.setViewportSize({width,height:1000});
    persisted={...initial};lookupDelay=700;
    await page.reload();
    const summary=page.getByRole('region',{name:'Site connection summary',exact:true});
    await summary.getByText('Checking plan',{exact:true}).waitFor();
    assert.equal(await summary.getByText('FREE',{exact:true}).count(),0,'Pending verification never labels a paid connection FREE');
    await summary.getByText('PRO',{exact:true}).waitFor();lookupDelay=0;
    await summary.getByText('Paid fixture · Synthetic workspace',{exact:true}).waitFor();
    assert.equal(await page.getByText('Account Information',{exact:true}).count(),0,'Connected compact summary hides account cards initially');
    assert.equal(await page.getByText('Site Details',{exact:true}).count(),0);
    assert.equal(await summary.getByRole('link',{name:'Platform Settings',exact:true}).count(),0,'Summary does not repeat Platform Settings navigation');
    await verifyPlanColor(summary,'PRO');
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),'Compact connected summary fits mobile and desktop');
    await page.screenshot({path:`/tmp/wpsuite-compact-connection-${width}.png`,fullPage:true});
    await expandConnection();
    await verifyConnectionDetails('Paid fixture','Professional');
    assert.equal(await page.getByText('Account Information',{exact:true}).count(),1);
    assert.equal(await page.getByRole('button',{name:'Sign Out',exact:true}).count(),1);
    await page.getByRole('button',{name:'Manage connection',exact:true}).click();
    assert.equal(await page.getByText('Account Information',{exact:true}).count(),0);
    for(const [target,id,plan]of[['Free fixture','free','FREE'],['Agency fixture','agency','AGENCY'],['Paid fixture','paid','PRO']]){
      await reconnect(target);
      await page.waitForFunction(id=>window.testSettings?.siteId===id,id);
      await summary.getByText(plan,{exact:true}).waitFor();
      await verifyPlanColor(summary,plan);
      await summary.getByText(`${target} · Synthetic workspace`,{exact:true}).waitFor();
      assert.equal(await page.getByText('Account Information',{exact:true}).count(),0,'Reload restores compact view using new identity');
      await expandConnection();
      await verifyConnectionDetails(target,id==='paid'?'Professional':id==='agency'?'Agency':'Free');
      await summary.getByRole('button',{name:'Manage connection',exact:true}).click();
    }
    lookupFailure=true;await page.reload();
    await summary.getByText('Plan unavailable',{exact:true}).waitFor();
    assert.equal(await summary.getByText('Unreachable',{exact:true}).count(),1);
    assert.equal(await summary.getByText('FREE',{exact:true}).count(),0,'Lookup failure is not a Free entitlement');
    lookupFailure=false;
    persisted={};await page.reload();
    await page.getByText('Account Information',{exact:true}).waitFor();
    assert.equal(await page.getByRole('region',{name:'Site connection summary',exact:true}).count(),0,'Disconnected mode retains full onboarding');
    assert.equal(await page.getByRole('button',{name:'Manage connection',exact:true}).count(),0);
  }
  assert.deepEqual(errors,[]);
  console.log('Reconnect browser regressions passed: same-workspace paid/free roundtrip, persistence, preserved settings, HTTP/network/non-JSON failures, key rotation, cache refresh, disconnect (including failure paths), native Agency CTA and both Stripe customer attribution modes; compact desktop/mobile paid/free/agency identity, separate Site/Workspace/Owner rows, plain detail plan names, red/teal summary pills, no duplicate status or Platform Settings link, expansion/collapse, loading/error plan honesty, overflow and disconnected onboarding.');
} finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
