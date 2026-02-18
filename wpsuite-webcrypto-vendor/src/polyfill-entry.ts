import * as asmCryptoNS from "asmcrypto.js";
import * as ellipticNS from "elliptic";
import * as joseNS from "jose";

/**
 * NOTE:
 * - We MUST set globalThis.asmCrypto and globalThis.elliptic BEFORE loading webcrypto-liner's shim.
 * - Static ESM imports execute dependencies first, so the shim must be loaded via dynamic import.
 */

const asmCrypto: any = asmCryptoNS as any;
const elliptic: any = (ellipticNS as any).default ?? (ellipticNS as any);
const jose: any = joseNS as any;

// Expose JOSE for consumers that externalize it in their webpack builds.
Object.defineProperty(globalThis, "WpSuiteJose", {
  value: jose,
  writable: false,
  configurable: false,
});

(async () => {
  // Only polyfill in non-secure contexts where crypto.subtle is missing.
  if (globalThis.crypto?.subtle) return;

  Object.defineProperty(globalThis, "asmCrypto", {
    value: asmCrypto,
    writable: false,
    configurable: false,
  });

  Object.defineProperty(globalThis, "elliptic", {
    value: elliptic,
    writable: false,
    configurable: false,
  });

  await import(
    /* webpackMode: "eager" */ "webcrypto-liner/build/webcrypto-liner.shim.js"
  );

  if (!globalThis.crypto?.subtle) {
    console.warn(
      "[WpSuite] WebCrypto polyfill did not initialize crypto.subtle",
    );
  }
})();
