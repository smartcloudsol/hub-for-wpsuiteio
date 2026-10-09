import assert from "node:assert/strict";
import test from "node:test";
import { groupAdvancedLinks, parseNavigation, parseSurface, runtimeValue, surfaceDraft, surfaceEndpoint, uniqueLinks } from "./navigation.ts";

const link = { label: "Settings", url: "/wp-admin/admin.php?page=ai-kit" };
const capability = {
  id: "answers", label: "Answers", product: "AI Kit", description: "Chat and search",
  url: "/wp-admin/admin.php?page=answers", primary: link, quick_links: [], advanced_links: [link],
};
const bootstrap = {
  schema_version: 1, view: "overview", overview_url: "/wp-admin/admin.php?page=smartcloud",
  advanced_url: "/wp-admin/admin.php?page=smartcloud-advanced", can_manage_connection: false,
  capabilities: [capability], platform_links: [], discovery: [],
};

test("accepts a permission-filtered bootstrap without inventing connection access", () => {
  assert.deepEqual(parseNavigation(JSON.stringify(bootstrap)), bootstrap);
});

test("rejects malformed or unsupported navigation instead of falling back to connection", () => {
  for (const value of ["{", "null", "[]", JSON.stringify({ ...bootstrap, schema_version: 2 }),
    JSON.stringify({ ...bootstrap, can_manage_connection: "true" }),
    JSON.stringify({ ...bootstrap, platform_links: null })]) {
    assert.equal(parseNavigation(value), null);
  }
});

test("rejects unsafe URLs in every navigation link surface", () => {
  for (const url of ["javascript:alert(1)", "java\nscript:alert(1)", "data:text/html,test"]) {
    assert.equal(parseNavigation(JSON.stringify({ ...bootstrap, overview_url: url })), null);
    assert.equal(parseNavigation(JSON.stringify({ ...bootstrap, capabilities: [{ ...capability, primary: { ...link, url } }] })), null);
    assert.equal(parseNavigation(JSON.stringify({ ...bootstrap, discovery: [{ ...capability, state: "not_installed", message: "", action: { ...link, url } }] })), null);
  }
});

test("accepts discovery without an install action when installation is unavailable", () => {
  const discovery = [{ id: "ai-tools", label: "AI Tools", product: "AI Kit", description: "Writing tools", state: "not_installed", message: "Ask an administrator", action: null }];
  assert.deepEqual(parseNavigation(JSON.stringify({ ...bootstrap, discovery }))?.discovery, discovery);
});

test("deduplicates shared Advanced targets within a product, preserving other products", () => {
  const groups = groupAdvancedLinks([capability, { ...capability, id: "ai-tools" }, { ...capability, id: "other", product: "Other plugin" }]);
  assert.deepEqual([...groups], [["AI Kit", [link]], ["Other plugin", [link]]]);
});

test("Advanced includes resource destinations and preserves specific provider labels", () => {
  const resource = { label: "Content library", url: "/wp-admin/edit.php" };
  const specific = { ...link, label: "Manage chatbot settings" };
  assert.deepEqual(uniqueLinks([specific], [resource, link], [link]), [specific, resource]);
  assert.deepEqual([...groupAdvancedLinks([{ ...capability, quick_links: [resource, link] }, capability])], [["AI Kit", [resource, link]]]);
});

const surface = {
  schema_version: 1, configured: false, can_edit: true, revision: "r1",
  status: { state: "needs_setup", label: "Needs local setup" }, notice: "Local settings do not prove backend availability.",
  metrics: [{ label: "Sources", value: 3 }], values: { target: "", enabled: false },
  steps: [{ id: "target", title: "Target", fields: [{ id: "target", label: "Target URL", type: "url", required: true }] },
    { id: "preferences", title: "Preferences", fields: [{ id: "enabled", label: "Enable sync", type: "checkbox" }] }],
  actions: [{ id: "publish", label: "Publish", confirm: "Queue publication?", fields: [] }], links: [link],
};

test("accepts optional surfaces and nonce without breaking old navigation", () => {
  const rich = { ...bootstrap, rest_nonce: "nonce", capabilities: [{ ...capability, surface_url: "/wp-json/smartcloud-wpsuite/v1/admin-surfaces/answers" }] };
  assert.deepEqual(parseNavigation(JSON.stringify(rich)), rich);
  assert.ok(parseNavigation(JSON.stringify({ ...rich, capabilities: [{ ...capability, surface_url: null }] })));
  assert.equal(parseNavigation(JSON.stringify({ ...rich, rest_nonce: 1 })), null);
  assert.equal(parseNavigation(JSON.stringify({ ...rich, capabilities: [{ ...capability, surface_url: "javascript:1" }] })), null);
});

