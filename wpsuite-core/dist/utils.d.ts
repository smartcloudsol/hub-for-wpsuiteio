export declare function b64uToBytes(b64u: string): Uint8Array<ArrayBuffer>;
export declare const deobfuscate: (blob: string, key: number) => string;
export declare const decryptData: (encryptedText: string, salt: number) => Promise<Record<string, unknown> | undefined>;
export type RecaptchaFunction = (reCaptchaSiteKey: string, options: {
    action: string;
}) => Promise<string | undefined>;
export declare const getRecaptcha: (useRecaptchaEnterprise: boolean) => Promise<{
    execute: RecaptchaFunction | undefined;
}>;
