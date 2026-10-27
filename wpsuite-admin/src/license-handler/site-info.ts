import { resolveWorkspaceId } from "@smart-cloud/wpsuite-core";
import { resolvePlatformConnection } from "../platform-connection.ts";
import { record, resolveApiMode, settingsView, workspaceRequestPath } from "../workspace-compat.ts";
import { connectionIdentity, usableSiteKey, type ConnectionIdentity } from "./site-connection.ts";

/** Site credentials belong to the explicitly selected tuple, not the signed-in user. */
export async function fetchSiteInfoWithSiteKey(
  target: ConnectionIdentity,
  apiBaseUrl: string,
  siteKey: string,
  fetcher: typeof fetch = fetch,
): Promise<Record<string, unknown>> {
  if (!usableSiteKey(siteKey)) throw new Error("The stored connection key is incomplete. Reconnect this site.");
  const { normalizedBase, path, workspaceId, mode } = siteInfoRequest(target, apiBaseUrl);
  const response = await fetcher(normalizedBase + path, {
    method: "GET", headers: { "X-Site-Key": siteKey }, credentials: "omit", redirect: "error",
  });
  if (!response.ok) throw Object.assign(new Error("The site connection could not be verified."), { status: response.status });
  const payload: unknown = await response.json();
  const site = mode === "workspace" ? settingsView(payload) : record(payload);
  if (resolveWorkspaceId(site) !== workspaceId || site.siteId !== target.siteId) {
    throw new Error("The verified connection belongs to a different workspace or site.");
  }
  // Metadata cannot replace the caller's credential, including on legacy backends.
  const { siteKey: responseKey, ...metadata } = site;
  void responseKey;
  return metadata;
}

/** Retain creation's one-time key in RAM while returning only cacheable metadata. */
export function rememberCreatedSite<T extends ConnectionIdentity>(
  created: T, target: ConnectionIdentity, oneTimeKeys: Map<string, string>,
): Omit<T, "siteKey"> {
  if (created.siteId !== target.siteId || resolveWorkspaceId(created) !== resolveWorkspaceId(target)) {
    throw new Error("The created site belongs to a different workspace or site.");
  }
  if (usableSiteKey(created.siteKey)) oneTimeKeys.set(connectionIdentity(target), created.siteKey);
  const { siteKey, ...metadata } = created;
  void siteKey;
  return metadata;
}

function siteInfoRequest(target: ConnectionIdentity, apiBaseUrl: string) {
  connectionIdentity(target);
  const mode = resolveApiMode(target);
  const connection = resolvePlatformConnection(target, apiBaseUrl, "");
  if (mode === "workspace" && !connection.explicit) throw new Error("The workspace connection is missing its platform binding.");
  const base = new URL(apiBaseUrl);
  if (base.protocol !== "https:" || base.username || base.password || /[\s\\?#]/.test(apiBaseUrl) ||
    Array.from(apiBaseUrl).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error("Invalid site API endpoint.");
  }
  const normalizedBase = base.href.replace(/\/+$/, "");
  if (connection.explicit && connection.apiBaseUrl !== normalizedBase) throw new Error("The site API endpoint does not match the selected platform binding.");
  const workspaceId = resolveWorkspaceId(target)!;
  const path = workspaceRequestPath(`/account/${encodeURIComponent(workspaceId)}/site/${encodeURIComponent(target.siteId!)}/settings`, mode);
  return { normalizedBase, path, workspaceId, mode };
}

/** Owner/admin recovery is explicit-site scoped; no list cache, fallback or rotation. */
export async function fetchRecoverableSiteKey(
  target: ConnectionIdentity, apiBaseUrl: string, configuredBackendEndpoint: string | undefined,
  readCredential: (path: string) => Promise<unknown>,
): Promise<string> {
  const request = siteInfoRequest(target, apiBaseUrl);
  if (request.mode !== "workspace" || !configuredBackendEndpoint ||
    new URL(configuredBackendEndpoint).href.replace(/\/+$/, "") !== request.normalizedBase) {
    throw new Error("The authenticated backend does not match the selected platform connection.");
  }
  const payload = record(await readCredential(`/workspace/${encodeURIComponent(request.workspaceId)}/site/${encodeURIComponent(target.siteId!)}/site-key`));
  if (resolveWorkspaceId(payload) !== request.workspaceId || payload.siteId !== target.siteId ||
    !usableSiteKey(payload.siteKeyId) || !usableSiteKey(payload.siteKey)) {
    throw new Error("The recovered connection key does not match the selected workspace and site.");
  }
  return payload.siteKey;
}
