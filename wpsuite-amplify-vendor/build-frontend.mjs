import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import externalGlobal from "esbuild-plugin-external-global";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("tsup"))("esbuild");
const directory = fileURLToPath(new URL(".", import.meta.url));
const react = { react: "React", "react-dom": "ReactDOM", "react/jsx-runtime": "ReactJSXRuntime" };
const sharedSdk = /^(aws-amplify|@aws-amplify)\//;
const options = {
  absWorkingDir: directory,
  bundle: true,
  platform: "browser",
  minify: true,
  treeShaking: true,
};

// Discover only the SDK bindings actually used by the tree-shaken UI. Both
// public APIs and UI internals then share one Amplify, Hub and credential store.
const ui = await build({
  ...options,
  entryPoints: ["src/ui.ts"],
  format: "esm",
  external: ["aws-amplify", "aws-amplify/*", "@aws-amplify/*"],
  plugins: [externalGlobal.externalGlobalPlugin(react)],
  write: false,
});
const uiSource = ui.outputFiles[0].text;
const imports = [];
const dependencies = new Map();
const bareImports = new Set();
const globals = { ...react };
const tree = ts.createSourceFile("ui.mjs", uiSource, ts.ScriptTarget.Latest, false, ts.ScriptKind.JS);
for (const statement of tree.statements) {
  if (!ts.isImportDeclaration(statement)) continue;
  const dependency = statement.moduleSpecifier.text;
  if (dependency in react) continue;
  if (dependency !== "aws-amplify" && !sharedSdk.test(dependency)) {
    throw new Error(`Unexpected frontend UI dependency: ${dependency}`);
  }
  if (!statement.importClause) {
    bareImports.add(dependency);
    if (!dependencies.has(dependency)) dependencies.set(dependency, new Map());
    globals[dependency] = `globalThis.WpSuiteAmplify.uiDependencies[${JSON.stringify(dependency)}]`;
    continue;
  }
  const bindings = statement.importClause?.namedBindings;
  if (statement.importClause?.name || !bindings || !ts.isNamedImports(bindings)) {
    throw new Error(`Expected named SDK imports from ${dependency}`);
  }
  const fields = dependencies.get(dependency) ?? new Map();
  for (const binding of bindings.elements) {
    const name = (binding.propertyName ?? binding.name).text;
    if (fields.has(name)) continue;
    const local = `sdkBinding${imports.length}`;
    imports.push(`import { ${name} as ${local} } from ${JSON.stringify(dependency)};`);
    fields.set(name, local);
  }
  dependencies.set(dependency, fields);
  globals[dependency] = `globalThis.WpSuiteAmplify.uiDependencies[${JSON.stringify(dependency)}]`;
}

const namespaceEntries = Array.from(dependencies, ([dependency, fields]) => {
  const entries = Array.from(fields, ([name, local]) => `${JSON.stringify(name)}: ${local}`);
  return `${JSON.stringify(dependency)}: {${entries.join(", ")}}`;
});
const sideEffects = Array.from(bareImports)
  .filter((dependency) => dependencies.get(dependency).size === 0)
  .map((dependency) => `import ${JSON.stringify(dependency)};`);
await build({
  ...options,
  stdin: {
    contents: [
      'export * from "./src/sdk";',
      ...sideEffects,
      ...imports,
      `export const uiDependencies = {${namespaceEntries.join(", ")}};`,
    ].join("\n"),
    resolveDir: directory,
    loader: "js",
  },
  format: "iife",
  globalName: "WpSuiteAmplify",
  outfile: "dist/amplify-sdk.min.js",
});

await build({
  ...options,
  stdin: { contents: uiSource, resolveDir: directory, loader: "js" },
  format: "iife",
  globalName: "WpSuiteAmplifyUi",
  plugins: [externalGlobal.externalGlobalPlugin(globals)],
  footer: { js: "Object.assign(globalThis.WpSuiteAmplify, WpSuiteAmplifyUi);" },
  outfile: "dist/amplify-ui.min.js",
});
