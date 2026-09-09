import assert from "node:assert/strict";
import test from "node:test";
import { getCustomTranslations, loadTranslationCatalogs } from "../src/translation-loader.ts";

test("translation loading validates dictionaries, handles HTTP/errors and bounds initialization", async () => {
  const original = globalThis.fetch;
  try {
    let requested = "";
    globalThis.fetch = async (url) => { requested = String(url); return Response.json({ hu_HU: { Send: "Küldés", Empty: "" } }); };
    assert.deepEqual(await loadTranslationCatalogs("https://example.test/dict.json?v=1#data", { cacheVersion: 2 }), { hu_HU: { Send: "Küldés", Empty: "" } });
    assert.equal(new URL(requested).searchParams.get("t"), "2");
    for (const input of [[], { hu: { Send: 4 } }, { system: { Send: "wrong" } }]) {
      globalThis.fetch = async () => Response.json(input);
      let reason;
      assert.equal(await loadTranslationCatalogs("https://example.test/dict.json", { onError: (value) => { reason = value; } }), null);
      assert.equal(reason, "invalid");
    }
    globalThis.fetch = async () => new Response(null, { status: 503 });
    let reason;
    assert.equal(await loadTranslationCatalogs("https://example.test/dict.json", { onError: (value) => { reason = value; } }), null);
    assert.equal(reason, "http");
    globalThis.fetch = () => new Promise(() => {});
    assert.equal(await loadTranslationCatalogs("https://example.test/dict.json", { timeoutMs: 10, onError: (value) => { reason = value; } }), null);
    assert.equal(reason, "timeout");
  } finally { globalThis.fetch = original; }
});

test("shared custom translations prefer site settings, deduplicate requests and support legacy fallback", async () => {
  const originalFetch = globalThis.fetch;
  const originalWpSuite = globalThis.WpSuite;
  try {
    let requests = 0;
    let requested = "";
    globalThis.fetch = async (url) => {
      requests += 1;
      requested = String(url);
      return Response.json({ de: { Save: "Speichern" } });
    };
    globalThis.WpSuite = {
      siteSettings: {
        customTranslationsUrl: "https://example.test/shared.json",
        lastUpdate: 41,
      },
      nonce: "",
      restUrl: "",
      uploadUrl: "",
      view: "settings",
      plugins: {},
    };

    const [first, second] = await Promise.all([
      getCustomTranslations({ legacyUrl: "https://example.test/legacy.json" }),
      getCustomTranslations({ legacyUrl: "https://example.test/other.json" }),
    ]);
    assert.deepEqual(first, { de: { Save: "Speichern" } });
    assert.deepEqual(second, first);
    assert.equal(requests, 1);
    assert.equal(new URL(requested).pathname, "/shared.json");
    assert.equal(new URL(requested).searchParams.get("t"), "41");

    globalThis.WpSuite.siteSettings = { lastUpdate: 42 };
    await getCustomTranslations({ legacyUrl: "https://example.test/legacy.json" });
    assert.equal(new URL(requested).pathname, "/legacy.json");
    assert.equal(new URL(requested).searchParams.get("t"), "42");
  } finally {
    globalThis.fetch = originalFetch;
    globalThis.WpSuite = originalWpSuite;
  }
});
