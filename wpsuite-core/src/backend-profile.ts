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

interface ProfileSuite {
  backendProfile?: unknown;
  backendProfilesAvailable?: boolean;
  restUrl?: string;
  nonce?: string;
}

interface ProfileState {
  context: BackendProfileContext;
  stale: boolean;
  installed: boolean;
  lastConfirmed: number;
  fetcher?: typeof fetch;
}

const stateKey = Symbol.for("wpsuite.backend-profile.runtime.v1");
const markerKey = "wpsuite:backend-profile:active:v1";
const globals = globalThis as typeof globalThis & { [stateKey]?: ProfileState };
const suite = (): ProfileSuite | undefined => (globalThis as { WpSuite?: ProfileSuite }).WpSuite;

function secureUrl(value: unknown, config = false): string {
  if (typeof value !== "string" || !value || /[\s\\?#]/.test(value)) throw new Error("Invalid backend profile endpoint.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || (config && !url.pathname.endsWith(".json"))) throw new Error("Invalid backend profile endpoint.");
  return config ? url.href : url.href.replace(/\/+$/, "");
}

function parseProfileIdentity(value: unknown, id: string): Readonly<BackendProfileIdentity> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid backend profile identity.");
  const item = value as Record<string, unknown>;
  const region = item.awsRegion;
  if (typeof region !== "string" || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)
    || typeof item.userPoolId !== "string" || item.userPoolId.length > 128 || !new RegExp(`^${region}_[A-Za-z0-9]+$`).test(item.userPoolId)
    || typeof item.identityPoolId !== "string" || !new RegExp(`^${region}:[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$`).test(item.identityPoolId)
    || typeof item.appClientPlugin !== "string" || !/^[a-z0-9]{1,128}$/.test(item.appClientPlugin)
    || typeof item.baseUrl !== "string" || item.baseUrl !== (id === "production" ? "https://wpsuite.io" : "https://dev.wpsuite.io")
    || (item.appClient !== undefined && (typeof item.appClient !== "string" || !/^[a-z0-9]{1,128}$/.test(item.appClient)))
    || (item.workspaceApiMode !== undefined && typeof item.workspaceApiMode !== "string")
    || (item.foundationApiBaseUrl !== undefined && (typeof item.foundationApiBaseUrl !== "string" || (item.foundationApiBaseUrl !== "" && secureUrl(item.foundationApiBaseUrl) !== item.foundationApiBaseUrl.replace(/\/+$/, ""))))) throw new Error("Invalid backend profile identity.");
  return Object.freeze({ awsRegion: region, userPoolId: item.userPoolId, identityPoolId: item.identityPoolId,
    appClientPlugin: item.appClientPlugin, baseUrl: item.baseUrl,
    ...(item.appClient === undefined ? {} : { appClient: item.appClient as string }),
    ...(item.workspaceApiMode === undefined ? {} : { workspaceApiMode: item.workspaceApiMode as string }),
    ...(item.foundationApiBaseUrl === undefined ? {} : { foundationApiBaseUrl: item.foundationApiBaseUrl as string }) });
}

/** A mutable public JSON URL cannot replace a profile's captured identity authority. */
export function assertBackendProfileConfiguration(value: unknown): void {
  const profile = getBackendProfileContext();
  if (!profile) return;
  assertBackendProfileCurrent(profile);
  const item = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const defaults = { awsRegion: "", userPoolId: "", identityPoolId: "", appClientPlugin: "", appClient: "",
    baseUrl: "", workspaceApiMode: "legacy", foundationApiBaseUrl: "" };
  for (const field of Object.keys(defaults) as Array<keyof typeof defaults>) {
    if ((item[field] ?? defaults[field]) !== (profile.identity[field] ?? defaults[field])) {
      markBackendProfileStale();
      throw new Error("The backend profile identity changed. Revalidate its connection before using backend services.");
    }
  }
}

