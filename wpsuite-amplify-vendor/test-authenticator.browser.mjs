/** Exercise the built WordPress global, real Authenticator and SDK against a synthetic Cognito transport. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const vendor = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(vendor, "../..");
const requireVendor = createRequire(path.join(vendor, "package.json"));
const { build } = requireVendor("esbuild");
const { chromium } = createRequire(path.join(workspace, "console/package.json"))("playwright");
const bundle = path.resolve(process.argv.slice(2).find(arg => !arg.startsWith("--")) || path.join(vendor, "dist/amplify-vendor.min.js"));
const expectMissing = process.argv.includes("--expect-missing");
const defaultHandler = process.argv.includes("--default-handler");
const email = process.argv.includes("--email");
const preference = process.argv.includes("--remember") ? "on" : "hidden";
const temp = await mkdtemp(path.join(tmpdir(), "wpsuite-mfa-"));
let browser;
try {
  await build({
    stdin: {
      contents: `import React from 'react'; import * as ReactDOM from 'react-dom'; import * as ReactJSXRuntime from 'react/jsx-runtime';
        Object.assign(window, {React, ReactDOM, ReactJSXRuntime});`,
      resolveDir: vendor,
    },
    bundle: true, platform: "browser", format: "iife",
    define: { "process.env.NODE_ENV": '"production"' },
    outfile: path.join(temp, "react.js"),
  });
  // The auth module is externalized exactly as in Gatey's WordPress webpack build.
  await build({
    stdin: {
      contents: `import {confirmSignIn, rememberDevice, forgetDevice} from 'aws-amplify/auth';
        import {confirmSignInWithDevicePreference} from ${JSON.stringify(path.join(workspace, "gatey/blocks/src/authenticator/confirm-sign-in.ts"))};
        const A = window.WpSuiteAmplify;
        window.authExports = Object.fromEntries(['confirmSignIn','rememberDevice','forgetDevice'].map(name=>[name,typeof A[name]]));
        A.Amplify.configure({Auth:{Cognito:{userPoolId:'eu-central-1_fixture',userPoolClientId:'fixtureclient'}}});
        window.ReactDOM.createRoot(document.getElementById('root')).render(window.React.createElement(A.Authenticator, {
          loginMechanisms:['username'],hideSignUp:true,
          services:${defaultHandler ? "{}" : `{handleConfirmSignIn:(input)=>confirmSignInWithDevicePreference({...input,options:{...input.options,rememberDevice:${JSON.stringify(preference)}}},{confirm:confirmSignIn,remember:rememberDevice,forget:forgetDevice})}`}
        },()=>window.React.createElement('p',{'data-signed-in':true},'Signed in')));`,
      resolveDir: vendor,
    },
    bundle: true, platform: "browser", format: "iife", minify: true,
    plugins: [{ name: "wordpress-auth-external", setup(build) {
      build.onResolve({ filter: /^aws-amplify\/auth$/ }, () => ({ path: "auth", namespace: "wp-global" }));
      build.onLoad({ filter: /.*/, namespace: "wp-global" }, () => ({ contents: "module.exports=window.WpSuiteAmplify" }));
    }}],
    outfile: path.join(temp, "fixture.js"),
  });
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  const page = await browser.newPage();
  page.setDefaultTimeout(10000);
  const requests = [], errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.hostname === "fixture.test") {
      const assets = { "/react.js": path.join(temp,"react.js"), "/vendor.js": bundle, "/fixture.js": path.join(temp,"fixture.js") };
      return route.fulfill(assets[url.pathname]
        ? { body: await readFile(assets[url.pathname]), contentType: "text/javascript" }
        : { body: '<!doctype html><div id="root"></div><script src="/react.js"></script><script src="/vendor.js"></script><script src="/fixture.js"></script>', contentType: "text/html" });
    }
    if (url.hostname === "cognito-idp.eu-central-1.amazonaws.com") {
      const operation = request.headers()["x-amz-target"]?.split(".").at(-1);
      const body = request.postDataJSON();
      requests.push({ operation, challenge: body.ChallengeName });
      const challenge = email ? "EMAIL_OTP" : "SOFTWARE_TOKEN_MFA";
      if (operation === "InitiateAuth") return route.fulfill({ json: { ChallengeName: challenge, Session: "synthetic-session", ChallengeParameters: { USER_ID_FOR_SRP: "fixture", CODE_DELIVERY_DESTINATION:"f***@example.test", CODE_DELIVERY_DELIVERY_MEDIUM:"EMAIL" } } });
      if (operation === "RespondToAuthChallenge") {
        assert.equal(body.ChallengeName, challenge);
        const code = body.ChallengeResponses[email ? "EMAIL_OTP_CODE" : "SOFTWARE_TOKEN_MFA_CODE"];
        assert.ok(["111111","123456"].includes(code));
        if (code === "111111") return route.fulfill({ status:400, json:{ __type:"CodeMismatchException", message:"Synthetic invalid code" } });
        // Test-only tokens, issued only by this intercepted transport. No real account or credentials.
        const token = use => [Buffer.from(JSON.stringify({alg:"RS256",typ:"JWT"})).toString("base64url"), Buffer.from(JSON.stringify({sub:"synthetic-sub",username:"fixture","cognito:username":"fixture",token_use:use,iss:"https://cognito-idp.eu-central-1.amazonaws.com/eu-central-1_fixture",aud:"fixtureclient",exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000)})).toString("base64url"),"synthetic"].join(".");
        return route.fulfill({json:{AuthenticationResult:{AccessToken:token("access"),IdToken:token("id"),RefreshToken:"synthetic-refresh",ExpiresIn:3600,TokenType:"Bearer"}}});
      }
      if (operation === "GetUser") return route.fulfill({json:{Username:"fixture",UserAttributes:[{Name:"sub",Value:"synthetic-sub"}]}});
    }
    throw new Error(`Unexpected transport ${url.origin}${url.pathname}`);
  });
  await page.goto("https://fixture.test/");
  const exports = await page.evaluate(() => window.authExports);
  assert.deepEqual(exports, Object.fromEntries(["confirmSignIn", "rememberDevice", "forgetDevice"].map(name => [name, expectMissing ? "undefined" : "function"])));
  await page.getByRole("textbox", {name:"Username",exact:true}).fill("fixture");
  await page.getByLabel("Password",{exact:true}).fill("SyntheticOnly123!");
  await page.getByRole("button",{name:"Sign in",exact:true}).click();
  await page.getByRole("textbox",{name:/Code/}).fill("111111");
  await page.getByRole("button",{name:/Confirm/}).click();
  await page.getByText(expectMissing && !defaultHandler ? /confirm is not a function/ : "Synthetic invalid code",{exact:!expectMissing || defaultHandler}).waitFor();
  if (!expectMissing || defaultHandler) {
    await page.getByRole("textbox",{name:/Code/}).fill("123456");
    await page.getByRole("button",{name:/Confirm/}).click();
    await page.locator("[data-signed-in]").waitFor();
  }
  assert.equal(requests.filter(item=>item.operation==="RespondToAuthChallenge").length, expectMissing && !defaultHandler ? 0 : 2);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ bundle, expectMissing, defaultHandler, email, preference, exports, requests, pageErrors:errors, result:"PASS" },null,2));
} finally {
  await browser?.close();
  await rm(temp,{recursive:true,force:true});
}
