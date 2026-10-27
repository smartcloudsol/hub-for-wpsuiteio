import { resolvePlatformConnection } from "../platform-connection.ts";

export interface ConnectionIdentity {
  workspaceId?: string;
  accountId?: string;
  siteId?: string;
  siteKey?: string;
  workspaceApiMode?: string;
  platformApiBaseUrl?: string;
  platformConfigUrl?: string;
}

/** Never turn missing credentials into the literal strings "undefined" or "null". */
export function usableSiteKey(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 &&
    !/\s/.test(value) && !["undefined", "null"].includes(value.toLowerCase()) &&
    !Array.from(value).some(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
}

export function connectionIdentity(value: ConnectionIdentity): string {
  const workspace = value.workspaceId || value.accountId;
  if (!workspace || !value.siteId ||
    (value.workspaceId && value.accountId && value.workspaceId !== value.accountId)) {
    throw new Error("A workspace and site must be selected before connecting.");
  }
  const mode = value.workspaceApiMode ?? "legacy";
  if (mode !== "legacy" && mode !== "workspace") throw new Error("Invalid connection mode.");
  const platform = resolvePlatformConnection(value, "", "");
  return JSON.stringify([workspace, value.siteId, mode, platform.apiBaseUrl, platform.configUrl]);
}

export function reusableLocalSiteKey(current: ConnectionIdentity, target: ConnectionIdentity): string | undefined {
  if (!usableSiteKey(current.siteKey)) return undefined;
  try { return connectionIdentity(current) === connectionIdentity(target) ? current.siteKey : undefined; }
  catch { return undefined; }
}

export interface ConnectionKeyInput { binding: string; key: string }

export function connectionKeyInputBinding(target: ConnectionIdentity, apiBaseUrl: string): string {
  return JSON.stringify([connectionIdentity(target), apiBaseUrl]);
}

export function enteredConnectionKey(input: ConnectionKeyInput | undefined, target: ConnectionIdentity, apiBaseUrl: string): string | undefined {
  if (input?.binding !== connectionKeyInputBinding(target, apiBaseUrl) || input.key === "") return undefined;
  if (!usableSiteKey(input.key)) throw new Error("The entered connection key is incomplete. Enter a valid key or clear the field to reuse the stored connection.");
  return input.key;
}

export interface PendingSiteKey {
  binding: string;
  expectedSiteKeyId: string;
  requestId: string;
  siteKey: string;
}

/** Called only from the explicit replacement confirmation, never from rendering or selection. */
export function createPendingSiteKey(target: ConnectionIdentity, expectedSiteKeyId: string, entropy: Pick<Crypto, "getRandomValues" | "randomUUID"> = crypto): PendingSiteKey {
  if (!expectedSiteKeyId?.trim() || expectedSiteKeyId !== expectedSiteKeyId.trim()) {
    throw new Error("Reload the site list before replacing its connection key.");
  }
  const bytes = entropy.getRandomValues(new Uint8Array(32));
  const siteKey = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return { binding: connectionIdentity(target), expectedSiteKeyId, requestId: entropy.randomUUID(), siteKey };
}

export function validateRotationResponse(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    typeof (value as Record<string, unknown>).siteKeyId !== "string" ||
    !(value as Record<string, unknown>).siteKeyId) {
    throw new Error("The connection key replacement was not confirmed. Retry before connecting.");
  }
}

export function failureStatus(error: unknown): number | undefined {
  if (!error || typeof error !== "object") return undefined;
  const value = error as { status?: unknown; statusCode?: unknown; response?: { statusCode?: unknown }; $metadata?: { httpStatusCode?: unknown } };
  const status = value.response?.statusCode ?? value.$metadata?.httpStatusCode ?? value.statusCode ?? value.status;
  return typeof status === "number" ? status : undefined;
}
