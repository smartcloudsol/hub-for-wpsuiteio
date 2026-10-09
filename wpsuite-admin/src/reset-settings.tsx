import { Alert, Button, Checkbox, Group, List, Loader, Modal, Stack, Text } from "@mantine/core";
import { TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";
import { __ } from "@wordpress/i18n";
import { useEffect, useState } from "react";
import { surfaceEndpoint } from "./navigation";

interface ResetReview {
  schema_version: 1;
  revision: string;
  title: string;
  consequences: string[];
  preserved: string[];
}

function parseReview(value: unknown): ResetReview {
  if (!value || typeof value !== "object"
    || !("schema_version" in value) || value.schema_version !== 1
    || !("revision" in value) || typeof value.revision !== "string" || !value.revision
    || !("title" in value) || typeof value.title !== "string" || !value.title
    || !("consequences" in value) || !Array.isArray(value.consequences) || !value.consequences.length || !value.consequences.every(item => typeof item === "string")
    || !("preserved" in value) || !Array.isArray(value.preserved) || !value.preserved.every(item => typeof item === "string")) {
    throw new Error(__("The reset details could not be loaded. Reload this page and try again.", TEXT_DOMAIN));
  }
  return value as ResetReview;
}

/** The server owns the exact reset scope. Never submit without a fresh review. */
export default function ResetSettings({ endpoint, nonce, disabled = false }: { endpoint?: string | null; nonce?: string; disabled?: boolean }) {
  const [available, setAvailable] = useState(false);
  const [opened, setOpened] = useState(false);
  const [review, setReview] = useState<ResetReview | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    if (endpoint && nonce) {
      void (async () => {
        try {
          const response = await fetch(surfaceEndpoint(endpoint, window.location.origin), { credentials: "same-origin", headers: { "X-WP-Nonce": nonce }, signal: controller.signal });
          if (!response.ok) return;
          parseReview(await response.json());
          if (!controller.signal.aborted) setAvailable(true);
        } catch { /* Unsupported, forbidden, or unavailable reset stays hidden. */ }
      })();
    }
    return () => controller.abort();
  }, [endpoint, nonce]);

  async function request(payload?: { revision: string; confirm: true }) {
    if (!endpoint || !nonce) throw new Error(__("Reload this page to refresh your WordPress session.", TEXT_DOMAIN));
    const response = await fetch(surfaceEndpoint(endpoint, window.location.origin), {
      method: payload ? "POST" : "GET", credentials: "same-origin",
      headers: { "X-WP-Nonce": nonce, ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const body: unknown = await response.json();
    if (!response.ok) {
      throw new Error(body && typeof body === "object" && "message" in body && typeof body.message === "string"
        ? body.message : __("The settings could not be reset. Review the latest details before trying again.", TEXT_DOMAIN));
    }
    return body;
  }

  async function loadReview() {
    setOpened(true); setLoading(true); setError(""); setReview(null); setAcknowledged(false);
    try { setReview(parseReview(await request())); }
    catch (failure) { setError(failure instanceof Error ? failure.message : __("Unable to load reset details.", TEXT_DOMAIN)); }
    finally { setLoading(false); }
  }

  async function reset() {
    if (!review || !acknowledged || busy || loading) return;
    setBusy(true); setError("");
    try {
      const result = await request({ revision: review.revision, confirm: true });
      if (!result || typeof result !== "object" || !("reset" in result) || result.reset !== true || !("reload_required" in result) || result.reload_required !== true) {
        throw new Error(__("The reset response was not recognized. Reload this page to check the settings before trying again.", TEXT_DOMAIN));
      }
      const destination = new URL(window.location.href);
      destination.searchParams.delete("panel");
      destination.searchParams.delete("section");
      destination.searchParams.delete("aikit-page");
      destination.searchParams.set("setup", "1");
      // Unmount every native editor and discard pre-reset bootstraps.
      window.location.assign(destination.href);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : __("Unable to reset settings.", TEXT_DOMAIN));
      setReview(null); setAcknowledged(false); setBusy(false);
    }
  }

  if (!available || !endpoint || !nonce) return null;
  return <>
    <Button variant="subtle" color="red" disabled={disabled} onClick={() => void loadReview()}>{__("Reset settings…", TEXT_DOMAIN)}</Button>
    <Modal className="wpsuite-reset-modal" opened={opened} zIndex={100001} centered title={review?.title ?? __("Reset plugin settings", TEXT_DOMAIN)}
      onClose={() => { if (!busy && !loading) setOpened(false); }} closeOnEscape={!busy && !loading} closeOnClickOutside={!busy && !loading} withCloseButton={!busy && !loading}>
      <Stack>
        {loading && <Group role="status"><Loader size="sm" /><Text>{__("Loading reset details…", TEXT_DOMAIN)}</Text></Group>}
        {error && <Alert color="red" role="alert">{error}</Alert>}
        {review && <>
          <Alert color="red" title={__("All plugin settings will be reset", TEXT_DOMAIN)}>
            {__("This permanently removes all of this plugin’s configuration stored in WordPress, including its advanced settings. It cannot be undone. Active features may stop working until you configure them again.", TEXT_DOMAIN)}
          </Alert>
          <List size="sm">{review.consequences.map((item, index) => <List.Item key={index}>{item}</List.Item>)}</List>
          {!!review.preserved.length && <div><Text fw={600} size="sm" mb="xs">{__("These are preserved", TEXT_DOMAIN)}</Text><List size="sm">{review.preserved.map((item, index) => <List.Item key={index}>{item}</List.Item>)}</List></div>}
          <Checkbox checked={acknowledged} disabled={busy} onChange={event => setAcknowledged(event.currentTarget.checked)} label={__("I understand that all plugin settings will be permanently reset.", TEXT_DOMAIN)} />
        </>}
        <Group>
          {review ? <Button color="red" disabled={!acknowledged || loading} loading={busy} onClick={() => void reset()}>{__("Reset settings", TEXT_DOMAIN)}</Button>
            : !loading && <Button variant="light" onClick={() => void loadReview()}>{__("Review latest reset details", TEXT_DOMAIN)}</Button>}
          <Button variant="default" disabled={busy || loading} onClick={() => setOpened(false)}>{__("Cancel", TEXT_DOMAIN)}</Button>
        </Group>
      </Stack>
    </Modal>
  </>;
}
