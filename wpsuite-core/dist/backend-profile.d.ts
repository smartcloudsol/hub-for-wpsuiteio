/** Backend-profile runtime. Only public connection/identity metadata is stored here. */
export interface BackendProfileIdentity {
    awsRegion: string;
    userPoolId: string;
    identityPoolId: string;
    appClientPlugin: string;
    baseUrl: string;
    appClient?: string;
    workspaceApiMode?: string;
    foundationApiBaseUrl?: string;
}
export interface BackendProfileContext {
    enabled: true;
    id: "production" | "development";
    generation: number;
    bindingRevision: number;
    legacyApiBaseUrl: string;
    legacyConfigUrl: string;
    identity: Readonly<BackendProfileIdentity>;
}
/** A mutable public JSON URL cannot replace a profile's captured identity authority. */
export declare function assertBackendProfileConfiguration(value: unknown): void;
export declare function parseBackendProfile(value: unknown): BackendProfileContext | undefined;
export declare function backendProfileIdentity(context: BackendProfileContext): string;
export declare function getBackendProfileContext(): BackendProfileContext | undefined;
export declare function resolveBackendProfileLegacyTargets(api: string, config?: string): {
    apiBaseUrl: string;
    configUrl: string;
};
export declare class BackendProfileChangedError extends Error {
    constructor();
}
export declare function assertBackendProfileCurrent(expected?: BackendProfileContext): void;
export declare function backendProfileHeaders(expected?: BackendProfileContext | undefined): Record<string, string>;
export declare function markBackendProfileStale(): void;
/** Public status returns identifiers/revisions only; failure never authorizes a write. */
export declare function assertBackendProfileFresh(expected?: BackendProfileContext | undefined, fetcher?: typeof fetch): Promise<void>;
export declare function announceBackendProfileChange(context: {
    id: string;
    generation: number;
    bindingRevision: number;
}): void;
/** One guard per browser window even when multiple separately bundled plugins boot. */
export declare function installBackendProfileGuards(): void;
export declare function backendProfileStorageKey(key: string, profile?: BackendProfileContext | undefined): string;
/** Amplify-compatible storage. Clearing one profile never clears unrelated browser data. */
export declare function createBackendProfileStorage(storage: Storage, profile?: BackendProfileContext | undefined): {
    getItem(key: string): Promise<string | null>;
    setItem(key: string, value: string): Promise<void>;
    removeItem(key: string): Promise<void>;
    clear(): Promise<void>;
} | undefined;
