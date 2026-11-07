import { record, workspaceRequestPath, workspaceResponseView } from "./workspace-compat.ts";
import { assertBackendProfileConfiguration, assertBackendProfileCurrent, getBackendProfileContext, resolveBackendProfileLegacyTargets } from "@smart-cloud/wpsuite-core";

export interface PlatformConnectionSettings {
  platformApiBaseUrl?: unknown;
  platformConfigUrl?: unknown;
  workspaceApiMode?: unknown;
  workspaceId?: unknown;
  accountId?: unknown;
  siteId?: unknown;
  siteKey?: unknown;
}

export interface PlatformConnection {
  apiBaseUrl: string;
  configUrl: string;
  explicit: boolean;
  profiled?: boolean;
}

/** Carry a new installation's verified authority into routing and the eventual saved connection. */
export function initializeUnboundFoundation(settings: PlatformConnectionSettings, connection: PlatformConnection): void {
  if (getBackendProfileContext() || !connection.explicit || settings.workspaceId || settings.accountId || settings.siteId || settings.siteKey
    || settings.platformApiBaseUrl || settings.platformConfigUrl) return;
  Object.assign(settings, { workspaceApiMode: "workspace", platformApiBaseUrl: connection.apiBaseUrl, platformConfigUrl: connection.configUrl });
}

interface ReconnectCandidate {
  readonly connection: Readonly<PlatformConnection>;
  readonly original: readonly unknown[];
}
const reconnectCandidates = new WeakMap<object, ReconnectCandidate>();
const connectionFields = ["workspaceId", "accountId", "siteId", "siteKey", "workspaceApiMode", "platformApiBaseUrl", "platformConfigUrl"] as const;
const firstPartyFoundation = {
  "https://wpsuite.io/static/config/foundation/prod/config.json": { api: "https://api.wpsuite.io", origin: "https://wpsuite.io" },
  "https://wpsuite.io/static/config/foundation/dev/config.json": { api: "https://api-dev.wpsuite.io", origin: "https://dev.wpsuite.io" },
};

/** Record a reconnect offer, never rewrite the current runtime or sealed connection. */
export function captureFoundationReconnectConnection(settings: PlatformConnectionSettings, connection: PlatformConnection, configuration: unknown): void {
  reconnectCandidates.delete(settings);
  if (getBackendProfileContext() || connection.explicit || settings.platformApiBaseUrl || settings.platformConfigUrl
    || (settings.workspaceApiMode !== undefined && settings.workspaceApiMode !== "legacy")) return;
  const firstParty = firstPartyFoundation[connection.configUrl as keyof typeof firstPartyFoundation];
  // An old /dev base or custom endpoint cannot adopt authority from another API.
  if (!firstParty || connection.apiBaseUrl !== firstParty.api) return;
  const config = record(configuration);
  validatePlatformConfiguration({ ...connection, explicit: true }, config);
  const region = config.awsRegion;
  if (config.baseUrl !== firstParty.origin || typeof region !== "string" || !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region)
    || typeof config.userPoolId !== "string" || !new RegExp(`^${region}_[A-Za-z0-9]+$`).test(config.userPoolId)
    || typeof config.identityPoolId !== "string" || !new RegExp(`^${region}:[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}$`).test(config.identityPoolId)
    || typeof config.appClientPlugin !== "string" || !/^[a-z0-9]{1,128}$/.test(config.appClientPlugin)) throw new Error("Invalid Foundation reconnect identity.");
  reconnectCandidates.set(settings, { original: connectionFields.map(field => settings[field]),
    connection: Object.freeze({ apiBaseUrl: firstParty.api, configUrl: connection.configUrl, explicit: true }) });
}

/** Proof is tied to the exact original binding and expires on any in-page replacement. */
export function getFoundationReconnectConnection(settings: PlatformConnectionSettings | undefined): Readonly<PlatformConnection> | undefined {
  if (!settings || getBackendProfileContext()) return;
  const candidate = reconnectCandidates.get(settings);
  if (candidate && !connectionFields.every((field, index) => Object.is(settings[field], candidate.original[index]))) throw new Error("The platform connection changed. Reload before reconnecting this site.");
  return candidate?.connection;
}

/** Called by explicit site selection; a legacy credential is never inherited by the new tuple. */
export function buildSiteReconnectTarget<T extends PlatformConnectionSettings>(settings: T, workspaceId: string, siteId: string): T & { workspaceId: string; accountId: string; siteId: string } {
  const candidate = getFoundationReconnectConnection(settings);
  return { ...settings, workspaceId, accountId: workspaceId, siteId,
    ...(candidate ? { siteKey: undefined, workspaceApiMode: "workspace", platformApiBaseUrl: candidate.apiBaseUrl, platformConfigUrl: candidate.configUrl } : {}) };
}

type SelectorApi = Pick<typeof import("@aws-amplify/api"), "get" | "post" | "put" | "del">;
/** Canonical selection is local to the reconnect modal. Existing licence calls keep their binding. */
export function createSiteSelectorApi(legacy: SelectorApi, canonical: SelectorApi, settings: PlatformConnectionSettings | undefined, configuredEndpoint: (apiName: string) => string | undefined): SelectorApi {
  const capturedCandidate = getFoundationReconnectConnection(settings);
  const result = {} as SelectorApi;
  for (const method of ["get", "post", "put", "del"] as const) {
    result[method] = (input => {
      const candidate = getFoundationReconnectConnection(settings);
      if (!candidate) {
        if (capturedCandidate) throw new Error("The Foundation reconnect configuration is no longer verified. Reload this page.");
        return legacy[method](input);
      }
      if (configuredEndpoint(input.apiName)?.replace(/\/+$/, "") !== candidate.apiBaseUrl) throw new Error("The authenticated backend does not match the selected platform connection.");
      const path = workspaceRequestPath(input.path, "workspace");
      const operation = canonical[method]({ ...input, path });
      if (method === "del") return operation;
      return { ...operation, response: operation.response.then(response => ({ ...response, body: { ...response.body,
        json: async () => workspaceResponseView(path, await response.body.json(), input.options?.queryParams ? record(input.options.queryParams) : {}) as Awaited<ReturnType<typeof response.body.json>>,
      } })) };
    }) as SelectorApi[typeof method];
  }
  return result;
}

