import { type TranslationCatalogs } from "./locale.ts";
export type TranslationLoadFailure = "timeout" | "http" | "invalid" | "network";
export interface TranslationLoadOptions {
    cacheVersion?: string | number;
    timeoutMs?: number;
    onError?: (reason: TranslationLoadFailure) => void;
}
export interface CustomTranslationLoadOptions extends TranslationLoadOptions {
    /** Temporary fallback for plugin-specific settings during rolling upgrades. */
    legacyUrl?: string | null;
}
/** Invalid remote dictionaries never prevent a plugin from mounting with built-ins. */
export declare function loadTranslationCatalogs(url?: string | null, options?: TranslationLoadOptions): Promise<TranslationCatalogs | null>;
/**
 * Loads the site-wide custom translation catalog.
 *
 * The shared site setting is authoritative. `legacyUrl` exists only so plugin
 * upgrades can retain their previous per-plugin URL until an administrator
 * saves the new common setting.
 */
export declare function getCustomTranslations(options?: CustomTranslationLoadOptions): Promise<TranslationCatalogs | null>;