test("optional surface extensions preserve old navigation and reject malformed identifiers", () => {
  for (const surface_extension of [undefined, null, "answers-publication"]) {
    const extended = { ...bootstrap, capabilities: [{ ...capability, surface_extension }] };
    assert.deepEqual(parseNavigation(JSON.stringify(extended))?.capabilities[0].surface_extension, surface_extension);
  }
  for (const surface_extension of [true, {}, "Answers", "", "x".repeat(65), "../plugin", "<script>"]) {
    assert.equal(parseNavigation(JSON.stringify({ ...bootstrap, capabilities: [{ ...capability, surface_extension }] })), null);
  }
});

test("validates rich surfaces before mounting editable controls", () => {
  assert.deepEqual(parseSurface(surface), surface);
  for (const changes of [
    { schema_version: 2 }, { can_edit: "yes" }, { revision: "" }, { values: { target: {}, enabled: true } },
    { values: { ...surface.values, secret: "not projected" } }, { steps: [surface.steps[0], surface.steps[0]] },
    { steps: [{ ...surface.steps[0], fields: [{ id: "constructor", label: "Unsafe", type: "text" }] }] },
    { actions: [{ id: "x", label: "X", fields: [{ id: "x", label: "X", type: "password" }] }] },
    { actions: [{ id: "x", label: "X", fields: [{ id: "x", label: "X", type: "select", options: [{ label: "A", value: "a" }, { label: "B", value: "a" }] }] }] },
    { runtime_plugin: "ai-kit", runtime_fields: [{ label: "Unsafe", path: "constructor.name", format: "text" }] },
    { runtime_plugin: "ai-kit", runtime_fields: [{ label: "Wrong", path: ["enabled"], format: "text" }] },
    { links: [{ label: "Unsafe", url: "javascript:alert(1)" }] },
  ]) assert.equal(parseSurface({ ...surface, ...changes }), null, JSON.stringify(changes));
});

test("optional setup permission supports custom wizards without granting generic editing", () => {
  for (const can_setup of [true, false]) {
    const custom = { ...surface, can_edit: false, can_setup, steps: [], values: {} };
    assert.deepEqual(parseSurface(custom), custom);
  }
  assert.ok(parseSurface(surface), "Older providers may omit setup permission");
  for (const can_setup of [null, undefined, 0, 1, "true", [], {}]) {
    assert.equal(parseSurface({ ...surface, can_setup }), null);
  }
});

test("wizard patches are allowlisted and preserve explicit existing values", () => {
  const fields = [{ id: "target", label: "Target", type: "url" as const }, { id: "enabled", label: "Enabled", type: "checkbox" as const }];
  assert.deepEqual(surfaceDraft(fields, { target: "https://target.test", enabled: false, advanced: "untouched" }), { target: "https://target.test", enabled: false });
  assert.deepEqual(surfaceDraft(fields), { target: "", enabled: false });
});

test("runtime projection exposes only declared own scalar fields and counts", () => {
  const config = { assistant: { enabled: true, entries: [{ private: "nested value" }] }, unknown: "secret" };
  assert.equal(runtimeValue(config, { label: "Enabled", path: "assistant.enabled", format: "boolean" }), true);
  assert.equal(runtimeValue(config, { label: "Entries", path: "assistant.entries", format: "count" }), 1);
  assert.equal(runtimeValue(config, { label: "Entries", path: "assistant.entries", format: "text" }), null);
  assert.equal(runtimeValue(config, { label: "Missing", path: "assistant.missing", format: "text" }), null);
  assert.equal(runtimeValue(config, { label: "Prototype", path: "constructor", format: "text" }), null);
  assert.equal(runtimeValue(Object.create({ inherited: "secret" }), { label: "Inherited", path: "inherited", format: "text" }), null);
});

