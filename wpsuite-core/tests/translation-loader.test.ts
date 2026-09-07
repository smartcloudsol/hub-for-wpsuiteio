import assert from "node:assert/strict";
import test from "node:test";
import { loadTranslationCatalogs } from "../src/translation-loader.ts";

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
