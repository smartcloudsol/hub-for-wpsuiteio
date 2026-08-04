import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const packageJson = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);
const blockJson = JSON.parse(
  await readFile(
    new URL("../src/fallback/block.json", import.meta.url),
    "utf8",
  ),
);

test("publishes separate runtime and editor entry points", () => {
  assert.equal(packageJson.name, "@smart-cloud/wpsuite-blocks");
  assert.ok(packageJson.exports["."]);
  assert.ok(packageJson.exports["./editor"]);
});

test("limits the fallback to supported React root blocks", () => {
  assert.equal(blockJson.name, "wpsuite/react-fallback");
  assert.deepEqual(blockJson.parent, [
    "smartcloud-ai-kit/feature",
    "smartcloud-ai-kit/doc-search",
    "gatey/authenticator",
    "smartcloud-flow/form",
    "smartcloud-flow/content-root",
  ]);
});
