import { Badge, Button, Stack, Text } from "@mantine/core";
import { useQuery } from "@tanstack/react-query";
import { __ } from "@wordpress/i18n";
import { TEXT_DOMAIN } from "@smart-cloud/wpsuite-core";
import { parseSurface, surfaceEndpoint } from "./navigation";

interface ToolActionProps {
  url: string;
  label: string;
  setupLabel: string;
}

export function ToolAction({ action, needsSetup = false }: { action: ToolActionProps; needsSetup?: boolean }) {
  return <Button component="a" href={action.url} variant="light" color={needsSetup ? "orange.9" : undefined} c={needsSetup ? "light-dark(#9a3412, #ffd8a8)" : undefined}
    style={{ alignSelf: "flex-start", whiteSpace: "normal", height: "auto", minHeight: 36 }}>
    {needsSetup ? action.setupLabel : action.label}
  </Button>;
}

/** Read the plugin's existing local status; never infer backend or AI readiness. */
export default function ToolStatus({ endpoint, nonce, toolId, action }: { endpoint: string; nonce?: string; toolId: string; action: ToolActionProps }) {
  const { data, isPending, isError } = useQuery({
    queryKey: ["wpsuite-tool-status", endpoint],
    queryFn: async () => {
      if (!nonce) throw new Error("WordPress session unavailable");
      const response = await fetch(surfaceEndpoint(endpoint, window.location.origin), {
        credentials: "same-origin", headers: { "X-WP-Nonce": nonce },
      });
      if (!response.ok) throw new Error("Tool status unavailable");
      const surface = parseSurface(await response.json());
      if (!surface) throw new Error("Unsupported tool status");
      return surface;
    },
    retry: false,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  if (isPending || isError || !data) return <Stack gap="sm">
    <Text size="sm" c="dimmed" role={isPending ? "status" : undefined}>{isPending ? __("Checking status…", TEXT_DOMAIN) : __("Status unavailable", TEXT_DOMAIN)}</Text>
    <ToolAction action={action} />
  </Stack>;
  const metrics = toolId === "ai-editing" ? data.metrics.filter(metric => typeof metric.value === "number").slice(-2) : data.metrics.slice(0, 2);
  const needsSetup = data.status.state === "needs_setup";
  let setupAction = action;
  if (needsSetup && data.can_setup === true) {
    const destination = new URL(action.url, window.location.href);
    destination.searchParams.set("setup", "1");
    setupAction = { ...action, url: destination.toString() };
  }
  return <Stack gap="sm">
    <Stack gap={4}>
      {needsSetup && <Badge color="orange.9" c="light-dark(#9a3412, #ffd8a8)" variant="light" style={{ alignSelf: "flex-start" }}>{__("Setup needed", TEXT_DOMAIN)}</Badge>}
      {(!needsSetup || data.status.label !== __("Setup needed", TEXT_DOMAIN)) && <Text size="sm" fw={500}>{data.status.label}</Text>}
      {metrics.length > 0 && <Text size="xs" c="dimmed" style={{ overflowWrap: "anywhere" }}>{metrics.map(metric => `${metric.label}: ${typeof metric.value === "boolean" ? metric.value ? __("Yes", TEXT_DOMAIN) : __("No", TEXT_DOMAIN) : String(metric.value)}`).join(" · ")}</Text>}
    </Stack>
    <ToolAction action={setupAction} needsSetup={needsSetup && (data.can_setup ?? data.can_edit)} />
  </Stack>;
}
