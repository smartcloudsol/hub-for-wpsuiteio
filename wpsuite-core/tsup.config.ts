import { defineConfig } from "tsup";

import { loadConstants, type Constants } from "./tsup.loader";

const premium = process.env.WPSUITE_PREMIUM === "true";
console.log("PREMIUM BUILD:", premium);

let constants: Constants = {
  __OB_KEY_EXPR__: 0,
  __X_EXPR__: "",
  __Y_EXPR__: "",
};
if (premium) {
  constants = await loadConstants();
}

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  minify: true,
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  define: {
    __WPSUITE_PREMIUM__: String(premium),
    __OB_KEY_EXPR__: JSON.stringify(constants.__OB_KEY_EXPR__),
    __X_EXPR__: JSON.stringify(constants.__X_EXPR__),
    __Y_EXPR__: JSON.stringify(constants.__Y_EXPR__),
  },
});
