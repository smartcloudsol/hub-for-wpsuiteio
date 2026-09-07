import * as joseNS from "jose";

export type WpSuiteWebCryptoStatus = Readonly<{
  available: boolean;
  mode: "native-only";
  polyfilled: false;
}>;

const jose = joseNS as typeof joseNS;
const available = Boolean(globalThis.crypto?.subtle);
const status: WpSuiteWebCryptoStatus = Object.freeze({
  available,
  mode: "native-only",
  polyfilled: false,
});

Object.defineProperty(globalThis, "WpSuiteJose", {
  value: jose,
  writable: false,
  configurable: false,
});

Object.defineProperty(globalThis, "WpSuiteWebCryptoStatus", {
  value: status,
  writable: false,
  configurable: false,
});

if (!available) {
  console.warn(
    "[WpSuite] Native Web Crypto is unavailable. WP Suite cryptographic operations require a supported secure-context browser.",
  );
}

export { jose, status };
