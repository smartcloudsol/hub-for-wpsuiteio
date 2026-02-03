import { defineConfig } from "tsup";
import fs from "fs";
import path from "path";

export default defineConfig({
  entry: {
    "webcrypto-vendor": "src/polyfill-entry.ts",
  },
  format: ["iife"],
  globalName: "WpSuiteWebcrypto",
  minify: true,
  sourcemap: false,
  clean: true,
  treeshake: false,
  onSuccess: async () => {
    const dist = "dist";
    const src = path.join(dist, "webcrypto-vendor.global.js");
    const dst = path.join(dist, "webcrypto-vendor.min.js");

    if (fs.existsSync(src)) fs.renameSync(src, dst);
  },
});
