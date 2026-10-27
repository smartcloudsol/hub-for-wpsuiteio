import assert from "node:assert/strict";
import test from "node:test";

import {
  fetchPlatformConfiguration,
  platformRestOptions,
  resolvePlatformConnection,
  validatePlatformConfiguration,
} from "./platform-connection.ts";

const legacyApi = "https://legacy-platform.example";
const legacyConfig = "https://legacy-platform.example/config/prod.json";
const explicitSettings = {
  platformApiBaseUrl: "https://private-api.eu-central-1.example/dev/",
  platformConfigUrl: "https://delivery.example/private/config/dev.json",
  workspaceApiMode: "workspace",
};

// These are synthetic endpoints; production build/WordPress host never select an explicit binding.
test("a demo explicit developer binding selects EU endpoints even with production defaults", () => {
  assert.deepEqual(
    resolvePlatformConnection(explicitSettings, legacyApi, legacyConfig),
    {
      apiBaseUrl: "https://private-api.eu-central-1.example/dev",
      configUrl: explicitSettings.platformConfigUrl,
      explicit: true,
    },
  );
  assert.deepEqual(
    resolvePlatformConnection(
      {
        ...explicitSettings,
        platformApiBaseUrl:
          "HTTPS://PRIVATE-API.EU-CENTRAL-1.EXAMPLE:443/dev///",
      },
      legacyApi,
      legacyConfig,
    ),
    {
      apiBaseUrl: "https://private-api.eu-central-1.example/dev",
      configUrl: explicitSettings.platformConfigUrl,
      explicit: true,
    },
  );
});

test("unconfigured sites retain their exact legacy endpoints and behavior", async () => {
  for (const settings of [
    undefined,
    {},
    { platformApiBaseUrl: "", platformConfigUrl: "" },
    { workspaceApiMode: "workspace" },
  ]) {
    const connection = resolvePlatformConnection(
      settings,
      legacyApi,
      legacyConfig,
    );
    assert.deepEqual(connection, {
      apiBaseUrl: legacyApi,
      configUrl: legacyConfig,
      explicit: false,
    });
    assert.doesNotThrow(() =>
      validatePlatformConfiguration(connection, { legacy: true }),
    );
  }
  const connection = resolvePlatformConnection(
    undefined,
    legacyApi,
    legacyConfig,
  );
  const downloaded = { source: "legacy-fallback" };
  const response = await fetchPlatformConfiguration(
    connection,
    () => downloaded,
    () => Promise.reject(new Error("offline")),
  );
  assert.deepEqual(await response.json(), downloaded);
});

test("the platform API signing region can differ from Cognito without changing the endpoint binding", () => {
  const connection = resolvePlatformConnection(explicitSettings, legacyApi, legacyConfig);
  const configuration = {
    workspaceApiMode: "workspace",
    foundationApiBaseUrl: connection.apiBaseUrl,
    awsRegion: "eu-central-1",
    foundationApiRegion: "us-east-1",
  };
  assert.doesNotThrow(() => validatePlatformConfiguration(connection, configuration));
  for (const foundationApiRegion of ["", "us-east-1/execute-api", 1, null]) {
    assert.throws(() => validatePlatformConfiguration(connection, { ...configuration, foundationApiRegion }), /Invalid Foundation API region/);
  }
});

