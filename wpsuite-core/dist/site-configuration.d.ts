export interface SiteConfigurationTarget {
    legacyApiBaseUrl: string;
    workspaceId: string;
    siteId: string;
    siteKey: string;
    pluginKey: string;
    connection?: {
        workspaceApiMode?: unknown;
        platformApiBaseUrl?: unknown;
        platformConfigUrl?: unknown;
        workspaceId?: string;
        accountId?: string;
        siteId?: string;
    };
}
export interface SiteConfigurationResult<T> {
    accountId: string;
    workspaceId?: string;
    siteId: string;
    name: string;
    domain: string;
    subscriptionType?: "PROFESSIONAL" | "AGENCY";
    settings: T;
    revision?: number;
}
export declare function getSitePluginSettings<T>(target: SiteConfigurationTarget, fetcher?: typeof fetch): Promise<SiteConfigurationResult<T>>;
export declare function putSitePluginSettings<T>(target: SiteConfigurationTarget, settings: T, fetcher?: typeof fetch): Promise<T>;
