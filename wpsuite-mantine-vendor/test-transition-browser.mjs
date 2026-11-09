// Local integration test. React 19 comes from WPSUITE_REACT19_DIR (a checkout
// with node_modules/react and react-dom); Playwright may be overridden too.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { patchTransition } from "./transition-node-ref-compat.mjs";
const here = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(here, "../..");
const require = createRequire(import.meta.url);
const esbuild = require("esbuild");
const externalGlobal = require("esbuild-plugin-external-global");
const playwright = process.env.WPSUITE_PLAYWRIGHT || path.join(workspace, "static-publisher/exporter/node_modules/playwright");
const { chromium } = require(playwright);
const versions = [
  { name: "18", directory: here },
  { name: "19", directory: process.env.WPSUITE_REACT19_DIR || path.join(workspace, "docs") },
];
const rtg = path.join(here, "node_modules/react-transition-group/esm/Transition.js");
const transition = await esbuild.build({
  stdin: { contents: `import Transition from ${JSON.stringify(rtg)};globalThis.TestTransition=Transition;`, resolveDir: here },
  bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' },
  plugins: [{ name: "test-transition-patch", setup(build) {
    build.onLoad({ filter: /react-transition-group[\\/]esm[\\/]Transition\.js$/ }, ({ path: file }) => ({ contents: patchTransition(fs.readFileSync(file, "utf8")), resolveDir: path.dirname(file), loader: "js" }));
  } }, externalGlobal.externalGlobalPlugin({ react: "React", "react-dom": "ReactDOM" })],
});
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
try {
  for (const version of versions) {
    const runtime = await esbuild.build({
      stdin: { contents: "import * as React from 'react';import {createRoot} from 'react-dom/client';import * as jsx from 'react/jsx-runtime';globalThis.React=React;globalThis.ReactDOM={createRoot};globalThis.ReactJSXRuntime=jsx;", resolveDir: version.directory },
      bundle: true, write: false, platform: "browser", format: "iife", define: { "process.env.NODE_ENV": '"production"' },
    });
    const page = await browser.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setContent('<div id="root"></div>');
    await page.addScriptTag({ content: runtime.outputFiles[0].text });
    const actual = await page.evaluate(() => React.version);
    if (!actual.startsWith(`${version.name}.`)) throw new Error(`Expected React ${version.name}, got ${actual}`);
    await page.addScriptTag({ path: path.join(here, "dist/mantine-vendor.min.js") });
    await page.evaluate(() => {
      const e = React.createElement;
      ReactDOM.createRoot(document.getElementById("root")).render(e(React.StrictMode, null, e(WpSuiteMantine.MantineProvider, null, e(WpSuiteMantine.Notifications, { withinPortal: false, autoClose: false, transitionDuration: 10 }))));
    });
    await page.waitForTimeout(100);
    await page.evaluate(() => WpSuiteMantine.notifications.show({ id: "alpha", message: "initial", autoClose: false }));
    await page.getByText("initial").waitFor();
    await page.evaluate(() => WpSuiteMantine.notifications.update({ id: "alpha", message: "updated", autoClose: false }));
    await page.getByText("updated").waitFor();
    await page.evaluate(() => WpSuiteMantine.notifications.hide("alpha"));
    await page.getByText("updated").waitFor({ state: "detached" });
    if (errors.length) throw new Error(`React ${actual} notification errors: ${errors.join(", ")}`);
    await page.addScriptTag({ content: transition.outputFiles[0].text });
    await page.evaluate(() => {
      class Boundary extends React.Component {
        constructor(props) { super(props); this.state = { message: "" }; }
        static getDerivedStateFromError(error) { return { message: error.message }; }
        render() { return this.state.message ? React.createElement("p", { id: "caught" }, this.state.message) : this.props.children; }
      }
      const node = document.createElement("div"); document.body.appendChild(node);
      const e = React.createElement;
      ReactDOM.createRoot(node).render(e(Boundary, null, e(TestTransition, { in: true, appear: true, timeout: 1 }, e("div", null, "test"))));
    });
    await page.locator("#caught").waitFor();
    if (await page.locator("#caught").innerText() !== "WP Suite transition requires nodeRef") throw new Error("Missing nodeRef did not fail explicitly");
    console.log(`React ${actual}: notification show/update/dismiss and missing-nodeRef guard PASS`);
    await page.close();
  }
} finally { await browser.close(); }
