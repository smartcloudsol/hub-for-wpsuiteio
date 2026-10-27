/** Tenant identity at the legacy wire boundary. AWS account IDs are unrelated. */
export interface WorkspaceIdentity {
    workspaceId?: string;
    /** @deprecated Compatibility alias for workspaceId. */
    accountId?: string;
}
export type WorkspaceApiMode = "legacy" | "workspace";
export declare function resolveWorkspaceId(identity: WorkspaceIdentity | undefined): string | undefined;
/** Preserve unknown settings and IDs while exposing the old alias to older plugins. */
export declare function normalizeWorkspaceIdentity<T extends WorkspaceIdentity>(settings: T): T & WorkspaceIdentity;
export declare function workspaceApiMode(value: unknown): WorkspaceApiMode;
export declare function workspaceManagementIds(scopes: readonly string[]): string[];