test("partial, malformed or legacy-mode explicit bindings fail closed", () => {
  const invalid = [
    { platformApiBaseUrl: explicitSettings.platformApiBaseUrl },
    { platformConfigUrl: explicitSettings.platformConfigUrl },
    { ...explicitSettings, platformApiBaseUrl: "" },
    { ...explicitSettings, workspaceApiMode: "legacy" },
    { ...explicitSettings, workspaceApiMode: undefined },
    { ...explicitSettings, platformApiBaseUrl: null },
    { ...explicitSettings, platformConfigUrl: false },
  ];
  for (const settings of invalid)
    assert.throws(() =>
      resolvePlatformConnection(settings, legacyApi, legacyConfig),
    );
  for (const field of ["platformApiBaseUrl", "platformConfigUrl"]) {
    for (const url of [
      "http://platform.example/config.json",
      "/config.json",
      "https:///platform.example/config.json",
      "https://user:password@platform.example/config.json",
      "https://@platform.example/config.json",
      "https://platform.example/config.json?token=value",
      "https://platform.example/config.json?",
      "https://platform.example/config.json#",
      "https://platform.example/config.json#fragment",
      " https://platform.example/config.json",
      "https://platform.example/invalid\\config.json",
    ]) {
      assert.throws(
        () =>
          resolvePlatformConnection(
            { ...explicitSettings, [field]: url },
            legacyApi,
            legacyConfig,
          ),
        `${field}: ${url}`,
      );
    }
  }
  assert.throws(
    () =>
      resolvePlatformConnection(
        {
          ...explicitSettings,
          platformConfigUrl: "https://delivery.example/config",
        },
        legacyApi,
        legacyConfig,
      ),
    /JSON/,
  );
});

test("downloaded configuration must match the explicit API and canonical workspace mode before auth", () => {
  const connection = resolvePlatformConnection(
    explicitSettings,
    legacyApi,
    legacyConfig,
  );
  assert.doesNotThrow(() =>
    validatePlatformConfiguration(connection, {
      foundationApiBaseUrl: connection.apiBaseUrl + "/",
      workspaceApiMode: "workspace",
    }),
  );
  for (const downloaded of [
    null,
    [],
    {},
    { foundationApiBaseUrl: legacyApi, workspaceApiMode: "workspace" },
    { foundationApiBaseUrl: connection.apiBaseUrl, workspaceApiMode: "legacy" },
    {
      foundationApiBaseUrl: connection.apiBaseUrl + "?fallback=true",
      workspaceApiMode: "workspace",
    },
  ]) {
    assert.throws(() => validatePlatformConfiguration(connection, downloaded));
  }
});

test("explicit network failures never invoke legacy identity fallback", async () => {
  const connection = resolvePlatformConnection(
    explicitSettings,
    legacyApi,
    legacyConfig,
  );
  let fallbackCalls = 0;
  const offline = new Error("private configuration unavailable");
  await assert.rejects(
    fetchPlatformConfiguration(
      connection,
      () => {
        fallbackCalls++;
        return {};
      },
      (url) => {
        assert.equal(url, explicitSettings.platformConfigUrl);
        return Promise.reject(offline);
      },
    ),
    (error) => error === offline,
  );
  assert.equal(fallbackCalls, 0);
});

test("HTTP errors preserve failure responses without switching environments", async () => {
  for (const settings of [undefined, explicitSettings]) {
    let fallbackCalls = 0;
    const connection = resolvePlatformConnection(
      settings,
      legacyApi,
      legacyConfig,
    );
    const response = await fetchPlatformConfiguration(
      connection,
      () => {
        fallbackCalls++;
        return {};
      },
      () => Promise.resolve(new Response("unavailable", { status: 503 })),
    );
    assert.equal(response.status, 503);
    assert.equal(fallbackCalls, 0);
  }
});

// These pure installed SDK utilities are the actual REST signing decision,
// exercised without fetching credentials, sending requests or configuring an SDK.
const signingModule = (await import(
  new URL(
    "../node_modules/@aws-amplify/api-rest/dist/esm/utils/isIamAuthApplicable.mjs",
    import.meta.url,
  ).href
)) as {
  isIamAuthApplicableForRest(
    request: { headers: Record<string, string> },
    info: { service: string; region: string },
  ): boolean;
};
const headerModule = (await import(
  new URL(
    "../node_modules/@aws-amplify/api-rest/dist/esm/utils/resolveHeaders.mjs",
    import.meta.url,
  ).href
)) as {
  resolveHeaders(headers: Record<string, string>): Record<string, string>;
};