function optionalUrl(value: unknown, field: string): string {
  if (value === undefined || value === "") return "";
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function secureUrl(
  value: string,
  field: string,
  configuration = false,
): string {
  const hasControlCharacters = Array.from(value).some(
    (character) =>
      character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
  );
  if (
    !/^https:\/\/[^/]/i.test(value) ||
    /[\s\\?#]/.test(value) ||
    hasControlCharacters
  ) {
    throw new Error(
      `${field} must be an absolute HTTPS URL without query or fragment`,
    );
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${field} must be an absolute HTTPS URL`);
  }
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    value.split("/")[2]?.includes("@")
  ) {
    throw new Error(`${field} must not include credentials`);
  }
  if (configuration && !url.pathname.toLowerCase().endsWith(".json")) {
    throw new Error(`${field} must name a JSON configuration file`);
  }
  return configuration ? url.href : url.href.replace(/\/+$/, "");
}

/** Operator-provided platform binding takes precedence over build/site heuristics. */
export function resolvePlatformConnection(
  settings: PlatformConnectionSettings | undefined,
  legacyApi: string,
  legacyConfig: string,
): PlatformConnection {
  const api = optionalUrl(settings?.platformApiBaseUrl, "platformApiBaseUrl");
  const config = optionalUrl(settings?.platformConfigUrl, "platformConfigUrl");
  if (!api && !config) {
    if (!getBackendProfileContext() && !settings?.workspaceId && !settings?.accountId && !settings?.siteId && !settings?.siteKey) {
      return { apiBaseUrl: "https://api.wpsuite.io", configUrl: "https://wpsuite.io/static/config/foundation/prod/config.json", explicit: true };
    }
    const targets = resolveBackendProfileLegacyTargets(legacyApi, legacyConfig);
    // Existing /account connections keep their site identity and transport. Only
    // the retired first-party authentication catalog moves to its stable alias.
    const catalogAliases: Record<string, string> = {
      "https://wpsuite.io/static/config/prod.json": "https://wpsuite.io/static/config/foundation/prod/config.json",
      "https://wpsuite.io/static/config/dev.json": "https://wpsuite.io/static/config/foundation/dev/config.json",
    };
    return { ...targets, configUrl: catalogAliases[targets.configUrl] ?? targets.configUrl, explicit: false, ...(getBackendProfileContext() ? { profiled: true } : {}) };
  }
  if (!api || !config)
    throw new Error(
      "platformApiBaseUrl and platformConfigUrl must be supplied together",
    );
  if (settings?.workspaceApiMode !== "workspace")
    throw new Error("Explicit platform connection requires workspace API mode");
  return {
    apiBaseUrl: secureUrl(api, "platformApiBaseUrl"),
    configUrl: secureUrl(config, "platformConfigUrl", true),
    explicit: true,
  };
}

/** A private binding must never authenticate against identity from another backend. */
export function validatePlatformConfiguration(
  connection: PlatformConnection,
  configuration: unknown,
): void {
  assertBackendProfileConfiguration(configuration);
  if (!connection.explicit) return;
  if (
    !configuration ||
    typeof configuration !== "object" ||
    Array.isArray(configuration)
  )
    throw new Error("Invalid platform configuration");
  const config = configuration as Record<string, unknown>;
  if (
    config.foundationApiRegion !== undefined &&
    (typeof config.foundationApiRegion !== "string" ||
      !/^[a-z]{2}(?:-[a-z]+)+-\d+$/.test(config.foundationApiRegion))
  ) {
    throw new Error("Invalid Foundation API region");
  }
  if (
    config.workspaceApiMode !== "workspace" ||
    typeof config.foundationApiBaseUrl !== "string" ||
    secureUrl(config.foundationApiBaseUrl, "foundationApiBaseUrl") !==
      connection.apiBaseUrl
  ) {
    throw new Error(
      "Downloaded platform configuration does not match the explicit connection",
    );
  }
}

/** Configuration failures must never switch identity authorities. */
export async function fetchPlatformConfiguration(
  connection: PlatformConnection,
  _legacyFallback: () => unknown,
  fetcher: (url: string) => Promise<Response> = fetch,
): Promise<Response> {
  assertBackendProfileCurrent();
  return fetcher(connection.configUrl);
}

interface PlatformAuthSession {
  tokens?: { accessToken?: { toString(): string } };
}

/** Global identity operations use the dedicated IAM alias; scoped operations use JWT. */
export function platformRestOptions(
  connection: PlatformConnection,
  readSession: () => Promise<PlatformAuthSession>,
  onLegacyError: (error: unknown) => void = () => undefined,
): {
  headers: (options: { apiName: string }) => Promise<Record<string, string>>;
} {
  return {
    headers: async ({ apiName }): Promise<Record<string, string>> => {
      if (apiName !== "backend") return {};
      try {
        const token = (await readSession()).tokens?.accessToken;
        if (token) {
          const value = token.toString();
          if (!connection.explicit || value)
            return { Authorization: `Bearer ${value}` };
        }
        if (connection.explicit)
          throw new Error(
            "Sign in to your WP Suite workspace before accessing this API.",
          );
      } catch (error) {
        if (connection.explicit) throw error;
        onLegacyError(error);
      }
      return {};
    },
  };
}
