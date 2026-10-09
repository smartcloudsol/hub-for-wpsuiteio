import BackendReadiness from "./backend-readiness";
import type { BackendId } from "./backend-readiness-cache";
import { ProductDetailsContext } from "./product-page-context";
import SetupIntroduction from "./setup-introduction";
import IntroductionGallery from "./introduction-gallery";
import ResetSettings from "./reset-settings";
import { Accordion, Alert, Anchor, Autocomplete, Badge, Button, Checkbox, Group, Loader, Modal, NumberInput, Paper, Select, SimpleGrid, Stack, Text, TextInput, Title } from "@mantine/core";
import { getConfig, getWpSuite, TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";
import { __ } from "@wordpress/i18n";
import { useContext, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { parseSurface, runtimeValue, surfaceDraft, surfaceEndpoint, uniqueLinks, type NavigationLink, type CapabilitySurface, type SurfaceAction, type SurfaceField, type SurfaceValue, type SiteUse, type SurfaceStep } from "./navigation";
import { CapabilityHelp, InfoLabel } from "./capability-help";
import PluginSurface from "./plugin-surface";
import classes from "./main.module.css";

export function AdvancedResources({ links }: { links: NavigationLink[] }) {
  const resources = uniqueLinks(links);
  if (!resources.length) return null;
  return <Paper withBorder p="lg" radius="md" component="section" aria-label={__("Advanced settings and resources", TEXT_DOMAIN)}>
    <details>
      <summary style={{ cursor: "pointer" }}>{<InfoLabel text={__("Advanced settings and resources", TEXT_DOMAIN)} helpId="advanced" />}</summary>
      <Text size="sm" c="dimmed" mt="sm" mb="md">{__("Open detailed settings and additional resources for this tool.", TEXT_DOMAIN)}</Text>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="sm">{resources.map(link => <Anchor key={link.url} href={link.url} style={{ overflowWrap: "anywhere" }}>{link.label}</Anchor>)}</SimpleGrid>
    </details>
  </Paper>;
}

function UseOnSite({ use }: { use: SiteUse }) {
  if (!use.items.length) return null;
  return <Paper withBorder p="lg" radius="md" component="section" aria-label={__("Use on this site", TEXT_DOMAIN)}>
    <Stack gap="md">
      <Title order={2} size="h3" aria-label={__("Use on this site", TEXT_DOMAIN)}><InfoLabel text={__("Use on this site", TEXT_DOMAIN)} helpId="placement" /></Title>
      {use.description && <Text size="sm">{use.description}</Text>}
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">{use.items.map(item => <Paper key={item.id} withBorder p="md" radius="sm" component="article">
        <Stack gap="sm">
          <Title order={3} size="h4" aria-label={item.title}><InfoLabel text={item.title} helpId={item.help_id} /></Title>
          <Text size="sm">{item.description}</Text>
          {item.status && <Text size="sm" c="dimmed">{item.status}</Text>}
          <Group gap="sm">{uniqueLinks(item.links).map((link, index) => <Button key={link.url} component="a" href={link.url} variant={index === 0 ? "filled" : "subtle"} size="xs" styles={{ label: { whiteSpace: "normal", overflowWrap: "anywhere" } }} style={{ height: "auto", minHeight: 34, maxWidth: "100%" }}>{link.label}</Button>)}</Group>
        </Stack>
      </Paper>)}</SimpleGrid>
    </Stack>
  </Paper>;
}

const displayValue = (value: SurfaceValue | null | undefined): string => value === true ? __("Yes", TEXT_DOMAIN) : value === false ? __("No", TEXT_DOMAIN) : value === null || value === undefined || value === "" ? __("Not set", TEXT_DOMAIN) : String(value);