const installedRest = await import(
  new URL(
    "../node_modules/@aws-amplify/api-rest/dist/esm/apis/common/publicApis.mjs",
    import.meta.url,
  ).href
);
const syntheticCredentials = () => ({
  accessKeyId: "AKIDSYNTHETICEXAMPLE",
  secretAccessKey: "synthetic-offline-test-signing-secret",
  sessionToken: "synthetic-offline-session-token",
  expiration: new Date(Date.now() + 60000),
});

test("explicit global account call uses native SDK IAM with no authentication overrides", async () => {
  const connection = resolvePlatformConnection(
    explicitSettings,
    legacyApi,
    legacyConfig,
  );
  const session = {
    credentials: syntheticCredentials(),
    tokens: { accessToken: { toString: () => "synthetic-scoped-token" } },
  };
  const libraryOptions = platformRestOptions(connection, async () => session);
  const amplify = {
    getConfig: () => ({
      API: {
        REST: {
          backendWithIam: {
            endpoint: connection.apiBaseUrl,
            region: "eu-central-1",
          },
        },
      },
    }),
    libraryOptions: { API: { REST: libraryOptions } },
    Auth: { fetchAuthSession: async () => session },
  };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (url, init) => {
    requests++;
    assert.equal(String(url), `${connection.apiBaseUrl}/workspace`);
    const headers = new Headers(init?.headers);
    assert.match(headers.get("authorization") ?? "", /^AWS4-HMAC-SHA256 /);
    assert.match(
      headers.get("authorization") ?? "",
      /\/eu-central-1\/execute-api\/aws4_request/,
    );
    assert.equal(
      headers.get("x-amz-security-token"),
      session.credentials.sessionToken,
    );
    assert.ok(headers.get("x-amz-date"));
    return new Response("[]", { status: 200 });
  };
  try {
    const response = await installedRest.get(amplify, {
      apiName: "backendWithIam",
      path: "/workspace",
    }).response;
    assert.equal(response.statusCode, 200);
    assert.equal(requests, 1);
    assert.equal(Object.hasOwn(libraryOptions, "defaultAuthMode"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("native SDK credential absence cannot turn an IAM-only operation into an accepted unsigned request", async () => {
  const connection = resolvePlatformConnection(explicitSettings, legacyApi, legacyConfig);
  const amplify = {
    getConfig: () => ({ API: { REST: { backendWithIam: {
      endpoint: connection.apiBaseUrl, region: "eu-central-1",
    } } } }),
    libraryOptions: { API: { REST: platformRestOptions(connection, async () => { throw new Error("IAM must not request a JWT"); }) } },
    Auth: { fetchAuthSession: async () => ({}) },
  };
  const originalFetch = globalThis.fetch; let requests = 0;
  globalThis.fetch = async (_url, init) => {
    requests++;
    assert.equal(new Headers(init?.headers).has("authorization"), false);
    return Response.json({ message: "IAM authentication required" }, { status: 403, headers: { "x-amzn-errortype": "ForbiddenException" } });
  };
  try {
    await assert.rejects(installedRest.get(amplify, {
      apiName: "backendWithIam", path: "/workspace",
      options: { retryStrategy: { strategy: "no-retry" } },
    }).response);
    assert.equal(requests, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("native SDK keeps scoped requests Bearer-authenticated without signing them", async () => {
  const connection = resolvePlatformConnection(
    explicitSettings,
    legacyApi,
    legacyConfig,
  );
  let credentialReads = 0;
  const amplify = {
    getConfig: () => ({
      API: {
        REST: {
          backend: {
            endpoint: connection.apiBaseUrl,
            region: "eu-central-1",
          },
        },
      },
    }),
    libraryOptions: {
      API: {
        REST: platformRestOptions(connection, async () => ({
          tokens: { accessToken: { toString: () => "synthetic-scoped-token" } },
        })),
      },
    },
    Auth: {
      fetchAuthSession: async () => {
        credentialReads++;
        throw new Error("Must not resolve IAM credentials");
      },
    },
  };
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async (_url, init) => {
    requests++;
    assert.equal(
      new Headers(init?.headers).get("authorization"),
      "Bearer synthetic-scoped-token",
    );
    assert.equal(new Headers(init?.headers).has("x-amz-security-token"), false);
    return new Response("{}", { status: 200 });
  };
  try {
    await installedRest.get(amplify, {
      apiName: "backend",
      path: "/workspace/synthetic",
    }).response;
    assert.equal(requests, 1);
    assert.equal(credentialReads, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("explicit scoped backend uses JWT while the dedicated global alias leaves IAM signing enabled", async () => {
  const connection = resolvePlatformConnection(
    explicitSettings,
    legacyApi,
    legacyConfig,
  );
  let sessionReads = 0;
  const options = platformRestOptions(connection, async () => {
    sessionReads++;
    return {
      credentials: syntheticCredentials(),
      tokens: {
        accessToken: { toString: () => "synthetic-workspace-access-token" },
      },
    };
  });
  assert.equal(Object.hasOwn(options, "defaultAuthMode"), false);
  for (const apiName of ["backend", "backendWithIam"]) {
    const headers = await options.headers({ apiName });
    assert.deepEqual(
      headers,
      apiName === "backend"
        ? {
            Authorization: "Bearer synthetic-workspace-access-token",
          }
        : {},
    );
    assert.equal(
      signingModule.isIamAuthApplicableForRest(
        { headers: headerModule.resolveHeaders(headers) },
        { service: "execute-api", region: "eu-central-1" },
      ),
      apiName === "backendWithIam",
    );
  }
  assert.equal(sessionReads, 1);
});

test("legacy backendWithIam preserves the IAM path and never resolves a JWT", async () => {
  const connection = resolvePlatformConnection(
    undefined,
    legacyApi,
    legacyConfig,
  );
  let sessionReads = 0;
  const options = platformRestOptions(connection, async () => {
    sessionReads++;
    throw new Error("Legacy IAM must not request a token");
  });
  const headers = await options.headers({ apiName: "backendWithIam" });
  assert.deepEqual(headers, {});
  assert.equal(Object.hasOwn(options, "defaultAuthMode"), false);
  assert.equal(sessionReads, 0);
  assert.equal(
    signingModule.isIamAuthApplicableForRest(
      { headers: headerModule.resolveHeaders(headers) },
      { service: "execute-api", region: "us-east-1" },
    ),
    true,
  );
});

test("explicit workspace auth fails before transfer instead of falling back to IAM when the token is absent", async () => {
  const connection = resolvePlatformConnection(
    explicitSettings,
    legacyApi,
    legacyConfig,
  );
  for (const session of [
    {},
    { tokens: {} },
    { tokens: { accessToken: { toString: () => "" } } },
  ]) {
    const options = platformRestOptions(connection, async () => session);
    await assert.rejects(
      options.headers({ apiName: "backend" }),
      /Sign in to your WP Suite workspace/,
    );
  }
  const failure = new Error("Session unavailable");
  await assert.rejects(
    platformRestOptions(connection, async () => {
      throw failure;
    }).headers({ apiName: "backend" }),
    (error) => error === failure,
  );
});

test("legacy backend JWT/error behavior and unrelated API helpers remain unchanged", async () => {
  const connection = resolvePlatformConnection(
    undefined,
    legacyApi,
    legacyConfig,
  );
  const options = platformRestOptions(connection, async () => ({
    tokens: {
      accessToken: { toString: () => "synthetic-legacy-access-token" },
    },
  }));
  assert.deepEqual(await options.headers({ apiName: "backend" }), {
    Authorization: "Bearer synthetic-legacy-access-token",
  });
  let errors = 0;
  const failing = platformRestOptions(
    connection,
    async () => {
      throw new Error("Synthetic legacy failure");
    },
    () => {
      errors++;
    },
  );
  assert.deepEqual(await failing.headers({ apiName: "backend" }), {});
  assert.equal(errors, 1);
  assert.deepEqual(await failing.headers({ apiName: "another-api" }), {});
  assert.equal(errors, 1);
});
