import "asmcrypto.js";
import "elliptic";
import "webcrypto-liner/build/webcrypto-liner.shim.js";

if (!globalThis.crypto?.subtle) {
  console.warn("[WpSuite] WebCrypto polyfill did not initialize crypto.subtle");
}
