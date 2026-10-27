import { assertBackendProfileConfiguration, assertBackendProfileCurrent, getBackendProfileContext, resolveBackendProfileLegacyTargets } from "@smart-cloud/wpsuite-core";

export interface PlatformConnectionSettings {
  platformApiBaseUrl?: unknown;
  platformConfigUrl?: unknown;
  workspaceApiMode?: unknown;
}

export interface PlatformConnection {
  apiBaseUrl: string;
  configUrl: string;
  explicit: boolean;
  profiled?: boolean;
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
    const targets = resolveBackendProfileLegacyTargets(legacyApi, legacyConfig);
    return { ...targets, explicit: false, ...(getBackendProfileContext() ? { profiled: true } : {}) };
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

/** Preserve the historical network fallback only for unconfigured installations. */
export async function fetchPlatformConfiguration(
  connection: PlatformConnection,
  legacyFallback: () => unknown,
  fetcher: (url: string) => Promise<Response> = fetch,
): Promise<Response> {
  try {
    assertBackendProfileCurrent();
    return await fetcher(connection.configUrl);
  } catch (error) {
    if (connection.explicit || connection.profiled) throw error;
    return new Response(JSON.stringify(legacyFallback()), {
      headers: { "Content-Type": "application/json" },
    });
  }
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
