/** Site configuration transport shared by plugin editors. No credentials are cached. */
import { assertBackendProfileCurrent, assertBackendProfileFresh, backendProfileIdentity, getBackendProfileContext, resolveBackendProfileLegacyTargets } from "./backend-profile.ts";
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

const revisions = new Map<string, number>();

function httpsUrl(value: unknown, config = false): string {
  if (typeof value !== "string" || !/^https:\/\/[^/]/i.test(value) || /[\s\\?#]/.test(value) || Array.from(value).some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) {
    throw new Error("An explicit platform connection requires HTTPS API and JSON configuration URLs.");
  }
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("Invalid explicit platform connection URL."); }
  if (parsed.username || parsed.password || (config && !parsed.pathname.toLowerCase().endsWith(".json"))) {
    throw new Error("Invalid explicit platform connection URL.");
  }
  return parsed.href.replace(/\/+$/, "");
}

function route(target: SiteConfigurationTarget) {
  if (!target.workspaceId || !target.siteId || !target.siteKey || !target.pluginKey) throw new Error("Connect this site before loading its settings.");
  const binding = target.connection;
  if (binding?.workspaceApiMode !== undefined && binding.workspaceApiMode !== "legacy" && binding.workspaceApiMode !== "workspace") throw new Error("Unsupported workspace API mode.");
  const explicit = binding?.workspaceApiMode === "workspace" || !!binding?.platformApiBaseUrl || !!binding?.platformConfigUrl;
  const profile = getBackendProfileContext();
  assertBackendProfileCurrent(profile);
  let base = resolveBackendProfileLegacyTargets(target.legacyApiBaseUrl).apiBaseUrl.replace(/\/+$/, "");
  if (explicit) {
    if (binding?.workspaceApiMode !== "workspace") throw new Error("Explicit platform connection requires workspace API mode.");
    base = httpsUrl(binding.platformApiBaseUrl);
    httpsUrl(binding.platformConfigUrl, true);
    for (const id of [binding.workspaceId, binding.accountId]) {
      if (id && id !== target.workspaceId) throw new Error("Workspace connection changed. Reload before saving.");
    }
    if (binding.siteId && binding.siteId !== target.siteId) throw new Error("Site connection changed. Reload before saving.");
  }
  const pluginKey = target.pluginKey === "ai-kit" ? "aiKit" : target.pluginKey;
  const url = `${base}/${explicit ? "workspace" : "account"}/${encodeURIComponent(target.workspaceId)}/site/${encodeURIComponent(target.siteId)}/settings`;
  return { explicit, pluginKey, url, profile, revisionKey: `${url}#${pluginKey}${profile ? `#${backendProfileIdentity(profile)}` : ""}` };
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid site configuration response.");
  return value as Record<string, unknown>;
}

function checkedConfiguration(value: unknown, target: SiteConfigurationTarget, pluginKey: string) {
  const configuration = record(value);
  if (configuration.workspaceId !== target.workspaceId || configuration.siteId !== target.siteId || configuration.pluginKey !== pluginKey || !Number.isSafeInteger(configuration.revision) || Number(configuration.revision) < 1 || !configuration.settings || typeof configuration.settings !== "object" || Array.isArray(configuration.settings)) {
    throw new Error("Site configuration response does not match the connection.");
  }
  return configuration;
}

async function checkedResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    if (response.status === 409) throw new Error("Site settings changed. Reload before saving; your changes have not been applied.");
    throw new Error(`Site configuration request failed (HTTP ${response.status}).`);
  }
  return response.json();
}

export async function getSitePluginSettings<T>(target: SiteConfigurationTarget, fetcher: typeof fetch = fetch): Promise<SiteConfigurationResult<T>> {
  const selected = route(target);
  // A failed reload invalidates the previous revision instead of allowing a stale save.
  revisions.delete(selected.revisionKey);
  const data = record(await checkedResponse(await fetcher(selected.url, {
    method: "GET", ...(selected.explicit ? { credentials: "omit" as const, redirect: "error" as const } : {}),
    headers: { "X-Site-Key": target.siteKey, "X-Plugin": selected.explicit ? selected.pluginKey : target.pluginKey },
  })));
  assertBackendProfileCurrent(selected.profile);
  if (!selected.explicit) return data as unknown as SiteConfigurationResult<T>;
  const site = record(data.site);
  if (site.workspaceId !== target.workspaceId || site.siteId !== target.siteId) throw new Error("Site response does not match the connection.");
  const configuration = data.configuration === null ? null : checkedConfiguration(data.configuration, target, selected.pluginKey);
  const revision = configuration ? Number(configuration.revision) : 0;
  revisions.set(selected.revisionKey, revision);
  return { ...site, accountId: target.workspaceId, siteId: target.siteId, name: String(site.name ?? ""), domain: String(site.domain ?? ""), settings: (configuration?.settings ?? {}) as T, revision } as SiteConfigurationResult<T>;
}

export async function putSitePluginSettings<T>(target: SiteConfigurationTarget, settings: T, fetcher: typeof fetch = fetch): Promise<T> {
  const selected = route(target);
  const revision = revisions.get(selected.revisionKey);
  if (selected.explicit && revision === undefined) throw new Error("Reload site settings before saving.");
  await assertBackendProfileFresh(selected.profile);
  const data = record(await checkedResponse(await fetcher(selected.url, {
    method: "PUT", ...(selected.explicit ? { credentials: "omit" as const, redirect: "error" as const } : {}),
    headers: { "Content-Type": "application/json", "X-Site-Key": target.siteKey, "X-Plugin": selected.explicit ? selected.pluginKey : target.pluginKey },
    body: JSON.stringify(selected.explicit ? { pluginKey: selected.pluginKey, expectedRevision: revision, settings } : { settings }),
  })));
  assertBackendProfileCurrent(selected.profile);
  if (!selected.explicit) return data.settings as T;
  const configuration = checkedConfiguration(data.configuration, target, selected.pluginKey);
  if (configuration.revision !== Number(revision) + 1) throw new Error("Unexpected site configuration revision. Reload before saving.");
  revisions.set(selected.revisionKey, Number(configuration.revision));
  return configuration.settings as T;
}
