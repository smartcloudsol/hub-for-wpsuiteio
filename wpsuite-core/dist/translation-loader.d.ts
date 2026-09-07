import { type TranslationCatalogs } from "./locale.ts";
export type TranslationLoadFailure = "timeout" | "http" | "invalid" | "network";
export interface TranslationLoadOptions {
    cacheVersion?: string | number;
    timeoutMs?: number;
    onError?: (reason: TranslationLoadFailure) => void;
}
/** Invalid remote dictionaries never prevent a plugin from mounting with built-ins. */
export declare function loadTranslationCatalogs(url?: string | null, options?: TranslationLoadOptions): Promise<TranslationCatalogs | null>;
