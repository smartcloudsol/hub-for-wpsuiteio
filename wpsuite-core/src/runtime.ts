import type { PluginAvailability, WpSuitePluginBase } from "./index";

/** common event name */
function pluginEvent(key: string, suffix: "ready" | "error"): string {
  return `wpsuite:${key}:${suffix}`;
}

/** common “await-ready” availability (does not return initializing) */
function makeAvailability(
  plugin: Pick<WpSuitePluginBase, "key" | "status">,
  timeoutMs = 8000
): () => Promise<PluginAvailability> {
  return () =>
    new Promise<PluginAvailability>((resolve) => {
      // fast path
      if (plugin.status === "available") return resolve("available");
      if (plugin.status === "error") return resolve("error");
      if (!plugin.status || plugin.status === "unavailable") {
        // not initialized / not present → wait a bit (maybe it will register later)
      }

      const readyEvt = pluginEvent(plugin.key, "ready");
      const errEvt = pluginEvent(plugin.key, "error");

      const onReady = () => cleanup("available");
      const onError = () => cleanup("error");

      let t: number | undefined = undefined;

      const cleanup = (result: PluginAvailability) => {
        window.removeEventListener(readyEvt, onReady);
        window.removeEventListener(errEvt, onError);
        if (t !== undefined) window.clearTimeout(t);
        resolve(result);
      };

      window.addEventListener(readyEvt, onReady, { once: true });
      window.addEventListener(errEvt, onError, { once: true });

      t = window.setTimeout(() => cleanup("unavailable"), timeoutMs);
    });
}

/** common onReady wrapper */
function makeOnReady(key: string): (cb: () => void) => void {
  return (cb) => {
    window.addEventListener(pluginEvent(key, "ready"), () => cb(), {
      once: true,
    });
  };
}

/** Attaches the default runtime functions to a plugin object */
export function attachDefaultPluginRuntime<T extends WpSuitePluginBase>(
  plugin: T,
  opts?: { timeoutMs?: number }
): T {
  const timeoutMs = opts?.timeoutMs ?? 8000;
  plugin.availability ??= makeAvailability(plugin, timeoutMs);
  plugin.onReady ??= makeOnReady(plugin.key);
  return plugin;
}
