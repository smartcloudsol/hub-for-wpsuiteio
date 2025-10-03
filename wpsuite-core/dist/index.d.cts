declare const deobfuscate: (blob: string, key: number) => string;
declare const decryptData: (encryptedText: string, salt: number) => Promise<Record<string, unknown> | undefined>;

declare global {
    const WpSuite: WpSuite;
}
declare const TEXT_DOMAIN = "hub-for-wpsuiteio";
interface SiteSettings {
    accountId?: string;
    siteId?: string;
    lastUpdate?: number;
    subscriber?: boolean;
    siteKey?: string;
}
interface WpSuite {
    siteSettings: SiteSettings;
    nonce: string;
    restUrl: string;
    uploadUrl: string;
    view: "connect" | "diagnostics";
}
type SubscriptionType = "PROFESSIONAL" | "AGENCY";
declare const getConfig: (plugin: string) => Promise<Record<string, unknown> | null>;

export { type SiteSettings, type SubscriptionType, TEXT_DOMAIN, WpSuite, decryptData, deobfuscate, getConfig };
