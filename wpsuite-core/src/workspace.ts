/** Tenant identity at the legacy wire boundary. AWS account IDs are unrelated. */
export interface WorkspaceIdentity {
  workspaceId?: string;
  /** @deprecated Compatibility alias for workspaceId. */
  accountId?: string;
}

export type WorkspaceApiMode = "legacy" | "workspace";

export function resolveWorkspaceId(identity: WorkspaceIdentity | undefined): string | undefined {
  const workspaceId = identity?.workspaceId;
  const accountId = identity?.accountId;
  for (const value of [workspaceId, accountId]) {
    if (value !== undefined && typeof value !== "string") throw new Error("Workspace identity must be a string");
    if (value && value.trim() !== value) throw new Error("Workspace identity must not contain surrounding whitespace");
  }
  if (workspaceId && accountId && workspaceId !== accountId) throw new Error("Conflicting workspaceId and accountId");
  return workspaceId || accountId || undefined;
}

/** Preserve unknown settings and IDs while exposing the old alias to older plugins. */
export function normalizeWorkspaceIdentity<T extends WorkspaceIdentity>(settings: T): T & WorkspaceIdentity {
  const workspaceId = resolveWorkspaceId(settings);
  return { ...settings, workspaceId, accountId: workspaceId };
}

export function workspaceApiMode(value: unknown): WorkspaceApiMode {
  if (value === undefined || value === "legacy") return "legacy";
  if (value === "workspace") return "workspace";
  throw new Error("Unsupported workspace API mode");
}

export function workspaceManagementIds(scopes: readonly string[]): string[] {
  return [...new Set(scopes.flatMap((scope) => {
    const match = /^sc\.(?:workspace|account)\.(?:owner|admin)\.([a-zA-Z0-9_-]+)$/.exec(scope);
    return match ? [match[1]] : [];
  }))];
}
