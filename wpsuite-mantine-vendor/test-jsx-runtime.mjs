import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const bundle = readFileSync(fileURLToPath(new URL("./dist/mantine-vendor.min.js", import.meta.url)), "utf8");
assert.match(bundle, /\bReactJSXRuntime\b/);
assert.doesNotMatch(bundle, /([\x27\x22\x60])react\.element\1/);
assert.doesNotMatch(bundle, /\b(?:window\.)?ReactJSXRuntime\s*=(?!=)/);
console.log("mantine vendor uses the WordPress JSX runtime without bundling pre-19 React.");
