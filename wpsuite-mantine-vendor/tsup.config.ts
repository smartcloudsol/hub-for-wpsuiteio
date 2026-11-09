/// <reference types="node" />
import { defineConfig } from "tsup";
import externalGlobal from "esbuild-plugin-external-global";
import fs from "fs";
import path from "path";
import { transitionNodeRefCompat } from "./transition-node-ref-compat.mjs";

export default defineConfig({
  entry: {
    "mantine-vendor": "src/index.ts",
  },
  format: ["iife"],
  globalName: "WpSuiteMantine",
  platform: "browser",
  bundle: true,
  treeshake: true,
  minify: true,
  sourcemap: false,
  dts: false,
  clean: true,
  external: ["react", "react-dom", "react/jsx-runtime"],
  // Preserve the upstream BSD notice in every redistributed vendor bundle.
  esbuildOptions(options) {
    const license = fs.readFileSync("node_modules/react-transition-group/LICENSE", "utf8");
    options.banner = { ...options.banner, js: `/*! react-transition-group 4.4.5\n${license}\n*/` };
  },
  esbuildPlugins: [
    transitionNodeRefCompat(),
    externalGlobal.externalGlobalPlugin({
      react: "React",
      "react/jsx-runtime": "ReactJSXRuntime",
      "react-dom": "ReactDOM",
    }),
  ],
  onSuccess: async () => {
    const dist = "dist";
    const src = path.join(dist, "mantine-vendor.global.js");
    const dst = path.join(dist, "mantine-vendor.min.js");

    if (fs.existsSync(src)) fs.renameSync(src, dst);
    fs.copyFileSync("node_modules/react-transition-group/LICENSE", path.join(dist, "react-transition-group.LICENSE.txt"));
  },
});
