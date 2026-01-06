declare global {
  var WpSuite: WpSuiteGlobal | undefined;
}

export type WpSuiteView = "connect" | "diagnostics";

export type PluginStatus =
  | "unavailable"
  | "initializing"
  | "available"
  | "error";

export type PluginAvailability = Omit<PluginStatus, "initializing">;

export interface WpSuiteEvents {
  emit(type: string, detail?: unknown): void;
  on(
    type: string,
    cb: (ev: Event) => void,
    opts?: AddEventListenerOptions
  ): void;
}

export interface WpSuitePluginBase {
  key: string;
  version?: string;
  status?: PluginStatus;

  availability?: () => Promise<PluginAvailability>;
  onReady?: (cb: () => void) => void;
}

/**
 * The plugins field simultaneously:
 * - contains typed, named plugins,
 * - and allows anything else (Record<string, WpSuitePluginBase | undefined>).
 */
export type WpSuitePluginRegistry = Record<
  string,
  WpSuitePluginBase | undefined
>;

export interface WpSuiteGlobal {
  siteSettings: SiteSettings;
  nonce: string;
  restUrl: string;
  uploadUrl: string;
  view: WpSuiteView;

  plugins: WpSuitePluginRegistry;
  events?: WpSuiteEvents;
}

export function getWpSuite(): WpSuiteGlobal | undefined {
  return globalThis.WpSuite;
}

export function getPlugin<K extends string>(
  key: K
): WpSuitePluginBase | undefined {
  return globalThis.WpSuite?.plugins[key];
}

export { getRecaptcha, type RecaptchaFunction } from "./utils";
export { attachDefaultPluginRuntime } from "./runtime";

export const TEXT_DOMAIN = "hub-for-wpsuiteio";

export interface SiteSettings {
  accountId?: string;
  siteId?: string;
  lastUpdate?: number;
  subscriber?: boolean;
  siteKey?: string;
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
