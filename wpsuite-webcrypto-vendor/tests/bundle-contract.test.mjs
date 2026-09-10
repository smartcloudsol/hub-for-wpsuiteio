import assert from "node:assert/strict";
import {
  createCipheriv,
  generateKeyPairSync,
  randomBytes,
  sign as signData,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const bundleUrl = new URL("../dist/webcrypto-vendor.min.js", import.meta.url);

function createContext(crypto) {
  const warnings = [];
  const context = {
    AbortSignal,
    ArrayBuffer,
    DOMException,
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
  assert.equal(context.WpSuiteWebCryptoStatus.mode, "native");
  assert.equal(context.WpSuiteWebCryptoStatus.polyfilled, false);
  assert.deepEqual(warnings, []);
});

function encodeBase64Url(value) {
  return Buffer.from(value).toString("base64url");
}

test("insecure contexts verify ES256 and decrypt AES-GCM with the narrow fallback", async () => {
  const source = await readFile(bundleUrl, "utf8");
  const insecureCrypto = {};
  const { context, warnings } = createContext(insecureCrypto);
  vm.runInNewContext(source, context);

  assert.equal(context.crypto, insecureCrypto);
  assert.equal(context.WpSuiteWebCryptoStatus.available, true);
  assert.equal(context.WpSuiteWebCryptoStatus.mode, "noble-fallback");
  assert.equal(context.WpSuiteWebCryptoStatus.polyfilled, true);
  assert.equal(typeof context.crypto.subtle.importKey, "function");
  assert.equal(typeof context.crypto.subtle.verify, "function");
  assert.equal(typeof context.crypto.subtle.decrypt, "function");
  assert.deepEqual(warnings, []);

  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const publicJwk = publicKey.export({ format: "jwk" });
  const protectedHeader = encodeBase64Url(JSON.stringify({ alg: "ES256" }));
  const payload = encodeBase64Url(
    JSON.stringify({ domain: "wpsuite.local", subscriptionType: "PROFESSIONAL" }),
  );
  const signingInput = `${protectedHeader}.${payload}`;
  const signature = signData("sha256", Buffer.from(signingInput), {
    key: privateKey,
    dsaEncoding: "ieee-p1363",
  });
  const token = `${signingInput}.${encodeBase64Url(signature)}`;
  const verificationKey = await context.WpSuiteJose.importJWK(publicJwk, "ES256");
  const verified = await context.WpSuiteJose.jwtVerify(token, verificationKey, {
    algorithms: ["ES256"],
  });
  assert.equal(verified.payload.domain, "wpsuite.local");
  assert.equal(verified.payload.subscriptionType, "PROFESSIONAL");

  const tamperedSignature = Buffer.from(signature);
  tamperedSignature[0] ^= 1;
  await assert.rejects(
    context.WpSuiteJose.jwtVerify(
      `${signingInput}.${encodeBase64Url(tamperedSignature)}`,
      verificationKey,
      { algorithms: ["ES256"] },
    ),
    /signature verification failed/i,
  );

  const aesKey = randomBytes(32);
  const iv = randomBytes(12);
  const plaintext = Buffer.from('{"region":"eu-central-1"}');
  const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const encrypted = Buffer.concat([ciphertext, cipher.getAuthTag()]);
  const decryptionKey = await context.crypto.subtle.importKey(
    "raw",
    new Uint8Array(aesKey),
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );
  const clear = await context.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(iv) },
    decryptionKey,
    new Uint8Array(encrypted),
  );
  assert.equal(Buffer.from(clear).toString(), plaintext.toString());

  const tamperedCiphertext = new Uint8Array(encrypted);
  tamperedCiphertext[tamperedCiphertext.length - 1] ^= 1;
  await assert.rejects(
    context.crypto.subtle.decrypt(
      { name: "AES-GCM", iv: new Uint8Array(iv) },
      decryptionKey,
      tamperedCiphertext,
    ),
    /authentication failed/i,
  );
});

test("environments without a crypto object fail closed", async () => {
  const source = await readFile(bundleUrl, "utf8");
  const { context, warnings } = createContext(undefined);
  vm.runInNewContext(source, context);

  assert.equal(context.crypto, undefined);
  assert.equal(context.elliptic, undefined);
  assert.equal(context.asmCrypto, undefined);
  assert.equal(typeof context.WpSuiteJose.jwtVerify, "function");
  assert.equal(context.WpSuiteWebCryptoStatus.available, false);
  assert.equal(context.WpSuiteWebCryptoStatus.mode, "unavailable");
  assert.equal(context.WpSuiteWebCryptoStatus.polyfilled, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /native Web Crypto or the portable fallback/);
});
