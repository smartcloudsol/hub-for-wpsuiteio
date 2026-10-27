import { Alert, Button, Card, Group, PasswordInput, Select, Stack, Text, TextInput } from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { announceBackendProfileChange, backendProfileHeaders, getWpSuite } from "@smart-cloud/wpsuite-core";

interface ProfileStatus {
  enabled: boolean;
  active: "production" | "development";
  generation: number;
  profiles: Array<{ id: "production" | "development"; configured: boolean; valid?: boolean }>;
  currentConnection?: { workspaceId?: string; accountId?: string; siteId?: string };
}

const labels = { production: "Production backend", development: "Development test backend" };

export function BackendProfiles({ nonce }: { nonce?: string }) {
  const suite = getWpSuite();
  const available = suite?.backendProfilesAvailable === true;
  const [status, setStatus] = useState<ProfileStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [configure, setConfigure] = useState<"production" | "development">("production");
  const [workspaceId, setWorkspaceId] = useState("");
  const [siteId, setSiteId] = useState("");
  const [siteKey, setSiteKey] = useState("");
  const [api, setApi] = useState("");
  const [configUrl, setConfigUrl] = useState("");
  const endpoint = `${suite?.restUrl?.replace(/\/+$/, "") ?? ""}/backend-profiles`;
  const restNonce = nonce ?? suite?.nonce ?? "";

  const request = useCallback(async (suffix = "", body?: unknown): Promise<ProfileStatus> => {
    const response = await fetch(endpoint + suffix, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json", "X-WP-Nonce": restNonce, ...backendProfileHeaders() },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!response.ok) throw new Error(response.status === 409 ? "The backend profile changed. Reload this page before continuing." : "The backend profile request could not be completed. Check the connection and try again.");
    const result = await response.json() as ProfileStatus;
    if (!result || !Array.isArray(result.profiles) || !Number.isSafeInteger(result.generation)) throw new Error("Invalid backend profile status.");
    return result;
  }, [endpoint, restNonce]);

  useEffect(() => {
    if (!available) return;
    let active = true;
    void request().then(value => {
      if (!active) return;
      setStatus(value);
      setWorkspaceId(value.currentConnection?.workspaceId ?? value.currentConnection?.accountId ?? suite?.siteSettings.workspaceId ?? suite?.siteSettings.accountId ?? "");
      setSiteId(value.currentConnection?.siteId ?? suite?.siteSettings.siteId ?? "");
    }).catch(() => { if (active) setError("Backend profiles could not be loaded."); });
    return () => { active = false; };
  }, [available, request, suite?.siteSettings.workspaceId, suite?.siteSettings.accountId, suite?.siteSettings.siteId]);

  const reload = async () => {
    const response = await fetch(`${suite!.restUrl.replace(/\/+$/, "")}/backend-profile-context`, { cache: "no-store", credentials: "same-origin" });
    if (!response.ok) throw new Error("Reload the page to use the saved backend profile.");
    const value = await response.json() as { enabled?: boolean; active: string; generation: number; bindingRevision: number };
    if (value.enabled === true) announceBackendProfileChange({ id: value.active, generation: value.generation, bindingRevision: value.bindingRevision });
    window.location.reload();
  };

  const activate = async (profileId: string | null) => {
    if (!status || !profileId || profileId === status.active || busy) return;
    setBusy(true); setError(undefined);
    try {
      await request("/activate", { profileId, expectedGeneration: status.generation });
      await reload();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Backend profile activation failed."); setBusy(false); }
  };

  const save = async () => {
    if (!status || busy || !workspaceId.trim() || !siteId.trim()) return;
    setBusy(true); setError(undefined);
    try {
      await request("/configure", { profileId: configure, expectedGeneration: status.generation, reuseCurrentKey: siteKey === "",
        connection: { workspaceId: workspaceId.trim(), accountId: workspaceId.trim(), siteId: siteId.trim(), subscriber: true,
          workspaceApiMode: configure === "production" && api === "" && configUrl === "" ? "legacy" : "workspace",
          platformApiBaseUrl: api.trim(), platformConfigUrl: configUrl.trim(), ...(siteKey ? { siteKey } : {}) },
        ...(configure === "production" && !api && !configUrl ? { legacyApiBaseUrl: "https://api.wpsuite.io", legacyConfigUrl: "https://wpsuite.io/static/config/prod.json" } : {}) });
      setSiteKey("");
      await reload();
    } catch (failure) { setSiteKey(""); setError(failure instanceof Error ? failure.message : "Backend profile configuration failed."); setBusy(false); }
  };

  if (!available) return null;
  return <Card withBorder mb="md" padding="md">
    <Stack gap="sm">
      <Text fw={600}>Backend environment</Text>
      <Text size="sm">Production is the normal CMS backend. Use development mode for backend release tests. WordPress content is shared between both modes.</Text>
      {error && <Alert color="red" role="alert">{error}</Alert>}
      {!status ? <Text size="sm">Loading backend profiles…</Text> : <>
        {status.enabled ? <Select label="Active backend" value={status.active} disabled={busy} allowDeselect={false}
          data={status.profiles.map(profile => ({ value: profile.id, label: labels[profile.id], disabled: !profile.configured || profile.valid === false }))}
          onChange={value => { void activate(value); }} /> : <Alert color="blue">Backend profiles are not configured yet. Your current site connection remains active until setup is complete.</Alert>}
        {status.enabled && <Text size="sm">Switching reloads this page. Other open tabs will pause saving until they are reloaded.</Text>}
        <details>
          <summary>Configure a backend profile</summary>
          <Stack gap="sm" mt="sm">
            <Select label="Profile" value={configure} allowDeselect={false} disabled={busy} data={Object.entries(labels).map(([value, label]) => ({ value, label }))}
              onChange={value => { if (value === "production" || value === "development") { setConfigure(value); setApi(""); setConfigUrl(""); setSiteKey(""); } }} />
            <TextInput label="Workspace ID" value={workspaceId} onChange={event => setWorkspaceId(event.currentTarget.value)} disabled={busy} />
            <TextInput label="Site ID" value={siteId} onChange={event => setSiteId(event.currentTarget.value)} disabled={busy} />
            <PasswordInput label="Connection key" description="Leave empty to reuse the current key only when the workspace and site are unchanged." autoComplete="off" value={siteKey} onChange={event => setSiteKey(event.currentTarget.value)} disabled={busy} />
            <TextInput label="Foundation API URL" description={configure === "production" ? "Leave both URLs empty for the current legacy production platform." : "Use this profile’s Foundation API and public JSON configuration."} value={api} onChange={event => setApi(event.currentTarget.value)} disabled={busy} />
            <TextInput label="Public platform configuration URL" value={configUrl} onChange={event => setConfigUrl(event.currentTarget.value)} disabled={busy} />
            <Group><Button onClick={() => { void save(); }} loading={busy} disabled={!workspaceId.trim() || !siteId.trim() || ((api === "") !== (configUrl === "")) || (configure === "development" && !api)}>Validate and save profile</Button></Group>
          </Stack>
        </details>
      </>}
    </Stack>
  </Card>;
}
