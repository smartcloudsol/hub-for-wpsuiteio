import { gcm } from "@noble/ciphers/aes.js";
import { p256 } from "@noble/curves/nist.js";
import * as joseNS from "jose";

export type WpSuiteWebCryptoStatus = Readonly<{
  available: boolean;
  mode: "native" | "noble-fallback" | "unavailable";
  polyfilled: boolean;
}>;

type PortableKeyMaterial =
  | Readonly<{ kind: "es256-public"; bytes: Uint8Array }>
  | Readonly<{ kind: "aes-gcm-secret"; bytes: Uint8Array }>;

const portableKeys = new WeakMap<object, PortableKeyMaterial>();

function unsupported(message: string): Error {
  const error = new Error(message);
  error.name = "NotSupportedError";
  return error;
}

function toBytes(value: BufferSource, label: string): Uint8Array {
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`${label} must be a BufferSource`);
}

function copyBytes(value: BufferSource, label: string): Uint8Array {
  return new Uint8Array(toBytes(value, label));
}

function decodeBase64Url(value: unknown, label: string): Uint8Array {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError(`${label} must be an unpadded base64url string`);
  }
  const remainder = value.length % 4;
  if (remainder === 1) throw new TypeError(`${label} is not valid base64url`);
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - remainder) % 4);
  const decoded = atob(base64);
  const result = new Uint8Array(decoded.length);
  for (let index = 0; index < decoded.length; index += 1) {
    result[index] = decoded.charCodeAt(index);
  }
  return result;
}

function algorithmName(algorithm: AlgorithmIdentifier): string {
  return typeof algorithm === "string" ? algorithm : algorithm.name;
}

function createPortableKey(
  material: PortableKeyMaterial,
  type: "public" | "secret",
  algorithm: KeyAlgorithm,
  extractable: boolean,
  usages: KeyUsage[],
): CryptoKey {
  const key = Object.freeze({
    algorithm: Object.freeze(algorithm),
    extractable,
    type,
    usages: Object.freeze([...usages]),
    [Symbol.toStringTag]: "CryptoKey",
  });
  portableKeys.set(key, material);
  return key as unknown as CryptoKey;
}

function validateUsages(usages: KeyUsage[], expected: KeyUsage): void {
  if (!Array.isArray(usages) || usages.length !== 1 || usages[0] !== expected) {
    throw new DOMException(`Only the ${expected} key usage is supported`, "SyntaxError");
  }
}

async function importPortableKey(
  format: KeyFormat,
  keyData: JsonWebKey | BufferSource,
  algorithm: AlgorithmIdentifier,
  extractable: boolean,
  keyUsages: KeyUsage[],
): Promise<CryptoKey> {
  const name = algorithmName(algorithm);

  if (format === "jwk" && name === "ECDSA") {
    const params = algorithm as EcKeyImportParams;
    const jwk = keyData as JsonWebKey;
    validateUsages(keyUsages, "verify");
    if (
      params.namedCurve !== "P-256" ||
      jwk.kty !== "EC" ||
      jwk.crv !== "P-256" ||
      typeof jwk.d === "string"
    ) {
      throw unsupported("Only public P-256 ECDSA JWK verification keys are supported");
    }
    if (jwk.use !== undefined && jwk.use !== "sig") {
      throw new DOMException('The JWK "use" member must be "sig"', "DataError");
    }
    if (jwk.key_ops !== undefined && !jwk.key_ops.includes("verify")) {
      throw new DOMException('The JWK "key_ops" member must include "verify"', "DataError");
    }

    const x = decodeBase64Url(jwk.x, "JWK x");
    const y = decodeBase64Url(jwk.y, "JWK y");
    if (x.length !== 32 || y.length !== 32) {
      throw new DOMException("P-256 JWK coordinates must be 32 bytes", "DataError");
    }
    const publicKey = new Uint8Array(65);
    publicKey[0] = 4;
    publicKey.set(x, 1);
    publicKey.set(y, 33);
    try {
      p256.Point.fromBytes(publicKey);
    } catch (cause) {
      throw new DOMException(`Invalid P-256 public key: ${String(cause)}`, "DataError");
    }

    return createPortableKey(
      Object.freeze({ kind: "es256-public", bytes: publicKey }),
      "public",
      { name: "ECDSA", namedCurve: "P-256" } as EcKeyAlgorithm,
      extractable,
      ["verify"],
    );
  }

  if (format === "raw" && name === "AES-GCM") {
    validateUsages(keyUsages, "decrypt");
    const bytes = copyBytes(keyData as BufferSource, "AES-GCM key");
    if (![16, 24, 32].includes(bytes.length)) {
      throw new DOMException("AES-GCM keys must be 128, 192, or 256 bits", "DataError");
    }
    return createPortableKey(
      Object.freeze({ kind: "aes-gcm-secret", bytes }),
      "secret",
      { name: "AES-GCM", length: bytes.length * 8 } as AesKeyAlgorithm,
      extractable,
      ["decrypt"],
    );
  }

  throw unsupported(`Unsupported importKey operation: ${format}/${name}`);
}

