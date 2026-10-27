import { normalizeWorkspaceIdentity, resolveWorkspaceId } from "./workspace";
import type { WorkspaceIdentity, WorkspaceApiMode } from "./workspace";
import { installBackendProfileGuards } from "./backend-profile";
import type { BackendProfileContext } from "./backend-profile";
export { getBackendProfileContext, assertBackendProfileConfiguration, parseBackendProfile, backendProfileIdentity, resolveBackendProfileLegacyTargets, backendProfileHeaders, assertBackendProfileCurrent, assertBackendProfileFresh, markBackendProfileStale, announceBackendProfileChange, installBackendProfileGuards, backendProfileStorageKey, createBackendProfileStorage, BackendProfileChangedError } from "./backend-profile";
export type { BackendProfileContext, BackendProfileIdentity } from "./backend-profile";
export { resolveWorkspaceId, normalizeWorkspaceIdentity, workspaceApiMode, workspaceManagementIds } from "./workspace";
export type { WorkspaceIdentity, WorkspaceApiMode } from "./workspace";

declare global {
  var WpSuite: WpSuiteGlobal | undefined;
}

export type WpSuiteView = "connect" | "settings";

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
    opts?: AddEventListenerOptions,
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
  themeCssEditorUrl?: string;
  view: WpSuiteView;

  plugins: WpSuitePluginRegistry;
  events?: WpSuiteEvents;
  backendProfilesAvailable?: boolean;
  backendProfile?: BackendProfileContext;
}

export function getWpSuite(): WpSuiteGlobal | undefined {
  const suite = globalThis.WpSuite;
  if (suite) {
    installBackendProfileGuards();
    const id = resolveWorkspaceId(suite.siteSettings);
    if (suite.siteSettings.workspaceId !== id || suite.siteSettings.accountId !== id) {
      suite.siteSettings = normalizeWorkspaceIdentity(suite.siteSettings);
    }
  }
  return suite;
}

export function getPlugin<K extends string>(
  key: K,
): WpSuitePluginBase | undefined {
  return globalThis.WpSuite?.plugins[key];
}

export { getRecaptcha, type RecaptchaFunction } from "./utils";
export { attachDefaultPluginRuntime } from "./runtime";

export const TEXT_DOMAIN = "smartcloud-wpsuite";

export interface SiteSettings extends WorkspaceIdentity {
  workspaceApiMode?: WorkspaceApiMode;
  /** Explicit operator-owned platform binding for a private or alternate backend. */
  platformApiBaseUrl?: string;
  platformConfigUrl?: string;
  siteId?: string;
  lastUpdate?: number;
  subscriber?: boolean;
  siteKey?: string;
  reCaptchaPublicKey?: string;
  useRecaptchaNet?: boolean;
  useRecaptchaEnterprise?: boolean;
  renderRecaptchaProvider?: boolean;
  customTranslationsUrl?: string;
  customTranslationsDefaultLocale?: string;
  themeCssUrls?: string[];
}

export type SubscriptionType = "PROFESSIONAL" | "AGENCY";

export const getConfig = async (
  plugin: string,
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

export { createSiteLocaleRuntime, getSiteLocaleRuntime, normalizeLocale, matchLocale, resolveSiteLocale, resolveComponentLocale, getLocaleDirection, createTranslator } from "./locale";
export type { SiteLocaleRuntime, SiteLocaleConfig, SiteLocaleSnapshot, LocaleRouteMode, TranslationCatalogs } from "./locale";
export {
  getCustomTranslations,
  loadTranslationCatalogs,
  type CustomTranslationLoadOptions,
  type TranslationLoadFailure,
  type TranslationLoadOptions,
} from "./translation-loader";

export { getSitePluginSettings, putSitePluginSettings } from "./site-configuration";
export type { SiteConfigurationTarget, SiteConfigurationResult } from "./site-configuration";
