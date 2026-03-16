import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.tsx"],
  format: ["cjs", "esm"],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: [
    /^aws-amplify(\/.*)?$/,
    /^@aws-amplify\/ui(\/.*)?$/,
    /^@aws-amplify\/ui-react(\/.*)?$/,
    "country-data-list",
    "jquery",
    "@wordpress/data",
  ],
});
