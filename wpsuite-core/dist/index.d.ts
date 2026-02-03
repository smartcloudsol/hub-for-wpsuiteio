type RecaptchaFunction = (reCaptchaSiteKey: string, options: {
    action: string;
}) => Promise<string | undefined>;
declare const getRecaptcha: (useRecaptchaEnterprise: boolean) => Promise<{
    execute: RecaptchaFunction | undefined;
}>;

/** Attaches the default runtime functions to a plugin object */
declare function attachDefaultPluginRuntime<T extends WpSuitePluginBase>(plugin: T, opts?: {
    timeoutMs?: number;
}): T;

declare global {
    var WpSuite: WpSuiteGlobal | undefined;
}
type WpSuiteView = "connect" | "diagnostics";
type PluginStatus = "unavailable" | "initializing" | "available" | "error";
type PluginAvailability = Omit<PluginStatus, "initializing">;
interface WpSuiteEvents {
    emit(type: string, detail?: unknown): void;
    on(type: string, cb: (ev: Event) => void, opts?: AddEventListenerOptions): void;
}
interface WpSuitePluginBase {
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
type WpSuitePluginRegistry = Record<string, WpSuitePluginBase | undefined>;
interface WpSuiteGlobal {
    siteSettings: SiteSettings;
    nonce: string;
    restUrl: string;
    uploadUrl: string;
    view: WpSuiteView;
    plugins: WpSuitePluginRegistry;
    events?: WpSuiteEvents;
}
declare function getWpSuite(): WpSuiteGlobal | undefined;
declare function getPlugin<K extends string>(key: K): WpSuitePluginBase | undefined;

declare const TEXT_DOMAIN = "smartcloud-wpsuite";
interface SiteSettings {
    accountId?: string;
    siteId?: string;
    lastUpdate?: number;
    subscriber?: boolean;
    siteKey?: string;
}
type SubscriptionType = "PROFESSIONAL" | "AGENCY";
declare const getConfig: (plugin: string) => Promise<Record<string, unknown> | null>;

export { type PluginAvailability, type PluginStatus, type RecaptchaFunction, type SiteSettings, type SubscriptionType, TEXT_DOMAIN, type WpSuiteEvents, type WpSuiteGlobal, type WpSuitePluginBase, type WpSuitePluginRegistry, type WpSuiteView, attachDefaultPluginRuntime, getConfig, getPlugin, getRecaptcha, getWpSuite };
