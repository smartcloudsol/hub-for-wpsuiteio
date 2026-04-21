import type { WpSuitePluginBase } from "./index";
/** Attaches the default runtime functions to a plugin object */
export declare function attachDefaultPluginRuntime<T extends WpSuitePluginBase>(plugin: T, opts?: {
    timeoutMs?: number;
}): T;