test("nonce transport rejects other origins and supports plain-permalink action routes", () => {
  const origin = "https://site.test";
  assert.equal(surfaceEndpoint("/wp-json/smartcloud-wpsuite/v1/admin-surfaces/answers", origin, true), `${origin}/wp-json/smartcloud-wpsuite/v1/admin-surfaces/answers/action`);
  const plain = new URL(surfaceEndpoint("/?rest_route=/smartcloud-wpsuite/v1/admin-surfaces/answers", origin, true));
  assert.equal(plain.searchParams.get("rest_route"), "/smartcloud-wpsuite/v1/admin-surfaces/answers/action");
  for (const url of ["https://other.test/api", "//other.test/api", "https://user:pass@site.test/api", "javascript:1"]) assert.throws(() => surfaceEndpoint(url, origin));
});


test("canonical camelCase runtime plugin keys remain readable", () => {
  const rich = { ...surface, runtime_plugin: "aiKit", runtime_fields: [{ label: "Assistant", path: "chatbot.enabled", format: "boolean" }] };
  assert.deepEqual(parseSurface(rich), rich);
  const bounded = { description: "x".repeat(4096), items: Array.from({ length: 12 }, (_, index) => ({ ...siteUse.items[0], id: `form-${index}`, title: "x".repeat(256), description: "x".repeat(4096), status: "x".repeat(1024), links: Array(8).fill(link) })) };
  assert.ok(parseSurface({ ...surface, use_on_site: bounded }), "Exact documented collection and text bounds remain usable");
});


test("text fields preserve optional local suggestions endpoints while invalid contracts fail closed", () => {
  const fields = [{ id: "target", label: "Path", type: "text", suggestions_url: "/wp-json/gatey/v1/page-suggestions" }];
  const suggested = { ...surface, steps: [{ ...surface.steps[0], fields }], values: { target: "manual-path" } };
  assert.deepEqual(parseSurface(suggested), suggested);
  for (const field of [
    { ...fields[0], suggestions_url: true },
    { ...fields[0], suggestions_url: { url: "/suggestions" } },
    { ...fields[0], type: "url" },
    { ...fields[0], type: "select", options: [{value: "manual-path", label: "Path"}] },
  ]) assert.equal(parseSurface({ ...suggested, steps: [{ ...surface.steps[0], fields: [field] }] }), null);
  assert.deepEqual(surfaceDraft(fields as Parameters<typeof surfaceDraft>[0], suggested.values), { target: "manual-path" }, "Suggestion labels and result identifiers never become configuration fields");
});

const siteUse = {
  description: "Add these native blocks in the page editor.",
  items: [{ id: "form", title: "Flow Form", description: "Choose Flow Form in the inserter.", status: "Configured path: /sign-in/", links: [link] }],
};

test("optional site-use guidance accepts old providers and exposes no additional patch fields or actions", () => {
  assert.deepEqual(parseSurface(surface), surface, "Providers without placement guidance remain valid");
  const rich = { ...surface, use_on_site: siteUse };
  assert.deepEqual(parseSurface(rich), rich);
  assert.deepEqual(parseSurface({ ...surface, use_on_site: { description: "Read-only guidance", items: [{ ...siteUse.items[0], status: undefined, links: [] }] } })?.actions, surface.actions);
  assert.deepEqual(surfaceDraft(surface.steps.flatMap(step => step.fields) as Parameters<typeof surfaceDraft>[0], rich.values), surface.values, "Placement state never enters local settings");
});

test("site-use guidance rejects unsafe URLs, duplicate identifiers and oversized or malformed optional structures", () => {
  const item = siteUse.items[0];
  for (const malformed of [
    null, [], "guidance", { ...siteUse, description: false }, { ...siteUse, description: "x".repeat(4097) },
    { ...siteUse, items: {} }, { ...siteUse, items: Array.from({ length: 13 }, (_, index) => ({ ...item, id: `form-${index}` })) },
    { ...siteUse, items: [item, item] },
    ...[{ id: "Form" }, { id: "x".repeat(65) }, { title: true }, { title: "x".repeat(257) }, { description: null },
      { description: "x".repeat(4097) }, { status: false }, { status: null }, { status: "x".repeat(1025) },
      { links: null }, { links: Array(9).fill(link) }].map(changes => ({ ...siteUse, items: [{ ...item, ...changes }] })),
    ...["javascript:alert(1)", "java\nscript:1", "data:text/html,test", "file:///tmp/test"].map(url => ({ ...siteUse, items: [{ ...item, links: [{ ...link, url }] }] })),
  ]) assert.equal(parseSurface({ ...surface, use_on_site: malformed }), null, JSON.stringify(malformed));
});

