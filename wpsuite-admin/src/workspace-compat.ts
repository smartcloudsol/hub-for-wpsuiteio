import { resolveWorkspaceId, workspaceApiMode } from "@smart-cloud/wpsuite-core";
import type { WorkspaceApiMode } from "@smart-cloud/wpsuite-core";

type JsonRecord = Record<string, unknown>;
export function record(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid workspace API response");
  return value as JsonRecord;
}
function tenantRecord(value: unknown): JsonRecord {
  const item = record(value);
  const workspaceId = resolveWorkspaceId(item);
  if (!workspaceId) throw new Error("Workspace API response is missing tenant identity");
  return { ...item, workspaceId, accountId: workspaceId };
}
export function resolveApiMode(settings: { workspaceApiMode?: unknown } | undefined): WorkspaceApiMode {
  return workspaceApiMode(settings?.workspaceApiMode);
}

/** Translate only known tenant routes, with no retry into another backend. */
export function workspaceRequestPath(path: string, mode: WorkspaceApiMode): string {
  if (mode === "legacy") return path;
  return path.replace(/^\/account(?=\/|$)/, "/workspace");
}
/** Canonical tenant routing with the existing pinned v1 licence verifier. */
export function workspaceLicenseRequestPath(path: string, mode: WorkspaceApiMode): string {
  const result = workspaceRequestPath(path, mode);
  return mode === "workspace" ? `${result}?licenseVersion=1` : result;
}
export function workspaceView(value: unknown): JsonRecord {
  const item = tenantRecord(value);
  const customerId = item.stripeCustomerId ?? item.customerId;
  return { ...item, owner: item.ownerUserId ?? item.owner, customerId,
    customer: item.customer ?? (typeof customerId === "string" ? { id: customerId } : undefined) };
}
export function siteView(value: unknown, siteKey?: unknown): JsonRecord {
  const item = tenantRecord(value);
  return { ...item, ...(typeof siteKey === "string" ? { siteKey } : {}) };
}
export function settingsView(payload: unknown, sitePayload?: unknown): JsonRecord {
  const body = record(payload);
  const configurations = Array.isArray(body.configurations)
    ? body.configurations : body.configuration ? [body.configuration] : [];
  const settings: JsonRecord = {};
  const revisions: JsonRecord = {};
  for (const value of configurations) {
    const configuration = record(value);
    if (typeof configuration.pluginKey !== "string") throw new Error("Invalid plugin configuration response");
    settings[configuration.pluginKey] = configuration.settings;
    revisions[configuration.pluginKey] = configuration.revision;
  }
  return { ...siteView(record(sitePayload ?? body).site), settings, revisions };
}

export function workspaceResponseView(path: string, payload: unknown, query: Record<string, unknown> = {}): unknown {
  if (path === "/workspace") {
    const body = record(payload);
    if (body.workspace) return workspaceView(body.workspace);
    if (!Array.isArray(body.workspaces)) throw new Error("Invalid workspace list response");
    return body.workspaces.map(workspaceView);
  }
  if (/^\/workspace\/[^/]+$/.test(path)) return workspaceView(record(payload).workspace);
  if (/^\/workspace\/[^/]+\/site$/.test(path)) {
    const body = record(payload);
    if (body.site) return siteView(body.site, body.siteKey);
    if (!Array.isArray(body.sites)) throw new Error("Invalid site list response");
    if (query.last_key) throw new Error("Canonical site list does not use legacy pagination cursors");
    const order = query.order === "domain" ? "domain" : "name";
    const search = typeof query.search === "string" ? query.search.trim().toLowerCase() : "";
    const list = body.sites.map((site) => siteView(site))
      .filter((site) => !search || String(site[order] ?? "").toLowerCase().startsWith(search))
      .sort((a, b) => String(a[order] ?? "").localeCompare(String(b[order] ?? "")));
    if (query.sort === "desc") list.reverse();
    return { list, lastKey: null };
  }
  if (/^\/workspace\/[^/]+\/site\/[^/]+$/.test(path)) {
    const body = record(payload);
    return siteView(body.site, body.siteKey);
  }
  // Billing sessions and licence payloads already have compatible contracts.
  return payload;
}
