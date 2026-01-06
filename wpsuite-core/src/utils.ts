export function b64uToBytes(b64u: string) {
  let b64 = b64u.replace(/-/g, "+").replace(/_/g, "/");
  while (b64.length % 4) b64 += "=";
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

const createKey = async (salt: number): Promise<CryptoKey> => {
  const k = deobfuscate(
    "emUgRnVEemN0U1BhUXB3amlxc1h0dm9JQklUbXh5Z2YaSRZeZ2EABH5lZgU=",
    salt
  );
  const keyBuffer = Uint8Array.from(atob(k), (c) => c.charCodeAt(0));
  return window.crypto.subtle.importKey(
    "raw",
    keyBuffer,
    { name: "AES-CBC", length: 256 },
    false,
    ["decrypt"]
  );
};

export const deobfuscate = (blob: string, key: number): string => {
  const bytes = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
  const plain = bytes.map((b, i) => b ^ ((key + i) & 0xff));
  return new TextDecoder().decode(plain);
};

export const decryptData = async (
  encryptedText: string,
  salt: number
): Promise<Record<string, unknown> | undefined> => {
  if (encryptedText === "") {
    return Promise.resolve({} as Record<string, unknown>);
  }
  try {
    const [ivBase64, encryptedBase64] = encryptedText.split(":");
    const key = await createKey(salt);
    const iv = new Uint8Array(
      atob(ivBase64)
        .split("")
        .map((c) => c.charCodeAt(0))
    );
    const encryptedData = new Uint8Array(
      atob(encryptedBase64)
        .split("")
        .map((c) => c.charCodeAt(0))
    );
    const decrypted = await window.crypto.subtle.decrypt(
      { name: "AES-CBC", iv },
      key,
      encryptedData
    );
    return JSON.parse(new TextDecoder().decode(decrypted));
  } catch (err) {
    console.error(err);
    return undefined;
  }
};

export type RecaptchaFunction = (
  reCaptchaSiteKey: string,
  options: { action: string }
) => Promise<string | undefined>;

export const getRecaptcha = async (
  useRecaptchaEnterprise: boolean
): Promise<{ execute: RecaptchaFunction | undefined }> => {
  // Support both Enterprise and standard grecaptcha.
  type GrecaptchaLike = {
    ready?: (cb: () => void) => void;
    execute?: (siteKey: string, opts: { action: string }) => Promise<string>;
    enterprise?: {
      ready?: (cb: () => void) => void;
      execute?: (siteKey: string, opts: { action: string }) => Promise<string>;
    };
  };

  const grecaptcha = (globalThis as unknown as { grecaptcha?: GrecaptchaLike })
    .grecaptcha;
  const enterprise = useRecaptchaEnterprise
    ? grecaptcha?.enterprise
    : undefined;
  const ready = enterprise?.ready ?? grecaptcha?.ready;
  const execute = enterprise?.execute ?? grecaptcha?.execute;

  if (typeof execute !== "function") return { execute: undefined };

  try {
    if (typeof ready === "function") {
      await new Promise<void>((resolve) => ready(() => resolve()));
    }
    return { execute };
  } catch {
    return { execute: undefined };
  }
};