async function verifyPortable(
  algorithm: AlgorithmIdentifier,
  key: CryptoKey,
  signature: BufferSource,
  data: BufferSource,
): Promise<boolean> {
  const params = algorithm as EcdsaParams;
  const material = portableKeys.get(key as unknown as object);
  const hashName = typeof params.hash === "string" ? params.hash : params.hash?.name;
  if (
    algorithmName(algorithm) !== "ECDSA" ||
    hashName !== "SHA-256" ||
    material?.kind !== "es256-public"
  ) {
    throw unsupported("Only ES256 signature verification is supported");
  }

  const signatureBytes = copyBytes(signature, "ES256 signature");
  if (signatureBytes.length !== 64) return false;
  try {
    return p256.verify(signatureBytes, toBytes(data, "ES256 data"), material.bytes, {
      format: "compact",
      lowS: false,
      prehash: true,
    });
  } catch {
    return false;
  }
}

async function decryptPortable(
  algorithm: AlgorithmIdentifier,
  key: CryptoKey,
  data: BufferSource,
): Promise<ArrayBuffer> {
  const params = algorithm as AesGcmParams;
  const material = portableKeys.get(key as unknown as object);
  if (algorithmName(algorithm) !== "AES-GCM" || material?.kind !== "aes-gcm-secret") {
    throw unsupported("Only AES-GCM decryption is supported");
  }
  if ((params.tagLength ?? 128) !== 128) {
    throw unsupported("Only 128-bit AES-GCM authentication tags are supported");
  }

  const iv = copyBytes(params.iv, "AES-GCM IV");
  if (iv.length < 8) throw new DOMException("AES-GCM IV must be at least 8 bytes", "DataError");
  const additionalData = params.additionalData
    ? copyBytes(params.additionalData, "AES-GCM additional data")
    : undefined;
  const encrypted = copyBytes(data, "AES-GCM ciphertext");
  if (encrypted.length < 16) {
    throw new DOMException("AES-GCM ciphertext must include a 16-byte tag", "OperationError");
  }

  try {
    const clear = gcm(material.bytes, iv, additionalData).decrypt(encrypted);
    return clear.buffer.slice(clear.byteOffset, clear.byteOffset + clear.byteLength) as ArrayBuffer;
  } catch {
    throw new DOMException("AES-GCM authentication failed", "OperationError");
  }
}

function installPortableSubtleCrypto(): boolean {
  const cryptoObject = globalThis.crypto;
  if (!cryptoObject || !Object.isExtensible(cryptoObject)) return false;

  const subtle = Object.freeze({
    decrypt: decryptPortable,
    importKey: importPortableKey,
    verify: verifyPortable,
  });
  try {
    Object.defineProperty(cryptoObject, "subtle", {
      value: subtle,
      writable: false,
      configurable: true,
    });
    return cryptoObject.subtle === (subtle as unknown as SubtleCrypto);
  } catch {
    return false;
  }
}

const jose = joseNS as typeof joseNS;
const nativeAvailable = Boolean(globalThis.crypto?.subtle);
const fallbackInstalled = !nativeAvailable && installPortableSubtleCrypto();
const available = nativeAvailable || fallbackInstalled;
const status: WpSuiteWebCryptoStatus = Object.freeze({
  available,
  mode: nativeAvailable ? "native" : fallbackInstalled ? "noble-fallback" : "unavailable",
  polyfilled: fallbackInstalled,
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
    "[WpSuite] Web Crypto is unavailable. WP Suite cryptographic operations require native Web Crypto or the portable fallback.",
  );
}

export { jose, status };
