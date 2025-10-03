declare global {
  const WpSuite: WpSuite;
}

export const TEXT_DOMAIN = "hub-for-wpsuiteio";

export interface SiteSettings {
  accountId?: string;
  siteId?: string;
  lastUpdate?: number;
  subscriber?: boolean;
  siteKey?: string;
}

export interface WpSuite {
  siteSettings: SiteSettings;
  nonce: string;
  restUrl: string;
  uploadUrl: string;
  view: "connect" | "diagnostics";
}

export type SubscriptionType = "PROFESSIONAL" | "AGENCY";

export const getConfig = async (
  plugin: string
): Promise<Record<string, unknown> | null> => {
  const configLoader = await import(
    __WPSUITE_PREMIUM__ ? "./paid-features/config" : "./free-features/config"
  );
  let config = await configLoader.getConfig();
  if (config) {
    config = { ...config[plugin], subscriptionType: config.subscriptionType };
  }
  return config;
};

export { deobfuscate, decryptData } from "./utils";