function SuggestedTextField({ field, value, change, disabled, nonce }: { field: SurfaceField; value: string; change: (value: string) => void; disabled: boolean; nonce?: string }) {
  const [result, setResult] = useState<{ query: string; items: { value: string; label: string }[]; failed?: boolean }>({ query: "", items: [] });
  const query = value.trim();
  const endpoint = field.suggestions_url;
  useEffect(() => {
    if (!endpoint || !query || disabled) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      async function search() {
        try {
          if (!nonce) throw new Error("WordPress session unavailable");
          const url = new URL(surfaceEndpoint(endpoint!, window.location.origin));
          url.searchParams.set("q", query);
          const response = await fetch(url.href, { credentials: "same-origin", headers: { "X-WP-Nonce": nonce }, signal: controller.signal });
          if (!response.ok) throw new Error("Suggestions unavailable");
          const data: unknown = await response.json();
          if (!Array.isArray(data)) throw new Error("Invalid suggestions");
          const items: { value: string; label: string }[] = [];
          for (const item of data.slice(0, 20)) {
            if (typeof item !== "object" || item === null || typeof item.value !== "string" || typeof item.label !== "string" || item.value.length > 512 || item.label.length > 1024 || items.some(existing => existing.value === item.value)) throw new Error("Invalid suggestion");
            items.push({ value: item.value, label: item.label });
          }
          if (!controller.signal.aborted) setResult({ query, items });
        } catch { if (!controller.signal.aborted) setResult({ query, items: [], failed: true }); }
      }
      void search();
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [endpoint, query, nonce, disabled]);
  const items = result.query === query ? result.items : [];
  return <Stack gap={4}>
    <Autocomplete aria-label={field.label} label={<InfoLabel text={field.label} helpId={field.help_id} />} description={field.description} required={field.required} disabled={disabled} value={value} onChange={change}
      data={items.map(item => item.value)} filter={({ options }) => options}
      renderOption={({ option }) => <Text size="sm" style={{ overflowWrap: "anywhere" }}>{items.find(item => item.value === option.value)?.label ?? option.value}</Text>}
      comboboxProps={{ withinPortal: false }} maxDropdownHeight={240} autoSelectOnBlur={false} />
    {result.query === query && result.failed && <Text size="xs" c="dimmed" role="status">{__("Page suggestions are unavailable. You can still enter a path.", TEXT_DOMAIN)}</Text>}
  </Stack>;
}

function Fields({ fields, values, change, disabled, nonce, inModal = false }: { inModal?: boolean; fields: SurfaceField[]; values: Record<string, SurfaceValue>; change: (id: string, value: SurfaceValue) => void; disabled: boolean; nonce?: string }) {
  return <Stack gap="md">{fields.map(field => {
    const props = { "aria-label": field.label, label: <InfoLabel text={field.label} helpId={field.help_id} />, description: field.description, required: field.required, disabled };
    const value = values[field.id];
    if (field.type === "checkbox") return <Checkbox key={field.id} {...props} checked={value === true} onChange={event => change(field.id, event.currentTarget.checked)} />;
    if (field.type === "select") return <Select key={field.id} {...props} data={field.options ?? []} value={typeof value === "string" && value ? value : null} onChange={next => change(field.id, next ?? "")} allowDeselect={false} comboboxProps={{ withinPortal: inModal, zIndex: inModal ? 100002 : undefined }} />;
    if (field.type === "number") return <NumberInput key={field.id} {...props} value={typeof value === "number" || typeof value === "string" ? value : ""} onChange={next => change(field.id, next)} />;
    if (field.type === "text" && field.suggestions_url) return <SuggestedTextField key={field.id} field={field} value={typeof value === "string" ? value : ""} disabled={disabled} nonce={nonce} change={next => change(field.id, next)} />;
    return <TextInput key={field.id} {...props} type={field.type === "url" ? "url" : "text"} value={typeof value === "string" ? value : ""} onChange={event => change(field.id, event.currentTarget.value)} />;
  })}</Stack>;
}

function fieldError(fields: SurfaceField[], values: Record<string, SurfaceValue>): string | null {
  for (const field of fields) {
    const value = values[field.id];
    if (field.required && (value === "" || value === undefined || (field.type === "checkbox" && value !== true))) return `${field.label}: ${__("This field is required.", TEXT_DOMAIN)}`;
    if (field.type === "number" && (typeof value !== "number" || !Number.isFinite(value))) return `${field.label}: ${__("Enter a number.", TEXT_DOMAIN)}`;
    if (field.type === "select" && !field.options?.some(option => option.value === value)) return `${field.label}: ${__("Choose an available option.", TEXT_DOMAIN)}`;
  }
  return null;
}

function Values({ fields, values }: { fields: SurfaceField[]; values: Record<string, SurfaceValue> }) {
  return <Stack component="dl" gap="sm" m={0}>{fields.map(field => <div key={field.id}>
    <Text component="dt" size="sm" c="dimmed">{<InfoLabel text={field.label} helpId={field.help_id} />}</Text>
    <Text component="dd" m={0} style={{ overflowWrap: "anywhere" }}>{field.type === "select" ? field.options?.find(option => option.value === values[field.id])?.label ?? displayValue(values[field.id]) : displayValue(values[field.id])}</Text>
  </div>)}</Stack>;
}

function SettingsSummary({ steps, values }: { steps: SurfaceStep[]; values: Record<string, SurfaceValue> }) {
  return <SimpleGrid cols={{ base: 1, sm: 2, lg: 3 }} spacing="lg">{steps.filter(step => step.fields.length > 0).map(step => <section key={step.id} style={{ minWidth: 0 }}>
    <Title order={3} size="h5" mb="sm" aria-label={step.title}><InfoLabel text={step.title} helpId={step.help_id} /></Title>
    <Values fields={step.fields} values={values} />
  </section>)}</SimpleGrid>;
}

function RuntimeSummary({ surface, compact = false }: { surface: CapabilitySurface; compact?: boolean }) {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null);
  const site = getWpSuite()?.siteSettings;
  const canRead = Boolean(surface.runtime_plugin && site?.accountId && site.siteId && site.siteKey);
  const [loading, setLoading] = useState(canRead);
  const plugin = surface.runtime_plugin;
  useEffect(() => {
    let active = true;
    if (!plugin || !canRead) return;
    getConfig(plugin).then(value => { if (active) setConfig(value); }).catch(() => { if (active) setConfig(null); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [plugin, canRead]);
  return <section aria-label={__("Connected configuration", TEXT_DOMAIN)}>
    {!compact && <Title order={2} size="h3" mb="sm">{__("Connected configuration", TEXT_DOMAIN)}</Title>}
    <Text size="sm" c="dimmed" mb="sm">{__("Read-only information from the connected WP Suite site.", TEXT_DOMAIN)}</Text>
    {loading ? <Text role="status">{__("Loading Pro information…", TEXT_DOMAIN)}</Text> : config ? <SimpleGrid component="dl" cols={{ base: 1, sm: 2, lg: 3 }} spacing="md" m={0}>
      {surface.runtime_fields?.map(field => <div key={field.path}><Text component="dt" size="sm" c="dimmed">{field.label}</Text><Text component="dd" m={0} style={{ overflowWrap: "anywhere" }}>{displayValue(runtimeValue(config, field))}</Text></div>)}
    </SimpleGrid> : <Text size="sm">{__("Pro information is not available.", TEXT_DOMAIN)}</Text>}
  </section>;
}

class SurfaceRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

function clearSetupIntent() {
  const url = new URL(window.location.href);
  if (url.searchParams.has("setup")) {
    url.searchParams.delete("setup");
    window.history.replaceState(window.history.state, "", url);
  }
}

export default function CapabilitySurfacePage({ backendId, endpoint, resetEndpoint, nonce, registrationLinks, extensionId, integrated = false }: { backendId?: BackendId; integrated?: boolean; endpoint: string; resetEndpoint?: string | null; nonce?: string; registrationLinks: NavigationLink[]; extensionId?: string | null }) {
  const detailsVisible = useContext(ProductDetailsContext);
  const [surface, setSurface] = useState<CapabilitySurface | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [message, setMessage] = useState("");
  const [messageColor, setMessageColor] = useState("green");
  const [redirect, setRedirect] = useState<string | null>(null);
  const [wizard, setWizard] = useState(false);
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<Record<string, SurfaceValue>>({});
  const [action, setAction] = useState<SurfaceAction | null>(null);
  const [actionInput, setActionInput] = useState<Record<string, SurfaceValue>>({});
  const [actionError, setActionError] = useState("");
  const [showRuntime, setShowRuntime] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { if (wizard) heading.current?.focus(); }, [step, wizard]);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        if (!nonce) throw new Error(__("Reload this page to refresh your WordPress session.", TEXT_DOMAIN));
        const response = await fetch(surfaceEndpoint(endpoint, window.location.origin), { credentials: "same-origin", headers: { "X-WP-Nonce": nonce }, signal: controller.signal });
        const body: unknown = await response.json();
        if (!response.ok) throw requestError(body, response.status);
        const next = parseSurface(body);
        if (!next) throw new Error(__("This tool could not be displayed. Its Advanced settings remain available.", TEXT_DOMAIN));
        if (!controller.signal.aborted) {
          setSurface(next); setDraft(surfaceDraft(next.steps.flatMap(item => item.fields), next.values));
          const startSetup = (!next.configured || new URL(window.location.href).searchParams.get("setup") === "1") && next.can_edit && next.steps.length > 0;
          setWizard(startSetup);
          if (startSetup) clearSetupIntent();
        }
      } catch (failure) { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : __("Unable to load this tool.", TEXT_DOMAIN)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void load();
    return () => controller.abort();
  }, [endpoint, nonce]);

  async function request(method: "GET" | "PATCH" | "POST", payload?: unknown) {
    if (!nonce) throw new Error(__("Reload this page to refresh your WordPress session.", TEXT_DOMAIN));
    const response = await fetch(surfaceEndpoint(endpoint, window.location.origin, method === "POST"), {
      method, credentials: "same-origin", headers: { "X-WP-Nonce": nonce, ...(payload ? { "Content-Type": "application/json" } : {}) },
      ...(payload ? { body: JSON.stringify(payload) } : {}),
    });
    const body: unknown = await response.json();
    if (!response.ok) throw requestError(body, response.status);
    return body;
  }

  async function refresh() {
    const next = parseSurface(await request("GET"));
    if (!next) throw new Error(__("This tool could not be displayed.", TEXT_DOMAIN));
    setSurface(next); setDraft(surfaceDraft(next.steps.flatMap(item => item.fields), next.values));
    return next;
  }

  function showError(failure: unknown) {
    setError(failure instanceof Error ? failure.message : __("The request could not be completed.", TEXT_DOMAIN));
    setConflict(failure instanceof SurfaceRequestError && failure.status === 409);
  }

  async function reloadLatest() {
    setBusy(true); setError(""); setConflict(false);
    try {
      const next = await refresh(); setStep(0); setWizard(!next.configured && next.can_edit && next.steps.length > 0);
    } catch (failure) { showError(failure); }
    finally { setBusy(false); }
  }

  const refreshSummary = useRef<() => void>(() => {});
  useLayoutEffect(() => {
    refreshSummary.current = () => { if (!wizard && !busy) void reloadLatest(); };
  });
  useEffect(() => {
    const open = () => refreshSummary.current();
    window.addEventListener("wpsuite-product-summary-open", open);
    return () => window.removeEventListener("wpsuite-product-summary-open", open);
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!surface || busy) return;
    const fields = surface.steps.flatMap(item => item.fields);
    const invalid = fieldError(step < surface.steps.length ? surface.steps[step].fields : fields, draft);
    if (invalid) { setError(invalid); return; }
    setError(""); setConflict(false);
    if (step < surface.steps.length) { setStep(step + 1); return; }
    setBusy(true); setMessage("");
    try {
      const saved = parseSurface(await request("PATCH", { values: surfaceDraft(fields, draft), revision: surface.revision }));
      if (!saved) throw new Error(__("The plugin returned an unsupported save response. Refresh before making further changes.", TEXT_DOMAIN));
      clearSetupIntent();
      setSurface(saved); setWizard(false); setMessageColor("green"); setMessage(__("Settings saved.", TEXT_DOMAIN));
      await refresh();
      window.dispatchEvent(new Event("wpsuite-product-saved"));
    } catch (failure) { showError(failure); }
    finally { setBusy(false); }
  }

  async function runAction(selected: SurfaceAction, values: Record<string, SurfaceValue>) {
    const invalid = fieldError(selected.fields, values);
    if (invalid) { setActionError(invalid); return; }
    setBusy(true); setActionError(""); setError(""); setMessage(""); setRedirect(null);
    try {
      const result = await request("POST", { action: selected.id, input: surfaceDraft(selected.fields, values) });
      if (typeof result !== "object" || result === null || !("message" in result) || typeof result.message !== "string") throw new Error(__("The plugin returned an unsupported action response.", TEXT_DOMAIN));
      let destination: string | null = null;
      if ("redirect" in result && result.redirect !== undefined) {
        if (typeof result.redirect !== "string") throw new Error(__("The plugin returned an invalid action destination.", TEXT_DOMAIN));
        destination = surfaceEndpoint(result.redirect, window.location.origin);
      }
      setMessageColor("severity" in result && result.severity === "warning" ? "yellow" : "severity" in result && result.severity === "error" ? "red" : "green");
      setMessage(result.message); setRedirect(destination); setAction(null);
      window.dispatchEvent(new Event("wpsuite-product-saved"));
      await refresh().catch(showError);
    } catch (failure) {
      if (action) setActionError(failure instanceof Error ? failure.message : __("The action could not be completed.", TEXT_DOMAIN));
      else showError(failure);
    } finally { setBusy(false); }
  }

  if (loading) return <Stack><Group role="status"><Loader size="sm" /><Text>{__("Loading tool…", TEXT_DOMAIN)}</Text></Group>{!integrated && <AdvancedResources links={registrationLinks} />}</Stack>;
  const fields = surface?.steps.flatMap(item => item.fields) ?? [];
  const currentStep = surface?.steps[step];
  const actionButtons = surface && <Group>{surface.primary_link && !integrated && <Button component="a" href={surface.primary_link.url}>{surface.primary_link.label}</Button>}{surface.actions.map((item, index) => <Button key={item.id} variant={index === 0 && !surface.primary_link ? "filled" : "light"} disabled={busy} onClick={() => {
    if (item.confirm || item.fields.length) { setAction(item); setActionInput(surfaceDraft(item.fields)); setActionError(""); }
    else void runAction(item, {});
  }}>{item.label}</Button>)}</Group>;
  return <CapabilityHelp topics={surface?.help}><Stack gap="lg">
    {error && <Alert color="red" title={conflict ? __("Settings changed in another session", TEXT_DOMAIN) : __("Unable to complete request", TEXT_DOMAIN)} role="alert">
      <Text size="sm">{error}</Text>
      {conflict && <Text size="sm" my="sm">{__("Your unsaved input is still shown. Reload the latest values before trying again; this discards the unsaved input.", TEXT_DOMAIN)}</Text>}
      <Button variant="light" size="xs" mt="sm" disabled={busy} onClick={() => void reloadLatest()}>{conflict ? __("Discard input and reload latest", TEXT_DOMAIN) : __("Refresh tool", TEXT_DOMAIN)}</Button>
    </Alert>}
    {message && <Alert color={messageColor} role="status"><Text size="sm">{message}</Text>{redirect && <Anchor href={redirect}>{__("Continue", TEXT_DOMAIN)}</Anchor>}</Alert>}
    {surface && <>
      {surface.introduction && (!wizard || step === 0) && <Paper withBorder p="lg" radius="md">
        <SetupIntroduction endpoint={endpoint} defaultOpen={!surface.configured}>
          <summary style={{ cursor: "pointer", fontWeight: 600 }}>{surface.introduction.title}</summary>
          <Text size="sm" mt="sm" mb="md">{surface.introduction.description}</Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>{surface.introduction.items.map(item => <div key={item.title}><Title order={3} size="h5" mb="xs">{item.title}</Title><Text size="sm">{item.description}</Text></div>)}</SimpleGrid>
          {backendId && <IntroductionGallery id={backendId} />}
        </SetupIntroduction>
      </Paper>}
      <Paper withBorder p="lg" radius="md" component="section" aria-label={__("Tool status", TEXT_DOMAIN)}>
        <Stack gap="md">
          <Group justify="space-between"><InfoLabel text={__("Status", TEXT_DOMAIN)} helpId="status" /><Badge color={surface.status.state === "ready" ? "teal" : surface.status.state === "needs_setup" ? "yellow" : "gray"}>{surface.status.label}</Badge><Button variant="subtle" size="xs" disabled={busy || wizard} onClick={() => void reloadLatest()}>{__("Refresh status", TEXT_DOMAIN)}</Button></Group>
          {surface.notice && <Text size="sm">{surface.notice}</Text>}
          {!wizard && surface.metrics.length > 0 && <SimpleGrid cols={{ base: 1, xs: 2, md: 3 }}>{surface.metrics.map((metric, index) => <div key={index}><Text size="sm" c="dimmed">{<InfoLabel text={metric.label} helpId={metric.help_id} />}</Text><Text fw={600} style={{ overflowWrap: "anywhere" }}>{displayValue(metric.value)}</Text></div>)}</SimpleGrid>}
          {!wizard && (surface.primary_link || integrated) && actionButtons}
          {backendId && !detailsVisible && <BackendReadiness id={backendId} compact detailed />}
          {surface.runtime_plugin === "gatey" && !!surface.runtime_fields?.length && <Accordion value={showRuntime} onChange={setShowRuntime} variant="contained" radius="sm" style={{ width: "100%", maxWidth: 640, alignSelf: "flex-start" }}>
            <Accordion.Item value="connected-services">
              <Accordion.Control>{__("Connected services", TEXT_DOMAIN)}</Accordion.Control>
              <Accordion.Panel>{showRuntime && <RuntimeSummary compact key={`${surface.runtime_plugin}-${surface.revision}`} surface={surface} />}</Accordion.Panel>
            </Accordion.Item>
          </Accordion>}
        </Stack>
      </Paper>
      {!wizard && !integrated && !surface.primary_link && surface.actions.length > 0 && <Paper withBorder p="lg" radius="md" component="section" aria-label={__("Actions", TEXT_DOMAIN)}><Title order={2} size="h3" mb="md">{__("Actions", TEXT_DOMAIN)}</Title>{actionButtons}</Paper>}
      {!wizard && extensionId && <PluginSurface id={extensionId} />}
      {wizard ? <Paper withBorder p="lg" radius="md" component="section" aria-label={__("Setup", TEXT_DOMAIN)}>
        <form onSubmit={event => void save(event)}>
          <Stack gap="md">
            <Text size="sm" c="dimmed">{__("Setup", TEXT_DOMAIN)} · {step + 1} / {surface.steps.length + 1}</Text>
            <Title order={2} ref={heading} tabIndex={-1} aria-label={currentStep?.title ?? __("Review settings", TEXT_DOMAIN)}><InfoLabel text={currentStep?.title ?? __("Review settings", TEXT_DOMAIN)} helpId={currentStep?.help_id ?? "setup"} /></Title>
            {currentStep ? <>
              {currentStep.description && <Text size="sm">{currentStep.description}</Text>}
              <Fields key={currentStep.id} fields={currentStep.fields} values={draft} disabled={busy} nonce={nonce} change={(id, value) => setDraft(previous => ({ ...previous, [id]: value }))} />
            </> : <><Text size="sm">{__("Only the displayed fields will change. Other settings are preserved.", TEXT_DOMAIN)}</Text><SettingsSummary steps={surface.steps} values={draft} /></>}
            <Group gap="sm" wrap="wrap">
              {step > 0 && <Button type="button" variant="default" disabled={busy} onClick={() => { setStep(step - 1); setError(""); }}>{__("Back", TEXT_DOMAIN)}</Button>}
              <Button type="submit" loading={busy} disabled={conflict}>{currentStep ? __("Next", TEXT_DOMAIN) : __("Save settings", TEXT_DOMAIN)}</Button>
              <Button type="button" variant="subtle" disabled={busy} onClick={() => { clearSetupIntent(); setWizard(false); setError(""); setConflict(false); }}>{__("Cancel", TEXT_DOMAIN)}</Button>
            </Group>
          </Stack>
        </form>
      </Paper> : (fields.length > 0 || (surface.can_edit && surface.steps.length > 0)) && <Paper withBorder p="lg" radius="md" component="section" aria-label={__("Settings", TEXT_DOMAIN)}>
        <Stack gap="md">
          <Title order={2} size="h3" aria-label={__("Settings", TEXT_DOMAIN)}><InfoLabel text={__("Settings", TEXT_DOMAIN)} helpId="setup" /></Title><SettingsSummary steps={surface.steps} values={surface.values} />
          <Group>{surface.can_edit && surface.steps.length > 0 && <Button variant="light" disabled={busy} onClick={() => { setDraft(surfaceDraft(fields, surface.values)); setStep(0); setWizard(true); setError(""); setConflict(false); }}>{surface.configured ? __("Run setup again", TEXT_DOMAIN) : __("Start setup", TEXT_DOMAIN)}</Button>}<ResetSettings endpoint={resetEndpoint} nonce={nonce} disabled={busy} /></Group>
        </Stack>
      </Paper>}
      {!wizard && fields.length === 0 && surface.steps.length === 0 && <Group><ResetSettings endpoint={resetEndpoint} nonce={nonce} disabled={busy} /></Group>}
      {!wizard && surface.use_on_site && <UseOnSite use={surface.use_on_site} />}
      {!backendId && surface.runtime_plugin && surface.runtime_plugin !== "gatey" && !!surface.runtime_fields?.length && <Paper withBorder p="lg" radius="md" component="section" aria-label={__("Pro information", TEXT_DOMAIN)}><Stack gap="sm">
        <button type="button" role="switch" aria-checked={Boolean(showRuntime)} aria-controls="wpsuite-pro-details" className={classes["pro-switch"]} onClick={() => setShowRuntime(showRuntime ? null : "pro")}>
          <span aria-hidden="true" className={classes["pro-switch-track"]}><span className={classes["pro-switch-thumb"]} /></span>
          <span>{__("Show Pro information", TEXT_DOMAIN)}</span>
        </button>
        <InfoLabel text={__("Connected configuration", TEXT_DOMAIN)} helpId="pro" />
        <Text size="sm" c="dimmed">{__("Optional, read-only details from your connected site.", TEXT_DOMAIN)}</Text>
        {showRuntime && <div id="wpsuite-pro-details"><RuntimeSummary key={`${surface.runtime_plugin}-${surface.revision}`} surface={surface} /></div>}
      </Stack></Paper>}
    </>}
    {!integrated && <AdvancedResources links={uniqueLinks(surface?.links ?? [], registrationLinks).filter(link => link.url !== surface?.primary_link?.url && !surface?.use_on_site?.items.some(item => item.links.some(placement => placement.url === link.url)))} />}
    <Modal zIndex={100001} opened={action !== null} onClose={() => { if (!busy) setAction(null); }} title={action?.label} centered closeOnEscape={!busy} closeOnClickOutside={!busy} withCloseButton={!busy}>
      {action && <form onSubmit={event => { event.preventDefault(); void runAction(action, actionInput); }}><Stack>
        {action.confirm && <Text>{action.confirm}</Text>}
        {actionError && <Alert color="red" role="alert">{actionError}</Alert>}
        <Fields inModal fields={action.fields} values={actionInput} disabled={busy} change={(id, value) => setActionInput(previous => ({ ...previous, [id]: value }))} />
        <Group><Button type="submit" loading={busy}>{action.label}</Button><Button type="button" variant="default" disabled={busy} onClick={() => setAction(null)}>{__("Cancel", TEXT_DOMAIN)}</Button></Group>
      </Stack></form>}
    </Modal>
  </Stack></CapabilityHelp>;
}

function requestError(body: unknown, status: number): SurfaceRequestError {
  const message = typeof body === "object" && body !== null && "message" in body && typeof body.message === "string" ? body.message : __("The WordPress request failed. Please try again.", TEXT_DOMAIN);
  return new SurfaceRequestError(message, status);
}
