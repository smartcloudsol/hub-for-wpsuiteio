import { getWpSuite } from "@smart-cloud/wpsuite-core";

export type BackendState = "ready" | "configure_backend" | "sign_in" | "gatey_missing" | "forbidden" | "unreachable" | "unsupported";
export type BackendId = "answers" | "forms-workflows";
export const backendStates: readonly string[] = ["ready", "configure_backend", "sign_in", "gatey_missing", "forbidden", "unreachable", "unsupported"];
const prefix = "wpsuite-backend-access:v1:";
const lifetime = 5 * 60 * 1000;
export const backendCacheChanged = "wpsuite-backend-cache-invalidated";

export function backendCacheKey(id: BackendId): string {
  const suite = getWpSuite();
  const site = suite?.siteSettings;
  const revisions = ["gatey", id === "answers" ? "aiKit" : "flow"].map(name => {
    const plugin = suite?.plugins?.[name] as { version?: string; settings?: { lastUpdate?: number } } | undefined;
    return [plugin?.version, plugin?.settings?.lastUpdate];
  });
  // No credentials or backend responses are persisted. Origin is implicitly
  // isolated by sessionStorage; the admin path also separates multisite blogs.
  return prefix + JSON.stringify([new URL(".", window.location.href).pathname, site?.accountId, site?.siteId, site?.lastUpdate, revisions, id]);
}
export function readBackendCache(key: string): BackendState | null {
  try {
    const cached = JSON.parse(sessionStorage.getItem(key) ?? "null");
    const age = Date.now() - cached?.time;
    if (cached && backendStates.includes(cached.state) && Number.isFinite(age) && age >= 0 && age < lifetime) return cached.state;
    sessionStorage.removeItem(key);
  } catch { /* Storage can be disabled; the live check still works. */ }
  return null;
}
export function writeBackendCache(key: string, state: BackendState) {
  try { sessionStorage.setItem(key, JSON.stringify({ state, time: Date.now() })); } catch { /* Optional cache. */ }
}
let channel: BroadcastChannel | undefined;
export function invalidateBackendCache(broadcast = true) {
  try {
    for (const key of Object.keys(sessionStorage)) if (key.startsWith(prefix)) sessionStorage.removeItem(key);
  } catch { /* Optional cache. */ }
  if (broadcast) channel?.postMessage("invalidate");
  window.dispatchEvent(new Event(backendCacheChanged));
}

let initialized = false;
/** Keep invalidation alive on Gatey's sign-in page, even without a status panel. */
export function initializeBackendCache() {
  if (initialized) return;
  initialized = true;
  try {
    channel = new BroadcastChannel("wpsuite-backend-access");
    channel.onmessage = event => { if (event.data === "invalidate") invalidateBackendCache(false); };
  } catch { /* Cross-tab signalling is optional; cached results expire in five minutes. */ }
  let subscribed = false;
  let refreshFailureHandled = false;
  function subscribeAuth() {
    if (subscribed || !window.WpSuiteAmplify?.Hub?.listen) return;
    subscribed = true;
    window.WpSuiteAmplify.Hub.listen("auth", ({ payload }) => {
      if (payload.event === "signedIn" || payload.event === "signedOut") {
        refreshFailureHandled = false;
        invalidateBackendCache();
      } else if (payload.event === "tokenRefresh_failure" && !refreshFailureHandled) {
        refreshFailureHandled = true;
        invalidateBackendCache();
      }
    });
  }
  window.addEventListener("wpsuite-backend-session-changed", () => invalidateBackendCache());
  window.addEventListener("smartcloud-wpsuite-backend-ready", subscribeAuth);
  window.addEventListener("wpsuite:gatey:ready", subscribeAuth);
  // Focus only discovers a late-loaded auth bus; it never probes a backend.
  window.addEventListener("focus", subscribeAuth);
  subscribeAuth();
}