export function parseBackendProfile(value: unknown): BackendProfileContext | undefined {
  if (value === undefined || value === null) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid backend profile context.");
  const profile = value as Record<string, unknown>;
  if (profile.enabled !== true || !["production", "development"].includes(String(profile.id))
    || !Number.isSafeInteger(profile.generation) || Number(profile.generation) < 1
    || !Number.isSafeInteger(profile.bindingRevision) || Number(profile.bindingRevision) < 1) throw new Error("Invalid backend profile context.");
  return Object.freeze({ enabled: true, id: profile.id as BackendProfileContext["id"], generation: Number(profile.generation),
    bindingRevision: Number(profile.bindingRevision),
    legacyApiBaseUrl: profile.legacyApiBaseUrl === "" || profile.legacyApiBaseUrl === undefined ? "" : secureUrl(profile.legacyApiBaseUrl),
    legacyConfigUrl: profile.legacyConfigUrl === "" || profile.legacyConfigUrl === undefined ? "" : secureUrl(profile.legacyConfigUrl, true),
    identity: parseProfileIdentity(profile.identity, String(profile.id)) });
}

export function backendProfileIdentity(context: BackendProfileContext): string {
  return `${context.id}:${context.generation}:${context.bindingRevision}`;
}

function state(): ProfileState | undefined {
  const current = parseBackendProfile(suite()?.backendProfile);
  if (!current) return undefined;
  const previous = globals[stateKey];
  if (!previous) return (globals[stateKey] = { context: current, stale: false, installed: false, lastConfirmed: 0 });
  if (backendProfileIdentity(previous.context) !== backendProfileIdentity(current) || JSON.stringify(previous.context.identity) !== JSON.stringify(current.identity)) previous.stale = true;
  return previous;
}

export function getBackendProfileContext(): BackendProfileContext | undefined {
  installBackendProfileGuards();
  return state()?.context;
}

export function resolveBackendProfileLegacyTargets(api: string, config = ""): { apiBaseUrl: string; configUrl: string } {
  const profile = getBackendProfileContext();
  return { apiBaseUrl: profile?.legacyApiBaseUrl || api, configUrl: profile?.legacyConfigUrl || config };
}

export class BackendProfileChangedError extends Error {
  constructor() { super("The backend profile changed. Reload this page before saving or submitting."); this.name = "BackendProfileChangedError"; }
}

export function assertBackendProfileCurrent(expected?: BackendProfileContext): void {
  const selected = state();
  if (expected && (!selected || backendProfileIdentity(selected.context) !== backendProfileIdentity(expected))) throw new BackendProfileChangedError();
  if (selected?.stale) throw new BackendProfileChangedError();
}

export function backendProfileHeaders(expected = getBackendProfileContext()): Record<string, string> {
  assertBackendProfileCurrent(expected);
  return expected ? { "X-WPSuite-Backend-Profile": expected.id,
    "X-WPSuite-Backend-Generation": String(expected.generation),
    "X-WPSuite-Backend-Binding-Revision": String(expected.bindingRevision) } : {};
}

function endpoint(suffix: string): string {
  const rest = suite()?.restUrl;
  if (!rest) throw new Error("The backend profile context endpoint is unavailable.");
  return `${rest.replace(/\/+$/, "")}/${suffix}`;
}

