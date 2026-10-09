import { useEffect, useRef, useState } from "react";
import { backendCacheChanged, backendCacheKey, type BackendId } from "./backend-readiness-cache";

export type InventoryId = "workflows" | "templates" | "webhooks";
export type InventoryCount = { count?: number; partial?: boolean; unavailable?: "unsupported" | "failed" };
export interface BackendDetails {
  mode?: string;
  transport?: string;
  apiName?: string;
  endpoint?: string;
  inventory?: Partial<Record<InventoryId, InventoryCount>>;
}
declare global {
  interface Window {
    smartcloudWpSuiteBackendDetails?: Partial<Record<BackendId, (signal: AbortSignal, includeInventory: boolean) => Promise<BackendDetails>>>;
  }
}

/** An endpoint is explanatory metadata; never display embedded credentials. */
export function displayEndpoint(value?: string): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
    return url.origin + url.pathname;
  } catch { return undefined; }
}

const cache = new Map<string, { time: number; value: BackendDetails }>();
if (typeof window !== "undefined") window.addEventListener(backendCacheChanged, () => cache.clear());

/** Config metadata is cheap; remote inventory is fetched only on expansion. */
export function useBackendDetails(id: BackendId, attempt: number, includeInventory: boolean) {
  const [details, setDetails] = useState<BackendDetails | null>(null);
  const [loading, setLoading] = useState(false);
  const previousAttempt = useRef(attempt);
  useEffect(() => {
    const controller = new AbortController();
    const key = backendCacheKey(id);
    const force = previousAttempt.current !== attempt;
    previousAttempt.current = attempt;
    if (force) cache.delete(key);
    let started = false;
    let timeout: number | undefined;
    const load = () => {
      const adapter = window.smartcloudWpSuiteBackendDetails?.[id];
      if (started || !adapter) return;
      started = true;
      const saved = cache.get(key);
      if (saved && Date.now() - saved.time < 5 * 60 * 1000 && (!includeInventory || saved.value.inventory)) {
        setDetails(saved.value);
        setLoading(false);
        return;
      }
      setLoading(true);
      if (force) setDetails(null);
      timeout = window.setTimeout(() => { controller.abort(); setLoading(false); }, 30_000);
      void adapter(controller.signal, includeInventory).then(value => {
        if (controller.signal.aborted) return;
        const next = { ...value, endpoint: displayEndpoint(value.endpoint) };
        cache.set(key, { time: Date.now(), value: next });
        setDetails(next);
      }).catch(() => {
        if (!controller.signal.aborted) setDetails(null);
      }).finally(() => {
        window.clearTimeout(timeout);
        if (!controller.signal.aborted) setLoading(false);
      });
    };
    window.addEventListener("smartcloud-wpsuite-backend-ready", load);
    load();
    return () => { controller.abort(); window.clearTimeout(timeout); window.removeEventListener("smartcloud-wpsuite-backend-ready", load); };
  }, [id, attempt, includeInventory]);
  return { details, loading };
}
