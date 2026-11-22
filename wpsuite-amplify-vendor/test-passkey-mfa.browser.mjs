/** Real built vendor and Cognito SDK against intercepted, synthetic-only Cognito transports. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const vendor = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(vendor, '../..');
const { build } = createRequire(path.join(vendor, 'package.json'))('esbuild');
const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE_JSON || path.join(workspace, 'console/package.json'))('playwright');
const bundle = path.resolve(process.argv[2] || path.join(vendor, 'dist/amplify-vendor.min.js'));
const sdk = process.argv[3] && path.resolve(process.argv[3]);
const dir = await mkdtemp(path.join(tmpdir(), 'passkey-mfa-browser-'));
let browser;
try {
  await build({ stdin: { contents: `import React from 'react'; import * as ReactDOM from 'react-dom'; import * as ReactJSXRuntime from 'react/jsx-runtime'; Object.assign(window,{React,ReactDOM,ReactJSXRuntime});`, resolveDir: vendor }, bundle:true, platform:'browser', format:'iife', define:{'process.env.NODE_ENV':'"production"'}, outfile:path.join(dir,'react.js') });
  await build({ stdin: { contents: `
    import {createGateyWebAuthnMfaServices} from ${JSON.stringify(path.join(workspace, "gatey/core/src/web-authn-mfa.ts"))};
    const A=window.WpSuiteAmplify;
    window.fixtureProfile={id:'production',generation:1};
    window.fixtureHasPasskey=!new URLSearchParams(location.search).has('empty');
    A.Amplify.configure({Auth:{Cognito:{userPoolId:'eu-central-1_fixture',userPoolClientId:'fixtureclient',identityPoolId:'eu-central-1:11111111-1111-1111-1111-111111111111'}}});
    const R=window.React;
    window.mount=(missing=false)=>{ if(missing) window.WpSuiteAmplify={...A,getWebAuthnMfaCapability:undefined}; (window.fixtureRoot=window.ReactDOM.createRoot(document.getElementById('root'))).render(R.createElement(R.StrictMode,null,R.createElement(A.Authenticator.Provider,null,R.createElement(A.Authenticator,{initialState:new URLSearchParams(location.search).has('totp')?'setupTotp':'passkeySettings',forceInitialState:true,services:{...createGateyWebAuthnMfaServices(),handleAssociateWebAuthnCredential:async()=>{window.fixtureHasPasskey=true;}}})))); };
    window.mount(new URLSearchParams(location.search).has('missing'));
  `, resolveDir:vendor },bundle:true,platform:'browser',format:'iife',minify:true, plugins:[{name:'fixture-externals',setup(b){ b.onResolve({filter:/^(aws-amplify|@smart-cloud\/wpsuite-core)$/}, args=>({path:args.path,namespace:'fixture'})); b.onLoad({filter:/.*/,namespace:'fixture'}, args=>({contents:args.path==='aws-amplify' ? 'module.exports=window.WpSuiteAmplify' : 'exports.getBackendProfileContext=()=>window.fixtureProfile; exports.assertBackendProfileCurrent=()=>{}'})); }}],outfile:path.join(dir,'fixture.js') });
  browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,args:['--no-sandbox']});
  const results=[];
  for (const mode of ['supported','unsupported','denied','missing','changed','empty','remove','no-totp','totp','on','unknown','readfail','cancel']) {
    const page=await browser.newPage();
    page.setDefaultTimeout(8000);
    const events=[], errors=[];
    let reads=0, failFirst=true, enabled=mode==='on', hasTotp=mode!=='no-totp' && mode!=='totp', hasPasskey=mode!=='empty';
    page.on('pageerror',e=>errors.push(e.name));
    await page.addInitScript(() => {
      const enc = obj => btoa(JSON.stringify(obj)).replace(/=/g,'').replace(/\+/g,'-').replace(/\//g,'_');
      const common={sub:'synthetic-sub',username:'fixture','cognito:username':'fixture',iss:'https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_fixture',exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)};
      const token=(use)=>[enc({alg:'RS256',typ:'JWT'}),enc({...common,token_use:use,...(use==='access'?{client_id:'fixtureclient',scope:'aws.cognito.signin.user.admin'}:{aud:'fixtureclient'})}),'synthetic'].join('.');
      const prefix='CognitoIdentityServiceProvider.fixtureclient.';
      localStorage.setItem(prefix+'LastAuthUser','fixture');
      localStorage.setItem(prefix+'fixture.accessToken',token('access'));
      localStorage.setItem(prefix+'fixture.idToken',token('id'));
      localStorage.setItem(prefix+'fixture.refreshToken','synthetic-refresh');
      localStorage.setItem(prefix+'fixture.clockDrift','0');
    });
    await page.route('**/*',async route=>{
      const req=route.request(), url=new URL(req.url());
      if(url.hostname==='fixture.test') {
        const asset={'/react.js':path.join(dir,'react.js'),'/sdk.js':sdk,'/vendor.js':bundle,'/fixture.js':path.join(dir,'fixture.js')}[url.pathname];
        const scripts = ['/react.js', ...(sdk ? ['/sdk.js'] : []), '/vendor.js', '/fixture.js'];
        return route.fulfill(asset ? {body:await readFile(asset),contentType:'text/javascript'} : {
          body:'<!doctype html><div id="root"></div>' + scripts.map(src => `<script src="${src}"></script>`).join(''),
          contentType:'text/html',
        });
      }
      const operation=req.headers()['x-amz-target']?.split('.').at(-1);
      if(url.hostname==='cognito-identity.eu-central-1.amazonaws.com') {
        events.push({operation});
        if(operation==='GetId') return route.fulfill({json:{IdentityId:'eu-central-1:22222222-2222-2222-2222-222222222222'}});
        if(operation==='GetCredentialsForIdentity') return route.fulfill({json:{IdentityId:'eu-central-1:22222222-2222-2222-2222-222222222222',Credentials:{AccessKeyId:'SYNTHETICACCESSKEY',SecretKey:'synthetic-secret-key',SessionToken:'synthetic-session-token',Expiration:Math.floor(Date.now()/1000)+3600}}});
      }
      if(url.hostname==='cognito-idp.eu-central-1.amazonaws.com') {
        const body=req.postDataJSON();
        if(operation==='GetUserPoolMfaConfig') {
          const signed=/^AWS4-HMAC-SHA256 /.test(req.headers().authorization || '');
          events.push({operation,signed}); assert.ok(signed);
          if(mode==='changed') await page.evaluate(()=>{ window.fixtureProfile={id:'development',generation:2}; });
          if(mode==='denied') return route.fulfill({status:400,json:{__type:'AccessDeniedException',message:'Synthetic denial'}});
          return route.fulfill({json:{MfaConfiguration:'OPTIONAL',WebAuthnConfiguration:{FactorConfiguration:mode==='unsupported'?'SINGLE_FACTOR':'MULTI_FACTOR_WITH_USER_VERIFICATION',UserVerification:'preferred'}}});
        }
        if(operation==='GetUser') { events.push({operation}); reads++; if(mode==='cancel' && reads>1) { await page.evaluate(()=>window.fixtureRoot.unmount()); await new Promise(resolve=>setTimeout(resolve,200)); } if(mode==='readfail') return route.fulfill({status:400,json:{__type:'AccessDeniedException'}}); return route.fulfill({json:{Username:'fixture',UserAttributes:[{Name:'sub',Value:'synthetic-sub'}],UserMFASettingList:[...(hasTotp?['SOFTWARE_TOKEN_MFA']:[]),...(enabled?['WEB_AUTHN_MFA']:[]),...(mode==='unknown'?['FUTURE_MFA']:[])],...(hasTotp?{PreferredMfaSetting:'SOFTWARE_TOKEN_MFA'}:{})}}); }
        if(operation==='ListWebAuthnCredentials') {events.push({operation}); hasPasskey=hasPasskey || await page.evaluate(()=>window.fixtureHasPasskey); return route.fulfill({json:{Credentials:hasPasskey?[{CredentialId:'fixture-credential',FriendlyCredentialName:'Fixture passkey',CreatedAt:1700000000,RelyingPartyId:'fixture.test',AuthenticatorAttachment:'PLATFORM',AuthenticatorTransports:['INTERNAL']}]:[]}});}
        if(operation==='DeleteWebAuthnCredential') {events.push({operation}); hasPasskey=false; await page.evaluate(()=>{window.fixtureHasPasskey=false;}); return route.fulfill({json:{}});}
        if(operation==='AssociateSoftwareToken') {events.push({operation}); return route.fulfill({json:{SecretCode:'JBSWY3DPEHPK3PXP'}});}
        if(operation==='VerifySoftwareToken') {events.push({operation}); return route.fulfill({json:{Status:'SUCCESS'}});}
        if(operation==='SetUserMFAPreference') {
          if(mode==='totp' && body.SoftwareTokenMfaSettings) { assert.deepEqual(Object.keys(body).sort(),['AccessToken','SoftwareTokenMfaSettings']); events.push({operation:'SetTotpPreference'}); hasTotp=true; return route.fulfill({json:{}}); }
          assert.deepEqual(Object.keys(body).sort(),['AccessToken','SoftwareTokenMfaSettings','WebAuthnMfaSettings']);
          assert.deepEqual(body.SoftwareTokenMfaSettings,{Enabled:true,PreferredMfa:true});
          assert.equal(events.at(-1)?.operation,'GetUser');
          assert.deepEqual(Object.keys(body.WebAuthnMfaSettings),['Enabled']);
          events.push({operation,enabled:body.WebAuthnMfaSettings.Enabled});
          if(failFirst) {failFirst=false;return route.fulfill({status:400,json:{__type:'InvalidParameterException',message:'Synthetic failure'}});}
          enabled=body.WebAuthnMfaSettings.Enabled;
          return route.fulfill({json:{}});
        }
      }
      events.push({operation:operation || 'unexpected'});
      return route.fulfill({status:500,json:{message:'Unexpected synthetic request'}});
    });
    await page.goto(`https://fixture.test/${['missing','empty','totp'].includes(mode)?'?'+mode:''}`);
    if(mode!=='totp') await page.getByRole('button',{name:'Add a passkey'}).waitFor();
    const enable=page.getByRole('button',{name:'Enable passkey MFA'});
    if(mode==='supported') {
      await enable.waitFor(); await enable.isEnabled().then(assert.ok);
      await page.getByText('Passkey MFA is disabled.',{exact:true}).waitFor();
      assert.equal(events.filter(e=>e.operation==='SetUserMFAPreference').length,0);
      await enable.click();
      await page.getByText(/could not|unable|failed/i).first().waitFor();
      await enable.click();
      await page.getByText('Passkey MFA is enabled.',{exact:true}).waitFor();
      await page.getByRole('button',{name:'Disable passkey MFA'}).click();
      await page.getByText('Passkey MFA is disabled.',{exact:true}).waitFor();
      assert.deepEqual(events.filter(e=>e.operation==='SetUserMFAPreference').map(e=>e.enabled),[true,true,false]);
    } else if(mode==='cancel') {
      await enable.waitFor(); await enable.click(); await page.waitForTimeout(500);
      assert.ok(reads>1); assert.equal(events.filter(e=>e.operation==='SetUserMFAPreference').length,0);
    } else if(mode==='on') {
      await page.getByRole('button',{name:'Disable passkey MFA'}).waitFor();
      await page.getByText('Passkey MFA is enabled.',{exact:true}).waitFor();
      assert.equal(events.filter(e=>e.operation==='SetUserMFAPreference').length,0);
    } else if(mode==='unknown' || mode==='readfail') {
      await page.waitForTimeout(500);
      assert.equal(events.filter(e=>e.operation==='SetUserMFAPreference').length,0);
      await page.getByText('The current passkey MFA setting is unknown.').waitFor();
      if(mode==='unknown') { await enable.click(); await page.getByText(/could not|unable|failed/i).first().waitFor(); assert.equal(events.filter(e=>e.operation==='SetUserMFAPreference').length,0); }
    } else if(mode==='empty') {
      await enable.waitFor(); assert.equal(await enable.isEnabled(),false);
      await page.getByRole('button',{name:'Add a passkey'}).click();
      await page.getByRole('button',{name:'Create a Passkey'}).click();
      await page.getByText('Passkey created successfully!').waitFor();
      await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Enable passkey MFA' && !b.disabled));
      assert.equal(await enable.isEnabled(),true);
      assert.equal(events.filter(e=>e.operation==='SetUserMFAPreference').length,0);
    } else if(mode==='remove') {
      await enable.waitFor(); assert.equal(await enable.isEnabled(),true);
      await page.getByRole('button',{name:'Remove',exact:true}).click();
      await page.getByRole('button',{name:'Remove',exact:true}).last().click();
      await page.getByText('Passkey removed.').waitFor();
      await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Enable passkey MFA' && b.disabled));
      assert.equal(events.filter(e=>e.operation==='SetUserMFAPreference').length,0);
    } else if(mode==='no-totp') {
      await enable.waitFor(); assert.equal(await enable.isEnabled(),false);
      assert.equal(events.filter(e=>e.operation==='SetUserMFAPreference').length,0);
    } else if(mode==='totp') {
      await page.getByLabel('Code').fill('123456');
      await page.getByRole('button',{name:'Confirm',exact:true}).click();
      await page.getByText('Authenticator setup completed.').waitFor();
      await enable.waitFor(); assert.equal(await enable.isEnabled(),true);
      assert.equal(events.filter(e=>e.operation==='SetTotpPreference').length,1);
      assert.equal(events.filter(e=>e.operation==='SetUserMFAPreference').length,0);
    } else {
      await page.waitForTimeout(800);
      assert.equal(await enable.count(),0);
      assert.equal(events.filter(e=>e.operation==='SetUserMFAPreference').length,0);
    }
    assert.equal(events.filter(e=>/RegisterWebAuthn|StartWebAuthn/.test(e.operation)).length,0);
    assert.deepEqual(errors,[]);
    results.push({mode,events}); await page.close();
  }
  console.log(JSON.stringify({result:'PASS',results},null,2));
} finally { await browser?.close(); await rm(dir,{recursive:true,force:true}); }
