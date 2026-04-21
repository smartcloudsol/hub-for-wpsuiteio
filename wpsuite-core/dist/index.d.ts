declare global {
    var WpSuite: WpSuiteGlobal | undefined;
}
export type WpSuiteView = "connect" | "settings";
export type PluginStatus = "unavailable" | "initializing" | "available" | "error";
export type PluginAvailability = Omit<PluginStatus, "initializing">;
export interface WpSuiteEvents {
    emit(type: string, detail?: unknown): void;
    on(type: string, cb: (ev: Event) => void, opts?: AddEventListenerOptions): void;
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
export type WpSuitePluginRegistry = Record<string, WpSuitePluginBase | undefined>;
export interface WpSuiteGlobal {
    siteSettings: SiteSettings;
    nonce: string;
    restUrl: string;
    uploadUrl: string;
    view: WpSuiteView;
    plugins: WpSuitePluginRegistry;
    events?: WpSuiteEvents;
}
export declare function getWpSuite(): WpSuiteGlobal | undefined;
export declare function getPlugin<K extends string>(key: K): WpSuitePluginBase | undefined;
export { getRecaptcha, type RecaptchaFunction } from "./utils";
export { attachDefaultPluginRuntime } from "./runtime";
export declare const TEXT_DOMAIN = "smartcloud-wpsuite";
export interface SiteSettings {
    accountId?: string;
    siteId?: string;
    lastUpdate?: number;
    subscriber?: boolean;
    siteKey?: string;
    reCaptchaPublicKey?: string;
    useRecaptchaNet?: boolean;
    useRecaptchaEnterprise?: boolean;
    renderRecaptchaProvider?: boolean;
}
export type SubscriptionType = "PROFESSIONAL" | "AGENCY";
export declare const getConfig: (plugin: string) => Promise<Record<string, unknown> | null>;
