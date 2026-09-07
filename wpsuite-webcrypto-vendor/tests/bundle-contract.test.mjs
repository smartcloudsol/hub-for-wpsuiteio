import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bundleUrl = new URL("../dist/webcrypto-vendor.min.js", import.meta.url);

function createContext(crypto) {
  const warnings = [];
  const context = {
    AbortSignal,
    ArrayBuffer,
    Headers,
    TextDecoder,
    TextEncoder,
    URL,
    Uint8Array,
    atob,
    btoa,
    console: {
      warn(message) {
        warnings.push(message);
      },
    },
    crypto,
    fetch,
    structuredClone,
  };

  return { context, warnings };
}

test("bundle contains JOSE without legacy cryptography shims", async () => {
  const source = await readFile(bundleUrl, "utf8");

  assert.doesNotMatch(source, /\belliptic\b/i);
  assert.doesNotMatch(source, /webcrypto-liner/i);
  assert.doesNotMatch(source, /asmCrypto/i);

  const nativeCrypto = { subtle: {} };
  const { context, warnings } = createContext(nativeCrypto);
  vm.runInNewContext(source, context);

  assert.equal(context.crypto, nativeCrypto);
  assert.equal(typeof context.WpSuiteJose.SignJWT, "function");
  assert.equal(
    context.WpSuiteJose.decodeJwt(
      "eyJhbGciOiJub25lIn0.eyJzdWIiOiJ3cHN1aXRlIn0.",
    ).sub,
    "wpsuite",
  );
  assert.equal(context.WpSuiteWebCryptoStatus.available, true);
  assert.equal(context.WpSuiteWebCryptoStatus.mode, "native-only");
  assert.equal(context.WpSuiteWebCryptoStatus.polyfilled, false);
  assert.deepEqual(warnings, []);
});

test("unsupported environments fail closed without installing crypto globals", async () => {
  const source = await readFile(bundleUrl, "utf8");
  const { context, warnings } = createContext(undefined);
  vm.runInNewContext(source, context);

  assert.equal(context.crypto, undefined);
  assert.equal(context.elliptic, undefined);
  assert.equal(context.asmCrypto, undefined);
  assert.equal(typeof context.WpSuiteJose.jwtVerify, "function");
  assert.equal(context.WpSuiteWebCryptoStatus.available, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /secure-context browser/);
});