const helpTopic = { id: "form-placement", title: "Add a form", summary: "Choose a destination.", paragraphs: ["Open the WordPress editor."] };
const helpedSurface = {
  ...surface, help: [helpTopic], metrics: [{ ...surface.metrics[0], help_id: helpTopic.id }],
  steps: surface.steps.map(step => ({ ...step, help_id: helpTopic.id, fields: step.fields.map(field => ({ ...field, help_id: helpTopic.id })) })),
  use_on_site: { ...siteUse, items: siteUse.items.map(item => ({ ...item, help_id: helpTopic.id })) },
};

test("optional contextual help preserves old providers and does not add patch values or actions", () => {
  assert.deepEqual(parseSurface(surface), surface);
  assert.deepEqual(parseSurface(helpedSurface), helpedSurface);
  assert.deepEqual(surfaceDraft(helpedSurface.steps.flatMap(step => step.fields) as Parameters<typeof surfaceDraft>[0], helpedSurface.values), surface.values);
  assert.deepEqual(parseSurface(helpedSurface)?.actions, surface.actions);
  const plainText = { ...helpTopic, paragraphs: ["<img src=x onerror=alert(1)>"] };
  assert.deepEqual(parseSurface({ ...surface, help: [plainText] })?.help?.[0].paragraphs, plainText.paragraphs, "Help is plain text data, never an executable HTML contract");
  const bounded = Array.from({ length: 32 }, (_, index) => ({ id: `topic-${index}`, title: "x".repeat(256), summary: "x".repeat(1024), paragraphs: Array(8).fill("x".repeat(4096)) }));
  assert.ok(parseSurface({ ...surface, help: bounded }), "Documented help bounds remain usable");
});

test("optional primary links preserve old surfaces and reject executable destinations", () => {
  assert.deepEqual(parseSurface(surface), surface);
  assert.deepEqual(parseSurface({ ...surface, primary_link: link })?.primary_link, link);
  for (const primary_link of [null, false, {}, { ...link, label: null },
    ...["javascript:alert(1)", "java\nscript:1", "data:text/html,test", "file:///tmp/test"].map(url => ({ ...link, url })),
  ]) assert.equal(parseSurface({ ...surface, primary_link }), null);
  assert.deepEqual(parseSurface({ ...surface, primary_link: link })?.actions, surface.actions, "A primary destination never becomes a mutation action");
});

test("malformed contextual help and references fail before rendering", () => {
  for (const help of [null, "help", {}, [helpTopic, helpTopic], Array.from({ length: 33 }, (_, index) => ({ ...helpTopic, id: `topic-${index}` })),
    ...[{ id: "Invalid" }, { id: "" }, { id: "x".repeat(65) }, { id: "<script>" }, { title: null }, { title: "x".repeat(257) },
      { summary: false }, { summary: "x".repeat(1025) }, { paragraphs: null }, { paragraphs: [null] },
      { paragraphs: Array(9).fill("text") }, { paragraphs: ["x".repeat(4097)] }].map(changes => [{ ...helpTopic, ...changes }]),
  ]) assert.equal(parseSurface({ ...surface, help }), null, JSON.stringify(help));
  for (const help_id of [null, true, [], "Bad", "", "x".repeat(65), "constructor.name"]) {
    assert.equal(parseSurface({ ...surface, metrics: [{ ...surface.metrics[0], help_id }] }), null);
    assert.equal(parseSurface({ ...surface, steps: [{ ...surface.steps[0], help_id }, ...surface.steps.slice(1)] }), null);
    assert.equal(parseSurface({ ...surface, steps: [{ ...surface.steps[0], fields: [{ ...surface.steps[0].fields[0], help_id }] }, ...surface.steps.slice(1)] }), null);
    assert.equal(parseSurface({ ...surface, use_on_site: { ...siteUse, items: [{ ...siteUse.items[0], help_id }] } }), null);
  }
});


test("onboarding introduction accepts bounded copy and rejects malformed payloads", () => {
  const introduction = { title: "Getting started", description: "Choose your first step.", items: [{ title: "No subscription required", description: "Use the available tools." }] };
  assert.deepEqual(parseSurface({ ...surface, introduction })?.introduction, introduction);
  assert.equal(parseSurface({ ...surface, introduction: { ...introduction, items: [{ title: "Bad", description: {} }] } }), null);
  assert.equal(parseSurface({ ...surface, introduction: { ...introduction, items: Array(9).fill(introduction.items[0]) } }), null);
});
