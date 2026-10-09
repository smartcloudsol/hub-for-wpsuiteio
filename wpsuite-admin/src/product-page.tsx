import { Button, Group, Paper, Stack, Text } from "@mantine/core";
import { __ } from "@wordpress/i18n";
import { TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

import BackendReadiness from "./backend-readiness";
import type { BackendId } from "./backend-readiness-cache";
import { ProductDetailsContext } from "./product-page-context";

function readPanel(): boolean {
  const query = new URL(window.location.href).searchParams;
  return query.get("panel") === "details" || (query.get("panel") !== "summary" && (query.has("section") || query.has("aikit-page")));
}

/** Keep both mounted: folding a panel must never discard a staged form. */
export default function ProductPage({ children, backendId }: { children: ReactNode; backendId?: BackendId }) {
  const [details, setDetails] = useState(readPanel);
  const saved = useRef(false);
  const mounted = useRef(false);
  const nativeEdited = useRef(false);
  const reloadNative = useCallback((destination: string) => {
    if (nativeEdited.current && !window.confirm(__("Setup has changed. Reload detailed settings to use the saved values? Any unsaved edits in detailed settings will be discarded.", TEXT_DOMAIN))) {
      const url = new URL(window.location.href);
      url.searchParams.set("panel", "summary");
      window.history.replaceState(window.history.state, "", url);
      window.dispatchEvent(new Event("wpsuite-admin-history-change"));
      setDetails(false);
      return;
    }
    window.location.assign(destination);
  }, []);
  useEffect(() => {
    const pop = () => {
      if (readPanel() && saved.current) { reloadNative(window.location.href); return; }
      setDetails(readPanel());
    };
    const changed = () => { saved.current = true; };
    const native = document.getElementById("wpsuite-product-details");
    const edited = () => { nativeEdited.current = true; };
    native?.addEventListener("input", edited);
    native?.addEventListener("change", edited);
    window.addEventListener("popstate", pop);
    window.addEventListener("wpsuite-product-saved", changed);
    return () => {
      native?.removeEventListener("input", edited);
      native?.removeEventListener("change", edited);
      window.removeEventListener("popstate", pop);
      window.removeEventListener("wpsuite-product-saved", changed);
    };
  }, [reloadNative]);
  useEffect(() => {
    const element = document.getElementById("wpsuite-product-details");
    if (element) element.hidden = !details;
    if (mounted.current && !details) window.dispatchEvent(new Event("wpsuite-product-summary-open"));
    mounted.current = true;
  }, [details]);

  function select(next: boolean) {
    if (next === details) return;
    const url = new URL(window.location.href);
    url.searchParams.set("panel", next ? "details" : "summary");
    // Native settings may have been hydrated before setup was saved. Rehydrate
    // through the canonical bootstraps instead of showing stale editable values.
    if (next && saved.current) { reloadNative(url.href); return; }
    const state = { ...window.history.state };
    const marker = state.wpsuiteAdminSectionHistory;
    if (marker && Number.isSafeInteger(marker.index)) {
      state.wpsuiteAdminSectionHistory = { ...marker, index: marker.index + 1 };
    }
    window.history.pushState(state, "", url);
    window.dispatchEvent(new Event("wpsuite-admin-history-change"));
    setDetails(next);
  }

  return <Stack gap="md">
    <Paper withBorder radius="md" p="md">
      <Group justify="space-between" gap="sm">
        <Stack gap={2}>
          <Text fw={600}>{details ? __("Detailed settings", TEXT_DOMAIN) : __("Setup and status", TEXT_DOMAIN)}</Text>
          <Text size="sm" c="dimmed">{details ? __("Your setup summary is folded away. Open it anytime without leaving this page.", TEXT_DOMAIN) : __("Review your setup or open all settings for this tool.", TEXT_DOMAIN)}</Text>
        </Stack>
        <Button variant={details ? "light" : "default"} aria-expanded={details} aria-controls="wpsuite-product-details" onClick={() => select(!details)}>
          {details ? __("Show setup and status", TEXT_DOMAIN) : __("Advanced settings and resources", TEXT_DOMAIN)}
        </Button>
      </Group>
    </Paper>
    {details && backendId && <BackendReadiness id={backendId} compact detailed />}
    <ProductDetailsContext.Provider value={details}><div hidden={details} id="wpsuite-product-summary">{children}</div></ProductDetailsContext.Provider>
  </Stack>;
}