function showStaleNotice(): void {
  if (typeof document === "undefined" || document.getElementById("wpsuite-backend-profile-stale")) return;
  const mount = () => {
    if (!document.body || document.getElementById("wpsuite-backend-profile-stale")) return;
    const notice = document.createElement("div");
    notice.id = "wpsuite-backend-profile-stale";
    notice.setAttribute("role", "alert");
    notice.className = "notice notice-warning";
    notice.style.cssText = "position:fixed;top:36px;left:20px;right:20px;z-index:100001;padding:12px;background:#fff4cf;color:#222;border:1px solid #b68b00";
    notice.append(document.createTextNode("The WP Suite backend profile changed. Saving and submissions are paused in this tab. "));
    const button = document.createElement("button");
    button.type = "button"; button.className = "button"; button.textContent = "Reload page";
    button.onclick = () => location.reload(); notice.append(button); document.body.append(notice);
  };
  if (document.body) mount(); else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

export function markBackendProfileStale(): void {
  const selected = state();
  if (!selected) return;
  selected.stale = true;
  showStaleNotice();
}

/** Public status returns identifiers/revisions only; failure never authorizes a write. */
export async function assertBackendProfileFresh(expected = getBackendProfileContext(), fetcher?: typeof fetch): Promise<void> {
  if (!expected) return;
  assertBackendProfileCurrent(expected);
  // Static publications intentionally retain their captured profile after the CMS switches.
  if (typeof location !== "undefined" && location.origin !== "https://dev.wpsuite.io") return;
  const selected = state()!;
  const request = fetcher ?? selected.fetcher ?? globalThis.fetch;
  const response = await request(endpoint("backend-profile-context"), { method: "GET", cache: "no-store", credentials: "same-origin", redirect: "error", signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error("The backend profile could not be verified. Reload before saving.");
  const value: unknown = await response.json();
  const current = value as { enabled?: unknown; active?: unknown; generation?: unknown; bindingRevision?: unknown } | null;
  if (!current || current.enabled !== true || current.active !== expected.id || current.generation !== expected.generation || current.bindingRevision !== expected.bindingRevision) {
    markBackendProfileStale(); throw new BackendProfileChangedError();
  }
  selected.lastConfirmed = Date.now();
  assertBackendProfileCurrent(expected);
}

export function announceBackendProfileChange(context: { id: string; generation: number; bindingRevision: number }): void {
  if (!["production", "development"].includes(context.id) || !Number.isSafeInteger(context.generation) || !Number.isSafeInteger(context.bindingRevision)) throw new Error("Invalid backend profile change.");
  try { localStorage.setItem(markerKey, JSON.stringify(context)); } catch { /* Server freshness checks remain authoritative. */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("wpsuite:backend-profile-changed", { detail: context }));
}

/** One guard per browser window even when multiple separately bundled plugins boot. */
export function installBackendProfileGuards(): void {
  const selected = state();
  if (!selected || selected.installed || typeof window === "undefined" || location.origin !== "https://dev.wpsuite.io" || typeof globalThis.fetch !== "function") return;
  selected.installed = true;
  const original = globalThis.fetch.bind(globalThis);
  selected.fetcher = original;
  const expected = selected.context;
  globalThis.fetch = async (input, init) => {
    const request = typeof Request !== "undefined" && input instanceof Request ? input : undefined;
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    if (["GET", "HEAD", "OPTIONS"].includes(method)) return original(input, init);
    assertBackendProfileCurrent(expected);
    await assertBackendProfileFresh(expected, original);
    const url = new URL(request?.url ?? String(input), location.href);
    if (url.origin === location.origin && (url.pathname.includes("/wp-json/") || url.searchParams.has("rest_route"))) {
      const headers = new Headers(init?.headers ?? request?.headers);
      Object.entries(backendProfileHeaders(expected)).forEach(([key, value]) => headers.set(key, value));
      return original(input, { ...init, headers });
    }
    return original(input, init);
  };
  const checkMarker = (value: string | null) => {
    if (!value) return;
    try {
      const item = JSON.parse(value) as { id?: unknown; generation?: unknown; bindingRevision?: unknown };
      if (Number(item.generation) >= expected.generation && (item.id !== expected.id || item.generation !== expected.generation || item.bindingRevision !== expected.bindingRevision)) markBackendProfileStale();
    } catch { /* Non-authoritative browser metadata is ignored. */ }
  };
  try { checkMarker(localStorage.getItem(markerKey)); } catch { /* Polling also detects switches. */ }
  window.addEventListener("storage", (event) => { if (event.key === markerKey) checkMarker(event.newValue); });
  window.addEventListener("wpsuite:backend-profile-changed", (event) => checkMarker(JSON.stringify((event as CustomEvent).detail)));
  const poll = () => { if (!selected.stale && document.visibilityState !== "hidden") void assertBackendProfileFresh(expected, original).catch(() => { /* Writes still require a successful live check. */ }); };
  window.setInterval(poll, 30000);
  document.addEventListener("visibilitychange", poll);
}

export function backendProfileStorageKey(key: string, profile = getBackendProfileContext()): string {
  return profile ? `wpsuite-profile:${profile.id}:${profile.bindingRevision}:${key}` : key;
}

/** Amplify-compatible storage. Clearing one profile never clears unrelated browser data. */
export function createBackendProfileStorage(storage: Storage, profile = getBackendProfileContext()) {
  if (!profile) return undefined;
  const prefix = backendProfileStorageKey("", profile);
  return {
    async getItem(key: string): Promise<string | null> { assertBackendProfileCurrent(profile); return storage.getItem(prefix + key); },
    async setItem(key: string, value: string): Promise<void> { assertBackendProfileCurrent(profile); storage.setItem(prefix + key, value); },
    async removeItem(key: string): Promise<void> { assertBackendProfileCurrent(profile); storage.removeItem(prefix + key); },
    async clear(): Promise<void> {
      assertBackendProfileCurrent(profile);
      const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => !!key && key.startsWith(prefix));
      keys.forEach(key => storage.removeItem(key));
    },
  };
}
