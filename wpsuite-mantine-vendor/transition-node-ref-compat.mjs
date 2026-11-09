// Compatibility patch for react-transition-group 4.4.5, BSD 3-Clause.
// Mantine Notifications is the sole permitted importer and supplies nodeRef
// for every Transition. We fail closed if another caller omits it. Do not
// silently adapt future upstream code: both inputs are pinned by SHA-256.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const transitionHash = "c3b1e364895a73f6c2378cc0e70f8b87fb69c042fcab243118bff7048873ecd4";
const importerHash = "b1698a24386602b10e442b919aa2571b70aa242b4172cf95f1ec20bb67adb729";
const digest = (source) => crypto.createHash("sha256").update(source).digest("hex");
const unsupportedCall = "ReactDOM.findDOMNode(this)";

export function patchTransition(source) {
  if (digest(source) !== transitionHash || source.split(unsupportedCall).length - 1 !== 4) {
    throw new Error("Unexpected react-transition-group Transition source; review compatibility patch.");
  }
  return `function requireTransitionNodeRef() { throw new Error("WP Suite transition requires nodeRef"); }\n${source.replaceAll(unsupportedCall, "requireTransitionNodeRef()")}`;
}

export function transitionNodeRefCompat() {
  let transitionPatched = false;
  let importerVerified = false;
  return {
    name: "wpsuite-transition-node-ref-compat",
    setup(build) {
      build.onResolve({ filter: /^react-transition-group(?:\/.*)?$/ }, (args) => {
        const expected = `${path.sep}@mantine${path.sep}notifications${path.sep}esm${path.sep}Notifications.mjs`;
        if (args.path !== "react-transition-group" || !args.importer.endsWith(expected) || digest(fs.readFileSync(args.importer)) !== importerHash) {
          throw new Error("Unexpected react-transition-group importer; review its nodeRef use.");
        }
        importerVerified = true;
        return undefined;
      });
      build.onLoad({ filter: /react-transition-group[\\/]esm[\\/]Transition\.js$/ }, (args) => {
        transitionPatched = true;
        return { contents: patchTransition(fs.readFileSync(args.path, "utf8")), loader: "js", resolveDir: path.dirname(args.path) };
      });
      build.onEnd(() => {
        if (!transitionPatched || !importerVerified) return { errors: [{ text: `Expected Mantine notification transition was not verified and patched (importer=${importerVerified}, transition=${transitionPatched}).` }] };
        return undefined;
      });
    },
  };
}
