/** Browser-wide locale state. No React, WordPress, or translation-provider dependency. */
export type LocaleRouteMode = "content" | "app" | "docs" | "docs-entry";
export interface SiteLocaleSnapshot {
    locale: string;
    direction: "ltr" | "rtl";
    source: string;
    routeMode: LocaleRouteMode;
    revision: number;
}
export interface SiteLocaleConfig {
    defaultLocale?: string;
    supportedLocales?: string[];
    pageLocale?: string;
    /** Live provider request language; omit for frozen exported app shells. */
    providerLocale?: string;
    routeMode?: LocaleRouteMode;
    /** Only configured preference keys are read. False disables persistence. */
    cookieName?: string | false;
    providerCookie?: {
        name: string;
        values: Record<string, string>;
        writable?: boolean;
    };
    queryParameter?: string | false;
}
export interface SiteLocaleRuntime {
    getSnapshot(): SiteLocaleSnapshot;
    subscribe(listener: () => void): () => void;
    setLocale(locale: string, options?: {
        persist?: boolean;
    }): void;
    configure(config: Partial<SiteLocaleConfig>): void;
}
declare global {
    var WpSuiteLocaleConfig: SiteLocaleConfig | undefined;
    var WpSuiteLocale: SiteLocaleRuntime | undefined;
}
export declare function normalizeLocale(value?: string | null): string | undefined;
export declare function getLocaleDirection(locale: string): "ltr" | "rtl";
export declare function matchLocale(value: string | null | undefined, supported?: readonly string[]): string | undefined;
export interface LocaleInputs {
    pageLocale?: string;
    documentLocale?: string;
    preferredLocale?: string;
    providerLocale?: string;
    queryLocale?: string;
    selectedLocale?: string;
    browserLocales?: readonly string[];
}
export declare function resolveSiteLocale(config: SiteLocaleConfig, inputs: LocaleInputs): Omit<SiteLocaleSnapshot, "revision">;
/** Fixed block > explicit application override > current frontend language. */
export declare function resolveComponentLocale(block: string | null | undefined, application: string | null | undefined, site: string): string;
export declare function createSiteLocaleRuntime(initial?: SiteLocaleConfig): SiteLocaleRuntime;
export declare function getSiteLocaleRuntime(): SiteLocaleRuntime;
export type TranslationCatalogs = Record<string, Record<string, string>>;
export declare function createTranslator(locale: string, catalogs: TranslationCatalogs, custom?: TranslationCatalogs | null, fallback?: string, siteDefaultLocale?: string | undefined): (key: string, defaultValue?: string) => string;
