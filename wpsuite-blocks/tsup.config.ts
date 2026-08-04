import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    editor: "src/editor.tsx",
  },
  format: ["cjs", "esm"],
  minify: true,
  dts: false,
  splitting: false,
  sourcemap: false,
  clean: true,
  external: [
    "@wordpress/block-editor",
    "@wordpress/blocks",
    "@wordpress/i18n",
    "react",
    "react/jsx-runtime",
  ],
});
