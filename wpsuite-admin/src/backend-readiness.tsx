import { Accordion, Anchor, Badge, Button, Group, Loader, Paper, SimpleGrid, Stack, Text, Title } from "@mantine/core";
import { getWpSuite, TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";
import { __ } from "@wordpress/i18n";
import { useEffect, useState } from "react";

import { backendCacheChanged, backendCacheKey, backendStates, initializeBackendCache, readBackendCache, writeBackendCache, type BackendId, type BackendState } from "./backend-readiness-cache";
import { useBackendDetails, type InventoryId } from "./backend-details";
type DisplayState = BackendState | "connect_site" | "checking";
declare global {
  interface Window {
    smartcloudWpSuiteBackendChecks?: Partial<Record<BackendId, (signal: AbortSignal) => Promise<BackendState>>>;
    WpSuiteAmplify?: { Hub?: { listen: (channel: "auth", callback: (event: { payload: { event: string } }) => void) => () => void } };
  }
}


function adminUrl(page: string, section?: string): string {
  const url = new URL("admin.php", window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("page", page);
  if (section) url.searchParams.set("section", section);
  return url.href;
}

export default function BackendReadiness({ id, compact = false, detailed = false }: { id: BackendId; compact?: boolean; detailed?: boolean }) {
  const [state, setState] = useState<DisplayState>("checking");
  const [attempt, setAttempt] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);
  const { details: config, loading: detailsLoading } = useBackendDetails(id, attempt, id === "forms-workflows" && state === "ready" && (!compact || expanded !== null));


  useEffect(() => {
    const controller = new AbortController();
    let registrationTimer: number | undefined;
    let probeTimer: number | undefined;
    let started = false;
    let finished = false;
    const cacheKey = backendCacheKey(id);

    function finish(next: DisplayState) {
      if (controller.signal.aborted || finished) return;
      finished = true;
      window.clearTimeout(registrationTimer);
      window.clearTimeout(probeTimer);
      window.removeEventListener("smartcloud-wpsuite-backend-ready", tryAdapter);
      if (backendStates.includes(next)) writeBackendCache(cacheKey, next as BackendState);
      setState(next);
    }

    function tryAdapter() {
      if (started || finished || controller.signal.aborted) return;
      const adapter = window.smartcloudWpSuiteBackendChecks?.[id];
      if (!adapter) return;
      started = true;
      window.clearTimeout(registrationTimer);
      window.removeEventListener("smartcloud-wpsuite-backend-ready", tryAdapter);
      probeTimer = window.setTimeout(() => {
        finish("unreachable");
        controller.abort();
      }, 15000);
      void Promise.resolve().then(() => adapter(controller.signal)).then(result => {
        finish(backendStates.includes(result) ? result : "unsupported");
      }).catch(() => finish("unreachable"));
    }

    // Defer the initial check so an immediately unmounted panel performs no work.
    void Promise.resolve().then(() => {
      if (controller.signal.aborted) return;
      setState("checking");
      const site = getWpSuite()?.siteSettings;
      if (!site?.accountId || !site.siteId || !site.siteKey) {
        finish("connect_site");
        return;
      }
      const cached = attempt === 0 ? readBackendCache(cacheKey) : null;
      if (cached) { finished = true; setState(cached); return; }
      window.addEventListener("smartcloud-wpsuite-backend-ready", tryAdapter);
      registrationTimer = window.setTimeout(() => finish("unsupported"), 10000);
      tryAdapter();
    });

    return () => {
      controller.abort();
      window.clearTimeout(registrationTimer);
      window.clearTimeout(probeTimer);
      window.removeEventListener("smartcloud-wpsuite-backend-ready", tryAdapter);
    };
  }, [id, attempt]);

  useEffect(() => {
    initializeBackendCache();
    const changed = () => setAttempt(value => value + 1);
    window.addEventListener(backendCacheChanged, changed);
    return () => window.removeEventListener(backendCacheChanged, changed);
  }, []);

  const apiUrl = adminUrl(id === "answers" ? "smartcloud-ai-kit" : "smartcloud-flow", "api-settings");
  const descriptions: Record<DisplayState, { label: string; detail: string }> = {
    checking: { label: __("Checking backend access…", TEXT_DOMAIN), detail: __("Checking this site's connection, sign-in session and protected backend API.", TEXT_DOMAIN) },
    connect_site: { label: __("Connect this site", TEXT_DOMAIN), detail: __("Connect this WordPress site to WP Suite to load its backend configuration. A WP Suite account session and your site's Cognito session are separate sign-ins.", TEXT_DOMAIN) },
    configure_backend: { label: __("Configure your backend", TEXT_DOMAIN), detail: __("Deploy your own backend through Deployment Access / Quick Launch, then connect it in this plugin's API settings. Connecting a site or having a subscription does not by itself deploy a backend.", TEXT_DOMAIN) },
    sign_in: { label: __("Sign in to your site's Cognito user pool", TEXT_DOMAIN), detail: __("Open Login & Access → WordPress Login and sign in to the configured Cognito pool with an account authorized to administer this backend. This separate sign-in keeps your current WordPress session. Alternatively, enable WordPress integration, map the pool's administrator group to the WordPress administrator role, then sign in to WordPress again. Your WP Suite workspace sign-in does not provide this session.", TEXT_DOMAIN) },
    gatey_missing: { label: __("Gatey is required for backend sign-in", TEXT_DOMAIN), detail: __("Install and activate Gatey, then configure your site's Cognito user pool in Login & Access. Use an account authorized to administer your backend.", TEXT_DOMAIN) },
    forbidden: { label: __("Backend access was denied", TEXT_DOMAIN), detail: __("Sign in to your site's Cognito pool with an account authorized by this backend. If that account already has access, check the API endpoint, deployment and access rules in API settings. An access-denied response can also indicate an incorrect API configuration.", TEXT_DOMAIN) },
    unreachable: { label: __("Backend access could not be verified", TEXT_DOMAIN), detail: __("Check that your backend is deployed and that its API address, browser access and network connection are working, then retry. This result does not establish whether the backend is missing.", TEXT_DOMAIN) },
    unsupported: { label: __("Backend access check is unavailable", TEXT_DOMAIN), detail: __("Check that the API settings point to a deployed, compatible backend with the required administration endpoint. If this page was open during a plugin update, reload it and retry the check.", TEXT_DOMAIN) },
    ready: { label: __("Backend administration access verified", TEXT_DOMAIN), detail: __("A protected, read-only backend request succeeded. Visitor chat responses and workflow execution have not been checked.", TEXT_DOMAIN) },
  };
  const { label, detail } = descriptions[state];
  const modes: Record<string, string> = {
    "local-only": __("Local only", TEXT_DOMAIN),
    "backend-fallback": __("Backend fallback", TEXT_DOMAIN),
    "backend-only": __("Backend only", TEXT_DOMAIN),
  };
  const transport = config?.transport === "gatey" ? __("Gatey", TEXT_DOMAIN) : config?.transport === "fetch" ? __("Custom URL", TEXT_DOMAIN) : undefined;
  const mode = id === "answers" ? modes[config?.mode ?? ""] : transport;
  const inventory: { id: InventoryId; label: string; section: string }[] = [
    { id: "workflows", label: __("Workflows", TEXT_DOMAIN), section: "workflows" },
    { id: "templates", label: __("Email templates", TEXT_DOMAIN), section: "templates" },
    { id: "webhooks", label: __("Webhooks", TEXT_DOMAIN), section: "workflows" },
  ];
  const configuration = <>
    {config && <Stack gap={4}>
      {id === "answers" && mode && <Text size="xs">{__("AI feature execution", TEXT_DOMAIN)}: {mode}</Text>}
      {transport && <Text size="xs">{__("Backend connection", TEXT_DOMAIN)}: {transport}</Text>}
      {config.endpoint && <div><Text size="xs" c="dimmed">{__("Resolved API URL", TEXT_DOMAIN)}</Text><Text size="xs" component="code" style={{ display: "block", overflowWrap: "anywhere" }}>{config.endpoint}</Text></div>}
      {config.apiName && <Text size="xs">{__("API name", TEXT_DOMAIN)}: {config.apiName}</Text>}
      {id === "answers" && mode && <Text size="xs" c="dimmed">{__("This mode controls AI features. Chatbot and DocSearch replies require a backend.", TEXT_DOMAIN)}</Text>}
    </Stack>}
    {id === "forms-workflows" && state === "ready" && <Stack gap="xs">
      <Text size="xs" fw={600}>{__("Configured backend resources", TEXT_DOMAIN)}</Text>
      <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="sm">{inventory.map(item => {
        const result = config?.inventory?.[item.id];
        return <div key={item.id}>
          <Anchor size="xs" href={adminUrl("smartcloud-flow", item.section)}>{item.label}</Anchor>
          <Text size="sm" fw={600}>{detailsLoading ? __("Checking…", TEXT_DOMAIN) : typeof result?.count === "number" ? `${result.partial ? "≥ " : ""}${result.count}` : __("Not available", TEXT_DOMAIN)}</Text>
        </div>;
      })}</SimpleGrid>
      {!detailsLoading && inventory.some(item => config?.inventory?.[item.id]?.unavailable) && <Text size="xs" c="dimmed">{__("Some counts could not be read. Open the corresponding settings to check backend support and permissions.", TEXT_DOMAIN)}</Text>}
      <Text size="xs" c="dimmed">{__("Counts include saved resources, including disabled ones.", TEXT_DOMAIN)}</Text>
    </Stack>}
  </>;
  const brief: Record<DisplayState, string> = {
    checking: __("Checking this site's protected backend API.", TEXT_DOMAIN),
    connect_site: __("Connect this site to WP Suite to load its backend configuration.", TEXT_DOMAIN),
    configure_backend: __("Deploy your backend through Deployment Access / Quick Launch, then connect it in API settings.", TEXT_DOMAIN),
    sign_in: __("Sign in to your site's Cognito pool in Gatey's WordPress Login settings. Your WP Suite sign-in is a separate session.", TEXT_DOMAIN),
    gatey_missing: __("Install and activate Gatey, then configure your Cognito user pool for backend sign-in.", TEXT_DOMAIN),
    forbidden: __("Use an account authorized by this backend, or check the API endpoint and access rules.", TEXT_DOMAIN),
    unreachable: __("Check deployment, API settings and network access, then retry. Backend availability is unverified.", TEXT_DOMAIN),
    unsupported: __("Check that API settings point to a deployed, compatible backend.", TEXT_DOMAIN),
    ready: __("Administration API access verified. Visitor chat and workflow execution are not checked.", TEXT_DOMAIN),
  };
  const compactLabels: Record<DisplayState, string> = {
    checking: __("Checking…", TEXT_DOMAIN),
    connect_site: __("Connect site", TEXT_DOMAIN),
    configure_backend: __("Configuration needed", TEXT_DOMAIN),
    sign_in: __("Sign-in needed", TEXT_DOMAIN),
    gatey_missing: __("Gatey needed", TEXT_DOMAIN),
    forbidden: __("Access denied", TEXT_DOMAIN),
    unreachable: __("Not verified", TEXT_DOMAIN),
    unsupported: __("Check unavailable", TEXT_DOMAIN),
    ready: __("Verified", TEXT_DOMAIN),
  };
  const badge = <Group gap="xs" aria-live="polite" role="status">
    {state === "checking" && <Loader size="xs" />}
    <Badge color={state === "ready" ? "teal" : state === "checking" ? "blue" : "orange"} style={{ height: "auto", whiteSpace: "normal" }} styles={{ label: { whiteSpace: "normal" } }}>{compact ? compactLabels[state] : label}</Badge>
  </Group>;
  const retry = <Button variant="subtle" size="xs" onClick={() => setAttempt(value => value + 1)}>{state === "checking" ? __("Restart check", TEXT_DOMAIN) : __("Check again", TEXT_DOMAIN)}</Button>;
  const actions = <Group gap="sm">
    {state === "connect_site" && <Button component="a" href={adminUrl("smartcloud-wpsuite")} variant="light" size={compact ? "xs" : "sm"}>{__("Manage site connection", TEXT_DOMAIN)}</Button>}
    {(state === "sign_in" || state === "forbidden") && <Button component="a" href={adminUrl("gatey", "wordpress-login")} variant="light" size={compact ? "xs" : "sm"}>{__("Open WordPress Login in Gatey", TEXT_DOMAIN)}</Button>}
    {state === "gatey_missing" && <Button component="a" href={new URL("plugins.php", window.location.href).href} variant="light" size={compact ? "xs" : "sm"}>{__("Manage WordPress plugins", TEXT_DOMAIN)}</Button>}
    {["configure_backend", "forbidden", "unreachable", "unsupported"].includes(state) && <Button component="a" href={apiUrl} variant="light" size={compact ? "xs" : "sm"}>{__("Open API settings", TEXT_DOMAIN)}</Button>}
  </Group>;
  if (compact) return <Accordion value={expanded} onChange={setExpanded} variant="contained" radius="sm" style={detailed ? { width: "100%", maxWidth: 640, alignSelf: "flex-start" } : undefined} styles={{ control: { padding: "8px 10px" }, label: { padding: 0 } }}>
    <Accordion.Item value="backend-access">
      <Accordion.Control aria-label={__("Backend access", TEXT_DOMAIN)}><Group gap="xs" justify="space-between"><Stack gap={0}><Text size="sm" fw={600}>{__("Backend access", TEXT_DOMAIN)}</Text>{mode && <Text size="xs" c="dimmed">{mode}</Text>}</Stack>{badge}</Group></Accordion.Control>
      <Accordion.Panel><Stack gap="sm"><Text size="xs">{detailed ? detail : brief[state]}</Text>{configuration}{actions}<Group>{retry}</Group></Stack></Accordion.Panel>
    </Accordion.Item>
  </Accordion>;
  return <Paper withBorder p="lg" radius="md" component="section" aria-label={__("Backend access", TEXT_DOMAIN)}>
    <Stack gap="sm">
      <Group justify="space-between" align="center">
        <Title order={2} size="h3">{__("Backend access", TEXT_DOMAIN)}</Title>
        {retry}
      </Group>
      {badge}
      <Text size="sm">{detail}</Text>
      {configuration}
      {actions}
    </Stack>
  </Paper>;
}
