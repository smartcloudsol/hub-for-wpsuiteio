import { Alert, Button, Card, Group, NativeSelect, Stack, Text, TextInput } from "@mantine/core";
import { useCallback, useEffect, useState } from "react";
import { announceBackendProfileChange, backendProfileHeaders, getWpSuite } from "@smart-cloud/wpsuite-core";

type ProfileId = "production" | "development";
type BackendType = "legacy" | "foundation";
interface ProfileDraft { workspaceId: string; siteId: string; backendType: BackendType; api: string; configUrl: string }
const emptyDraft = (backendType: BackendType): ProfileDraft => ({ workspaceId: "", siteId: "", backendType, api: "", configUrl: "" });

interface ProfileStatus {
  enabled: boolean;
  active: "production" | "development";
  generation: number;
  profiles: Array<{ id: "production" | "development"; configured: boolean; valid?: boolean }>;
  currentConnection?: { workspaceId?: string; accountId?: string; siteId?: string; workspaceApiMode?: string; platformApiBaseUrl?: string; platformConfigUrl?: string };
}

const labels = { production: "Production backend", development: "Development test backend" };

export function BackendProfiles({ nonce }: { nonce?: string }) {
  const suite = getWpSuite();
  const available = suite?.backendProfilesAvailable === true;
  const [status, setStatus] = useState<ProfileStatus>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [configure, setConfigure] = useState<"production" | "development">("production");
  const [drafts, setDrafts] = useState<Record<ProfileId, ProfileDraft>>({ production: emptyDraft("legacy"), development: emptyDraft("foundation") });
  const [siteKey, setSiteKey] = useState("");
  const draft = drafts[configure];
  const { workspaceId, siteId, api, configUrl } = draft;
  const foundation = configure === "development" || draft.backendType === "foundation";
  const editDraft = (changes: Partial<ProfileDraft>) => setDrafts(previous => ({ ...previous, [configure]: { ...previous[configure], ...changes } }));
  const currentOwner: ProfileId = status?.enabled ? status.active
    : status?.currentConnection?.workspaceApiMode === "workspace" && status.currentConnection.platformApiBaseUrl === "https://api-dev.wpsuite.io" ? "development" : "production";
  const canReuseKey = !!status && configure === currentOwner
    && workspaceId.trim() === (status.currentConnection?.workspaceId ?? status.currentConnection?.accountId ?? "")
    && siteId.trim() === (status.currentConnection?.siteId ?? "") && !!workspaceId.trim() && !!siteId.trim();
  const expectedApi = configure === "production" ? "https://api.wpsuite.io" : "https://api-dev.wpsuite.io";
  let validConfigUrl = false;
  try { const url = new URL(configUrl.trim()); validConfigUrl = url.protocol === "https:" && !url.username && !url.password && !url.search && !url.hash && !/[\\\s?#]/.test(configUrl.trim()) && !Array.from(configUrl.trim()).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127); } catch { /* Incomplete drafts are not submitted. */ }
  const canSave = !!status && !busy && !!workspaceId.trim() && !!siteId.trim() && (!!siteKey || canReuseKey)
    && (!foundation || (api.trim() === expectedApi && validConfigUrl));
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
      const connection = value.currentConnection;
      const owner: ProfileId = value.enabled ? value.active : connection?.workspaceApiMode === "workspace" && connection.platformApiBaseUrl === "https://api-dev.wpsuite.io" ? "development" : "production";
      setDrafts(previous => ({ ...previous, [owner]: {
        workspaceId: connection?.workspaceId ?? connection?.accountId ?? suite?.siteSettings.workspaceId ?? suite?.siteSettings.accountId ?? "",
        siteId: connection?.siteId ?? suite?.siteSettings.siteId ?? "",
        backendType: owner === "development" || connection?.workspaceApiMode === "workspace" ? "foundation" : "legacy",
        api: connection?.platformApiBaseUrl ?? "", configUrl: connection?.platformConfigUrl ?? "",
      } }));
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
    if (!status || !canSave) return;
    setBusy(true); setError(undefined);
    try {
      await request("/configure", { profileId: configure, expectedGeneration: status.generation, reuseCurrentKey: siteKey === "",
        connection: { workspaceId: workspaceId.trim(), accountId: workspaceId.trim(), siteId: siteId.trim(), subscriber: true,
          workspaceApiMode: foundation ? "workspace" : "legacy",
          ...(foundation ? { platformApiBaseUrl: api.trim(), platformConfigUrl: configUrl.trim() } : { platformApiBaseUrl: "", platformConfigUrl: "" }), ...(siteKey ? { siteKey } : {}) },
        ...(!foundation ? { legacyApiBaseUrl: "https://api.wpsuite.io", legacyConfigUrl: "https://wpsuite.io/static/config/prod.json" } : {}) });
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
        {status.enabled ? <NativeSelect label="Active backend" description="This selects the backend used by the whole site. Switching takes effect immediately and reloads this page." value={status.active} disabled={busy}
          data={status.profiles.map(profile => ({ value: profile.id, label: labels[profile.id], disabled: !profile.configured || profile.valid === false }))}
          onChange={event => { void activate(event.currentTarget.value); }} /> : <Alert color="blue">Backend profiles are not configured yet. Your current site connection remains active until setup is complete.</Alert>}
        {status.enabled && <Text size="sm">Switching reloads this page and discards unsaved profile edits. Other open tabs will pause saving until they are reloaded.</Text>}
        <details>
          <summary style={{ cursor: "pointer" }}>Configure a backend profile</summary>
          <Stack gap="sm" mt="sm">
            <NativeSelect label="Profile to configure" description="Choose which connection to validate and save. This choice does not switch the active backend." value={configure} disabled={busy} data={Object.entries(labels).map(([value, label]) => ({ value, label }))}
              onChange={event => { const value = event.currentTarget.value; if (value === "production" || value === "development") { setConfigure(value); setSiteKey(""); } }} />
            {configure === "production" ? <NativeSelect label="Production backend type" description="Use legacy production until the production Foundation migration is complete. Foundation requires its matching API and public configuration." value={draft.backendType} disabled={busy}
              data={[{ value: "legacy", label: "Legacy production API" }, { value: "foundation", label: "Foundation API" }]}
              onChange={event => { editDraft({ backendType: event.currentTarget.value as BackendType }); setSiteKey(""); }} />
              : <Text size="sm">The development test profile always uses Foundation. Its workspace, site and connection key belong to the DEV backend.</Text>}
            <Text size="sm">An already configured profile cannot be rebound to a different connection here; that requires the migration procedure. Saving validates the licence and configuration before storing the profile.</Text>
            <TextInput label="Workspace ID" description="Copy the workspace identifier from the dashboard workspace selector in the backend you are configuring. The workspace name is not the ID." placeholder="Example: workspace_123" value={workspaceId} onChange={event => { editDraft({ workspaceId: event.currentTarget.value }); setSiteKey(""); }} disabled={busy} />
            <TextInput label="Site ID" description="Copy the site identifier from that workspace’s site list. Use the matching record in production or DEV, not the WordPress URL." placeholder="Example: site_123" value={siteId} onChange={event => { editDraft({ siteId: event.currentTarget.value }); setSiteKey(""); }} disabled={busy} />
            <TextInput type="password" label="Connection key" description="Use the connection key for that exact site record (dashboard site details → Reveal). This form never loads or reveals a saved key. Leave empty only to reuse the current profile’s key with unchanged workspace and site IDs." autoComplete="off" value={siteKey} onChange={event => setSiteKey(event.currentTarget.value)} disabled={busy} />
            {!siteKey && !canReuseKey && <Text size="sm">Enter the matching site connection key before saving this profile.</Text>}
            {foundation && <>
              <TextInput label="Foundation API URL" description="Copy the Foundation API base URL from its deployment outputs or published platform configuration. This is the WP Suite platform API, not an AI Kit or Flow API URL. Use HTTPS." placeholder={`Example: ${expectedApi}`} value={api} onChange={event => editDraft({ api: event.currentTarget.value })} disabled={busy}
                error={api && api.trim() !== expectedApi ? `This profile requires ${expectedApi}.` : undefined} />
              <TextInput label="Public platform configuration URL" description="Use the published Foundation JSON URL from the deployment configuration, under https://wpsuite.io/static/config/foundation/<env>/…. Use its public HTTPS address, not a raw S3 or internal CloudFront domain. The server verifies that its identity matches the API." placeholder={`Example: https://wpsuite.io/static/config/foundation/${configure === "production" ? "prod" : "dev"}/config.json`} value={configUrl} onChange={event => editDraft({ configUrl: event.currentTarget.value })} disabled={busy}
                error={configUrl && !validConfigUrl ? "Enter a complete HTTPS configuration URL without credentials, query or fragment." : undefined} />
            </>}
            {!foundation && <Text size="sm">Legacy production uses the trusted production API and platform configuration automatically. No Foundation URLs are needed.</Text>}
            <Group><Button onClick={() => { void save(); }} loading={busy} disabled={!canSave}>Validate and save profile</Button></Group>
          </Stack>
        </details>
      </>}
    </Stack>
  </Card>;
}
