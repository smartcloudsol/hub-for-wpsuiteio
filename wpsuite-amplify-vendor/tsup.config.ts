import { defineConfig } from "tsup";
import externalGlobal from "esbuild-plugin-external-global";
import fs from "fs";
import path from "path";

export default defineConfig({
  entry: {
    "wpsuite-amplify-vendor": "src/index.ts",
  },
  format: ["iife"],
  globalName: "WpSuiteAmplify",
  platform: "browser",
  bundle: true,
  treeshake: true,
  minify: true,
  sourcemap: false,
  dts: false,
  clean: true,
  external: ["react", "react-dom"],
  esbuildPlugins: [
    externalGlobal.externalGlobalPlugin({
      react: "React",
      "react-dom": "ReactDOM",
    }),
  ],
  onSuccess: async () => {
    const dist = "dist";
    const src = path.join(dist, "wpsuite-amplify-vendor.global.js");
    const dst = path.join(dist, "wpsuite-amplify-vendor.min.js");

    if (fs.existsSync(src)) fs.renameSync(src, dst);
  },
});
